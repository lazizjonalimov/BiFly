"""Putting a driver and equipment on a load, safely when several dispatchers work at once."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid
from app.modules.dispatch import eligibility
from app.modules.dispatch.models import DispatchAssignment
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.loads import service as loads
from app.modules.loads.models import Load, LoadStatusEvent


def _lock(db: Session, model, id_: uuid.UUID | None, field: str, label: str):
    """Lock one driver, truck or trailer for the rest of the transaction.

    Two dispatchers booking the same driver onto different loads both stop here; the second one continues
    only after the first has committed, and then sees the first one's assignment in the conflict check.
    Rows are always locked in the same order (driver, truck, trailer), so two requests can't deadlock.
    """
    if id_ is None:
        return None
    row = db.scalar(select(model).where(model.id == id_).with_for_update())
    if row is None:
        raise Invalid(f"{label} not found", field=field)
    return row


def assign(db: Session, p: Principal, load: Load, driver_id: uuid.UUID, vehicle_id: uuid.UUID,
           trailer_id: uuid.UUID | None, *, reason: str | None = None) -> DispatchAssignment:
    """Assign a planned load, or replace the driver and equipment on one that already has them."""
    replacing = load.status in loads.REASSIGNABLE
    if not replacing and load.status not in loads.TRANSITIONS["assign"]:
        raise loads.illegal(load, "assign")
    note = (reason or "").strip() or None
    if load.status in loads.ROLLING and not note:
        raise Invalid("Say why the load is changing hands while it is under way", field="reason")

    driver = _lock(db, Driver, driver_id, "driver_id", "Driver")
    vehicle = _lock(db, Vehicle, vehicle_id, "vehicle_id", "Truck")
    trailer = _lock(db, Trailer, trailer_id, "trailer_id", "Trailer")

    now = datetime.now(UTC)
    problems = eligibility.blocking(eligibility.check_trio(db, load, driver, vehicle, trailer, p.today(), now))
    if problems:
        raise Conflict(problems[0].message if len(problems) == 1
                       else f"{problems[0].message}, and {len(problems) - 1} more problem(s)",
                       code="ASSIGNMENT_CONFLICT",
                       details={"reasons": [r.model_dump(mode="json") for r in problems]})

    current = loads.active_assignment(db, load.id)
    if current and (current.driver_id, current.vehicle_id, current.trailer_id) == (driver_id, vehicle_id, trailer_id):
        return current  # nothing to change
    if current:
        current.status, current.released_at = "released", now
        current.release_reason = note or "Reassigned"
        db.flush()  # the old row must stop being active before the new one is inserted

    assignment = DispatchAssignment(organization_id=p.org_id, load_id=load.id, driver_id=driver_id,
                                    vehicle_id=vehicle_id, trailer_id=trailer_id, assigned_by=p.user_id)
    db.add(assignment)
    db.flush()
    data = {"driver_id": str(driver_id), "vehicle_id": str(vehicle_id),
            "trailer_id": str(trailer_id) if trailer_id else None}
    if replacing:
        load.version += 1
        db.add(LoadStatusEvent(organization_id=p.org_id, load_id=load.id, load_version=load.version,
                               action="reassign", from_status=load.status, to_status=load.status,
                               actor_user_id=p.user_id, note=note))
        audit(db, p, "load.reassign", "load", load.id, {**data, "note": note})
    else:
        loads.move(db, p, load, "assign", "assigned", note)
        audit(db, p, "dispatch.assigned", "load", load.id, data)
    return assignment


def unassign(db: Session, p: Principal, load: Load, *, reason: str | None = None) -> None:
    if load.status not in loads.TRANSITIONS["unassign"]:
        raise loads.illegal(load, "unassign")
    note = (reason or "").strip() or None
    current = loads.active_assignment(db, load.id)
    if current:
        current.status, current.released_at = "released", datetime.now(UTC)
        current.release_reason = note or "Unassigned"
    loads.move(db, p, load, "unassign", "planned", note)
