import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKeyConstraint, Index, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class Invoice(Base, IdMixin, TenantScoped, TimestampMixin):
    """draft -> issued -> paid, or void. Once issued the content is fixed: corrections are a void and a new
    invoice, never an edit. "Partially paid" and "overdue" are worked out from payments and the due date."""
    __tablename__ = "invoices"
    # Assigned when the invoice is issued, so discarded drafts leave no gaps in the numbering.
    invoice_number: Mapped[str | None] = mapped_column(String(30))
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(10), default="draft", server_default="draft")
    issue_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    # The customer's billing identity as it was when the invoice was issued.
    bill_to: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    issued_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    void_reason: Mapped[str | None] = mapped_column(String(300))
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "invoice_number"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_invoices_customer"),
        Index("ix_invoices_org_created", "organization_id", "created_at", "id"),
        Index("ix_invoices_org_status_due", "organization_id", "status", "due_date"),
        Index("ix_invoices_org_customer", "organization_id", "customer_id"),
        CheckConstraint("status IN ('draft','issued','paid','void')", name="status_valid"),
        CheckConstraint("total >= 0", name="total_nonneg"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint("status = 'draft' OR invoice_number IS NOT NULL", name="number_when_issued"),
    )


class InvoiceLine(Base, IdMixin, TenantScoped):
    __tablename__ = "invoice_lines"
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    load_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(15), default="line_haul", server_default="line_haul")
    description: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"), server_default="1")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_invoice_lines_invoice", ondelete="CASCADE"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_invoice_lines_load"),
        Index("ix_invoice_lines_org_invoice", "organization_id", "invoice_id"),
        Index("ix_invoice_lines_org_load", "organization_id", "load_id"),
        CheckConstraint("kind IN ('line_haul','accessorial','adjustment')", name="kind_valid"),
    )


class Payment(Base, IdMixin, TenantScoped):
    """Money received from a customer. Applied to invoices through allocations; never edited, only reversed."""
    __tablename__ = "payments"
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    received_on: Mapped[date] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(String(30))
    reference: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(10), default="recorded", server_default="recorded")
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reversal_reason: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_payments_customer"),
        Index("ix_payments_org_created", "organization_id", "created_at", "id"),
        Index("ix_payments_org_customer", "organization_id", "customer_id"),
        CheckConstraint("amount > 0", name="amount_pos"),
        CheckConstraint("status IN ('recorded','reversed')", name="status_valid"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
    )


class PaymentAllocation(Base, IdMixin, TenantScoped):
    """How much of a payment went to which invoice. Insert-only."""
    __tablename__ = "payment_allocations"
    payment_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "payment_id"], ["payments.organization_id", "payments.id"],
                             name="fk_payment_allocations_payment"),
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_payment_allocations_invoice"),
        Index("ix_payment_allocations_org_invoice", "organization_id", "invoice_id"),
        Index("ix_payment_allocations_org_payment", "organization_id", "payment_id"),
        CheckConstraint("amount > 0", name="amount_pos"),
    )
