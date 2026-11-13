"""What a driver can do for themselves: see the loads they are hauling and report progress on them.

Everything here is tied to the signed-in driver's own assignments. A driver can't reach another driver's load
by guessing its id, and never sees rates.
"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_db, require
from app.core.errors import Forbidden, NotFound
from app.modules.customers.models import Customer
from app.modules.dispatch.models import DispatchAssignment
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.loads import schemas as ls
from app.modules.loads import service as loads
from app.modules.loads.models import Load

router = APIRouter(prefix="/driver", tags=["driver"])

# A driver sees a load from the moment it is dispatched until shortly after it is delivered.
VISIBLE = (*loads.ROLLING, "delivered", "pod_review")
RECENT = timedelta(days=14)


class DriverLoad(BaseModel):
    id: uuid.UUID
    load_number: str
    status: str
    version: int
    customer_name: str
    reference: str | None
    bol_number: str | None
    commodity: str | None
    weight_lbs: int | None
    equipment_type: str
    instructions: str | None
    truck: str
    trailer: str | None
    stops: list[ls.StopOut]
    allowed_actions: list[Literal["arrive", "depart"]]
    needs_pod: bool


class DriverTransition(BaseModel):
    action: Literal["arrive", "depart"]
    version: int
    stop_id: uuid.UUID | None = None
    occurred_at: AwareDatetime | None = None
    note: str | None = Field(default=None, max_length=500)


def _me(db: Session, p: Principal) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.user_id == p.user_id))
    if driver is None:
        raise Forbidden("Your sign-in is not linked to a driver yet. Ask your dispatcher to link it.",
                        code="DRIVER_NOT_LINKED")
    return driver


def _mine(driver_id: uuid.UUID):
    return (select(Load, Customer.name, Vehicle.unit_number, Trailer.unit_number)
            .join(DispatchAssignment, (DispatchAssignment.load_id == Load.id)
                  & DispatchAssignment.status.in_(("active", "completed")))
            .join(Customer, Customer.id == Load.customer_id)
            .join(Vehicle, Vehicle.id == DispatchAssignment.vehicle_id)
            .outerjoin(Trailer, Trailer.id == DispatchAssignment.trailer_id)
            .where(DispatchAssignment.driver_id == driver_id, Load.status.in_(VISIBLE)))


def _out(db: Session, row) -> DriverLoad:
    load, customer_name, truck, trailer = row
    actions = [a for a in ("arrive", "depart") if load.status in loads.TRANSITIONS[a]]
    return DriverLoad(
        id=load.id, load_number=load.load_number, status=load.status, version=load.version,
        customer_name=customer_name, reference=load.reference, bol_number=load.bol_number,
        commodity=load.commodity, weight_lbs=load.weight_lbs, equipment_type=load.equipment_type,
        instructions=load.instructions, truck=truck, trailer=trailer,
        stops=[ls.StopOut.model_validate(x) for x in loads.stops_of(db, load.id)], allowed_actions=actions,
        needs_pod=load.status == "delivered")


def _one(db: Session, driver: Driver, load_id: uuid.UUID):
    row = db.execute(_mine(driver.id).where(Load.id == load_id)).first()
    if row is None:
        raise NotFound("Load not found")
    return row


@router.get("/loads", response_model=list[DriverLoad])
def my_loads(p: Principal = Depends(require("driver.self")), db: Session = Depends(get_db)):
    driver = _me(db, p)
    cutoff = datetime.now(UTC) - RECENT
    rows = db.execute(_mine(driver.id).where((Load.delivered_at.is_(None)) | (Load.delivered_at >= cutoff))
                      .order_by(Load.pickup_at.nulls_last())).all()
    return [_out(db, row) for row in rows]


@router.get("/loads/{load_id}", response_model=DriverLoad)
def my_load(load_id: uuid.UUID, p: Principal = Depends(require("driver.self")), db: Session = Depends(get_db)):
    return _out(db, _one(db, _me(db, p), load_id))


@router.post("/loads/{load_id}/transitions", response_model=DriverLoad)
def report_progress(load_id: uuid.UUID, body: DriverTransition, p: Principal = Depends(require("driver.self")),
                    db: Session = Depends(get_db)):
    """Arrive at or leave the next stop. Uses the same lifecycle rules as the dispatcher's screen."""
    driver = _me(db, p)
    _one(db, driver, load_id)
    load = loads.lock_load(db, load_id)
    loads.check_version(load, body.version)
    # The driver's right to do this comes from being assigned to the load, checked above, not from a role
    # permission.
    loads.transition(db, p, load, body.action, reason=body.note, stop_id=body.stop_id,
                     occurred_at=body.occurred_at, check_permission=False)
    db.commit()
    return _out(db, _one(db, driver, load_id))


@router.post("/loads/{load_id}/tracking", response_model=DriverLoad, status_code=201)
def check_in(load_id: uuid.UUID, body: ls.TrackingIn, p: Principal = Depends(require("driver.self")),
             db: Session = Depends(get_db)):
    """Tell dispatch where you are, or that something is wrong."""
    driver = _me(db, p)
    row = _one(db, driver, load_id)
    loads.add_tracking(db, p, load_id, body, source="driver")
    db.commit()
    return _out(db, row)
