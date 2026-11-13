"""The expirations queue: every dated compliance item across drivers and equipment, in one sorted list."""
import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, Uuid, cast, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.core.crud import ListParams, like
from app.core.deps import Principal, get_db, require
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.modules.documents.models import Document, DocumentLink
from app.modules.drivers.models import Driver, DriverQualification
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.safety.rules import ITEM_LABELS, WARN_DAYS

router = APIRouter(prefix="/safety", tags=["safety"])

# "equipment" means trucks and trailers together.
EntityType = Literal["driver", "vehicle", "trailer", "equipment"]
State = Literal["expired", "expiring", "missing"]
FAR = date(9999, 1, 1)
DOCUMENT_LABELS = {"license": "Licence document", "medical": "Medical document", "insurance": "Insurance document",
                   "registration": "Registration document", "inspection": "Inspection document"}


class Expiration(BaseModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    entity_label: str
    terminal_id: uuid.UUID | None
    item: str
    item_label: str
    expires_on: date | None
    state: State
    days_left: int | None = Field(description="Negative once expired. Null when nothing is on file")
    # True when this item stops the driver or unit from being dispatched once it expires.
    blocks_dispatch: bool


class ExpirationParams(ListParams):
    state: State | None = Field(default=None, description="Default: expired and expiring")
    within_days: int = Field(default=WARN_DAYS, ge=1, le=365)
    entity_type: EntityType | None = None
    terminal_id: uuid.UUID | None = None


class SafetySummary(BaseModel):
    expired: int
    expiring: int
    missing: int
    drivers_blocked: int
    units_blocked: int


def _row_id(entity_id, item: str):
    # One stable id per (record, item) pair, so the list can be paged.
    return cast(func.md5(func.concat(cast(entity_id, String), literal(":" + item))), Uuid)


def items():
    """One row per dated item. Records that are no longer in service are left out."""
    def part(entity_type: str, entity_id, label, terminal_id, item, expires_on, blocks, row_id, source):
        item_column = literal(item) if isinstance(item, str) else item
        return select(
            row_id.label("id"), literal(entity_type).label("entity_type"), entity_id.label("entity_id"),
            label.label("entity_label"), terminal_id.label("terminal_id"), item_column.label("item"),
            expires_on.label("expires_on"), blocks.label("blocks_dispatch")).select_from(source)

    driver_name = func.concat(Driver.first_name, literal(" "), Driver.last_name)
    in_service = Driver.status == "active"
    parts = [
        part("driver", Driver.id, driver_name, Driver.terminal_id, "cdl", Driver.cdl_expiry, literal(True),
             _row_id(Driver.id, "cdl"), Driver).where(in_service),
        part("driver", Driver.id, driver_name, Driver.terminal_id, "medical", Driver.medical_cert_expiry,
             literal(True), _row_id(Driver.id, "medical"), Driver).where(in_service),
        part("driver", Driver.id, driver_name, Driver.terminal_id, DriverQualification.type,
             DriverQualification.expires_on, DriverQualification.required, DriverQualification.id,
             DriverQualification.__table__.join(Driver, Driver.id == DriverQualification.driver_id))
        .where(in_service, DriverQualification.expires_on.is_not(None)),
    ]
    for entity_type, model, word in (("vehicle", Vehicle, "Truck "), ("trailer", Trailer, "Trailer ")):
        name = func.concat(literal(word), model.unit_number)
        for item, column in (("insurance", model.insurance_expiry), ("registration", model.registration_expiry),
                             ("inspection", model.inspection_expiry)):
            parts.append(part(entity_type, model.id, name, model.terminal_id, item, column, literal(True),
                              _row_id(model.id, item), model).where(model.status != "retired"))
    return union_all(*parts).subquery("items")


def _state(expires_on: date | None, today: date) -> tuple[State, int | None]:
    if expires_on is None:
        return "missing", None
    days = (expires_on - today).days
    return ("expired" if days < 0 else "expiring"), days


@router.get("/expirations", response_model=Page[Expiration])
def expirations(params: Annotated[ExpirationParams, Query()], p: Principal = Depends(require("safety.read")),
                db: Session = Depends(get_db)):
    """What has expired, what is about to, and what has no date on file."""
    today = p.today()
    horizon = today + timedelta(days=params.within_days)
    t = items()
    stmt = select(t)
    if params.state == "expired":
        stmt = stmt.where(t.c.expires_on < today)
    elif params.state == "expiring":
        stmt = stmt.where(t.c.expires_on >= today, t.c.expires_on <= horizon)
    elif params.state == "missing":
        stmt = stmt.where(t.c.expires_on.is_(None))
    else:
        stmt = stmt.where(t.c.expires_on <= horizon)
    if params.entity_type == "equipment":
        stmt = stmt.where(t.c.entity_type != "driver")
    elif params.entity_type:
        stmt = stmt.where(t.c.entity_type == params.entity_type)
    if params.terminal_id:
        stmt = stmt.where(t.c.terminal_id == params.terminal_id)
    if params.q:
        stmt = stmt.where(t.c.entity_label.ilike(like(params.q.strip())))
    sortable = {"expires_on": func.coalesce(t.c.expires_on, literal(FAR)), "entity": t.c.entity_label}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "expires_on"), t.c.id, cursor=params.cursor,
                          limit=params.limit, count=params.count)
    names = [c.key for c in t.c]
    out = []
    for values in rows:
        row = dict(zip(names, values, strict=True))
        state, days = _state(row["expires_on"], today)
        out.append(Expiration(**row, item_label=ITEM_LABELS.get(row["item"], row["item"]), state=state,
                              days_left=days))
    return envelope(out, info)


def summary_counts(db: Session, today: date) -> SafetySummary:
    t = items()
    horizon = today + timedelta(days=WARN_DAYS)
    expired = t.c.expires_on < today
    blocked = expired & t.c.blocks_dispatch
    row = db.execute(select(
        func.count().filter(expired),
        func.count().filter(t.c.expires_on >= today, t.c.expires_on <= horizon),
        func.count().filter(t.c.expires_on.is_(None)),
        func.count(func.distinct(t.c.entity_id)).filter(blocked, t.c.entity_type == "driver"),
        func.count(func.distinct(t.c.entity_id)).filter(blocked, t.c.entity_type != "driver"),
    ).select_from(t)).one()
    return SafetySummary(expired=row[0], expiring=row[1], missing=row[2], drivers_blocked=row[3], units_blocked=row[4])


@router.get("/summary", response_model=SafetySummary)
def summary(p: Principal = Depends(require("safety.read")), db: Session = Depends(get_db)):
    return summary_counts(db, p.today())


class ExpiringDocument(BaseModel):
    id: uuid.UUID
    type: str
    label: str
    filename: str
    expires_on: date
    state: State
    days_left: int
    entity_type: str
    entity_id: uuid.UUID


@router.get("/expiring-documents", response_model=list[ExpiringDocument])
def expiring_documents(within_days: int = Query(default=WARN_DAYS, ge=1, le=365),
                       p: Principal = Depends(require("safety.read")), db: Session = Depends(get_db)):
    """Uploaded documents that carry their own expiry date (an insurance certificate, a permit)."""
    today = p.today()
    stmt = (select(Document, DocumentLink.entity_type, DocumentLink.entity_id)
            .join(DocumentLink, DocumentLink.document_id == Document.id)
            .where(Document.upload_status == "uploaded", Document.expires_on <= today + timedelta(days=within_days))
            .order_by(Document.expires_on, Document.id).limit(200))
    if not p.can("drivers.sensitive.read"):
        stmt = stmt.where(Document.type.notin_(("license", "medical")))
    out = []
    for doc, entity_type, entity_id in db.execute(stmt):
        state, days = _state(doc.expires_on, today)
        out.append(ExpiringDocument(
            id=doc.id, type=doc.type, label=DOCUMENT_LABELS.get(doc.type, "Document"), filename=doc.filename,
            expires_on=doc.expires_on, state=state, days_left=days, entity_type=entity_type, entity_id=entity_id))
    return out
