import uuid
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKeyConstraint, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class Customer(Base, IdMixin, TenantScoped, TimestampMixin):
    """A shipper or broker the company hauls for."""
    __tablename__ = "customers"
    name: Mapped[str] = mapped_column(String(160))
    code: Mapped[str | None] = mapped_column(String(30))
    legal_name: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    phone: Mapped[str | None] = mapped_column(String(40))
    billing_email: Mapped[str | None] = mapped_column(String(254))
    billing_address: Mapped[str | None] = mapped_column(String(300))
    billing_city: Mapped[str | None] = mapped_column(String(80))
    billing_state: Mapped[str | None] = mapped_column(String(40))
    billing_postal_code: Mapped[str | None] = mapped_column(String(20))
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "code"),
        Index("ix_customers_org_created", "organization_id", "created_at", "id"),
        Index("ix_customers_org_name", "organization_id", "name", "id"),
        CheckConstraint("status IN ('active','archived')", name="status_valid"),
        CheckConstraint("payment_terms_days BETWEEN 0 AND 365", name="terms_range"),
        CheckConstraint("credit_limit IS NULL OR credit_limit >= 0", name="credit_nonneg"),
    )


class CustomerContact(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "customer_contacts"
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str | None] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(40))
    # Operational and billing contacts are kept apart: they get different messages.
    kind: Mapped[str] = mapped_column(String(20), default="operations", server_default="operations")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_customer_contacts_customer", ondelete="CASCADE"),
        Index("ix_customer_contacts_org_customer", "organization_id", "customer_id"),
        CheckConstraint("kind IN ('operations','billing','other')", name="kind_valid"),
    )


class CustomerAddress(Base, IdMixin, TenantScoped, TimestampMixin):
    """A billing address or a facility the customer ships from or to. Facilities prefill load stops."""
    __tablename__ = "customer_addresses"
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="facility", server_default="facility")
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_phone: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(String(500))
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_customer_addresses_customer", ondelete="CASCADE"),
        Index("ix_customer_addresses_org_customer", "organization_id", "customer_id"),
        CheckConstraint("kind IN ('billing','facility')", name="kind_valid"),
    )
