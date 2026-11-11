import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

ROLES = "('owner','admin','dispatcher','safety_manager','fleet_manager','accountant','driver','customer')"


class Organization(Base, IdMixin, TimestampMixin):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    dot_number: Mapped[str | None] = mapped_column(String(20))
    mc_number: Mapped[str | None] = mapped_column(String(20))
    default_payment_terms_days: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    # IANA zone. "Today" for invoices, due dates and expiry checks is this company's local date.
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    # Per-tenant gapless-ish counters, incremented with a row lock.
    load_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    invoice_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class User(Base, IdMixin, TimestampMixin):
    """Global identity. Tenant access is granted only through memberships."""
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Embedded in access tokens; bumping it (e.g. on password change) invalidates every token already issued.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)


class Membership(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "organization_memberships"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id"),
        UniqueConstraint("organization_id", "id"),
        CheckConstraint(f"role IN {ROLES}", name="role_valid"),
    )


class AuditLog(Base, IdMixin, TenantScoped):
    """Append-only (UPDATE/DELETE are not granted to the app role)."""
    __tablename__ = "audit_logs"
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_audit_logs_org_created", "organization_id", "created_at", "id"),
        Index("ix_audit_logs_org_entity", "organization_id", "entity_type", "entity_id"),
    )


class IdempotencyKey(Base, TenantScoped):
    __tablename__ = "idempotency_keys"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(200))
    request_hash: Mapped[str] = mapped_column(String(64))
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Indexed so a retention job can purge old keys cheaply.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


