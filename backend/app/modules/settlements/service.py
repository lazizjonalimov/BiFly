"""Driver settlements: what a driver is owed for a period.

A draft is built from its sources: the loads the driver delivered up to the end of the period that no other
settlement has paid (paid by the driver's pay terms: per mile, a percentage of the load's revenue, or a flat
amount), the charges on those loads marked payable to the driver, and the driver's reimbursements and
deductions recorded as expenses. It is rebuilt from them whenever it is recalculated: on creation, on
request, when its period or one of its expenses changes, and one last time on approval. Lines entered by hand
survive a recalculation.

Approval numbers the settlement and fixes it; from then on the database refuses any change to it, its lines
or its expenses. A load or an expense is on at most one settlement that isn't void, and each driver has at
most one draft, so two people can't build competing drafts from the same loads.
"""
import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid, NotFound
from app.core.money import ZERO, money
from app.modules.dispatch.models import DispatchAssignment
from app.modules.drivers.models import Driver
from app.modules.expenses.models import Expense
from app.modules.loads.models import Load, LoadCharge
from app.modules.loads.schemas import Ref
from app.modules.loads.service import day_bounds
from app.modules.organizations.models import Organization, User
from app.modules.settlements import schemas as s
from app.modules.settlements.models import DriverSettlement, SettlementLine

DELIVERED = ("delivered", "pod_review", "completed")
EARNINGS = ("load_pay", "accessorial", "adjustment")
CHARGE_LABELS = {"detention": "Detention", "layover": "Layover", "lumper": "Lumper", "tonu": "Truck ordered not used",
                 "stop_off": "Extra stop", "driver_assist": "Driver assist", "fuel_surcharge": "Fuel surcharge"}
CATEGORY_LABELS = {"advance": "Cash advance", "fuel": "Fuel", "tolls": "Tolls", "lumper": "Lumper", "scales": "Scale ticket",
                   "parking": "Parking", "permits": "Permit", "repairs": "Repair", "tires": "Tires", "insurance": "Insurance",
                   "lodging": "Lodging", "meals": "Meals", "other": "Expense"}
FOURTH = Decimal("0.0001")


# ---------------------------------------------------------------- locking and checks
def lock(db: Session, settlement_id: uuid.UUID) -> DriverSettlement:
    st = db.scalar(select(DriverSettlement).where(DriverSettlement.id == settlement_id).with_for_update())
    if st is None:
        raise NotFound("Settlement not found")
    return st


def lock_driver(db: Session, driver_id: uuid.UUID) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.id == driver_id).with_for_update())
    if driver is None:
        raise Invalid("Driver not found", field="driver_id")
    return driver


def check_version(st: DriverSettlement, version: int) -> None:
    if st.version != version:
        raise Conflict("Someone else changed this settlement while you were working. Review the latest figures and "
                       "try again.", code="VERSION_CONFLICT", details={"current_version": st.version, "your_version": version})


def require_draft(st: DriverSettlement) -> None:
    if st.status != "draft":
        raise Conflict(f"An {st.status} settlement can't be changed" if st.status == "approved"
                       else f"A {st.status} settlement can't be changed", code="SETTLEMENT_NOT_DRAFT")


def _period(start, end) -> None:
    if end < start:
        raise Invalid("The period ends before it starts", field="period_end")


# ---------------------------------------------------------------- building a draft
def _route(load: Load) -> str:
    def place(city, state):
        return ", ".join(x for x in (city, state) if x)
    ends = [x for x in (place(load.origin_city, load.origin_state), place(load.destination_city, load.destination_state)) if x]
    return " to ".join(ends)


def pay_line(driver: Driver, load: Load) -> dict:
    """The driver's pay for one load, by their pay terms."""
    rate = Decimal(driver.pay_rate)
    where = _route(load)
    head = f"{load.load_number}{f' {where}' if where else ''}"
    if driver.pay_type == "per_mile":
        if not load.miles:
            return dict(quantity=Decimal(1), rate=ZERO, amount=ZERO, description=f"{head}: no miles recorded on the load")
        return dict(quantity=Decimal(load.miles), rate=rate, amount=money(Decimal(load.miles) * rate),
                    description=f"{head}: {load.miles:,} mi at {rate.normalize():f} per mile")
    if driver.pay_type == "percent":
        revenue = Decimal(load.customer_rate) + Decimal(load.charges_total)
        amount = money(revenue * rate / 100)
        return dict(quantity=Decimal(1), rate=amount, amount=amount,
                    description=f"{head}: {rate.normalize():f}% of {money(revenue)} {load.currency}")
    return dict(quantity=Decimal(1), rate=rate, amount=money(rate), description=f"{head}: flat rate")


def eligible_loads(db: Session, p: Principal, st: DriverSettlement) -> list[Load]:
    end = day_bounds(p.timezone, st.period_end)[1]
    taken = (select(SettlementLine.load_id).join(DriverSettlement, DriverSettlement.id == SettlementLine.settlement_id)
             .where(DriverSettlement.status != "void", DriverSettlement.id != st.id, SettlementLine.load_id.is_not(None)))
    hauled = (select(DispatchAssignment.load_id)
              .where(DispatchAssignment.driver_id == st.driver_id, DispatchAssignment.status.in_(("active", "completed"))))
    return list(db.scalars(select(Load).where(Load.id.in_(hauled), Load.status.in_(DELIVERED), Load.delivered_at < end,
                                              Load.id.not_in(taken)).order_by(Load.delivered_at, Load.load_number)))


def _totals(db: Session, st: DriverSettlement) -> None:
    db.flush()
    sums = dict(db.execute(select(SettlementLine.kind, func.coalesce(func.sum(SettlementLine.amount), 0))
                           .where(SettlementLine.settlement_id == st.id).group_by(SettlementLine.kind)).all())
    st.earnings = money(sum((Decimal(sums.get(k, 0)) for k in EARNINGS), ZERO))
    st.reimbursements = money(sums.get("reimbursement", 0))
    st.deductions = money(-Decimal(sums.get("deduction", 0)))
    st.net_pay = money(st.earnings + st.reimbursements - st.deductions)


def recalculate(db: Session, p: Principal, st: DriverSettlement) -> None:
    """Rebuild the draft from its sources, keeping the lines entered by hand."""
    require_draft(st)
    driver = lock_driver(db, st.driver_id)
    db.execute(delete(SettlementLine).where(SettlementLine.settlement_id == st.id, SettlementLine.manual.is_(False)))
    db.execute(update(Expense).where(Expense.settlement_id == st.id).values(settlement_id=None))
    position = 0

    def add(kind: str, **line) -> None:
        nonlocal position
        db.add(SettlementLine(organization_id=p.org_id, settlement_id=st.id, kind=kind, position=position, **line))
        position += 1

    loads = eligible_loads(db, p, st)
    charges: dict[uuid.UUID, list[LoadCharge]] = {}
    if loads:
        for charge in db.scalars(select(LoadCharge).where(LoadCharge.load_id.in_([x.id for x in loads]),
                                                          LoadCharge.driver_payable.is_(True)).order_by(LoadCharge.created_at)):
            charges.setdefault(charge.load_id, []).append(charge)
    for load in loads:
        add("load_pay", load_id=load.id, **pay_line(driver, load))
        for charge in charges.get(load.id, []):
            label = CHARGE_LABELS.get(charge.type, charge.type.replace("_", " ").capitalize())
            add("accessorial", load_id=load.id, quantity=charge.quantity, rate=charge.rate, amount=charge.amount,
                description=f"{load.load_number}: {label}{f' ({charge.description})' if charge.description else ''}")

    expenses = db.scalars(select(Expense).where(Expense.driver_id == st.driver_id, Expense.driver_treatment != "none",
                                                Expense.settlement_id.is_(None), Expense.incurred_on <= st.period_end)
                          .order_by(Expense.incurred_on, Expense.created_at))
    for expense in expenses:
        label = CATEGORY_LABELS.get(expense.category, "Expense")
        detail = expense.vendor or expense.description
        if detail and detail.strip().lower() == label.lower():
            detail = None  # "Cash advance: Cash advance" says it twice
        sign = Decimal(1) if expense.driver_treatment == "reimburse" else Decimal(-1)
        add("reimbursement" if sign > 0 else "deduction", expense_id=expense.id, quantity=Decimal(1),
            rate=money(expense.amount) * sign, amount=money(expense.amount) * sign,
            description=f"{label}, {expense.incurred_on.isoformat()}{f': {detail}' if detail else ''}")
        expense.settlement_id = st.id
    # Lines worked out from the sources come first; those entered by hand follow, in the order they were added.
    db.flush()
    manual = db.scalars(select(SettlementLine).where(SettlementLine.settlement_id == st.id, SettlementLine.manual.is_(True))
                        .order_by(SettlementLine.position, SettlementLine.id))
    for line in manual:
        line.position = position
        position += 1
    _totals(db, st)
    st.calculated_at = datetime.now(UTC)
    st.version += 1


def recalculate_if_draft(db: Session, p: Principal, settlement_id: uuid.UUID) -> None:
    st = lock(db, settlement_id)
    if st.status == "draft":
        recalculate(db, p, st)


# ---------------------------------------------------------------- changing
def create(db: Session, p: Principal, body: s.SettlementCreate) -> DriverSettlement:
    lock_driver(db, body.driver_id)
    _period(body.period_start, body.period_end)
    existing = db.scalar(select(DriverSettlement.id).where(DriverSettlement.driver_id == body.driver_id,
                                                           DriverSettlement.status == "draft"))
    if existing:
        raise Conflict("This driver already has a draft settlement. Finish or delete it first.",
                       code="SETTLEMENT_DRAFT_EXISTS", details={"settlement_id": str(existing)})
    st = DriverSettlement(organization_id=p.org_id, currency=p.currency, created_by=p.user_id, **body.model_dump())
    db.add(st)
    db.flush()
    recalculate(db, p, st)
    audit(db, p, "settlement.created", "settlement", st.id, body.model_dump(mode="json"))
    return st


def update_draft(db: Session, p: Principal, settlement_id: uuid.UUID, body: s.SettlementUpdate) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, body.version)
    require_draft(st)
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    for required in ("period_start", "period_end"):
        if required in changes and changes[required] is None:
            raise Invalid("This field can't be empty", field=required)
    for key, value in changes.items():
        setattr(st, key, value)
    _period(st.period_start, st.period_end)
    if "period_start" in changes or "period_end" in changes:
        recalculate(db, p, st)
    else:
        st.version += 1
    audit(db, p, "settlement.updated", "settlement", st.id, body.model_dump(mode="json", exclude_unset=True, exclude={"version"}))
    return st


def refresh(db: Session, p: Principal, settlement_id: uuid.UUID, version: int) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, version)
    recalculate(db, p, st)
    audit(db, p, "settlement.recalculated", "settlement", st.id)
    return st


def add_line(db: Session, p: Principal, settlement_id: uuid.UUID, body: s.ManualLineIn) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, body.version)
    require_draft(st)
    if body.amount == 0:
        raise Invalid("Enter an amount other than zero", field="amount")
    amount = money(abs(body.amount))
    if body.kind == "deduction":
        amount = -amount
    elif body.kind == "adjustment":
        amount = money(body.amount)
    position = db.scalar(select(func.coalesce(func.max(SettlementLine.position), -1))
                         .where(SettlementLine.settlement_id == st.id)) + 1
    db.add(SettlementLine(organization_id=p.org_id, settlement_id=st.id, kind=body.kind, description=body.description.strip(),
                          quantity=Decimal(1), rate=amount, amount=amount, manual=True, position=position))
    _totals(db, st)
    st.version += 1
    audit(db, p, "settlement.line_added", "settlement", st.id,
          {"kind": body.kind, "description": body.description, "amount": str(amount)})
    return st


def remove_line(db: Session, p: Principal, settlement_id: uuid.UUID, line_id: uuid.UUID, version: int) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, version)
    require_draft(st)
    line = db.get(SettlementLine, line_id)
    if line is None or line.settlement_id != st.id:
        raise NotFound("Line not found")
    if not line.manual:
        raise Conflict("This line comes from a load or an expense. Change that instead, then recalculate.")
    db.delete(line)
    _totals(db, st)
    st.version += 1
    audit(db, p, "settlement.line_removed", "settlement", st.id, {"description": line.description})
    return st


def approve(db: Session, p: Principal, settlement_id: uuid.UUID, version: int) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, version)
    require_draft(st)
    recalculate(db, p, st)  # the last look at the sources before the settlement is fixed
    if not db.scalar(select(func.count()).select_from(SettlementLine).where(SettlementLine.settlement_id == st.id)):
        raise Conflict("There is nothing to pay on this settlement", code="SETTLEMENT_EMPTY")
    seq = db.execute(update(Organization).where(Organization.id == p.org_id)
                     .values(settlement_seq=Organization.settlement_seq + 1).returning(Organization.settlement_seq)).scalar_one()
    st.number = f"ST-{1000 + seq}"
    st.status, st.approved_by, st.approved_at = "approved", p.user_id, datetime.now(UTC)
    st.version += 1
    audit(db, p, "settlement.approved", "settlement", st.id, {"number": st.number, "net_pay": str(st.net_pay)})
    return st


def pay(db: Session, p: Principal, settlement_id: uuid.UUID, body: s.PayIn) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, body.version)
    if st.status != "approved":
        raise Conflict("Only an approved settlement can be paid", code="INVALID_TRANSITION", details={"status": st.status})
    if body.paid_on > p.today():
        raise Invalid("The payment date can't be in the future", field="paid_on")
    st.status, st.paid_on, st.paid_method = "paid", body.paid_on, body.method
    st.paid_reference, st.paid_by = (body.reference or "").strip() or None, p.user_id
    st.version += 1
    audit(db, p, "settlement.paid", "settlement", st.id, body.model_dump(mode="json", exclude={"version"}))
    return st


def void(db: Session, p: Principal, settlement_id: uuid.UUID, body: s.SettlementVoidIn) -> DriverSettlement:
    st = lock(db, settlement_id)
    check_version(st, body.version)
    if st.status != "approved":
        raise Conflict("Only an approved, unpaid settlement can be voided. A draft is deleted instead.",
                       code="INVALID_TRANSITION", details={"status": st.status})
    st.status, st.voided_at, st.void_reason = "void", datetime.now(UTC), body.reason.strip()
    st.version += 1
    db.flush()
    # Its loads and expenses are free to go on another settlement.
    db.execute(update(Expense).where(Expense.settlement_id == st.id).values(settlement_id=None))
    audit(db, p, "settlement.voided", "settlement", st.id, {"reason": st.void_reason})
    return st


def delete_draft(db: Session, p: Principal, settlement_id: uuid.UUID) -> None:
    st = lock(db, settlement_id)
    require_draft(st)
    db.execute(update(Expense).where(Expense.settlement_id == st.id).values(settlement_id=None))
    db.delete(st)
    db.flush()
    audit(db, p, "settlement.deleted", "settlement", settlement_id)


# ---------------------------------------------------------------- reading
def rate_text(value: Decimal) -> str:
    """A rate with two decimals, or up to four when it needs them: "2500.00", "0.62", "0.625"."""
    text = f"{Decimal(value).quantize(FOURTH, ROUND_HALF_UP):f}"
    whole, _, fraction = text.partition(".")
    return f"{whole}.{fraction.rstrip('0').ljust(2, '0')}"


def allowed_actions(st: DriverSettlement, p: Principal) -> list[str]:
    if not p.can("settlements.manage"):
        return []
    return {"draft": ["edit", "recalculate", "add_line", "approve", "delete"], "approved": ["pay", "void"]}.get(st.status, [])


def list_item(st: DriverSettlement, driver_name: str) -> dict:
    return dict(id=st.id, number=st.number, status=st.status, driver=Ref(id=st.driver_id, name=driver_name),
                period_start=st.period_start, period_end=st.period_end, currency=st.currency, earnings=st.earnings,
                reimbursements=st.reimbursements, deductions=st.deductions, net_pay=st.net_pay, created_at=st.created_at,
                approved_at=st.approved_at, paid_on=st.paid_on, version=st.version)


def detail(db: Session, p: Principal, settlement_id: uuid.UUID) -> s.SettlementDetail:
    st = db.get(DriverSettlement, settlement_id)
    if st is None:
        raise NotFound("Settlement not found")
    db.refresh(st)
    driver = db.get(Driver, st.driver_id)
    rows = db.execute(select(SettlementLine, Load.load_number).outerjoin(Load, Load.id == SettlementLine.load_id)
                      .where(SettlementLine.settlement_id == st.id).order_by(SettlementLine.position, SettlementLine.id)).all()
    wanted = {u for u in (st.created_by, st.approved_by) if u}
    people = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(wanted))).all()) if wanted else {}
    return s.SettlementDetail(
        **list_item(st, f"{driver.first_name} {driver.last_name}"), notes=st.notes,
        lines=[s.SettlementLineOut(id=line.id, kind=line.kind, load=Ref(id=line.load_id, name=number) if line.load_id else None,
                                   expense_id=line.expense_id, description=line.description, quantity=line.quantity,
                                   rate=rate_text(line.rate), amount=line.amount, manual=line.manual)
               for line, number in rows],
        pay_terms=s.PayTerms(pay_type=driver.pay_type, pay_rate=f"{Decimal(driver.pay_rate).normalize():f}"),
        calculated_at=st.calculated_at, created_by_name=people.get(st.created_by), approved_by_name=people.get(st.approved_by),
        paid_method=st.paid_method, paid_reference=st.paid_reference, voided_at=st.voided_at, void_reason=st.void_reason,
        allowed_actions=allowed_actions(st, p))


def summary(db: Session, p: Principal) -> s.SettlementSummary:
    today = p.today()
    drafts, approved, to_pay = db.execute(select(
        func.count().filter(DriverSettlement.status == "draft"), func.count().filter(DriverSettlement.status == "approved"),
        func.coalesce(func.sum(DriverSettlement.net_pay).filter(DriverSettlement.status == "approved"), 0))).one()
    paid = db.scalar(select(func.coalesce(func.sum(DriverSettlement.net_pay), 0))
                     .where(DriverSettlement.status == "paid", DriverSettlement.paid_on >= today.replace(day=1)))
    return s.SettlementSummary(currency=p.currency, drafts=drafts, to_pay=to_pay, approved_unpaid=approved, paid_this_month=paid)
