
from sqlalchemy import CheckConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class Customer(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "customers"
    name: Mapped[str] = mapped_column(String(160))
    billing_email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(300))
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    notes: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_customers_org_created", "organization_id", "created_at", "id"),
        CheckConstraint("status IN ('active','inactive')", name="status_valid"),
        CheckConstraint("payment_terms_days BETWEEN 0 AND 365", name="terms_range"),
    )
