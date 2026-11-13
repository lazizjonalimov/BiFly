"""Fleet maintenance: work orders with their costs, inspections and their defects, and return to service."""
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import Session

from app.core.crud import child_router, like
from app.core.deps import Principal, get_db, require
from app.core.errors import Invalid, NotFound
from app.core.idempotency import run_idempotent
from app.core.money import money
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.maintenance import schemas as s
from app.modules.maintenance import service
from app.modules.maintenance.models import Inspection, WorkOrder, WorkOrderLine

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

READ = require("maintenance.read")
MANAGE = require("maintenance.manage")
# Inspections belong to safety as much as to the shop.
INSPECTIONS_READ = require("safety.read", "maintenance.read")
INSPECTIONS_RECORD = require("safety.manage", "maintenance.manage")
FAR = date(9999, 1, 1)
PRIORITY_RANK = case({"urgent": 0, "high": 1, "normal": 2, "low": 3}, value=WorkOrder.priority)


def _units_matching(q: str):
    """Work orders and inspections can be found by the unit's number."""
    pattern = like(q)
    return (select(Vehicle.id).where(Vehicle.unit_number.ilike(pattern)),
            select(Trailer.id).where(Trailer.unit_number.ilike(pattern)))


# ---------------------------------------------------------------- summary
@router.get("/summary", response_model=s.MaintenanceSummary)
def get_summary(p: Principal = Depends(READ), db: Session = Depends(get_db)):
    """Open and urgent work orders, what is overdue, units off the road and this month's spend."""
    return service.summary(db, p)


# ---------------------------------------------------------------- work orders
@router.get("/work-orders", response_model=Page[s.WorkOrderListItem])
def list_work_orders(params: Annotated[s.WorkOrderListParams, Query()], p: Principal = Depends(READ),
                     db: Session = Depends(get_db)):
    stmt = select(WorkOrder)
    if params.status:
        stmt = stmt.where(WorkOrder.status == params.status)
    if params.open is True:
        stmt = stmt.where(WorkOrder.status.in_(service.OPEN))
    elif params.open is False:
        stmt = stmt.where(WorkOrder.status.notin_(service.OPEN))
    if params.overdue:
        stmt = stmt.where(WorkOrder.status.in_(service.OPEN), WorkOrder.scheduled_for < p.today())
    if params.priority:
        stmt = stmt.where(WorkOrder.priority == params.priority)
    if params.unit_type == "vehicle":
        stmt = stmt.where(WorkOrder.vehicle_id.is_not(None))
    elif params.unit_type == "trailer":
        stmt = stmt.where(WorkOrder.trailer_id.is_not(None))
    if params.vehicle_id:
        stmt = stmt.where(WorkOrder.vehicle_id == params.vehicle_id)
    if params.trailer_id:
        stmt = stmt.where(WorkOrder.trailer_id == params.trailer_id)
    if params.q and params.q.strip():
        q = params.q.strip()
        trucks, trailers = _units_matching(q)
        stmt = stmt.where(or_(WorkOrder.number.ilike(like(q)), WorkOrder.title.ilike(like(q)), WorkOrder.vendor.ilike(like(q)),
                              WorkOrder.vehicle_id.in_(trucks), WorkOrder.trailer_id.in_(trailers)))
    sortable = {"created_at": WorkOrder.created_at, "priority": PRIORITY_RANK,
                "scheduled_for": func.coalesce(WorkOrder.scheduled_for, literal(FAR)), "total_cost": WorkOrder.total_cost}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-created_at"), WorkOrder.id,
                          cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope(service.work_order_items(db, rows), info)


@router.post("/work-orders", response_model=s.WorkOrderDetail, status_code=201)
def create_work_order(body: s.WorkOrderCreate, p: Principal = Depends(MANAGE), db: Session = Depends(get_db),
                      idempotency_key: Annotated[str | None, Header()] = None):
    """Open a work order. With `out_of_service`, an active unit goes to "in maintenance" and can't be dispatched."""
    def work():
        wo = service.create_work_order(db, p, body)
        db.flush()
        return 201, service.work_order_detail(db, p, wo.id)
    return run_idempotent(db, p, idempotency_key, "POST /maintenance/work-orders", body.model_dump(mode="json"), work)


@router.get("/work-orders/{work_order_id}", response_model=s.WorkOrderDetail)
def get_work_order(work_order_id: uuid.UUID, p: Principal = Depends(READ), db: Session = Depends(get_db)):
    return service.work_order_detail(db, p, work_order_id)


@router.patch("/work-orders/{work_order_id}", response_model=s.WorkOrderDetail)
def update_work_order(work_order_id: uuid.UUID, body: s.WorkOrderUpdate, p: Principal = Depends(MANAGE),
                      db: Session = Depends(get_db)):
    service.update_work_order(db, p, work_order_id, body)
    db.commit()
    return service.work_order_detail(db, p, work_order_id)


@router.post("/work-orders/{work_order_id}/transitions", response_model=s.WorkOrderDetail)
def transition_work_order(work_order_id: uuid.UUID, body: s.WorkOrderTransition, p: Principal = Depends(MANAGE),
                          db: Session = Depends(get_db)):
    """Start, complete or cancel. Completing doesn't put the unit back on the road: return it to service."""
    service.transition(db, p, work_order_id, body)
    db.commit()
    return service.work_order_detail(db, p, work_order_id)


def _prepare_line(db: Session, p: Principal, data: dict, line: WorkOrderLine | None) -> None:
    for required in ("kind", "description", "quantity", "unit_cost"):
        if required in data and data[required] is None:
            raise Invalid("This field can't be empty", field=required)
    quantity = data.get("quantity", line.quantity if line is not None else None)
    unit_cost = data.get("unit_cost", line.unit_cost if line is not None else None)
    data["amount"] = money(quantity * unit_cost)


router.include_router(child_router(
    prefix="/work-orders/{parent_id}/lines", tag="maintenance", entity="work_order_line", label="cost line",
    model=WorkOrderLine, parent_model=WorkOrder, parent_fk="work_order_id", parent_label="Work order",
    create_schema=s.CostLineIn, update_schema=s.CostLinePatch, read_schema=s.CostLineOut, read_perm="maintenance.read",
    write_perm="maintenance.manage", order_by=service.LINE_ORDER, before_save=_prepare_line,
    parent_guard=service.guard_lines, after_change=service.after_line_change))


# ---------------------------------------------------------------- inspections
@router.get("/inspections", response_model=Page[s.InspectionOut])
def list_inspections(params: Annotated[s.InspectionListParams, Query()], p: Principal = Depends(INSPECTIONS_READ),
                     db: Session = Depends(get_db)):
    stmt = select(Inspection)
    if params.kind:
        stmt = stmt.where(Inspection.kind == params.kind)
    if params.result:
        stmt = stmt.where(Inspection.result == params.result)
    if params.unit_type == "vehicle":
        stmt = stmt.where(Inspection.vehicle_id.is_not(None))
    elif params.unit_type == "trailer":
        stmt = stmt.where(Inspection.trailer_id.is_not(None))
    if params.vehicle_id:
        stmt = stmt.where(Inspection.vehicle_id == params.vehicle_id)
    if params.trailer_id:
        stmt = stmt.where(Inspection.trailer_id == params.trailer_id)
    if params.q and params.q.strip():
        q = params.q.strip()
        trucks, trailers = _units_matching(q)
        stmt = stmt.where(or_(Inspection.report_number.ilike(like(q)), Inspection.location.ilike(like(q)),
                              Inspection.inspector.ilike(like(q)), Inspection.vehicle_id.in_(trucks),
                              Inspection.trailer_id.in_(trailers)))
    sortable = {"inspected_on": Inspection.inspected_on, "created_at": Inspection.created_at}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-inspected_on"), Inspection.id,
                          cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope(service.inspection_out(db, rows), info)


@router.post("/inspections", response_model=s.InspectionOut, status_code=201)
def record_inspection(body: s.InspectionCreate, p: Principal = Depends(INSPECTIONS_RECORD), db: Session = Depends(get_db),
                      idempotency_key: Annotated[str | None, Header()] = None):
    """Record an inspection. An out-of-service result takes the unit off the road; a passed annual inspection
    moves the unit's inspection date a year on."""
    def work():
        inspection = service.record_inspection(db, p, body)
        db.flush()
        return 201, service.inspection_out(db, [inspection])[0]
    return run_idempotent(db, p, idempotency_key, "POST /maintenance/inspections", body.model_dump(mode="json"), work)


@router.get("/inspections/{inspection_id}", response_model=s.InspectionOut)
def get_inspection(inspection_id: uuid.UUID, p: Principal = Depends(INSPECTIONS_READ), db: Session = Depends(get_db)):
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise NotFound("Inspection not found")
    return service.inspection_out(db, [inspection])[0]


@router.post("/inspections/{inspection_id}/defects/{defect_id}/work-order", response_model=s.WorkOrderDetail,
             status_code=201)
def raise_work_order(inspection_id: uuid.UUID, defect_id: uuid.UUID, p: Principal = Depends(MANAGE),
                     db: Session = Depends(get_db)):
    """Open a work order to repair a defect. An out-of-service defect makes it urgent and keeps the unit off the road."""
    wo = service.work_order_from_defect(db, p, inspection_id, defect_id)
    db.commit()
    return service.work_order_detail(db, p, wo.id)


# ---------------------------------------------------------------- back on the road
@router.post("/return-to-service", response_model=s.UnitRef)
def return_to_service(body: s.ReturnToServiceIn, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    """Put a unit back on the road. Refused while an out-of-service work order is open or an out-of-service
    defect hasn't been repaired."""
    unit = service.return_to_service(db, p, body)
    db.commit()
    return service.unit_ref(unit)
