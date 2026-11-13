import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

ROLES = "('owner','admin','dispatcher','safety_manager','fleet_manager','accountant','viewer','driver','customer')"


class User(Base, IdMixin, TimestampMixin):
    """A person's sign-in. Access to a company is granted only through a membership."""
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Embedded in access tokens; bumping it (e.g. on password change) invalidates every token already issued.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The company this person last worked in, so signing in returns them there.
    last_organization_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)


class Account(Base, IdMixin, TimestampMixin):
    """The owner's profile. It holds up to `max_companies` active companies (decision 0001)."""
    __tablename__ = "accounts"
    name: Mapped[str] = mapped_column(String(160))
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    max_companies: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    __table_args__ = (CheckConstraint("max_companies BETWEEN 1 AND 100", name="max_companies_range"),)


class Organization(Base, IdMixin, TimestampMixin):
    """A company: one legal entity with its own books. The unit of tenant isolation."""
    __tablename__ = "organizations"
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    legal_name: Mapped[str | None] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dot_number: Mapped[str | None] = mapped_column(String(20))
    mc_number: Mapped[str | None] = mapped_column(String(20))
    # Printed on invoices.
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(254))
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    # IANA zone. "Today" for invoices, due dates and expiry checks is this company's local date.
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    base_currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    default_payment_terms_days: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    load_number_prefix: Mapped[str] = mapped_column(String(10), default="L", server_default="L")
    invoice_number_prefix: Mapped[str] = mapped_column(String(10), default="INV", server_default="INV")
    # Per-company counters, incremented under a row lock.
    load_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    invoice_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    settlement_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    work_order_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (
        CheckConstraint("status IN ('active','archived')", name="status_valid"),
        CheckConstraint("base_currency ~ '^[A-Z]{3}$'", name="currency_code"),
    )


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


class Terminal(Base, IdMixin, TenantScoped, TimestampMixin):
    """A yard or office inside a company. A scope for filtering, not a tenant."""
    __tablename__ = "terminals"
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    phone: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "name"),
        CheckConstraint("status IN ('active','archived')", name="status_valid"),
    )


class UserPreference(Base, IdMixin, TenantScoped, TimestampMixin):
    """Per-user, per-company settings owned by the backend (table columns, selected terminal, ...)."""
    __tablename__ = "user_preferences"
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    key: Mapped[str] = mapped_column(String(80))
    value: Mapped[Any] = mapped_column(JSONB)
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", "key"),
        ForeignKeyConstraint(["organization_id", "user_id"],
                             ["organization_memberships.organization_id", "organization_memberships.user_id"],
                             name="fk_user_preferences_member", ondelete="CASCADE"),
    )


class SavedView(Base, IdMixin, TenantScoped, TimestampMixin):
    """A named set of filters for a list. Personal by default; shared ones are visible to the whole company."""
    __tablename__ = "saved_views"
    owner_user_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    resource: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "owner_user_id"],
                             ["organization_memberships.organization_id", "organization_memberships.user_id"],
                             name="fk_saved_views_owner", ondelete="CASCADE"),
        Index("ix_saved_views_org_resource", "organization_id", "resource"),
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
    # The wall clock, not the transaction's start: entries written in one request keep their order.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.clock_timestamp())
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
