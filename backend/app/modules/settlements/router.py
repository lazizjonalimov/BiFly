"""Driver settlements: build a draft from the period's loads and expenses, approve it, pay it."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.crud import like
from app.core.deps import Principal, get_db, require
from app.core.idempotency import run_idempotent
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.modules.drivers.models import Driver
from app.modules.settlements import schemas as s
from app.modules.settlements import service
from app.modules.settlements.models import DriverSettlement

router = APIRouter(prefix="/settlements", tags=["settlements"])
READ = require("settlements.read")
MANAGE = require("settlements.manage")


@router.get("/summary", response_model=s.SettlementSummary)
def get_summary(p: Principal = Depends(READ), db: Session = Depends(get_db)):
    """Drafts in progress, what is approved and waiting to be paid, and what was paid this month."""
    return service.summary(db, p)


@router.get("", response_model=Page[s.SettlementListItem])
def list_settlements(params: Annotated[s.SettlementListParams, Query()], p: Principal = Depends(READ),
                     db: Session = Depends(get_db)):
    name = Driver.first_name + " " + Driver.last_name
    stmt = select(DriverSettlement, name).join(Driver, Driver.id == DriverSettlement.driver_id)
    if params.status:
        stmt = stmt.where(DriverSettlement.status == params.status)
    if params.driver_id:
        stmt = stmt.where(DriverSettlement.driver_id == params.driver_id)
    if params.period_from:
        stmt = stmt.where(DriverSettlement.period_end >= params.period_from)
    if params.period_to:
        stmt = stmt.where(DriverSettlement.period_start <= params.period_to)
    if params.q and params.q.strip():
        pattern = like(params.q.strip())
        stmt = stmt.where(or_(DriverSettlement.number.ilike(pattern), name.ilike(pattern)))
    sortable = {"created_at": DriverSettlement.created_at, "period_end": DriverSettlement.period_end,
                "net_pay": DriverSettlement.net_pay}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-created_at"), DriverSettlement.id,
                          cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope([s.SettlementListItem(**service.list_item(st, driver)) for st, driver in rows], info)


@router.post("", response_model=s.SettlementDetail, status_code=201)
def create_settlement(body: s.SettlementCreate, p: Principal = Depends(MANAGE), db: Session = Depends(get_db),
                      idempotency_key: Annotated[str | None, Header()] = None):
    """Start a draft for a driver and a period. It is filled from the loads they delivered up to the end of the
    period that no other settlement paid, the driver-payable charges on them, and their reimbursements and
    deductions."""
    def work():
        st = service.create(db, p, body)
        db.flush()
        return 201, service.detail(db, p, st.id)
    return run_idempotent(db, p, idempotency_key, "POST /settlements", body.model_dump(mode="json"), work)


@router.get("/{settlement_id}", response_model=s.SettlementDetail)
def get_settlement(settlement_id: uuid.UUID, p: Principal = Depends(READ), db: Session = Depends(get_db)):
    return service.detail(db, p, settlement_id)


@router.patch("/{settlement_id}", response_model=s.SettlementDetail)
def update_settlement(settlement_id: uuid.UUID, body: s.SettlementUpdate, p: Principal = Depends(MANAGE),
                      db: Session = Depends(get_db)):
    service.update_draft(db, p, settlement_id, body)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.delete("/{settlement_id}", status_code=204)
def delete_settlement(settlement_id: uuid.UUID, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    service.delete_draft(db, p, settlement_id)
    db.commit()


@router.post("/{settlement_id}/recalculate", response_model=s.SettlementDetail)
def recalculate(settlement_id: uuid.UUID, body: s.Versioned, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    """Rebuild the draft from its loads and expenses as they are now. Lines entered by hand are kept."""
    service.refresh(db, p, settlement_id, body.version)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.post("/{settlement_id}/lines", response_model=s.SettlementDetail, status_code=201)
def add_line(settlement_id: uuid.UUID, body: s.ManualLineIn, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    service.add_line(db, p, settlement_id, body)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.delete("/{settlement_id}/lines/{line_id}", response_model=s.SettlementDetail)
def remove_line(settlement_id: uuid.UUID, line_id: uuid.UUID, version: int = Query(), p: Principal = Depends(MANAGE),
                db: Session = Depends(get_db)):
    """Remove a line entered by hand."""
    service.remove_line(db, p, settlement_id, line_id, version)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.post("/{settlement_id}/approve", response_model=s.SettlementDetail)
def approve(settlement_id: uuid.UUID, body: s.Versioned, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    """Recalculate one last time, number the settlement and fix it."""
    service.approve(db, p, settlement_id, body.version)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.post("/{settlement_id}/pay", response_model=s.SettlementDetail)
def pay(settlement_id: uuid.UUID, body: s.PayIn, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    service.pay(db, p, settlement_id, body)
    db.commit()
    return service.detail(db, p, settlement_id)


@router.post("/{settlement_id}/void", response_model=s.SettlementDetail)
def void(settlement_id: uuid.UUID, body: s.SettlementVoidIn, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    """Void an approved, unpaid settlement. Its loads and expenses can go on another one."""
    service.void(db, p, settlement_id, body)
    db.commit()
    return service.detail(db, p, settlement_id)
