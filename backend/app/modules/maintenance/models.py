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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

WORK_ORDER_STATUSES = ("open", "in_progress", "completed", "cancelled")
PRIORITIES = ("low", "normal", "high", "urgent")
LINE_KINDS = ("labor", "part", "other")
INSPECTION_KINDS = ("pre_trip", "post_trip", "annual", "roadside", "other")
INSPECTION_RESULTS = ("pass", "defects", "out_of_service")
DEFECT_SEVERITIES = ("minor", "major", "out_of_service")
ONE_UNIT = "(vehicle_id IS NULL) <> (trailer_id IS NULL)"


class WorkOrder(Base, IdMixin, TenantScoped, TimestampMixin):
    """Repair or service on one truck or trailer. While a work order that takes the unit out of service is
    open, the unit can't be dispatched; it goes back on the road only through a return-to-service check."""
    __tablename__ = "work_orders"
    number: Mapped[str] = mapped_column(String(30))
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(15), default="open", server_default="open")
    priority: Mapped[str] = mapped_column(String(10), default="normal", server_default="normal")
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    vendor: Mapped[str | None] = mapped_column(String(160))
    odometer: Mapped[int | None] = mapped_column(Integer)
    scheduled_for: Mapped[date | None] = mapped_column(Date)
    out_of_service: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(Text)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "number"),
        ForeignKeyConstraint(["organization_id", "vehicle_id"], ["vehicles.organization_id", "vehicles.id"],
                             name="fk_work_orders_vehicle"),
        ForeignKeyConstraint(["organization_id", "trailer_id"], ["trailers.organization_id", "trailers.id"],
                             name="fk_work_orders_trailer"),
        Index("ix_work_orders_org_created", "organization_id", "created_at", "id"),
        Index("ix_work_orders_org_status", "organization_id", "status"),
        Index("ix_work_orders_org_vehicle", "organization_id", "vehicle_id"),
        Index("ix_work_orders_org_trailer", "organization_id", "trailer_id"),
        CheckConstraint(ONE_UNIT, name="one_unit"),
        CheckConstraint("status IN " + str(WORK_ORDER_STATUSES), name="status_valid"),
        CheckConstraint("priority IN " + str(PRIORITIES), name="priority_valid"),
        CheckConstraint("total_cost >= 0", name="cost_nonneg"),
        CheckConstraint("odometer IS NULL OR odometer >= 0", name="odometer_nonneg"),
    )


class WorkOrderLine(Base, IdMixin, TenantScoped, TimestampMixin):
    """Labour, a part, or another cost on a work order."""
    __tablename__ = "work_order_lines"
    work_order_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(10), default="part", server_default="part")
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"), server_default="1")
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # Lines entered together keep the order they were entered in; later lines follow by creation time.
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "work_order_id"], ["work_orders.organization_id", "work_orders.id"],
                             name="fk_work_order_lines_work_order", ondelete="CASCADE"),
        Index("ix_work_order_lines_org_work_order", "organization_id", "work_order_id"),
        CheckConstraint("kind IN " + str(LINE_KINDS), name="kind_valid"),
        CheckConstraint("quantity > 0", name="quantity_pos"),
        CheckConstraint("unit_cost >= 0", name="unit_cost_nonneg"),
    )


class Inspection(Base, IdMixin, TenantScoped, TimestampMixin):
    """A recorded inspection of one truck or trailer: a driver's daily check, the annual inspection, a
    roadside inspection. Recorded once; corrections are made by recording another."""
    __tablename__ = "inspections"
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(15))
    inspected_on: Mapped[date] = mapped_column(Date)
    result: Mapped[str] = mapped_column(String(15))
    odometer: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str | None] = mapped_column(String(160))
    inspector: Mapped[str | None] = mapped_column(String(160))
    report_number: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(["organization_id", "vehicle_id"], ["vehicles.organization_id", "vehicles.id"],
                             name="fk_inspections_vehicle"),
        ForeignKeyConstraint(["organization_id", "trailer_id"], ["trailers.organization_id", "trailers.id"],
                             name="fk_inspections_trailer"),
        ForeignKeyConstraint(["organization_id", "driver_id"], ["drivers.organization_id", "drivers.id"],
                             name="fk_inspections_driver"),
        Index("ix_inspections_org_inspected", "organization_id", "inspected_on", "id"),
        Index("ix_inspections_org_vehicle", "organization_id", "vehicle_id"),
        Index("ix_inspections_org_trailer", "organization_id", "trailer_id"),
        CheckConstraint(ONE_UNIT, name="one_unit"),
        CheckConstraint("kind IN " + str(INSPECTION_KINDS), name="kind_valid"),
        CheckConstraint("result IN " + str(INSPECTION_RESULTS), name="result_valid"),
    )


class InspectionDefect(Base, IdMixin, TenantScoped):
    """Something an inspection found. It can be turned into a work order, which is then linked here."""
    __tablename__ = "inspection_defects"
    inspection_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    item: Mapped[str] = mapped_column(String(120))
    severity: Mapped[str] = mapped_column(String(15))
    description: Mapped[str | None] = mapped_column(String(500))
    work_order_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # the order they were listed in
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "inspection_id"], ["inspections.organization_id", "inspections.id"],
                             name="fk_inspection_defects_inspection", ondelete="CASCADE"),
        ForeignKeyConstraint(["organization_id", "work_order_id"], ["work_orders.organization_id", "work_orders.id"],
                             name="fk_inspection_defects_work_order"),
        Index("ix_inspection_defects_org_inspection", "organization_id", "inspection_id"),
        CheckConstraint("severity IN " + str(DEFECT_SEVERITIES), name="severity_valid"),
    )
