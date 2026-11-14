"""Expense rules. Fuel needs its gallons and state; a reimbursement or deduction needs a driver; an expense in an
approved settlement is part of a pay record and can't change. Changing one that sits on a draft settlement
recalculates the draft, so the draft never shows a stale figure."""
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.crud import ensure_exists
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid, NotFound
from app.core.money import ZERO, money
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.expenses import schemas as s
from app.modules.expenses.models import Expense
from app.modules.loads.models import Load
from app.modules.loads.schemas import Ref
from app.modules.organizations.models import User
from app.modules.settlements.models import DriverSettlement

THOUSANDTH = Decimal("0.001")
FIXED = ("approved", "paid")


def three(value: Decimal | None) -> str | None:
    return None if value is None else str(Decimal(value).quantize(THOUSANDTH, ROUND_HALF_UP))


def _check(db: Session, p: Principal, data: dict, expense: Expense | None) -> None:
    """Validate the merged state of an expense (what it will be once `data` is applied)."""
    def final(key):
        return data[key] if key in data else (getattr(expense, key) if expense is not None else None)

    for required in ("category", "incurred_on", "amount", "driver_treatment"):
        if required in data and data[required] is None:
            raise Invalid("This field can't be empty", field=required)
    ensure_exists(db, Load, data.get("load_id"), "load_id", "Load")
    ensure_exists(db, Driver, data.get("driver_id"), "driver_id", "Driver")
    ensure_exists(db, Vehicle, data.get("vehicle_id"), "vehicle_id", "Truck")
    ensure_exists(db, Trailer, data.get("trailer_id"), "trailer_id", "Trailer")
    if final("incurred_on") and final("incurred_on") > p.today():
        raise Invalid("The date can't be in the future", field="incurred_on")
    if data.get("jurisdiction"):
        data["jurisdiction"] = data["jurisdiction"].upper()
    if final("category") == "fuel":
        if final("gallons") is None:
            raise Invalid("Enter the gallons bought", field="gallons")
        if not final("jurisdiction"):
            raise Invalid("Enter the state it was bought in", field="jurisdiction")
        if final("fuel_type") is None:
            data["fuel_type"] = "diesel"
    else:
        for fuel_only in ("gallons", "fuel_type", "jurisdiction"):
            if final(fuel_only) is not None:
                if fuel_only in data:
                    raise Invalid("Only fuel has this", field=fuel_only)
                data[fuel_only] = None  # the category changed away from fuel
    if final("driver_treatment") not in (None, "none") and final("driver_id") is None:
        raise Invalid("Choose the driver to reimburse or deduct", field="driver_id")


def _lock(db: Session, expense_id: uuid.UUID) -> Expense:
    expense = db.scalar(select(Expense).where(Expense.id == expense_id).with_for_update())
    if expense is None:
        raise NotFound("Expense not found")
    return expense


def _settlement_status(db: Session, expense: Expense) -> str | None:
    if expense.settlement_id is None:
        return None
    return db.scalar(select(DriverSettlement.status).where(DriverSettlement.id == expense.settlement_id))


def _refuse_if_settled(db: Session, expense: Expense) -> None:
    if _settlement_status(db, expense) in FIXED:
        raise Conflict("This expense is part of an approved driver settlement and can't be changed",
                       code="EXPENSE_SETTLED")


def _recalculate(db: Session, p: Principal, *settlement_ids: uuid.UUID | None) -> None:
    from app.modules.settlements import service as settlements  # settlements reads expenses; avoid a cycle

    for settlement_id in {i for i in settlement_ids if i}:
        settlements.recalculate_if_draft(db, p, settlement_id)


def _drafts_for(db: Session, driver_ids) -> list[uuid.UUID]:
    """Open drafts of these drivers: a new or changed reimbursement may now belong on one."""
    wanted = [d for d in driver_ids if d]
    if not wanted:
        return []
    return list(db.scalars(select(DriverSettlement.id).where(DriverSettlement.driver_id.in_(wanted),
                                                            DriverSettlement.status == "draft")))


def create(db: Session, p: Principal, body: s.ExpenseCreate) -> Expense:
    data = body.model_dump()
    _check(db, p, data, None)
    expense = Expense(organization_id=p.org_id, currency=p.currency, created_by=p.user_id, **data)
    db.add(expense)
    db.flush()
    audit(db, p, "expense.created", "expense", expense.id, body.model_dump(mode="json", exclude_none=True))
    if expense.driver_treatment != "none":
        _recalculate(db, p, *_drafts_for(db, [expense.driver_id]))
    return expense


def update(db: Session, p: Principal, expense_id: uuid.UUID, body: s.ExpenseUpdate) -> Expense:
    expense = _lock(db, expense_id)
    _refuse_if_settled(db, expense)
    data = body.model_dump(exclude_unset=True)
    _check(db, p, data, expense)
    before_driver, before_settlement = expense.driver_id, expense.settlement_id
    for key, value in data.items():
        setattr(expense, key, value)
    db.flush()
    audit(db, p, "expense.updated", "expense", expense.id, body.model_dump(mode="json", exclude_unset=True))
    _recalculate(db, p, before_settlement, *_drafts_for(db, [before_driver, expense.driver_id]))
    return expense


def delete(db: Session, p: Principal, expense_id: uuid.UUID) -> None:
    expense = _lock(db, expense_id)
    _refuse_if_settled(db, expense)
    settlement_id = expense.settlement_id
    db.delete(expense)
    db.flush()
    audit(db, p, "expense.deleted", "expense", expense_id)
    _recalculate(db, p, settlement_id)


# ---------------------------------------------------------------- reading
def present(db: Session, p: Principal, expenses: list[Expense]) -> list[s.ExpenseOut]:
    if not expenses:
        return []

    def ids(attr):
        return {getattr(e, attr) for e in expenses if getattr(e, attr)}

    loads = dict(db.execute(select(Load.id, Load.load_number).where(Load.id.in_(ids("load_id")))).all())
    drivers = {d.id: f"{d.first_name} {d.last_name}" for d in db.scalars(select(Driver).where(Driver.id.in_(ids("driver_id"))))}
    trucks = dict(db.execute(select(Vehicle.id, Vehicle.unit_number).where(Vehicle.id.in_(ids("vehicle_id")))).all())
    trailers = dict(db.execute(select(Trailer.id, Trailer.unit_number).where(Trailer.id.in_(ids("trailer_id")))).all())
    settlements = {row.id: row for row in db.execute(select(DriverSettlement.id, DriverSettlement.number, DriverSettlement.status)
                                                     .where(DriverSettlement.id.in_(ids("settlement_id"))))}
    people = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids("created_by")))).all())
    can_manage = p.can("expenses.manage")

    def ref(mapping, key, word=""):
        return Ref(id=key, name=f"{word}{mapping[key]}") if key in mapping else None

    out = []
    for e in expenses:
        settlement = settlements.get(e.settlement_id)
        per_gallon = (Decimal(e.amount) / Decimal(e.gallons)) if e.gallons else None
        out.append(s.ExpenseOut(
            id=e.id, category=e.category, incurred_on=e.incurred_on, amount=e.amount, currency=e.currency, vendor=e.vendor,
            description=e.description, paid_with=e.paid_with, reference=e.reference, load=ref(loads, e.load_id),
            driver=ref(drivers, e.driver_id), vehicle=ref(trucks, e.vehicle_id, "Truck "),
            trailer=ref(trailers, e.trailer_id, "Trailer "), driver_treatment=e.driver_treatment, gallons=three(e.gallons),
            price_per_gallon=three(per_gallon), fuel_type=e.fuel_type, jurisdiction=e.jurisdiction, odometer=e.odometer,
            notes=e.notes,
            settlement=s.SettlementRef(id=settlement.id, number=settlement.number, status=settlement.status)
            if settlement else None,
            editable=can_manage and (settlement is None or settlement.status not in FIXED),
            created_by_name=people.get(e.created_by), created_at=e.created_at))
    return out


def get(db: Session, p: Principal, expense_id: uuid.UUID) -> s.ExpenseOut:
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise NotFound("Expense not found")
    return present(db, p, [expense])[0]


def month_range(p: Principal, date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = p.today()
    first, last = date_from or today.replace(day=1), date_to or today
    if last < first:
        raise Invalid("The end of the range is before its start", field="date_to")
    return first, last


def summary(db: Session, p: Principal, date_from: date | None, date_to: date | None) -> s.ExpenseSummary:
    first, last = month_range(p, date_from, date_to)
    in_range = (Expense.incurred_on >= first) & (Expense.incurred_on <= last)
    rows = db.execute(select(Expense.category, func.sum(Expense.amount), func.count()).where(in_range)
                      .group_by(Expense.category).order_by(func.sum(Expense.amount).desc())).all()
    unsettled = Expense.settlement_id.is_(None) | Expense.settlement_id.in_(
        select(DriverSettlement.id).where(DriverSettlement.status == "draft"))
    owed = dict(db.execute(select(Expense.driver_treatment, func.sum(Expense.amount))
                           .where(Expense.driver_treatment != "none", unsettled).group_by(Expense.driver_treatment)).all())
    return s.ExpenseSummary(
        date_from=first, date_to=last, currency=p.currency, total=sum((r[1] for r in rows), ZERO), count=sum(r[2] for r in rows),
        by_category=[s.CategoryTotal(category=c, amount=a, count=n) for c, a, n in rows],
        to_reimburse=owed.get("reimburse", ZERO), to_deduct=owed.get("deduct", ZERO))


def fuel_summary(db: Session, p: Principal, date_from: date | None, date_to: date | None) -> s.FuelSummary:
    from app.modules.dispatch.models import DispatchAssignment
    from app.modules.loads.service import day_bounds

    first, last = month_range(p, date_from, date_to)
    fuel = (Expense.category == "fuel") & (Expense.incurred_on >= first) & (Expense.incurred_on <= last)
    gallons, amount, purchases = db.execute(select(func.coalesce(func.sum(Expense.gallons), 0),
                                                   func.coalesce(func.sum(Expense.amount), 0), func.count()).where(fuel)).one()
    states = db.execute(select(Expense.jurisdiction, func.sum(Expense.gallons), func.sum(Expense.amount), func.count())
                        .where(fuel).group_by(Expense.jurisdiction).order_by(Expense.jurisdiction)).all()
    trucks = db.execute(select(Vehicle.id, Vehicle.unit_number, func.sum(Expense.gallons), func.sum(Expense.amount))
                        .join(Vehicle, Vehicle.id == Expense.vehicle_id).where(fuel)
                        .group_by(Vehicle.id, Vehicle.unit_number).order_by(Vehicle.unit_number)).all()
    # Miles: loads each truck delivered in the range (the truck on the assignment that completed the load).
    start, end = day_bounds(p.timezone, first, last)
    miles = dict(db.execute(
        select(DispatchAssignment.vehicle_id, func.coalesce(func.sum(Load.miles), 0))
        .join(Load, Load.id == DispatchAssignment.load_id)
        .where(DispatchAssignment.status.in_(("active", "completed")), Load.delivered_at >= start, Load.delivered_at < end,
               DispatchAssignment.vehicle_id.in_([t[0] for t in trucks]))
        .group_by(DispatchAssignment.vehicle_id)).all()) if trucks else {}

    def per(numerator, denominator):
        return three(Decimal(numerator) / Decimal(denominator)) if denominator else None

    return s.FuelSummary(
        date_from=first, date_to=last, currency=p.currency, gallons=three(gallons), amount=money(amount),
        price_per_gallon=per(amount, gallons), purchases=purchases,
        by_jurisdiction=[s.JurisdictionFuel(jurisdiction=j, gallons=three(g), amount=a, purchases=n) for j, g, a, n in states],
        by_truck=[s.TruckFuel(vehicle=Ref(id=i, name=f"Truck {u}"), gallons=three(g), amount=a, miles=int(miles.get(i, 0)),
                              mpg=per(miles.get(i, 0), g) if miles.get(i) else None) for i, u, g, a in trucks])
