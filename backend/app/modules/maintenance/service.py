"""Maintenance rules.

A unit comes off the road when a work order says so, or when an inspection puts it out of service. It goes
back on the road only when nothing that took it off is still open (`return_blockers`), whether that happens
through "Return to service" or through editing the unit. Dispatch never needs to know why a unit is
unavailable: anything but `active` makes it ineligible.
"""
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid, NotFound
from app.core.money import money
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.maintenance import schemas as s
from app.modules.maintenance.models import Inspection, InspectionDefect, WorkOrder, WorkOrderLine
from app.modules.organizations.models import Organization, User

OPEN = ("open", "in_progress")
OFF_ROAD = ("in_maintenance", "out_of_service")
TRANSITIONS = {"start": ("open",), "complete": OPEN, "cancel": OPEN}
PAST = {"start": "started", "complete": "completed", "cancel": "cancelled"}
LINE_ORDER = (WorkOrderLine.created_at, WorkOrderLine.position)
Unit = Vehicle | Trailer


# ---------------------------------------------------------------- units
def kind_of(unit: Unit) -> str:
    return "vehicle" if isinstance(unit, Vehicle) else "trailer"


def unit_ref(unit: Unit) -> s.UnitRef:
    word = "Truck" if isinstance(unit, Vehicle) else "Trailer"
    return s.UnitRef(type=kind_of(unit), id=unit.id, name=f"{word} {unit.unit_number}", status=unit.status)


def find_unit(db: Session, vehicle_id: uuid.UUID | None, trailer_id: uuid.UUID | None, *, lock: bool = False) -> Unit:
    if (vehicle_id is None) == (trailer_id is None):
        raise Invalid("Choose either a truck or a trailer", field="vehicle_id")
    model, unit_id, field = (Vehicle, vehicle_id, "vehicle_id") if vehicle_id else (Trailer, trailer_id, "trailer_id")
    stmt = select(model).where(model.id == unit_id)
    unit = db.scalar(stmt.with_for_update() if lock else stmt)
    if unit is None:
        raise Invalid(f"{'Truck' if model is Vehicle else 'Trailer'} not found", field=field)
    return unit


def take_off_road(db: Session, p: Principal, unit: Unit, status: str, why: str) -> None:
    """Mark a unit unavailable. Out of service outranks in maintenance; a retired unit stays retired."""
    if unit.status in ("retired", status) or (unit.status == "out_of_service" and status == "in_maintenance"):
        return
    before, unit.status = unit.status, status
    audit(db, p, f"{kind_of(unit)}.status_changed", kind_of(unit), unit.id, {"from": before, "to": status, "why": why})


def return_blockers(db: Session, kind: str, unit_id: uuid.UUID) -> None:
    """Refuse to put a unit back on the road while something that took it off is still open."""
    column = WorkOrder.vehicle_id if kind == "vehicle" else WorkOrder.trailer_id
    blocking = list(db.scalars(
        select(WorkOrder.number).where(column == unit_id, WorkOrder.status.in_(OPEN), WorkOrder.out_of_service.is_(True))
        .order_by(WorkOrder.number)))
    if blocking:
        plural = "s" if len(blocking) > 1 else ""
        raise Conflict(f"Work order{plural} {', '.join(blocking)} must be completed first", code="OPEN_WORK_ORDERS",
                       details={"work_orders": blocking})
    # Every out-of-service defect found on the unit must have been repaired by a completed work order.
    inspected = Inspection.vehicle_id if kind == "vehicle" else Inspection.trailer_id
    unresolved = list(db.scalars(
        select(InspectionDefect.item).join(Inspection, Inspection.id == InspectionDefect.inspection_id)
        .outerjoin(WorkOrder, WorkOrder.id == InspectionDefect.work_order_id)
        .where(inspected == unit_id, InspectionDefect.severity == "out_of_service",
               InspectionDefect.work_order_id.is_(None) | (WorkOrder.status != "completed"))
        .order_by(Inspection.inspected_on, InspectionDefect.position)))
    if unresolved:
        raise Conflict(f"Out-of-service defects not yet repaired: {', '.join(unresolved)}", code="UNRESOLVED_DEFECTS",
                       details={"defects": unresolved})


# ---------------------------------------------------------------- work orders
def lock_work_order(db: Session, work_order_id: uuid.UUID) -> WorkOrder:
    wo = db.scalar(select(WorkOrder).where(WorkOrder.id == work_order_id).with_for_update())
    if wo is None:
        raise NotFound("Work order not found")
    return wo


def check_version(wo: WorkOrder, version: int) -> None:
    if wo.version != version:
        raise Conflict("Someone else changed this work order while you were working. Review the latest details and "
                       "try again.", code="VERSION_CONFLICT", details={"current_version": wo.version, "your_version": version})


def next_number(db: Session, org_id: uuid.UUID) -> str:
    seq = db.execute(update(Organization).where(Organization.id == org_id)
                     .values(work_order_seq=Organization.work_order_seq + 1)
                     .returning(Organization.work_order_seq)).scalar_one()
    return f"WO-{1000 + seq}"


def recalc(db: Session, wo: WorkOrder) -> None:
    db.flush()
    total = db.scalar(select(func.coalesce(func.sum(WorkOrderLine.amount), 0)).where(WorkOrderLine.work_order_id == wo.id))
    wo.total_cost = money(total)


def add_line(db: Session, p: Principal, wo: WorkOrder, line: s.CostLineIn, position: int = 0) -> WorkOrderLine:
    row = WorkOrderLine(organization_id=p.org_id, work_order_id=wo.id, **line.model_dump(),
                        amount=money(line.quantity * line.unit_cost), position=position)
    db.add(row)
    return row


def create_work_order(db: Session, p: Principal, body: s.WorkOrderCreate, *,
                      defect: InspectionDefect | None = None) -> WorkOrder:
    unit = find_unit(db, body.vehicle_id, body.trailer_id, lock=True)
    if unit.status == "retired":
        raise Invalid("This unit is retired", field="vehicle_id" if body.vehicle_id else "trailer_id")
    wo = WorkOrder(organization_id=p.org_id, number=next_number(db, p.org_id), currency=p.currency,
                   created_by=p.user_id, **body.model_dump(exclude={"lines"}))
    db.add(wo)
    db.flush()
    for position, line in enumerate(body.lines):
        add_line(db, p, wo, line, position)
    recalc(db, wo)
    if wo.out_of_service:
        take_off_road(db, p, unit, "in_maintenance", f"Work order {wo.number}")
    if defect is not None:
        defect.work_order_id = wo.id
    audit(db, p, "work_order.created", "work_order", wo.id,
          {"number": wo.number, "unit": unit_ref(unit).name, "out_of_service": wo.out_of_service})
    return wo


def update_work_order(db: Session, p: Principal, work_order_id: uuid.UUID, body: s.WorkOrderUpdate) -> WorkOrder:
    wo = lock_work_order(db, work_order_id)
    check_version(wo, body.version)
    if wo.status not in OPEN:
        raise Conflict(f"A {wo.status.replace('_', ' ')} work order can't be changed")
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    for required in ("title", "priority", "out_of_service"):
        if required in changes and changes[required] is None:
            raise Invalid("This field can't be empty", field=required)
    for key, value in changes.items():
        setattr(wo, key, value)
    wo.version += 1
    if changes.get("out_of_service"):
        unit = find_unit(db, wo.vehicle_id, wo.trailer_id, lock=True)
        take_off_road(db, p, unit, "in_maintenance", f"Work order {wo.number}")
    audit(db, p, "work_order.updated", "work_order", wo.id, body.model_dump(mode="json", exclude_unset=True, exclude={"version"}))
    return wo


def transition(db: Session, p: Principal, work_order_id: uuid.UUID, body: s.WorkOrderTransition) -> WorkOrder:
    wo = lock_work_order(db, work_order_id)
    check_version(wo, body.version)
    if wo.status not in TRANSITIONS[body.action]:
        raise Conflict(f"A {wo.status.replace('_', ' ')} work order can't be {PAST[body.action]}", code="INVALID_TRANSITION",
                       details={"status": wo.status, "action": body.action})
    notes = (body.notes or "").strip() or None
    now = datetime.now(UTC)
    if body.action == "start":
        wo.status, wo.started_at = "in_progress", now
    elif body.action == "complete":
        wo.status, wo.completed_at, wo.completed_by, wo.resolution = "completed", now, p.user_id, notes
        wo.started_at = wo.started_at or now
        if wo.vehicle_id and wo.odometer:
            truck = db.get(Vehicle, wo.vehicle_id)
            if truck.odometer is None or wo.odometer > truck.odometer:
                truck.odometer = wo.odometer
    else:
        if not notes:
            raise Invalid("Say why it is cancelled", field="notes")
        wo.status, wo.resolution = "cancelled", notes
    wo.version += 1
    audit(db, p, f"work_order.{PAST[body.action]}", "work_order", wo.id, {"notes": notes} if notes else None)
    return wo


def guard_lines(db: Session, p: Principal, wo: WorkOrder) -> None:
    if wo.status not in OPEN:
        raise Conflict("Costs can only be changed while the work order is open")


def after_line_change(db: Session, p: Principal, wo: WorkOrder) -> None:
    recalc(db, wo)
    wo.version += 1


def allowed_actions(wo: WorkOrder, p: Principal) -> list[str]:
    if not p.can("maintenance.manage"):
        return []
    return [action for action, starts in TRANSITIONS.items() if wo.status in starts]


# ---------------------------------------------------------------- inspections
def one_year_after(day: date) -> date:
    try:
        return day.replace(year=day.year + 1)
    except ValueError:  # 29 February
        return day + timedelta(days=365)


def record_inspection(db: Session, p: Principal, body: s.InspectionCreate) -> Inspection:
    unit = find_unit(db, body.vehicle_id, body.trailer_id, lock=True)
    if body.driver_id is not None and db.get(Driver, body.driver_id) is None:
        raise Invalid("Driver not found", field="driver_id")
    if body.inspected_on > p.today():
        raise Invalid("The inspection date can't be in the future", field="inspected_on")
    if body.result == "pass" and body.defects:
        raise Invalid("An inspection that found defects can't be a pass", field="result")
    if body.result != "pass" and not body.defects:
        raise Invalid("List what the inspection found", field="defects")
    if any(d.severity == "out_of_service" for d in body.defects) and body.result != "out_of_service":
        raise Invalid("An out-of-service defect puts the unit out of service: choose that result", field="result")

    inspection = Inspection(organization_id=p.org_id, created_by=p.user_id, **body.model_dump(exclude={"defects"}))
    db.add(inspection)
    db.flush()
    for position, defect in enumerate(body.defects):
        db.add(InspectionDefect(organization_id=p.org_id, inspection_id=inspection.id, position=position,
                                **defect.model_dump()))

    if body.result == "out_of_service":
        what = body.kind.replace("_", " ").capitalize()
        take_off_road(db, p, unit, "out_of_service", f"{what} inspection on {body.inspected_on.isoformat()}")
    if body.kind == "annual" and body.result == "pass":
        # A passed annual inspection is good for a year: the unit's compliance date moves with it.
        due = one_year_after(body.inspected_on)
        if unit.inspection_expiry is None or due > unit.inspection_expiry:
            unit.inspection_expiry = due
    if body.odometer and isinstance(unit, Vehicle) and (unit.odometer is None or body.odometer > unit.odometer):
        unit.odometer = body.odometer
    audit(db, p, "inspection.recorded", "inspection", inspection.id,
          {"unit": unit_ref(unit).name, "kind": body.kind, "result": body.result, "defects": len(body.defects)})
    return inspection


def work_order_from_defect(db: Session, p: Principal, inspection_id: uuid.UUID, defect_id: uuid.UUID) -> WorkOrder:
    inspection = db.get(Inspection, inspection_id)
    defect = db.scalar(select(InspectionDefect).where(InspectionDefect.id == defect_id).with_for_update())
    if inspection is None or defect is None or defect.inspection_id != inspection_id:
        raise NotFound("Defect not found")
    if defect.work_order_id:
        raise Conflict("A work order was already raised for this defect", code="DUPLICATE_REFERENCE")
    body = s.WorkOrderCreate(
        vehicle_id=inspection.vehicle_id, trailer_id=inspection.trailer_id, title=defect.item, description=defect.description,
        priority={"out_of_service": "urgent", "major": "high"}.get(defect.severity, "normal"),
        out_of_service=defect.severity == "out_of_service", odometer=inspection.odometer)
    return create_work_order(db, p, body, defect=defect)


# ---------------------------------------------------------------- back on the road
def return_to_service(db: Session, p: Principal, body: s.ReturnToServiceIn) -> Unit:
    is_truck = body.unit_type == "vehicle"
    unit = find_unit(db, body.unit_id if is_truck else None, None if is_truck else body.unit_id, lock=True)
    if unit.status not in OFF_ROAD:
        raise Conflict("This unit is not off the road")
    return_blockers(db, body.unit_type, unit.id)
    before, unit.status = unit.status, "active"
    audit(db, p, f"{body.unit_type}.returned_to_service", body.unit_type, unit.id,
          {"from": before, "notes": (body.notes or "").strip() or None})
    return unit


# ---------------------------------------------------------------- reading
def names(db: Session, ids) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(wanted))).all()) if wanted else {}


def units_by_id(db: Session, vehicle_ids, trailer_ids) -> dict[uuid.UUID, s.UnitRef]:
    out: dict[uuid.UUID, s.UnitRef] = {}
    for model, ids in ((Vehicle, vehicle_ids), (Trailer, trailer_ids)):
        wanted = {i for i in ids if i}
        if wanted:
            out.update({unit.id: unit_ref(unit) for unit in db.scalars(select(model).where(model.id.in_(wanted)))})
    return out


def list_item(wo: WorkOrder, unit: s.UnitRef) -> dict:
    return dict(id=wo.id, number=wo.number, status=wo.status, priority=wo.priority, title=wo.title, unit=unit,
                vendor=wo.vendor, scheduled_for=wo.scheduled_for, out_of_service=wo.out_of_service,
                total_cost=wo.total_cost, currency=wo.currency, created_at=wo.created_at, completed_at=wo.completed_at,
                version=wo.version)


def work_order_items(db: Session, rows: list[WorkOrder]) -> list[s.WorkOrderListItem]:
    units = units_by_id(db, [w.vehicle_id for w in rows], [w.trailer_id for w in rows])
    return [s.WorkOrderListItem(**list_item(w, units[w.vehicle_id or w.trailer_id])) for w in rows]


def work_order_detail(db: Session, p: Principal, work_order_id: uuid.UUID) -> s.WorkOrderDetail:
    wo = db.get(WorkOrder, work_order_id)
    if wo is None:
        raise NotFound("Work order not found")
    db.refresh(wo)
    unit = units_by_id(db, [wo.vehicle_id], [wo.trailer_id])[wo.vehicle_id or wo.trailer_id]
    lines = db.scalars(select(WorkOrderLine).where(WorkOrderLine.work_order_id == wo.id)
                       .order_by(*LINE_ORDER, WorkOrderLine.id))
    sources = db.execute(
        select(InspectionDefect, Inspection.kind, Inspection.inspected_on)
        .join(Inspection, Inspection.id == InspectionDefect.inspection_id).where(InspectionDefect.work_order_id == wo.id))
    people = names(db, [wo.created_by, wo.completed_by])
    return s.WorkOrderDetail(
        **list_item(wo, unit), description=wo.description, odometer=wo.odometer, started_at=wo.started_at,
        resolution=wo.resolution, created_by_name=people.get(wo.created_by), completed_by_name=people.get(wo.completed_by),
        lines=[s.CostLineOut.model_validate(line) for line in lines],
        defects=[s.DefectSource(inspection_id=d.inspection_id, inspection_kind=kind, inspected_on=on, item=d.item,
                                severity=d.severity) for d, kind, on in sources],
        allowed_actions=allowed_actions(wo, p), editable=p.can("maintenance.manage") and wo.status in OPEN)


def inspection_out(db: Session, inspections: list[Inspection]) -> list[s.InspectionOut]:
    if not inspections:
        return []
    units = units_by_id(db, [i.vehicle_id for i in inspections], [i.trailer_id for i in inspections])
    driver_ids = {i.driver_id for i in inspections if i.driver_id}
    drivers = {d.id: f"{d.first_name} {d.last_name}" for d in db.scalars(select(Driver).where(Driver.id.in_(driver_ids)))}
    defects: dict[uuid.UUID, list[s.DefectOut]] = {}
    rows = db.execute(
        select(InspectionDefect, WorkOrder.number, WorkOrder.status)
        .outerjoin(WorkOrder, WorkOrder.id == InspectionDefect.work_order_id)
        .where(InspectionDefect.inspection_id.in_([i.id for i in inspections]))
        .order_by(InspectionDefect.position, InspectionDefect.id))
    for d, number, status in rows:
        work_order = s.WorkOrderRef(id=d.work_order_id, number=number, status=status) if d.work_order_id else None
        defects.setdefault(d.inspection_id, []).append(
            s.DefectOut(id=d.id, item=d.item, severity=d.severity, description=d.description, work_order=work_order))
    people = names(db, [i.created_by for i in inspections])
    return [s.InspectionOut(
        id=i.id, unit=units[i.vehicle_id or i.trailer_id],
        driver=s.Ref(id=i.driver_id, name=drivers[i.driver_id]) if i.driver_id in drivers else None,
        kind=i.kind, inspected_on=i.inspected_on, result=i.result, odometer=i.odometer, location=i.location,
        inspector=i.inspector, report_number=i.report_number, notes=i.notes, created_by_name=people.get(i.created_by),
        created_at=i.created_at, defects=defects.get(i.id, [])) for i in inspections]


def summary(db: Session, p: Principal) -> s.MaintenanceSummary:
    from app.modules.loads.service import day_bounds  # the loads module owns the company-day helper

    today = p.today()
    is_open = WorkOrder.status.in_(OPEN)
    open_, urgent, overdue = db.execute(select(
        func.count().filter(is_open), func.count().filter(is_open, WorkOrder.priority == "urgent"),
        func.count().filter(is_open, WorkOrder.scheduled_for < today))).one()
    off_road = sum(db.scalar(select(func.count()).select_from(model).where(model.status.in_(OFF_ROAD)))
                   for model in (Vehicle, Trailer))
    start, end = day_bounds(p.timezone, today.replace(day=1), today)
    spend = db.scalar(select(func.coalesce(func.sum(WorkOrder.total_cost), 0))
                      .where(WorkOrder.status == "completed", WorkOrder.completed_at >= start, WorkOrder.completed_at < end))
    return s.MaintenanceSummary(open_work_orders=open_, urgent_open=urgent, overdue=overdue, units_out_of_service=off_road,
                                currency=p.currency, spend_this_month=spend)
