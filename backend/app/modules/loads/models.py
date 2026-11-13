import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from app.modules.equipment.models import EQUIPMENT_SQL

# Operational lifecycle (decision 0002). Billing is tracked separately in `billing_status`.
STATUSES = ("draft", "planned", "assigned", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered",
            "pod_review", "completed", "on_hold", "cancelled")
BILLING = ("unbilled", "invoiced", "paid")
CHARGE_TYPES = ("detention", "layover", "lumper", "fuel_surcharge", "tarp", "extra_stop", "tonu", "other")


class Load(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "loads"
    load_number: Mapped[str] = mapped_column(String(30))
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(20), default="planned", server_default="planned")
    # Where an on-hold load returns to when released.
    held_from_status: Mapped[str | None] = mapped_column(String(20))
    billing_status: Mapped[str] = mapped_column(String(20), default="unbilled", server_default="unbilled")
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    # Incremented on every change. Clients send back the version they saw; a stale one is a conflict.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    reference: Mapped[str | None] = mapped_column(String(80))
    bol_number: Mapped[str | None] = mapped_column(String(80))
    commodity: Mapped[str | None] = mapped_column(String(200))
    equipment_type: Mapped[str] = mapped_column(String(20), default="dry_van", server_default="dry_van")
    weight_lbs: Mapped[int | None] = mapped_column(Integer)
    miles: Mapped[int | None] = mapped_column(Integer)
    instructions: Mapped[str | None] = mapped_column(Text)

    customer_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    # Sum of billable charges, kept in step with load_charges so revenue is cheap to show and sort.
    charges_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")

    # Copied from the first and last stop whenever stops change, so the board can filter and sort on them.
    origin_city: Mapped[str | None] = mapped_column(String(80))
    origin_state: Mapped[str | None] = mapped_column(String(40))
    destination_city: Mapped[str | None] = mapped_column(String(80))
    destination_state: Mapped[str | None] = mapped_column(String(40))
    pickup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "load_number"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_loads_customer"),
        ForeignKeyConstraint(["organization_id", "terminal_id"], ["terminals.organization_id", "terminals.id"],
                             name="fk_loads_terminal"),
        # use_alter: loads and invoices refer to each other (invoice lines point back at loads).
        ForeignKeyConstraint(["organization_id", "invoice_id"], ["invoices.organization_id", "invoices.id"],
                             name="fk_loads_invoice", use_alter=True),
        Index("ix_loads_org_created", "organization_id", "created_at", "id"),
        Index("ix_loads_org_status", "organization_id", "status", "created_at"),
        Index("ix_loads_org_customer", "organization_id", "customer_id", "created_at"),
        Index("ix_loads_org_pickup", "organization_id", "pickup_at"),
        Index("ix_loads_org_delivery", "organization_id", "delivery_at"),
        Index("ix_loads_org_billing", "organization_id", "billing_status", "status"),
        CheckConstraint("status IN " + str(STATUSES), name="status_valid"),
        CheckConstraint("billing_status IN " + str(BILLING), name="billing_valid"),
        CheckConstraint("equipment_type IN " + EQUIPMENT_SQL, name="equipment_valid"),
        CheckConstraint("customer_rate >= 0", name="rate_nonneg"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint("miles IS NULL OR miles >= 0", name="miles_nonneg"),
    )


class LoadStop(Base, IdMixin, TenantScoped):
    __tablename__ = "load_stops"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(10))
    name: Mapped[str | None] = mapped_column(String(160))
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_phone: Mapped[str | None] = mapped_column(String(40))
    reference: Mapped[str | None] = mapped_column(String(80))
    instructions: Mapped[str | None] = mapped_column(String(1000))
    appt_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    appt_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    departed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("load_id", "seq"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_stops_load", ondelete="CASCADE"),
        CheckConstraint("type IN ('pickup','delivery')", name="type_valid"),
        CheckConstraint("appt_end IS NULL OR appt_start IS NULL OR appt_end >= appt_start", name="appt_order"),
    )


class LoadItem(Base, IdMixin, TenantScoped, TimestampMixin):
    """What is on the truck: a line of freight."""
    __tablename__ = "load_items"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[int | None] = mapped_column(Integer)
    unit: Mapped[str | None] = mapped_column(String(30))
    weight_lbs: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_items_load", ondelete="CASCADE"),
        Index("ix_load_items_org_load", "organization_id", "load_id"),
    )


class LoadCharge(Base, IdMixin, TenantScoped, TimestampMixin):
    """An accessorial: detention, lumper, fuel surcharge and the like."""
    __tablename__ = "load_charges"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(String(200))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"), server_default="1")
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    billable: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    driver_payable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_charges_load", ondelete="CASCADE"),
        Index("ix_load_charges_org_load", "organization_id", "load_id"),
        CheckConstraint("type IN " + str(CHARGE_TYPES), name="type_valid"),
        CheckConstraint("quantity > 0", name="quantity_pos"),
    )


class LoadNote(Base, IdMixin, TenantScoped):
    __tablename__ = "load_notes"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    body: Mapped[str] = mapped_column(Text)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_notes_load", ondelete="CASCADE"),
        Index("ix_load_notes_org_load", "organization_id", "load_id"),
    )


class LoadStatusEvent(Base, IdMixin, TenantScoped):
    """Append-only history of load status changes (no UPDATE/DELETE grant)."""
    __tablename__ = "load_status_events"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    # The load's version once this change was applied. It orders the history exactly, even when two changes
    # are saved in the same instant.
    load_version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(30))
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_status_events_load", ondelete="CASCADE"),
        Index("ix_load_status_events_load", "organization_id", "load_id"),
        UniqueConstraint("load_id", "load_version"),
    )


class TrackingEvent(Base, IdMixin, TenantScoped):
    """A position or check-call report on a load. Append-only."""
    __tablename__ = "tracking_events"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(20), default="check_call", server_default="check_call")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(20), default="dispatcher", server_default="dispatcher")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_tracking_events_load", ondelete="CASCADE"),
        Index("ix_tracking_events_org_load", "organization_id", "load_id", "occurred_at"),
        CheckConstraint("kind IN ('check_call','exception')", name="kind_valid"),
        CheckConstraint("source IN ('dispatcher','driver','integration')", name="source_valid"),
    )
