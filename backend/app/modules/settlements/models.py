import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

SETTLEMENT_STATUSES = ("draft", "approved", "paid", "void")
LINE_KINDS = ("load_pay", "accessorial", "reimbursement", "deduction", "adjustment")
PAY_METHODS = ("ach", "check", "direct_deposit", "cash", "other")


class DriverSettlement(Base, IdMixin, TenantScoped, TimestampMixin):
    """What a driver is paid for a period: earnings from delivered loads, driver-payable charges,
    reimbursements and deductions. draft -> approved -> paid, or void. Approved means fixed."""
    __tablename__ = "driver_settlements"
    # Assigned when the settlement is approved, so discarded drafts leave no gaps.
    number: Mapped[str | None] = mapped_column(String(30))
    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="draft", server_default="draft")
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    earnings: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    reimbursements: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    deductions: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    notes: Mapped[str | None] = mapped_column(Text)
    calculated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_on: Mapped[date | None] = mapped_column(Date)
    paid_method: Mapped[str | None] = mapped_column(String(20))
    paid_reference: Mapped[str | None] = mapped_column(String(80))
    paid_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    void_reason: Mapped[str | None] = mapped_column(String(300))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "number"),
        ForeignKeyConstraint(["organization_id", "driver_id"], ["drivers.organization_id", "drivers.id"],
                             name="fk_driver_settlements_driver"),
        Index("ix_driver_settlements_org_created", "organization_id", "created_at", "id"),
        Index("ix_driver_settlements_org_driver", "organization_id", "driver_id", "status"),
        # One draft per driver at a time, so two people can't build competing drafts from the same loads.
        Index("uq_driver_settlements_one_draft", "organization_id", "driver_id", unique=True,
              postgresql_where=text("status = 'draft'")),
        CheckConstraint("status IN " + str(SETTLEMENT_STATUSES), name="status_valid"),
        CheckConstraint("period_end >= period_start", name="period_valid"),
        CheckConstraint("status = 'draft' OR number IS NOT NULL", name="number_when_approved"),
        CheckConstraint("paid_method IS NULL OR paid_method IN " + str(PAY_METHODS), name="paid_method_valid"),
    )


class SettlementLine(Base, IdMixin, TenantScoped):
    """One line of a settlement. Lines worked out from loads and expenses are rebuilt whenever the draft is
    recalculated; lines entered by hand (`manual`) are kept. Amounts are signed: deductions are negative."""
    __tablename__ = "settlement_lines"
    settlement_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(15))
    load_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"), server_default="1")
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    manual: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "settlement_id"],
                             ["driver_settlements.organization_id", "driver_settlements.id"],
                             name="fk_settlement_lines_settlement", ondelete="CASCADE"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_settlement_lines_load"),
        Index("ix_settlement_lines_org_settlement", "organization_id", "settlement_id"),
        Index("ix_settlement_lines_org_load", "organization_id", "load_id"),
        CheckConstraint("kind IN " + str(LINE_KINDS), name="kind_valid"),
        CheckConstraint("quantity > 0", name="quantity_pos"),
    )
