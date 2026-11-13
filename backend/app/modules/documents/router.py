"""Documents: metadata in PostgreSQL, bytes in object storage, access decided here on every request.

Uploading follows the contract the blueprint asks for, so moving to S3 presigned URLs later changes only the
address the browser sends the file to:

    1. POST /documents/upload-intents    the API checks the request and says where to send the file
    2. PUT  <upload.url>                 the file itself
    3. POST /documents/{id}/complete     the API verifies what arrived and makes the document usable
"""
import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.crud import ListParams, like
from app.core.deps import Principal, get_db, require
from app.core.errors import AppError, Conflict, Forbidden, Invalid, NotFound
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.core.storage import get_storage, make_key
from app.modules.customers.models import Customer
from app.modules.dispatch.models import DispatchAssignment
from app.modules.documents.models import Document, DocumentLink
from app.modules.drivers.models import Driver
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.finance.models import Invoice
from app.modules.loads import service as loads
from app.modules.loads.models import Load
from app.modules.maintenance.models import WorkOrder
from app.modules.organizations.models import User
from app.modules.safety.rules import WARN_DAYS

router = APIRouter(prefix="/documents", tags=["documents"])

DocumentType = Literal["bol", "pod", "rate_confirmation", "receipt", "license", "medical", "insurance",
                       "registration", "inspection", "maintenance", "invoice", "other"]
EntityType = Literal["load", "driver", "vehicle", "trailer", "customer", "invoice", "work_order"]

# What a document can be attached to: the record, the permission needed to see that record, its display name.
ENTITIES = {
    "load": (Load, "loads.read", lambda x: x.load_number),
    "driver": (Driver, "drivers.read", lambda x: f"{x.first_name} {x.last_name}"),
    "vehicle": (Vehicle, "equipment.read", lambda x: f"Truck {x.unit_number}"),
    "trailer": (Trailer, "equipment.read", lambda x: f"Trailer {x.unit_number}"),
    "customer": (Customer, "customers.read", lambda x: x.name),
    "invoice": (Invoice, "invoices.read", lambda x: x.invoice_number or "Draft invoice"),
    "work_order": (WorkOrder, "maintenance.read", lambda x: f"Work order {x.number}"),
}
# Scans of personal identity documents: only roles that may see the numbers on them may see the scans.
SENSITIVE = ("license", "medical")
# Reviewed by safety before they count. Proof of delivery is reviewed through the load instead.
COMPLIANCE = ("license", "medical", "insurance", "registration", "inspection")
# What a driver may add to a load they are hauling.
DRIVER_TYPES = ("pod", "bol", "receipt")

SIGNATURES = {
    "application/pdf": (b"%PDF-",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


# ---------------------------------------------------------------- schemas
class UploadIntentIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(max_length=100)
    size_bytes: int = Field(gt=0)
    type: DocumentType
    entity_type: EntityType
    entity_id: uuid.UUID
    expires_on: date | None = None


class LinkIn(BaseModel):
    entity_type: EntityType
    entity_id: uuid.UUID


class LinkOut(LinkIn):
    id: uuid.UUID
    label: str | None


class DocumentOut(BaseModel):
    id: uuid.UUID
    type: str
    filename: str
    content_type: str
    size_bytes: int
    upload_status: str
    scan_status: str
    review_status: str
    review_note: str | None
    reviewed_by_name: str | None
    reviewed_at: datetime | None
    expires_on: date | None
    uploaded_by_name: str | None
    created_at: datetime
    links: list[LinkOut]


class UploadTarget(BaseModel):
    method: Literal["PUT"] = "PUT"
    url: str = Field(description="Where to send the file. Relative URLs are relative to the API base path")
    headers: dict[str, str]


class UploadIntentOut(BaseModel):
    document: DocumentOut
    upload: UploadTarget


class DocumentPatch(BaseModel):
    filename: str | None = Field(default=None, min_length=1, max_length=255)
    expires_on: date | None = None


class ReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)


class DocumentListParams(ListParams):
    entity_type: EntityType | None = None
    entity_id: uuid.UUID | None = None
    type: DocumentType | None = None
    review_status: Literal["not_required", "pending", "approved", "rejected"] | None = None
    expiring: bool | None = Field(default=None, description="Only documents already expired or expiring soon")


# ---------------------------------------------------------------- access
def _see_sensitive(p: Principal) -> bool:
    return p.can("drivers.sensitive.read")


def _my_driver_id(db: Session, p: Principal) -> uuid.UUID | None:
    return db.scalar(select(Driver.id).where(Driver.user_id == p.user_id))


def _check_entity(db: Session, p: Principal, entity_type: str, entity_id: uuid.UUID, doc_type: str) -> None:
    """The caller must be allowed to see the record a document is being attached to."""
    model, permission, _ = ENTITIES[entity_type]
    if p.role == "driver":
        mine = entity_type == "load" and doc_type in DRIVER_TYPES and db.scalar(
            select(DispatchAssignment.id).where(DispatchAssignment.load_id == entity_id,
                                                DispatchAssignment.driver_id == _my_driver_id(db, p),
                                                DispatchAssignment.status.in_(("active", "completed"))))
        if not mine:
            raise Forbidden("Drivers can add a POD, BOL or receipt to a load they are hauling")
    elif not p.can(permission):
        raise Forbidden("Your role does not allow access to that record")
    if db.get(model, entity_id) is None:
        raise Invalid(f"{entity_type.capitalize()} not found", field="entity_id")
    if doc_type in SENSITIVE and not _see_sensitive(p):
        raise Forbidden("Your role does not allow handling licence or medical documents")


def _get(db: Session, p: Principal, document_id: uuid.UUID, *, uploaded: bool = True) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or (uploaded and doc.upload_status != "uploaded"):
        raise NotFound("Document not found")
    if doc.type in SENSITIVE and not _see_sensitive(p):
        raise NotFound("Document not found")  # hidden rather than refused: its existence is not disclosed
    return doc


def _present(db: Session, docs: list[Document]) -> list[DocumentOut]:
    ids = [d.id for d in docs]
    links = list(db.scalars(select(DocumentLink).where(DocumentLink.document_id.in_(ids)))) if ids else []
    labels: dict[tuple[str, uuid.UUID], str] = {}
    for entity_type, (model, _, name) in ENTITIES.items():
        wanted = {link.entity_id for link in links if link.entity_type == entity_type}
        if wanted:
            for row in db.scalars(select(model).where(model.id.in_(wanted))):
                labels[(entity_type, row.id)] = name(row)
    people = {u for d in docs for u in (d.uploaded_by, d.reviewed_by) if u}
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(people))).all()) if people else {}
    by_doc: dict[uuid.UUID, list[LinkOut]] = {}
    for link in links:
        by_doc.setdefault(link.document_id, []).append(LinkOut(
            id=link.id, entity_type=link.entity_type, entity_id=link.entity_id,
            label=labels.get((link.entity_type, link.entity_id))))
    return [DocumentOut(
        id=d.id, type=d.type, filename=d.filename, content_type=d.content_type, size_bytes=d.size_bytes,
        upload_status=d.upload_status, scan_status=d.scan_status, review_status=d.review_status,
        review_note=d.review_note, reviewed_by_name=names.get(d.reviewed_by), reviewed_at=d.reviewed_at,
        expires_on=d.expires_on, uploaded_by_name=names.get(d.uploaded_by), created_at=d.created_at,
        links=by_doc.get(d.id, [])) for d in docs]


# ---------------------------------------------------------------- upload
@router.post("/upload-intents", response_model=UploadIntentOut, status_code=201)
def create_upload_intent(body: UploadIntentIn, p: Principal = Depends(require("documents.upload", "driver.self")),
                         db: Session = Depends(get_db)):
    """Step 1: ask to upload. Nothing is stored yet; the reply says where to send the file."""
    limit = get_settings().max_upload_bytes
    if body.content_type not in SIGNATURES:
        raise Invalid("Upload a PDF, JPEG, PNG or WebP file", field="content_type")
    if body.size_bytes > limit:
        raise Invalid(f"Files can be up to {limit // (1024 * 1024)} MB", field="size_bytes")
    _check_entity(db, p, body.entity_type, body.entity_id, body.type)

    doc = Document(
        id=uuid.uuid4(), organization_id=p.org_id, type=body.type, filename=body.filename.strip(),
        content_type=body.content_type, size_bytes=body.size_bytes, expires_on=body.expires_on,
        uploaded_by=p.user_id,
        review_status="pending" if body.type == "pod" or body.type in COMPLIANCE else "not_required")
    doc.storage_key = make_key(p.org_id, doc.id)
    db.add(doc)
    db.flush()
    db.add(DocumentLink(organization_id=p.org_id, document_id=doc.id, entity_type=body.entity_type,
                        entity_id=body.entity_id))
    db.commit()
    return UploadIntentOut(document=_present(db, [doc])[0],
                           upload=UploadTarget(url=f"/documents/{doc.id}/content",
                                               headers={"Content-Type": doc.content_type}))


def _pending_upload(db: Session, p: Principal, document_id: uuid.UUID) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or doc.uploaded_by != p.user_id:
        raise NotFound("Upload not found")
    if doc.upload_status != "pending":
        raise Conflict("This upload has already been completed")
    return doc


async def _raw_body(request: Request) -> bytes:
    # Taken as it comes, whatever Content-Type says: the bytes are judged by what they are, not by a header.
    # The outermost middleware has already capped how much can be sent.
    return await request.body()


@router.put("/{document_id}/content", status_code=204, openapi_extra={"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
def upload_content(document_id: uuid.UUID, content: bytes = Depends(_raw_body),
                   p: Principal = Depends(require("documents.upload", "driver.self")),
                   db: Session = Depends(get_db)):
    """Step 2: the file. Stands in for the presigned storage URL used in production."""
    doc = _pending_upload(db, p, document_id)
    if len(content) > get_settings().max_upload_bytes or len(content) != doc.size_bytes:
        raise AppError("The file is not the size that was announced", status=413, code="PAYLOAD_TOO_LARGE")
    get_storage().put(doc.storage_key, content)


@router.post("/{document_id}/complete", response_model=DocumentOut)
def complete_upload(document_id: uuid.UUID, p: Principal = Depends(require("documents.upload", "driver.self")),
                    db: Session = Depends(get_db)):
    """Step 3: confirm. The API checks what actually arrived before the document can be used."""
    doc = _pending_upload(db, p, document_id)
    storage = get_storage()
    if not storage.exists(doc.storage_key):
        raise Conflict("The file has not been uploaded yet", code="UPLOAD_INCOMPLETE")
    data = storage.get(doc.storage_key)
    ok = len(data) == doc.size_bytes and data.startswith(SIGNATURES[doc.content_type])
    if ok and doc.content_type == "image/webp":
        ok = data[8:12] == b"WEBP"
    if not ok:
        # What arrived is not what was announced: discard it rather than keep a mislabelled file.
        storage.delete(doc.storage_key)
        db.delete(doc)
        db.commit()
        raise Invalid("The file's contents don't match its type. Upload a PDF, JPEG, PNG or WebP file.",
                      field="file")
    doc.checksum = hashlib.sha256(data).hexdigest()
    doc.upload_status = "uploaded"
    links = list(db.scalars(select(DocumentLink).where(DocumentLink.document_id == doc.id)))
    audit(db, p, "document.uploaded", "document", doc.id,
          {"type": doc.type, "filename": doc.filename,
           "attached_to": [{"type": x.entity_type, "id": str(x.entity_id)} for x in links]})
    if doc.type == "pod":
        db.flush()
        for link in links:
            if link.entity_type == "load":
                loads.on_pod_uploaded(db, p, link.entity_id)
    db.commit()
    return _present(db, [doc])[0]


# ---------------------------------------------------------------- read
@router.get("", response_model=Page[DocumentOut])
def list_documents(params: Annotated[DocumentListParams, Query()],
                   p: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)):
    stmt = select(Document).where(Document.upload_status == "uploaded")
    if not _see_sensitive(p):
        stmt = stmt.where(Document.type.notin_(SENSITIVE))
    if params.entity_type or params.entity_id:
        link = select(DocumentLink.id).where(DocumentLink.document_id == Document.id)
        if params.entity_type:
            link = link.where(DocumentLink.entity_type == params.entity_type)
        if params.entity_id:
            link = link.where(DocumentLink.entity_id == params.entity_id)
        stmt = stmt.where(exists(link))
    if params.type:
        stmt = stmt.where(Document.type == params.type)
    if params.review_status:
        stmt = stmt.where(Document.review_status == params.review_status)
    if params.expiring:
        stmt = stmt.where(Document.expires_on <= p.today() + timedelta(days=WARN_DAYS))
    if params.q:
        stmt = stmt.where(Document.filename.ilike(like(params.q.strip())))
    rows, info = paginate(db, stmt, parse_sort(params.sort, {"created_at": Document.created_at}, "-created_at"),
                          Document.id, cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope(_present(db, rows), info)


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: uuid.UUID, p: Principal = Depends(require("documents.read")),
                 db: Session = Depends(get_db)):
    return _present(db, [_get(db, p, document_id)])[0]


@router.get("/{document_id}/download")
def download(document_id: uuid.UUID, disposition: Literal["attachment", "inline"] = "attachment",
             p: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)):
    """The file itself. Access is checked on every download; there are no shareable links."""
    doc = _get(db, p, document_id)
    try:
        data = get_storage().get(doc.storage_key)
    except FileNotFoundError as e:
        raise NotFound("The file is missing from storage") from e
    audit(db, p, "document.downloaded", "document", doc.id)
    db.commit()
    return Response(content=data, media_type=doc.content_type, headers={
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(doc.filename)}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox"})


# ---------------------------------------------------------------- change
@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(document_id: uuid.UUID, body: DocumentPatch, p: Principal = Depends(require("documents.upload")),
                    db: Session = Depends(get_db)):
    doc = _get(db, p, document_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("filename", "") is None:
        raise Invalid("This field can't be empty", field="filename")
    for k, v in changes.items():
        setattr(doc, k, v)
    audit(db, p, "document.updated", "document", doc.id, body.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return _present(db, [doc])[0]


@router.post("/{document_id}/links", response_model=DocumentOut, status_code=201)
def add_link(document_id: uuid.UUID, body: LinkIn, p: Principal = Depends(require("documents.upload")),
             db: Session = Depends(get_db)):
    """Attach the same document to another record, instead of uploading it twice."""
    doc = _get(db, p, document_id)
    _check_entity(db, p, body.entity_type, body.entity_id, doc.type)
    already = db.scalar(select(DocumentLink.id).where(
        DocumentLink.document_id == doc.id, DocumentLink.entity_type == body.entity_type,
        DocumentLink.entity_id == body.entity_id))
    if not already:
        db.add(DocumentLink(organization_id=p.org_id, document_id=doc.id, **body.model_dump()))
        audit(db, p, "document.linked", "document", doc.id, body.model_dump(mode="json"))
        if doc.type == "pod" and body.entity_type == "load" and doc.review_status == "pending":
            db.flush()
            loads.on_pod_uploaded(db, p, body.entity_id)
        db.commit()
    return _present(db, [doc])[0]


def _guard_proof(db: Session, doc: Document, links: list[DocumentLink]) -> None:
    """The proof behind a finished load stays put."""
    if doc.type != "pod" or doc.review_status != "approved":
        return
    load_ids = [x.entity_id for x in links if x.entity_type == "load"]
    if load_ids and db.scalar(select(Load.id).where(Load.id.in_(load_ids), Load.status == "completed")):
        raise Conflict("This is the approved proof of delivery for a completed load and can't be removed")


@router.delete("/{document_id}/links/{link_id}", status_code=204)
def remove_link(document_id: uuid.UUID, link_id: uuid.UUID, p: Principal = Depends(require("documents.delete")),
                db: Session = Depends(get_db)):
    doc = _get(db, p, document_id)
    links = list(db.scalars(select(DocumentLink).where(DocumentLink.document_id == doc.id)))
    link = next((x for x in links if x.id == link_id), None)
    if link is None:
        raise NotFound("Link not found")
    if len(links) == 1:
        raise Conflict("A document must stay attached to something. Delete the document instead.")
    _guard_proof(db, doc, [link])
    db.delete(link)
    audit(db, p, "document.unlinked", "document", doc.id,
          {"entity_type": link.entity_type, "entity_id": str(link.entity_id)})
    db.commit()


@router.post("/{document_id}/review", response_model=DocumentOut)
def review(document_id: uuid.UUID, body: ReviewIn, p: Principal = Depends(require("safety.manage")),
           db: Session = Depends(get_db)):
    """Approve or reject a compliance document. Proof of delivery is reviewed on its load instead."""
    doc = _get(db, p, document_id)
    if doc.type == "pod":
        raise Conflict("Review proof of delivery from its load, so the load moves on with it")
    if doc.review_status == "not_required":
        raise Conflict("This kind of document doesn't need a review")
    note = (body.note or "").strip() or None
    if body.decision == "rejected" and not note:
        raise Invalid("Say what is wrong so it can be fixed", field="note")
    doc.review_status, doc.review_note = body.decision, note
    doc.reviewed_by, doc.reviewed_at = p.user_id, datetime.now(UTC)
    audit(db, p, f"document.{body.decision}", "document", doc.id, {"note": note} if note else None)
    db.commit()
    return _present(db, [doc])[0]


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: uuid.UUID, p: Principal = Depends(require("documents.delete")),
                    db: Session = Depends(get_db)):
    doc = _get(db, p, document_id)
    _guard_proof(db, doc, list(db.scalars(select(DocumentLink).where(DocumentLink.document_id == doc.id))))
    key = doc.storage_key
    db.delete(doc)
    audit(db, p, "document.deleted", "document", document_id, {"type": doc.type, "filename": doc.filename})
    db.commit()
    get_storage().delete(key)  # after the commit: a failed transaction must not lose the file
