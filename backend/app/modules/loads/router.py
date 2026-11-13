import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.crud import child_router
from app.core.deps import Principal, get_db, require
from app.core.idempotency import run_idempotent
from app.core.pagination import Page, envelope
from app.modules.loads import schemas as s
from app.modules.loads import service
from app.modules.loads.models import Load, LoadCharge, LoadItem

router = APIRouter(tags=["loads"])


@router.get("/loads", response_model=Page[s.LoadListItem])
def list_loads(params: Annotated[s.LoadListParams, Query()], p: Principal = Depends(require("loads.read")),
               db: Session = Depends(get_db)):
    items, info = service.list_loads(db, p, params)
    return envelope(items, info)


@router.post("/loads", response_model=s.LoadDetail, status_code=201)
def create_load(body: s.LoadCreate, p: Principal = Depends(require("loads.create")), db: Session = Depends(get_db),
                idempotency_key: Annotated[str | None, Header()] = None):
    """Book a load. Send an Idempotency-Key so a retried request can't book it twice."""
    def work():
        load = service.create_load(db, p, body)
        db.flush()
        return 201, service.load_detail(db, p, load.id)
    return run_idempotent(db, p, idempotency_key, "POST /loads", body.model_dump(mode="json"), work)


@router.get("/loads/{load_id}", response_model=s.LoadDetail)
def get_load(load_id: uuid.UUID, p: Principal = Depends(require("loads.read")), db: Session = Depends(get_db)):
    return service.load_detail(db, p, load_id)


@router.patch("/loads/{load_id}", response_model=s.LoadDetail)
def update_load(load_id: uuid.UUID, body: s.LoadUpdate, p: Principal = Depends(require("loads.update")),
                db: Session = Depends(get_db)):
    service.update_load(db, p, load_id, body)
    db.commit()
    return service.load_detail(db, p, load_id)


@router.post("/loads/{load_id}/transitions", response_model=s.LoadDetail)
def transition(load_id: uuid.UUID, body: s.TransitionIn, p: Principal = Depends(require("loads.read")),
               db: Session = Depends(get_db)):
    """Move a load through its lifecycle. The action decides which permission is needed."""
    load = service.lock_load(db, load_id)
    service.check_version(load, body.version)
    service.transition(db, p, load, body.action, reason=body.reason, stop_id=body.stop_id,
                       occurred_at=body.occurred_at)
    db.commit()
    return service.load_detail(db, p, load_id)


@router.put("/loads/{load_id}/stops", response_model=s.LoadDetail)
def replace_stops(load_id: uuid.UUID, body: s.StopsReplace, p: Principal = Depends(require("loads.update")),
                  db: Session = Depends(get_db)):
    """Set the whole route at once: add, remove and reorder stops. Allowed until the load is dispatched."""
    service.set_stops(db, p, load_id, body)
    db.commit()
    return service.load_detail(db, p, load_id)


@router.patch("/loads/{load_id}/stops/{stop_id}", response_model=s.LoadDetail)
def update_stop(load_id: uuid.UUID, stop_id: uuid.UUID, body: s.StopPatch,
                p: Principal = Depends(require("loads.update")), db: Session = Depends(get_db)):
    """Change a stop's appointment or contact. Allowed until the truck has left that stop."""
    service.patch_stop(db, p, load_id, stop_id, body)
    db.commit()
    return service.load_detail(db, p, load_id)


@router.post("/loads/{load_id}/notes", response_model=s.LoadDetail, status_code=201)
def add_note(load_id: uuid.UUID, body: s.NoteIn, p: Principal = Depends(require("loads.update")),
             db: Session = Depends(get_db)):
    service.add_note(db, p, load_id, body)
    db.commit()
    return service.load_detail(db, p, load_id)


@router.post("/loads/{load_id}/tracking", response_model=s.LoadDetail, status_code=201)
def add_check_call(load_id: uuid.UUID, body: s.TrackingIn, p: Principal = Depends(require("loads.update")),
                   db: Session = Depends(get_db)):
    """Record where the truck is, or that something has gone wrong."""
    service.add_tracking(db, p, load_id, body)
    db.commit()
    return service.load_detail(db, p, load_id)


def _prepare_charge(db: Session, p: Principal, data: dict, obj) -> None:
    quantity = data.get("quantity") or (obj.quantity if obj is not None else None)
    rate = data.get("rate") if data.get("rate") is not None else (obj.rate if obj is not None else None)
    for required in ("type", "quantity", "rate", "billable", "driver_payable"):
        if required in data and data[required] is None:
            data.pop(required)  # an explicit null means "leave it"
    if quantity is not None and rate is not None:
        data["amount"] = service.charge_amount(quantity, rate)


router.include_router(child_router(
    prefix="/loads/{parent_id}/items", tag="loads", entity="load_item", label="item", model=LoadItem,
    parent_model=Load, parent_fk="load_id", parent_label="Load", create_schema=s.ItemIn, update_schema=s.ItemPatch,
    read_schema=s.ItemOut, read_perm="loads.read", write_perm="loads.update", parent_guard=service.guard_open,
    after_change=service.after_item_change))
router.include_router(child_router(
    prefix="/loads/{parent_id}/charges", tag="loads", entity="load_charge", label="charge", model=LoadCharge,
    parent_model=Load, parent_fk="load_id", parent_label="Load", create_schema=s.ChargeIn,
    update_schema=s.ChargePatch, read_schema=s.ChargeOut, read_perm="loads.rates.read", write_perm="loads.update",
    before_save=_prepare_charge, parent_guard=service.guard_rates, after_change=service.after_charge_change))
