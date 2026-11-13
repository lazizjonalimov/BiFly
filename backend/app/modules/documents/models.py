import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped

DOCUMENT_TYPES = ("bol", "pod", "rate_confirmation", "receipt", "license", "medical", "insurance", "registration",
                  "inspection", "maintenance", "invoice", "other")
# What a document can be attached to.
ENTITY_TYPES = ("load", "driver", "vehicle", "trailer", "customer", "work_order", "invoice", "expense")


class Document(Base, IdMixin, TenantScoped):
    """Metadata only. The bytes live in object storage (S3 in production), never in the database."""
    __tablename__ = "documents"
    type: Mapped[str] = mapped_column(String(20))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str | None] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(300))
    # pending: an upload was authorised but the file has not arrived. Only uploaded documents are usable.
    upload_status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending")
    scan_status: Mapped[str] = mapped_column(String(15), default="not_scanned", server_default="not_scanned")
    review_status: Mapped[str] = mapped_column(String(15), default="not_required", server_default="not_required")
    review_note: Mapped[str | None] = mapped_column(String(500))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_on: Mapped[date | None] = mapped_column(Date)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_documents_org_created", "organization_id", "created_at", "id"),
        Index("ix_documents_org_expires", "organization_id", "expires_on"),
        Index("ix_documents_org_review", "organization_id", "review_status"),
        CheckConstraint("type IN " + str(DOCUMENT_TYPES), name="type_valid"),
        CheckConstraint("upload_status IN ('pending','uploaded')", name="upload_valid"),
        CheckConstraint("scan_status IN ('not_scanned','passed','failed')", name="scan_valid"),
        CheckConstraint("review_status IN ('not_required','pending','approved','rejected')", name="review_valid"),
    )


class DocumentLink(Base, IdMixin, TenantScoped):
    """Attaches a document to a record. One document can serve several records."""
    __tablename__ = "document_links"
    document_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "document_id"], ["documents.organization_id", "documents.id"],
                             name="fk_document_links_document", ondelete="CASCADE"),
        UniqueConstraint("document_id", "entity_type", "entity_id"),
        Index("ix_document_links_org_entity", "organization_id", "entity_type", "entity_id"),
        CheckConstraint("entity_type IN " + str(ENTITY_TYPES), name="entity_valid"),
    )
