import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select

from app.core.audit import audit
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Conflict
from app.core.idempotency import run_idempotent
from app.modules.dispatch.models import DispatchAssignment
from app.modules.drivers.models import Driver
from app.modules.fleet.models import Trailer, Vehicle
from app.modules.loads import schemas as ls
from app.modules.loads.models import Load, LoadStop
from app.modules.loads.router import assignment_view, assignment_views, detail_view, summarize
from app.modules.loads.service import change_status, lock_load_or_404

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

# Equipment a load needs -> trailer types that satisfy it. Loads on straight trucks need no trailer.
TRAILER_FOR = {"dry_van": {"dry_van"}, "reefer": {"reefer"}, "flatbed": {"flatbed", "step_deck"},
               "step_deck": {"step_deck"}, "tanker": {"tanker"}}
IN_PROGRESS = ("dispatched", "in_transit")


class AssignIn(BaseModel):
    load_id: uuid.UUID
    driver_id: uuid.UUID
    vehicle_id: uuid.UUID
    trailer_id: uuid.UUID | None = None


def _not_expired(label: str, expiry: date | None, on: date) -> None:
    if expiry and expiry < on:
        raise Conflict(f"{label} expired on {expiry.isoformat()}", code="compliance")


def _busy(db, column, value, load_id: uuid.UUID, what: str) -> None:
    clash = db.scalar(select(Load.load_number).join(DispatchAssignment, DispatchAssignment.load_id == Load.id)
                      .where(column == value, DispatchAssignment.status == "active", Load.id != load_id,
                             Load.status.in_(IN_PROGRESS)))
    if clash:
        raise Conflict(f"{what} is currently on load {clash}", code="resource_busy")


@router.post("/assignments", response_model=ls.LoadDetail)
def assign(body: AssignIn, p: Principal = Depends(require("dispatch:write")), db=Depends(get_db),
           idempotency_key: str | None = Header(default=None)):
    def work():
        load = lock_load_or_404(db, body.load_id)
        driver = get_or_404(db, Driver, body.driver_id, "Driver")
        vehicle = get_or_404(db, Vehicle, body.vehicle_id, "Vehicle")
        trailer = get_or_404(db, Trailer, body.trailer_id, "Trailer") if body.trailer_id else None

        # A repeated identical request (e.g. double click) is a no-op, not a second assignment.
        current = db.scalar(select(DispatchAssignment).where(DispatchAssignment.load_id == load.id,
                                                              DispatchAssignment.status == "active"))
        if current:
            if (current.driver_id, current.vehicle_id, current.trailer_id) == (driver.id, vehicle.id, body.trailer_id):
                return 200, detail_view(db, load).model_dump(mode="json")
            raise Conflict("This load already has an assignment. Unassign it first.", code="already_assigned")
        if load.status != "pending":
            raise Conflict(f"A {load.status} load cannot be assigned")

        first = db.scalar(select(LoadStop).where(LoadStop.load_id == load.id).order_by(LoadStop.seq).limit(1))
        on = first.appt_start.date() if first and first.appt_start else date.today()
        if driver.status != "active":
            raise Conflict("Driver is inactive", code="compliance")
        _not_expired("Driver CDL", driver.cdl_expiry, on)
        _not_expired("Driver medical certificate", driver.medical_cert_expiry, on)
        if vehicle.status != "active":
            raise Conflict(f"Vehicle {vehicle.unit_number} is {vehicle.status}", code="compliance")
        _not_expired(f"Vehicle {vehicle.unit_number} insurance", vehicle.insurance_expiry, on)
        _not_expired(f"Vehicle {vehicle.unit_number} registration", vehicle.registration_expiry, on)
        needed = TRAILER_FOR.get(load.equipment_type)
        if needed and trailer is None:
            raise Conflict(f"A {load.equipment_type.replace('_', ' ')} trailer is required for this load", code="equipment")
        if trailer:
            if trailer.status != "active":
                raise Conflict(f"Trailer {trailer.unit_number} is {trailer.status}", code="compliance")
            if needed and trailer.type not in needed:
                raise Conflict(f"Trailer {trailer.unit_number} ({trailer.type}) does not match the load's "
                               f"equipment ({load.equipment_type})", code="equipment")
            _not_expired(f"Trailer {trailer.unit_number} insurance", trailer.insurance_expiry, on)
            _not_expired(f"Trailer {trailer.unit_number} registration", trailer.registration_expiry, on)

        _busy(db, DispatchAssignment.driver_id, driver.id, load.id, f"Driver {driver.last_name}")
        _busy(db, DispatchAssignment.vehicle_id, vehicle.id, load.id, f"Vehicle {vehicle.unit_number}")
        if trailer:
            _busy(db, DispatchAssignment.trailer_id, trailer.id, load.id, f"Trailer {trailer.unit_number}")

        a = DispatchAssignment(organization_id=p.org_id, load_id=load.id, driver_id=driver.id, vehicle_id=vehicle.id,
                               trailer_id=body.trailer_id, assigned_by=p.user_id)
        db.add(a)
        db.flush()
        change_status(db, p, load, "assigned", f"Assigned to {driver.first_name} {driver.last_name}, "
                                               f"truck {vehicle.unit_number}")
        audit(db, p, "dispatch.assigned", "load", load.id, body.model_dump(mode="json"))
        return 201, detail_view(db, load).model_dump(mode="json")

    return run_idempotent(db, p, idempotency_key, "dispatch.assign", body.model_dump(mode="json"), work)


@router.delete("/assignments/{load_id}", response_model=ls.LoadDetail)
def unassign(load_id: uuid.UUID, p: Principal = Depends(require("dispatch:write")), db=Depends(get_db)):
    load = lock_load_or_404(db, load_id)
    if load.status != "assigned":
        raise Conflict(f"Only an assigned (not yet dispatched) load can be unassigned; this load is {load.status}")
    for a in db.scalars(select(DispatchAssignment).where(DispatchAssignment.load_id == load.id,
                                                          DispatchAssignment.status == "active")):
        a.status = "cancelled"
    db.flush()
    change_status(db, p, load, "pending", "Unassigned")
    audit(db, p, "dispatch.unassigned", "load", load.id)
    db.commit()
    return detail_view(db, load)


@router.post("/loads/{load_id}/dispatch", response_model=ls.LoadDetail)
def send_to_driver(load_id: uuid.UUID, p: Principal = Depends(require("dispatch:write")), db=Depends(get_db)):
    """Release an assigned load to the driver (it then appears in the driver app)."""
    load = lock_load_or_404(db, load_id)
    if load.status != "assigned" or assignment_view(db, load.id) is None:
        raise Conflict("Only an assigned load can be dispatched")
    change_status(db, p, load, "dispatched", "Dispatched to driver")
    audit(db, p, "dispatch.dispatched", "load", load.id)
    db.commit()
    return detail_view(db, load)


BOARD_COLUMNS = ("pending", "assigned", "dispatched", "in_transit", "delivered")
BOARD_LIMIT = 500


@router.get("/board", response_model=ls.Board)
def board(p: Principal = Depends(require("loads:read")), db=Depends(get_db)):
    """Open work grouped by stage, oldest first. A fixed number of queries regardless of how many loads are open."""
    loads = list(db.scalars(select(Load).where(Load.status.in_(BOARD_COLUMNS))
                            .order_by(Load.created_at, Load.id).limit(BOARD_LIMIT + 1)))
    truncated = len(loads) > BOARD_LIMIT
    loads = loads[:BOARD_LIMIT]
    assignments = assignment_views(db, [ld.id for ld in loads])
    columns: dict[str, list[ls.BoardCard]] = {c: [] for c in BOARD_COLUMNS}
    for summary in summarize(db, loads):
        columns[summary.status].append(ls.BoardCard(**summary.model_dump(), assignment=assignments.get(summary.id)))
    return ls.Board(columns=columns, truncated=truncated)
