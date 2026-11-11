"""Load lifecycle rules. All status changes go through `change_status` so history is always recorded."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal
from app.core.errors import Conflict, NotFound
from app.modules.loads.models import Load, LoadStatusEvent, LoadStop
from app.modules.organizations.models import Organization

# Explicit load status transitions. Anything not listed is rejected.
TRANSITIONS: dict[str, set[str]] = {
    "pending": {"assigned", "cancelled"},
    "assigned": {"dispatched", "pending", "cancelled"},   # assigned -> pending == unassign
    "dispatched": {"in_transit", "cancelled"},
    "in_transit": {"delivered"},                            # set when the driver departs the final stop
    "delivered": {"completed"},                             # dispatcher confirms (requires POD)
    "completed": {"invoiced"},
    "invoiced": {"paid", "completed"},                      # invoiced -> completed == invoice voided
    "paid": set(),
    "cancelled": set(),
}
EDITABLE = {"pending", "assigned", "dispatched"}
STOPS_EDITABLE = {"pending", "assigned"}


def next_number(db: Session, org_id: uuid.UUID, counter: str, prefix: str) -> str:
    """Per-organization sequence. The UPDATE takes a row lock so concurrent requests can't collide."""
    col = getattr(Organization, counter)
    n = db.execute(update(Organization).where(Organization.id == org_id).values({counter: col + 1})
                   .returning(col)).scalar_one()
    return f"{prefix}-{n:06d}"


def change_status(db: Session, p: Principal, load: Load, to: str, note: str | None = None) -> None:
    if to not in TRANSITIONS.get(load.status, set()):
        raise Conflict(f"A {load.status} load cannot move to {to}", code="invalid_transition")
    db.add(LoadStatusEvent(organization_id=p.org_id, load_id=load.id, from_status=load.status, to_status=to,
                           actor_user_id=p.user_id, note=note))
    load.status = to
    db.flush()


def lock_load_or_404(db: Session, load_id: uuid.UUID) -> Load:
    """SELECT ... FOR UPDATE: serializes concurrent changes to the same load."""
    load = db.scalar(select(Load).where(Load.id == load_id).with_for_update())
    if load is None:
        raise NotFound("Load not found")
    return load


def record_stop_event(db: Session, p: Principal, load: Load, stop: LoadStop, event: str,
                      at: datetime | None) -> bool:
    """Apply arrived/departed. Returns False when it was already recorded (safe to replay after offline sync)."""
    if load.status not in ("dispatched", "in_transit"):
        raise Conflict(f"Stop events can only be recorded on dispatched or in-transit loads (load is {load.status})")
    stops = list(db.scalars(select(LoadStop).where(LoadStop.load_id == load.id).order_by(LoadStop.seq)))
    idx = next(i for i, s in enumerate(stops) if s.id == stop.id)
    at = at or datetime.now(UTC)
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    if (at - datetime.now(UTC)).total_seconds() > 300:  # tolerate small device clock skew
        raise Conflict("Event time is in the future")

    if event == "arrived":
        if stop.arrived_at:
            return False
        if idx > 0 and not stops[idx - 1].departed_at:
            raise Conflict("The previous stop has not been completed yet")
        stop.arrived_at = at
        action = "stop.arrived"
    else:
        if stop.departed_at:
            return False
        if not stop.arrived_at:
            raise Conflict("Record arrival before departure")
        if at < stop.arrived_at:
            raise Conflict("Departure is before arrival")
        stop.departed_at = at
        action = "stop.departed"
    db.flush()
    audit(db, p, action, "load_stop", stop.id, {"load_id": str(load.id), "seq": stop.seq, "at": at.isoformat()})

    if event == "departed":
        if idx == 0 and load.status == "dispatched":
            change_status(db, p, load, "in_transit", "Departed first pickup")
        if idx == len(stops) - 1 and load.status == "in_transit":
            change_status(db, p, load, "delivered", "Departed final delivery")
    return True
