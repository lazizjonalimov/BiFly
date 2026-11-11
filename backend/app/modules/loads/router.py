import uuid

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import delete, func, select

from app.core.audit import audit
from app.core.crud import Page
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Conflict, NotFound
from app.core.idempotency import run_idempotent
from app.core.pagination import paginate
from app.modules.customers.models import Customer
from app.modules.dispatch.models import DispatchAssignment
from app.modules.documents.models import Document
from app.modules.drivers.models import Driver
from app.modules.finance.models import Invoice
from app.modules.fleet.models import Trailer, Vehicle
from app.modules.loads import schemas as s
from app.modules.loads.models import Load, LoadStatusEvent, LoadStop
from app.modules.loads.service import (
    EDITABLE,
    STOPS_EDITABLE,
    change_status,
    lock_load_or_404,
    next_number,
    record_stop_event,
)

router = APIRouter(prefix="/loads", tags=["loads"])


def _add_stops(db, p: Principal, load_id: uuid.UUID, stops: list[s.StopIn]) -> None:
    for i, st in enumerate(stops, start=1):
        db.add(LoadStop(organization_id=p.org_id, load_id=load_id, seq=i, **st.model_dump()))
    db.flush()


def _place(stop: LoadStop | None) -> str | None:
    if stop is None:
        return None
    return f"{stop.city}, {stop.state}" if stop.state else stop.city


def assignment_views(db, load_ids: list[uuid.UUID]) -> dict[uuid.UUID, s.AssignmentOut]:
    """Active assignment per load, resolved in a single query however many loads are asked for."""
    if not load_ids:
        return {}
    rows = db.execute(
        select(DispatchAssignment, Driver, Vehicle, Trailer)
        .join(Driver, Driver.id == DispatchAssignment.driver_id)
        .join(Vehicle, Vehicle.id == DispatchAssignment.vehicle_id)
        .outerjoin(Trailer, Trailer.id == DispatchAssignment.trailer_id)
        .where(DispatchAssignment.load_id.in_(load_ids), DispatchAssignment.status == "active"))
    return {
        a.load_id: s.AssignmentOut(
            id=a.id, driver_id=d.id, driver_name=f"{d.first_name} {d.last_name}", vehicle_id=v.id,
            vehicle_unit=v.unit_number, trailer_id=a.trailer_id, trailer_unit=t.unit_number if t else None)
        for a, d, v, t in rows
    }


def assignment_view(db, load_id: uuid.UUID) -> s.AssignmentOut | None:
    return assignment_views(db, [load_id]).get(load_id)


def summarize(db, loads: list[Load]) -> list[s.LoadSummary]:
    """List rows with customer name and route. Two extra queries in total, not two per load."""
    if not loads:
        return []
    names = dict(db.execute(select(Customer.id, Customer.name)
                            .where(Customer.id.in_({ld.customer_id for ld in loads}))).all())
    stops: dict[uuid.UUID, list[LoadStop]] = {}
    for st in db.scalars(select(LoadStop).where(LoadStop.load_id.in_([ld.id for ld in loads]))
                         .order_by(LoadStop.load_id, LoadStop.seq)):
        stops.setdefault(st.load_id, []).append(st)
    out = []
    for ld in loads:
        sl = stops.get(ld.id, [])
        out.append(s.LoadSummary.model_validate(ld).model_copy(update={
            "customer_name": names.get(ld.customer_id),
            "origin": _place(sl[0]) if sl else None, "destination": _place(sl[-1]) if sl else None,
            "pickup_at": sl[0].appt_start if sl else None}))
    return out


def detail_view(db, load: Load) -> s.LoadDetail:
    stops = list(db.scalars(select(LoadStop).where(LoadStop.load_id == load.id).order_by(LoadStop.seq)))
    events = list(db.scalars(select(LoadStatusEvent).where(LoadStatusEvent.load_id == load.id)
                             .order_by(LoadStatusEvent.created_at.desc(), LoadStatusEvent.id)))
    cust = db.get(Customer, load.customer_id)
    has_pod = db.scalar(select(func.count()).select_from(Document)
                        .where(Document.load_id == load.id, Document.type == "pod")) > 0
    inv = db.scalar(select(Invoice.id).where(Invoice.load_id == load.id, Invoice.status != "void"))
    first, last = (stops[0], stops[-1]) if stops else (None, None)
    return s.LoadDetail(
        **s.LoadSummary.model_validate(load).model_dump(exclude={"customer_name", "origin", "destination", "pickup_at"}),
        customer_name=cust.name if cust else None, origin=_place(first), destination=_place(last),
        pickup_at=first.appt_start if first else None,
        weight_lbs=load.weight_lbs, notes=load.notes,
        stops=[s.StopOut.model_validate(x) for x in stops],
        assignment=assignment_view(db, load.id),
        events=[s.StatusEventOut.model_validate(e) for e in events],
        has_pod=has_pod, invoice_id=inv)


@router.get("", response_model=Page[s.LoadSummary])
def list_loads(cursor: str | None = None, limit: int = Query(50, ge=1, le=200), status: s.LoadStatus | None = None,
               customer_id: uuid.UUID | None = None, q: str | None = None,
               p: Principal = Depends(require("loads:read")), db=Depends(get_db)):
    stmt = select(Load)
    if status:
        stmt = stmt.where(Load.status == status)
    if customer_id:
        stmt = stmt.where(Load.customer_id == customer_id)
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(Load.load_number.ilike(like) | Load.reference.ilike(like) | Load.commodity.ilike(like))
    rows, nxt = paginate(db, stmt, Load, cursor, limit)
    return {"items": summarize(db, rows), "next_cursor": nxt}


@router.post("", response_model=s.LoadDetail, status_code=201)
def create_load(body: s.LoadCreate, p: Principal = Depends(require("loads:write")), db=Depends(get_db)):
    cust = get_or_404(db, Customer, body.customer_id, "Customer")
    if cust.status != "active":
        raise Conflict("Customer is inactive")
    load = Load(organization_id=p.org_id, load_number=next_number(db, p.org_id, "load_seq", "L"), created_by=p.user_id,
                **body.model_dump(exclude={"stops"}))
    db.add(load)
    db.flush()
    _add_stops(db, p, load.id, body.stops)
    db.add(LoadStatusEvent(organization_id=p.org_id, load_id=load.id, from_status=None, to_status="pending",
                           actor_user_id=p.user_id, note="Load created"))
    audit(db, p, "load.created", "load", load.id, {"load_number": load.load_number})
    db.commit()
    return detail_view(db, load)


@router.get("/{load_id}", response_model=s.LoadDetail)
def get_load(load_id: uuid.UUID, p: Principal = Depends(require("loads:read")), db=Depends(get_db)):
    return detail_view(db, get_or_404(db, Load, load_id, "Load"))


@router.patch("/{load_id}", response_model=s.LoadDetail)
def update_load(load_id: uuid.UUID, body: s.LoadUpdate, p: Principal = Depends(require("loads:write")),
                db=Depends(get_db)):
    load = lock_load_or_404(db, load_id)
    if load.status not in EDITABLE:
        raise Conflict(f"A {load.status} load can no longer be edited")
    changes = body.model_dump(exclude_unset=True, exclude={"stops"})
    for k, v in changes.items():
        setattr(load, k, v)
    if body.stops is not None:
        if load.status not in STOPS_EDITABLE:
            raise Conflict("Stops cannot be changed once a load has been dispatched")
        db.execute(delete(LoadStop).where(LoadStop.load_id == load.id))
        _add_stops(db, p, load.id, body.stops)
    audit(db, p, "load.updated", "load", load.id, body.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return detail_view(db, load)


@router.post("/{load_id}/cancel", response_model=s.LoadDetail)
def cancel_load(load_id: uuid.UUID, body: s.CancelIn, p: Principal = Depends(require("loads:write")),
                db=Depends(get_db)):
    load = lock_load_or_404(db, load_id)
    change_status(db, p, load, "cancelled", body.reason)
    for a in db.scalars(select(DispatchAssignment).where(DispatchAssignment.load_id == load.id,
                                                          DispatchAssignment.status == "active")):
        a.status = "cancelled"
    audit(db, p, "load.cancelled", "load", load.id, {"reason": body.reason})
    db.commit()
    return detail_view(db, load)


@router.post("/{load_id}/confirm-delivery", response_model=s.LoadDetail)
def confirm_delivery(load_id: uuid.UUID, p: Principal = Depends(require("loads:write")), db=Depends(get_db)):
    """Dispatcher confirms a driver-reported delivery. A POD must be on file."""
    load = lock_load_or_404(db, load_id)
    if load.status == "delivered":
        has_pod = db.scalar(select(func.count()).select_from(Document)
                            .where(Document.load_id == load.id, Document.type == "pod"))
        if not has_pod:
            raise Conflict("Upload a proof of delivery (POD) before confirming delivery", code="pod_required")
    change_status(db, p, load, "completed", "Delivery confirmed")
    for a in db.scalars(select(DispatchAssignment).where(DispatchAssignment.load_id == load.id,
                                                          DispatchAssignment.status == "active")):
        a.status = "completed"
    audit(db, p, "load.delivery_confirmed", "load", load.id)
    db.commit()
    return detail_view(db, load)


@router.post("/{load_id}/stops/{stop_id}/events", response_model=s.LoadDetail)
def stop_event(load_id: uuid.UUID, stop_id: uuid.UUID, body: s.StopEventIn,
               p: Principal = Depends(require("loads:write")), db=Depends(get_db),
               idempotency_key: str | None = Header(default=None)):
    """Dispatcher-entered arrival/departure (drivers use /driver/... instead)."""
    def work():
        load = lock_load_or_404(db, load_id)
        stop = get_or_404(db, LoadStop, stop_id, "Stop")
        if stop.load_id != load.id:
            raise NotFound("Stop not found")
        record_stop_event(db, p, load, stop, body.event, body.occurred_at)
        return 200, detail_view(db, load).model_dump(mode="json")
    return run_idempotent(db, p, idempotency_key, f"stop_event:{load_id}:{stop_id}", body.model_dump(mode="json"), work)
