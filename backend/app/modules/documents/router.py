import re
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import AppError, Invalid, NotFound
from app.core.storage import get_storage, make_key
from app.modules.documents.models import Document
from app.modules.loads.models import Load

router = APIRouter(tags=["documents"])

ALLOWED = {"application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"}
DocType = Literal["bol", "pod", "receipt", "other"]


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    load_id: uuid.UUID
    type: str
    filename: str
    content_type: str
    size_bytes: int
    uploaded_by: uuid.UUID | None
    created_at: datetime


def save_document(db: Session, p: Principal, load: Load, doc_type: str, file: UploadFile) -> Document:
    """Shared by the office and driver upload endpoints."""
    limit = get_settings().max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise AppError(f"File is larger than {limit // (1024 * 1024)} MB", status=413, code="too_large")
    if not data:
        raise Invalid("File is empty")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in ALLOWED:
        raise Invalid("Unsupported file type. Upload a PDF or an image (JPEG, PNG, HEIC, WebP).")
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", (file.filename or "document").rsplit("/", 1)[-1].rsplit("\\", 1)[-1])[:200]
    doc_id = uuid.uuid4()
    key = make_key(p.org_id, doc_id)
    get_storage().put(key, data)
    doc = Document(id=doc_id, organization_id=p.org_id, load_id=load.id, type=doc_type, filename=name or "document",
                   content_type=ctype, size_bytes=len(data), storage_key=key, uploaded_by=p.user_id)
    db.add(doc)
    db.flush()
    audit(db, p, "document.uploaded", "document", doc.id, {"load_id": str(load.id), "type": doc_type})
    return doc


@router.post("/loads/{load_id}/documents", response_model=DocumentOut, status_code=201)
def upload(load_id: uuid.UUID, type: DocType = Form(...), file: UploadFile = File(...),
           p: Principal = Depends(require("documents:write")), db=Depends(get_db)):
    load = get_or_404(db, Load, load_id, "Load")
    doc = save_document(db, p, load, type, file)
    db.commit()
    return doc


@router.get("/loads/{load_id}/documents", response_model=list[DocumentOut])
def list_documents(load_id: uuid.UUID, p: Principal = Depends(require("documents:read")), db=Depends(get_db)):
    get_or_404(db, Load, load_id, "Load")
    return list(db.scalars(select(Document).where(Document.load_id == load_id).order_by(Document.created_at.desc())))


@router.get("/documents/{doc_id}/download")
def download(doc_id: uuid.UUID, p: Principal = Depends(require("documents:read")), db=Depends(get_db)):
    doc = get_or_404(db, Document, doc_id, "Document")
    try:
        data = get_storage().get(doc.storage_key)
    except FileNotFoundError as e:
        raise NotFound("The stored file for this document is missing") from e
    return Response(data, media_type=doc.content_type, headers={
        "Content-Disposition": f'attachment; filename="{doc.filename}"',
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})
