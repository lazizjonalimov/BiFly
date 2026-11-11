"""Endpoints for the driver mobile app. Everything here is limited to the caller's own assignments."""
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy import select

from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Forbidden, NotFound
from app.core.idempotency import run_idempotent
from app.modules.dispatch.models import DispatchAssignment
from app.modules.documents.router import DocType, DocumentOut, save_document
from app.modules.drivers.models import Driver
from app.modules.loads import schemas as ls
from app.modules.loads.models import Load, LoadStop
from app.modules.loads.router import detail_view
from app.modules.loads.service import lock_load_or_404, record_stop_event

router = APIRouter(prefix="/driver", tags=["driver app"])

# A driver sees a load only once it has been released to them, and until delivery is confirmed.
VISIBLE = ("dispatched", "in_transit", "delivered")


def _me(db, p: Principal) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.user_id == p.user_id))
    if driver is None:
        raise Forbidden("This login is not linked to a driver profile")
    return driver


def _my_load(db, p: Principal, load_id: uuid.UUID, *, lock: bool = False) -> Load:
    driver = _me(db, p)
    mine = db.scalar(select(DispatchAssignment.id).where(
        DispatchAssignment.load_id == load_id, DispatchAssignment.driver_id == driver.id,
        DispatchAssignment.status == "active"))
    load = (lock_load_or_404(db, load_id) if lock else db.get(Load, load_id)) if mine else None
    if load is None or load.status not in VISIBLE:
        raise NotFound("Load not found")  # same answer whether it doesn't exist or isn't yours
    return load


@router.get("/assignments", response_model=list[ls.LoadDetail])
def my_assignments(p: Principal = Depends(require("driver:self")), db=Depends(get_db)):
    driver = _me(db, p)
    loads = db.scalars(select(Load).join(DispatchAssignment, DispatchAssignment.load_id == Load.id)
                       .where(DispatchAssignment.driver_id == driver.id, DispatchAssignment.status == "active",
                              Load.status.in_(VISIBLE)).order_by(Load.created_at))
    return [_strip(detail_view(db, ld)) for ld in loads]


def _strip(d: ls.LoadDetail) -> ls.LoadDetail:
    """Drivers don't see what the customer is paying."""
    return d.model_copy(update={"customer_rate": Decimal("0"), "invoice_id": None})


@router.get("/loads/{load_id}", response_model=ls.LoadDetail)
def my_load(load_id: uuid.UUID, p: Principal = Depends(require("driver:self")), db=Depends(get_db)):
    return _strip(detail_view(db, _my_load(db, p, load_id)))


@router.post("/loads/{load_id}/stops/{stop_id}/events", response_model=ls.LoadDetail)
def my_stop_event(load_id: uuid.UUID, stop_id: uuid.UUID, body: ls.StopEventIn,
                  p: Principal = Depends(require("driver:self")), db=Depends(get_db),
                  idempotency_key: str | None = Header(default=None)):
    """Arrived / departed. Send an Idempotency-Key so queued offline events can be retried safely."""
    def work():
        load = _my_load(db, p, load_id, lock=True)
        stop = get_or_404(db, LoadStop, stop_id, "Stop")
        if stop.load_id != load.id:
            raise NotFound("Stop not found")
        record_stop_event(db, p, load, stop, body.event, body.occurred_at)
        return 200, _strip(detail_view(db, load)).model_dump(mode="json")
    return run_idempotent(db, p, idempotency_key, f"driver.stop_event:{load_id}:{stop_id}",
                          body.model_dump(mode="json"), work)


@router.post("/loads/{load_id}/documents", response_model=DocumentOut, status_code=201)
def my_upload(load_id: uuid.UUID, type: DocType = Form(...), file: UploadFile = File(...),
              p: Principal = Depends(require("driver:self")), db=Depends(get_db)):
    """Upload a BOL, POD or receipt photo for one of my loads."""
    load = _my_load(db, p, load_id)
    doc = save_document(db, p, load, type, file)
    db.commit()
    return doc
