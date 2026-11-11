import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class Invoice(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "invoices"
    invoice_number: Mapped[str] = mapped_column(String(30))
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(10), default="sent", server_default="sent")
    issued_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "invoice_number"),
        Index("ix_invoices_org_created", "organization_id", "created_at", "id"),
        Index("ix_invoices_org_status_due", "organization_id", "status", "due_date"),
        Index("ix_invoices_org_customer", "organization_id", "customer_id"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"], name="fk_invoices_load"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_invoices_customer"),
        CheckConstraint("status IN ('sent','paid','void')", name="status_valid"),
        CheckConstraint("total >= 0", name="total_nonneg"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        # One live invoice per load.
        Index("uq_invoice_one_live_per_load", "load_id", unique=True, postgresql_where=text("status <> 'void'")),
    )


class InvoiceLine(Base, IdMixin, TenantScoped):
    __tablename__ = "invoice_lines"
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_invoice_lines_invoice", ondelete="CASCADE"),
        Index("ix_invoice_lines_org_invoice", "organization_id", "invoice_id"),
    )


class Payment(Base, IdMixin, TenantScoped):
    __tablename__ = "payments"
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    paid_on: Mapped[date] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(String(30))
    reference: Mapped[str | None] = mapped_column(String(80))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_payments_invoice"),
        Index("ix_payments_org_invoice", "organization_id", "invoice_id"),
        CheckConstraint("amount > 0", name="amount_pos"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
    )
