import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
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

from app.core.db import Base, IdMixin, TimestampMixin


class Invoice(Base, IdMixin, TimestampMixin):
    __tablename__ = "invoices"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    invoice_number: Mapped[str] = mapped_column(String(30))
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(10), default="sent", server_default="sent")
    issued_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "invoice_number"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"], name="fk_invoices_load"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_invoices_customer"),
        CheckConstraint("status IN ('sent','paid','void')", name="status_valid"),
        CheckConstraint("total >= 0", name="total_nonneg"),
        # One live invoice per load.
        Index("uq_invoice_one_live_per_load", "load_id", unique=True, postgresql_where=text("status <> 'void'")),
    )


class InvoiceLine(Base, IdMixin):
    __tablename__ = "invoice_lines"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_invoice_lines_invoice", ondelete="CASCADE"),
    )


class Payment(Base, IdMixin):
    __tablename__ = "payments"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    paid_on: Mapped[date] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(String(30))
    reference: Mapped[str | None] = mapped_column(String(80))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_payments_invoice"),
        CheckConstraint("amount > 0", name="amount_pos"),
    )
