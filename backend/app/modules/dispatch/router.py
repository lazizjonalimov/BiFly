import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Conflict, NotFound
from app.core.idempotency import run_idempotent
from app.core.pagination import Page, envelope
from app.modules.dispatch import eligibility, service
from app.modules.dispatch.models import DispatchAssignment
from app.modules.loads import schemas as ls
from app.modules.loads import service as loads
from app.modules.loads.models import Load

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class AssignIn(BaseModel):
    load_id: uuid.UUID
    driver_id: uuid.UUID
    vehicle_id: uuid.UUID
    trailer_id: uuid.UUID | None = None
    version: int = Field(description="The load version you last saw")
    reason: str | None = Field(default=None, max_length=200)


class ReassignIn(BaseModel):
    """Only what is sent changes. Send `trailer_id: null` to drop the trailer."""
    driver_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None
    version: int
    reason: str | None = Field(default=None, max_length=200)


class ReleaseIn(BaseModel):
    version: int
    reason: str | None = Field(default=None, max_length=200)


@router.get("/board", response_model=Page[ls.LoadListItem])
def board(params: Annotated[ls.LoadListParams, Query()], p: Principal = Depends(require("dispatch.read")),
          db: Session = Depends(get_db)):
    """The loads a dispatcher is working, filtered, sorted and paged in the database."""
    items, info = loads.list_loads(db, p, params, default_view=None if params.status else "active")
    return envelope(items, info)


@router.get("/summary", response_model=ls.BoardSummary)
def summary(terminal_id: uuid.UUID | None = None, p: Principal = Depends(require("dispatch.read")),
            db: Session = Depends(get_db)):
    return loads.board_summary(db, p, terminal_id)


@router.get("/eligible-resources", response_model=eligibility.EligibleResources)
def eligible_resources(load_id: uuid.UUID, q: str | None = Query(default=None, max_length=100),
                       terminal_id: uuid.UUID | None = None, p: Principal = Depends(require("dispatch.read")),
                       db: Session = Depends(get_db)):
    """Drivers, trucks and trailers for a load, each with the reasons it can or can't take it."""
    load = get_or_404(db, Load, load_id, "Load")
    return eligibility.evaluate(db, load, p.today(), datetime.now(UTC), q=q, terminal_id=terminal_id)


@router.post("/assignments", response_model=ls.LoadDetail, status_code=201)
def assign(body: AssignIn, p: Principal = Depends(require("dispatch.assign")), db: Session = Depends(get_db),
           idempotency_key: Annotated[str | None, Header()] = None):
    """Assign a planned load. Eligibility is checked again here, inside the transaction that books it."""
    def work():
        load = loads.lock_load(db, body.load_id)
        loads.check_version(load, body.version)
        if load.status not in loads.TRANSITIONS["assign"]:
            raise loads.illegal(load, "assign")
        service.assign(db, p, load, body.driver_id, body.vehicle_id, body.trailer_id, reason=body.reason)
        db.flush()
        return 201, loads.load_detail(db, p, load.id)
    return run_idempotent(db, p, idempotency_key, "POST /dispatch/assignments", body.model_dump(mode="json"), work)


def _active(db: Session, assignment_id: uuid.UUID) -> tuple[DispatchAssignment, Load]:
    assignment = db.get(DispatchAssignment, assignment_id)
    if assignment is None:
        raise NotFound("Assignment not found")
    load = loads.lock_load(db, assignment.load_id)
    db.refresh(assignment)
    if assignment.status != "active":
        raise Conflict("This assignment has already been replaced or released. Refresh to see the current one.",
                       code="STATE_CONFLICT")
    return assignment, load


@router.patch("/assignments/{assignment_id}", response_model=ls.LoadDetail)
def reassign(assignment_id: uuid.UUID, body: ReassignIn, p: Principal = Depends(require("dispatch.assign")),
             db: Session = Depends(get_db)):
    """Swap the driver, truck or trailer. The old assignment is kept as history."""
    assignment, load = _active(db, assignment_id)
    loads.check_version(load, body.version)
    if load.status not in loads.REASSIGNABLE:
        raise loads.illegal(load, "reassign")
    sent = body.model_fields_set
    service.assign(
        db, p, load, body.driver_id or assignment.driver_id, body.vehicle_id or assignment.vehicle_id,
        body.trailer_id if "trailer_id" in sent else assignment.trailer_id, reason=body.reason)
    db.commit()
    return loads.load_detail(db, p, load.id)


@router.post("/assignments/{assignment_id}/release", response_model=ls.LoadDetail)
def release(assignment_id: uuid.UUID, body: ReleaseIn, p: Principal = Depends(require("dispatch.assign")),
            db: Session = Depends(get_db)):
    """Take the driver and equipment off a load that has not been dispatched. It goes back to planned."""
    _, load = _active(db, assignment_id)
    loads.check_version(load, body.version)
    service.unassign(db, p, load, reason=body.reason)
    db.commit()
    return loads.load_detail(db, p, load.id)
