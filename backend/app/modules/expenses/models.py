import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKeyConstraint, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

CATEGORIES = ("fuel", "tolls", "lumper", "scales", "parking", "permits", "repairs", "tires", "insurance", "lodging",
              "meals", "advance", "other")
FUEL_TYPES = ("diesel", "def", "gasoline", "reefer")
PAID_WITH = ("company_card", "fuel_card", "cash", "check", "ach", "driver")
# What the expense means for the driver's pay: nothing, paid back to them, or taken from their pay.
DRIVER_TREATMENTS = ("none", "reimburse", "deduct")


class Expense(Base, IdMixin, TenantScoped, TimestampMixin):
    """A cost the company records: fuel, tolls, a lumper, a permit, a cash advance to a driver. Optionally
    tied to a load, a driver, a truck or a trailer. Fuel carries gallons and the state it was bought in, for
    fuel-tax reporting. A driver's reimbursements and deductions flow into their settlement, and once that is
    approved the expense is part of it and can't change."""
    __tablename__ = "expenses"
    category: Mapped[str] = mapped_column(String(15))
    incurred_on: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    vendor: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(String(300))
    paid_with: Mapped[str | None] = mapped_column(String(15))
    reference: Mapped[str | None] = mapped_column(String(80))
    load_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    driver_treatment: Mapped[str] = mapped_column(String(10), default="none", server_default="none")
    # Fuel only.
    gallons: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    fuel_type: Mapped[str | None] = mapped_column(String(10))
    jurisdiction: Mapped[str | None] = mapped_column(String(2))
    odometer: Mapped[int | None] = mapped_column(Integer)
    # The settlement that reimburses or deducts it, once one does.
    settlement_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"], name="fk_expenses_load"),
        ForeignKeyConstraint(["organization_id", "driver_id"], ["drivers.organization_id", "drivers.id"],
                             name="fk_expenses_driver"),
        ForeignKeyConstraint(["organization_id", "vehicle_id"], ["vehicles.organization_id", "vehicles.id"],
                             name="fk_expenses_vehicle"),
        ForeignKeyConstraint(["organization_id", "trailer_id"], ["trailers.organization_id", "trailers.id"],
                             name="fk_expenses_trailer"),
        ForeignKeyConstraint(["organization_id", "settlement_id"],
                             ["driver_settlements.organization_id", "driver_settlements.id"],
                             name="fk_expenses_settlement", ondelete="SET NULL"),
        Index("ix_expenses_org_incurred", "organization_id", "incurred_on", "id"),
        Index("ix_expenses_org_driver", "organization_id", "driver_id"),
        Index("ix_expenses_org_vehicle", "organization_id", "vehicle_id"),
        Index("ix_expenses_org_load", "organization_id", "load_id"),
        CheckConstraint("category IN " + str(CATEGORIES), name="category_valid"),
        CheckConstraint("amount > 0", name="amount_pos"),
        CheckConstraint("paid_with IS NULL OR paid_with IN " + str(PAID_WITH), name="paid_with_valid"),
        CheckConstraint("driver_treatment IN " + str(DRIVER_TREATMENTS), name="treatment_valid"),
        CheckConstraint("driver_treatment = 'none' OR driver_id IS NOT NULL", name="treatment_needs_driver"),
        CheckConstraint("fuel_type IS NULL OR fuel_type IN " + str(FUEL_TYPES), name="fuel_type_valid"),
        CheckConstraint("gallons IS NULL OR gallons > 0", name="gallons_pos"),
        CheckConstraint("odometer IS NULL OR odometer >= 0", name="odometer_nonneg"),
        CheckConstraint("category <> 'fuel' OR (gallons IS NOT NULL AND jurisdiction IS NOT NULL)", name="fuel_details"),
    )
