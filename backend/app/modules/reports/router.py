"""Dashboard, global search and reports. Everything here is read-only and worked out when asked for."""
import csv
import io
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.crud import like
from app.core.deps import Principal, get_db, get_principal, require
from app.core.errors import Forbidden, Invalid
from app.core.money import ZERO, Money, money
from app.modules.customers.models import Customer
from app.modules.dispatch.models import DispatchAssignment
from app.modules.documents.models import Document
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.finance import service as finance
from app.modules.finance.models import Invoice, Payment, PaymentAllocation
from app.modules.finance.schemas import Receivables
from app.modules.loads import service as loads
from app.modules.loads.models import Load, LoadStop
from app.modules.loads.schemas import BoardSummary
from app.modules.maintenance import service as maintenance
from app.modules.maintenance.models import WorkOrder
from app.modules.organizations.models import Terminal
from app.modules.safety.router import SafetySummary, summary_counts
from app.modules.settlements import service as settlements

router = APIRouter()
DELIVERED = ("delivered", "pod_review", "completed")


# ---------------------------------------------------------------- dashboard
class Fleet(BaseModel):
    drivers_active: int
    drivers_on_load: int
    trucks_active: int
    trucks_on_load: int
    trucks_unavailable: int
    trailers_active: int


class Revenue(BaseModel):
    currency: str
    this_month: Money
    last_month: Money
    loads_delivered_this_month: int
    miles_this_month: int


class DashboardSummary(BaseModel):
    """Each block is present only if the caller's role may see it."""
    today: date
    timezone: str
    loads: BoardSummary | None = None
    fleet: Fleet | None = None
    safety: SafetySummary | None = None
    receivables: Receivables | None = None
    revenue: Revenue | None = None


class Exception_(BaseModel):
    """Something that needs a person. `resource` and `params` say which list shows the records behind it."""
    code: str
    severity: Literal["high", "medium", "low"]
    title: str
    detail: str
    count: int
    resource: str
    params: dict[str, str]


def _month_bounds(p: Principal, offset: int = 0) -> tuple:
    first = p.today().replace(day=1)
    for _ in range(offset):
        first = (first - timedelta(days=1)).replace(day=1)
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    return loads.day_bounds(p.timezone, first, last)


def _delivered_totals(db: Session, start, end) -> tuple[int, int, Decimal]:
    row = db.execute(select(func.count(), func.coalesce(func.sum(Load.miles), 0),
                            func.coalesce(func.sum(Load.customer_rate + Load.charges_total), 0))
                     .where(Load.status.in_(DELIVERED), Load.delivered_at >= start, Load.delivered_at < end)).one()
    return row[0], int(row[1]), Decimal(row[2])


def _fleet(db: Session) -> Fleet:
    busy = (select(DispatchAssignment.driver_id, DispatchAssignment.vehicle_id)
            .join(Load, Load.id == DispatchAssignment.load_id)
            .where(DispatchAssignment.status == "active", Load.status.in_(loads.ROLLING)).subquery())
    drivers = db.execute(select(func.count().filter(Driver.status == "active")).select_from(Driver)).scalar_one()
    trucks = db.execute(select(func.count().filter(Vehicle.status == "active"),
                               func.count().filter(Vehicle.status.in_(("in_maintenance", "out_of_service"))))
                        .select_from(Vehicle)).one()
    trailers = db.execute(select(func.count().filter(Trailer.status == "active")).select_from(Trailer)).scalar_one()
    on_load = db.execute(select(func.count(func.distinct(busy.c.driver_id)),
                                func.count(func.distinct(busy.c.vehicle_id))).select_from(busy)).one()
    return Fleet(drivers_active=drivers, drivers_on_load=on_load[0], trucks_active=trucks[0],
                 trucks_on_load=on_load[1], trucks_unavailable=trucks[1], trailers_active=trailers)


@router.get("/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary(terminal_id: uuid.UUID | None = None, p: Principal = Depends(require("dashboard.read")),
                      db: Session = Depends(get_db)):
    out = DashboardSummary(today=p.today(), timezone=p.timezone)
    if p.can("loads.read"):
        out.loads = loads.board_summary(db, p, terminal_id)
    if p.can("drivers.read") and p.can("equipment.read"):
        out.fleet = _fleet(db)
    if p.can("safety.read"):
        out.safety = summary_counts(db, p.today())
    if p.can("invoices.read"):
        out.receivables = finance.receivables(db, p)
    if p.can("loads.rates.read"):
        count, miles, amount = _delivered_totals(db, *_month_bounds(p))
        out.revenue = Revenue(currency=p.currency, this_month=amount, loads_delivered_this_month=count,
                              miles_this_month=miles, last_month=_delivered_totals(db, *_month_bounds(p, 1))[2])
    return out


@router.get("/dashboard/exceptions", response_model=list[Exception_], tags=["dashboard"])
def dashboard_exceptions(p: Principal = Depends(require("dashboard.read")), db: Session = Depends(get_db)):
    """Work that needs attention, most urgent first, limited to what the caller's role can act on or see."""
    found: list[Exception_] = []

    def add(count: int, code: str, severity: str, title: str, detail: str, resource: str, **params: str) -> None:
        if count:
            found.append(Exception_(code=code, severity=severity, title=title, detail=detail, count=count,
                                    resource=resource, params=params))

    if p.can("loads.read"):
        board = loads.board_summary(db, p)
        add(board.at_risk, "LOADS_AT_RISK", "high", "Loads at risk",
            "Late for an appointment, or picking up within a day with no driver", "loads", view="at_risk")
        add(board.unassigned, "LOADS_UNASSIGNED", "medium", "Loads waiting for a driver",
            "Planned loads with nobody assigned", "loads", view="unassigned")
        add(board.missing_pod, "MISSING_POD", "medium", "Delivered without proof of delivery",
            "Upload the signed paperwork so these can be completed and invoiced", "loads", view="missing_pod")
        waiting = db.scalar(select(func.count()).select_from(Load).where(Load.status == "pod_review"))
        if p.can("loads.close"):
            add(waiting, "POD_REVIEW", "medium", "Proof of delivery to review",
                "Approve or send back, so the load can be invoiced", "loads", status="pod_review")
        add(board.on_hold, "LOADS_ON_HOLD", "low", "Loads on hold", "Held loads keep their driver and equipment",
            "loads", status="on_hold")
    if p.can("safety.read"):
        safety = summary_counts(db, p.today())
        add(safety.drivers_blocked, "DRIVERS_BLOCKED", "high", "Drivers who can't be dispatched",
            "An expired licence, medical card or required qualification", "safety",
            state="expired", entity_type="driver")
        add(safety.units_blocked, "UNITS_BLOCKED", "high", "Equipment that can't be dispatched",
            "Expired insurance, registration or inspection", "safety", state="expired", entity_type="equipment")
        add(safety.expiring, "EXPIRING_SOON", "medium", "Expiring within 30 days",
            "Renew these before they stop a truck", "safety", state="expiring")
        if p.can("safety.manage"):
            pending = db.scalar(select(func.count()).select_from(Document).where(
                Document.upload_status == "uploaded", Document.review_status == "pending", Document.type != "pod"))
            add(pending, "DOCUMENTS_TO_REVIEW", "low", "Compliance documents to review",
                "Uploaded and waiting for approval", "documents", review_status="pending")
    if p.can("maintenance.read"):
        shop = maintenance.summary(db, p)
        add(shop.urgent_open, "WORK_ORDERS_URGENT", "high", "Urgent work orders",
            "Open repairs marked urgent", "maintenance", priority="urgent", open="true")
        add(shop.overdue, "WORK_ORDERS_OVERDUE", "medium", "Work orders past their date",
            "Scheduled for a day that has passed and still open", "maintenance", overdue="true")
    if p.can("settlements.read"):
        pay = settlements.summary(db, p)
        add(pay.approved_unpaid, "SETTLEMENTS_TO_PAY", "medium", "Driver pay approved, not yet paid",
            f"{pay.to_pay} {pay.currency} to pay out", "settlements", status="approved")
    if p.can("invoices.read"):
        owed = finance.receivables(db, p)
        add(owed.overdue_invoices, "INVOICES_OVERDUE", "high", "Overdue invoices",
            f"{owed.overdue_balance} {owed.currency} past due", "invoices", overdue="true")
        add(owed.ready_to_invoice_loads, "READY_TO_INVOICE", "medium", "Completed loads not yet invoiced",
            f"{owed.ready_to_invoice_amount} {owed.currency} ready to bill", "loads", view="ready_to_invoice")
        add(owed.draft_invoices, "DRAFT_INVOICES", "low", "Draft invoices", "Started but not issued", "invoices",
            status="draft")
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(found, key=lambda e: order[e.severity])


# ---------------------------------------------------------------- search
class SearchResult(BaseModel):
    type: Literal["load", "customer", "driver", "vehicle", "trailer", "invoice", "work_order"]
    id: uuid.UUID
    title: str
    subtitle: str | None


@router.get("/search", response_model=list[SearchResult], tags=["search"])
def search(q: str = Query(min_length=2, max_length=100), limit: int = Query(default=5, ge=1, le=10),
           p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Find a record of any kind by number or name. Only kinds the caller's role may see are searched."""
    pattern = like(q.strip())
    out: list[SearchResult] = []

    def run(permission: str, kind: str, stmt, title, subtitle) -> None:
        if p.can(permission):
            for row in db.scalars(stmt.limit(limit)):
                out.append(SearchResult(type=kind, id=row.id, title=title(row), subtitle=subtitle(row)))

    run("loads.read", "load",
        select(Load).where(or_(Load.load_number.ilike(pattern), Load.reference.ilike(pattern),
                               Load.bol_number.ilike(pattern))).order_by(Load.created_at.desc()),
        lambda x: x.load_number,
        lambda x: " to ".join(c for c in (x.origin_city, x.destination_city) if c) or x.status.replace("_", " "))
    run("customers.read", "customer",
        select(Customer).where(or_(Customer.name.ilike(pattern), Customer.code.ilike(pattern))).order_by(Customer.name),
        lambda x: x.name, lambda x: x.code)
    run("drivers.read", "driver",
        select(Driver).where(or_(func.concat(Driver.first_name, literal(" "), Driver.last_name).ilike(pattern),
                                 Driver.employee_number.ilike(pattern))).order_by(Driver.last_name),
        lambda x: f"{x.first_name} {x.last_name}", lambda x: x.status)
    run("equipment.read", "vehicle",
        select(Vehicle).where(or_(Vehicle.unit_number.ilike(pattern), Vehicle.plate.ilike(pattern),
                                  Vehicle.vin.ilike(pattern))).order_by(Vehicle.unit_number),
        lambda x: f"Truck {x.unit_number}", lambda x: " ".join(str(v) for v in (x.year, x.make, x.model) if v) or None)
    run("equipment.read", "trailer",
        select(Trailer).where(or_(Trailer.unit_number.ilike(pattern), Trailer.plate.ilike(pattern),
                                  Trailer.vin.ilike(pattern))).order_by(Trailer.unit_number),
        lambda x: f"Trailer {x.unit_number}", lambda x: x.type.replace("_", " "))
    run("invoices.read", "invoice",
        select(Invoice).where(Invoice.invoice_number.ilike(pattern)).order_by(Invoice.created_at.desc()),
        lambda x: x.invoice_number or "Draft invoice", lambda x: f"{x.total} {x.currency} · {x.status}")
    run("maintenance.read", "work_order",
        select(WorkOrder).where(or_(WorkOrder.number.ilike(pattern), WorkOrder.title.ilike(pattern)))
        .order_by(WorkOrder.created_at.desc()),
        lambda x: f"Work order {x.number}", lambda x: f"{x.title} · {x.status.replace('_', ' ')}")
    return out


# ---------------------------------------------------------------- reports
class ReportColumn(BaseModel):
    key: str
    label: str
    kind: Literal["text", "number", "money", "percent"] = "text"


class Report(BaseModel):
    """A table: `columns` describes each field of `rows`. `totals` is the footer row, where there is one."""
    name: str
    title: str
    date_from: date | None
    date_to: date | None
    currency: str
    columns: list[ReportColumn]
    rows: list[dict]
    totals: dict | None = None


def _range(p: Principal, date_from: date | None, date_to: date | None) -> tuple[date, date]:
    """Calendar dates in the company's time zone, both inclusive. Defaults to this month so far."""
    end = date_to or p.today()
    start = date_from or end.replace(day=1)
    if start > end:
        raise Invalid("The start date is after the end date", field="date_from")
    if (end - start).days > 366:
        raise Invalid("Choose a period of a year or less", field="date_to")
    return start, end


def _cell(value) -> str:
    text = "" if value is None else str(value)
    # A cell starting with one of these would be run as a formula by spreadsheet software.
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") and not isinstance(value, int | Decimal) else text


def _deliver(db: Session, p: Principal, report: Report, fmt: str):
    if fmt == "json":
        return report
    if not p.can("reports.export"):
        raise Forbidden("Your role does not allow exporting reports")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([c.label for c in report.columns])
    for row in [*report.rows, *([report.totals] if report.totals else [])]:
        writer.writerow([_cell(row.get(c.key)) for c in report.columns])
    audit(db, p, "report.exported", "report", None,
          {"report": report.name, "date_from": str(report.date_from), "date_to": str(report.date_to),
           "rows": len(report.rows)})
    db.commit()
    stamp = f"{report.date_from}_{report.date_to}" if report.date_from else str(p.today())
    return Response(content="﻿" + buffer.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="bifly-{report.name}-{stamp}.csv"',
        "Cache-Control": "private, no-store"})


Format = Literal["json", "csv"]
MONEY_COLUMNS = [ReportColumn(key="loads", label="Loads", kind="number"),
                 ReportColumn(key="miles", label="Miles", kind="number"),
                 ReportColumn(key="revenue", label="Revenue", kind="money"),
                 ReportColumn(key="revenue_per_mile", label="Revenue per mile", kind="money")]


def _per_mile(revenue: Decimal, miles: int) -> Decimal | None:
    return money(revenue / miles) if miles else None


@router.get("/reports/revenue", response_model=Report, tags=["reports"])
def revenue_report(group_by: Literal["customer", "month", "terminal"] = "customer", date_from: date | None = None,
                   date_to: date | None = None, format: Format = "json",
                   p: Principal = Depends(require("reports.read")), db: Session = Depends(get_db)):
    """Revenue from delivered loads, by customer, month or terminal."""
    if not p.can("loads.rates.read"):
        raise Forbidden("Your role does not allow seeing rates")
    start, end = _range(p, date_from, date_to)
    lo, hi = loads.day_bounds(p.timezone, start, end)
    if group_by == "customer":
        key, source = Customer.name, select().join_from(Load, Customer, Customer.id == Load.customer_id)
    elif group_by == "terminal":
        key = func.coalesce(Terminal.name, literal("No terminal"))
        source = select().join_from(Load, Terminal, Terminal.id == Load.terminal_id, isouter=True)
    else:
        key, source = func.to_char(func.timezone(p.timezone, Load.delivered_at), "YYYY-MM"), select().select_from(Load)
    amount = func.coalesce(func.sum(Load.customer_rate + Load.charges_total), 0)
    stmt = (source.add_columns(key.label("label"), func.count().label("loads"),
                               func.coalesce(func.sum(Load.miles), 0).label("miles"), amount.label("revenue"))
            .where(Load.status.in_(DELIVERED), Load.delivered_at >= lo, Load.delivered_at < hi)
            .group_by(key).order_by(key if group_by == "month" else amount.desc()))
    rows = [{"label": r.label, "loads": r.loads, "miles": int(r.miles), "revenue": money(r.revenue),
             "revenue_per_mile": _per_mile(Decimal(r.revenue), int(r.miles))} for r in db.execute(stmt)]
    total_miles, total = sum(r["miles"] for r in rows), sum((r["revenue"] for r in rows), ZERO)
    return _deliver(db, p, Report(
        name=f"revenue-by-{group_by}", title=f"Revenue by {group_by}", date_from=start, date_to=end,
        currency=p.currency, columns=[ReportColumn(key="label", label=group_by.capitalize()), *MONEY_COLUMNS],
        rows=rows, totals={"label": "Total", "loads": sum(r["loads"] for r in rows), "miles": total_miles,
                           "revenue": total, "revenue_per_mile": _per_mile(total, total_miles)}), format)


def _last_stop():
    """Each load's final stop: when the truck got there, and when it was due."""
    return (select(LoadStop.load_id, LoadStop.arrived_at,
                   func.coalesce(LoadStop.appt_end, LoadStop.appt_start).label("due"))
            .distinct(LoadStop.load_id).order_by(LoadStop.load_id, LoadStop.seq.desc()).subquery("last_stop"))


def _hauled(db: Session, p: Principal, by: Literal["driver", "vehicle"], date_from: date | None,
            date_to: date | None, fmt: str):
    start, end = _range(p, date_from, date_to)
    lo, hi = loads.day_bounds(p.timezone, start, end)
    rates = p.can("loads.rates.read")
    last = _last_stop()
    if by == "driver":
        label = func.concat(Driver.first_name, literal(" "), Driver.last_name)
        entity, entity_id, on = Driver, Driver.id, Driver.id == DispatchAssignment.driver_id
    else:
        label, entity, entity_id, on = Vehicle.unit_number, Vehicle, Vehicle.id, Vehicle.id == DispatchAssignment.vehicle_id
    judged = func.count().filter(last.c.due.is_not(None), last.c.arrived_at.is_not(None))
    on_time = func.count().filter(last.c.arrived_at <= last.c.due)
    stmt = (select(entity_id, label.label("label"), func.count().label("loads"),
                   func.coalesce(func.sum(Load.miles), 0).label("miles"),
                   func.coalesce(func.sum(Load.customer_rate + Load.charges_total), 0).label("revenue"),
                   judged.label("judged"), on_time.label("on_time"))
            .select_from(Load)
            .join(DispatchAssignment, (DispatchAssignment.load_id == Load.id)
                  & DispatchAssignment.status.in_(("active", "completed")))
            .join(entity, on).outerjoin(last, last.c.load_id == Load.id)
            .where(Load.status.in_(DELIVERED), Load.delivered_at >= lo, Load.delivered_at < hi)
            .group_by(entity_id, label).order_by(func.count().desc(), label))
    rows = []
    for r in db.execute(stmt):
        row = {"label": r.label, "loads": r.loads, "miles": int(r.miles),
               "on_time": round(100 * r.on_time / r.judged) if r.judged else None}
        if rates:
            row |= {"revenue": money(r.revenue), "revenue_per_mile": _per_mile(Decimal(r.revenue), int(r.miles))}
        rows.append(row)
    columns = [ReportColumn(key="label", label="Driver" if by == "driver" else "Truck"),
               ReportColumn(key="loads", label="Loads delivered", kind="number"),
               ReportColumn(key="miles", label="Miles", kind="number"),
               ReportColumn(key="on_time", label="On-time delivery %", kind="percent")]
    if rates:
        columns += MONEY_COLUMNS[2:]
    return _deliver(db, p, Report(name=f"{by}-performance", title=f"{'Driver' if by == 'driver' else 'Truck'} performance",
                                  date_from=start, date_to=end, currency=p.currency, columns=columns, rows=rows), fmt)


@router.get("/reports/drivers", response_model=Report, tags=["reports"])
def driver_report(date_from: date | None = None, date_to: date | None = None, format: Format = "json",
                  p: Principal = Depends(require("reports.read")), db: Session = Depends(get_db)):
    """Loads delivered, miles and on-time delivery per driver."""
    return _hauled(db, p, "driver", date_from, date_to, format)


@router.get("/reports/trucks", response_model=Report, tags=["reports"])
def truck_report(date_from: date | None = None, date_to: date | None = None, format: Format = "json",
                 p: Principal = Depends(require("reports.read")), db: Session = Depends(get_db)):
    """Loads delivered and miles per truck."""
    return _hauled(db, p, "vehicle", date_from, date_to, format)


@router.get("/reports/ar-aging", response_model=Report, tags=["reports"])
def ar_aging(format: Format = "json", p: Principal = Depends(require("reports.read")),
             db: Session = Depends(get_db)):
    """What each customer owes, by how long it has been due."""
    if not p.can("invoices.read"):
        raise Forbidden("Your role does not allow seeing invoices")
    today = p.today()
    paid = (select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .join(Payment, Payment.id == PaymentAllocation.payment_id)
            .where(PaymentAllocation.invoice_id == Invoice.id, Payment.status == "recorded")
            .correlate(Invoice).scalar_subquery())
    balance = Invoice.total - paid
    due = Invoice.due_date

    def bucket(newer_than: int | None, older_than: int | None):
        conditions = []
        if older_than is not None:
            conditions.append(due < today - timedelta(days=older_than))
        if newer_than is not None:
            conditions.append(due >= today - timedelta(days=newer_than))
        return func.coalesce(func.sum(case((conditions[0] if len(conditions) == 1 else conditions[0] & conditions[1],
                                            balance), else_=0)), 0)

    buckets = {"current": bucket(0, None), "days_1_30": bucket(30, 0), "days_31_60": bucket(60, 30),
               "days_61_90": bucket(90, 60), "days_over_90": bucket(None, 90)}
    stmt = (select(Customer.name.label("label"), *[b.label(k) for k, b in buckets.items()],
                   func.coalesce(func.sum(balance), 0).label("total"))
            .join(Customer, Customer.id == Invoice.customer_id).where(Invoice.status == "issued")
            .group_by(Customer.id, Customer.name).order_by(func.sum(balance).desc()))
    keys = [*buckets, "total"]
    rows = [{"label": r.label, **{k: money(getattr(r, k)) for k in keys}} for r in db.execute(stmt)]
    labels = {"current": "Not yet due", "days_1_30": "1-30 days", "days_31_60": "31-60 days",
              "days_61_90": "61-90 days", "days_over_90": "Over 90 days", "total": "Total owed"}
    return _deliver(db, p, Report(
        name="ar-aging", title="Receivables aging", date_from=None, date_to=today, currency=p.currency,
        columns=[ReportColumn(key="label", label="Customer"),
                 *[ReportColumn(key=k, label=labels[k], kind="money") for k in keys]],
        rows=rows, totals={"label": "Total", **{k: sum((r[k] for r in rows), ZERO) for k in keys}}), format)
