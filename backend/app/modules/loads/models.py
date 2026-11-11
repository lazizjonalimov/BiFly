import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
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
from app.modules.fleet.models import EQUIPMENT

LOAD_STATUSES = "('pending','assigned','dispatched','in_transit','delivered','completed','invoiced','paid','cancelled')"


class Load(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "loads"
    load_number: Mapped[str] = mapped_column(String(30))
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    reference: Mapped[str | None] = mapped_column(String(80))
    commodity: Mapped[str | None] = mapped_column(String(200))
    equipment_type: Mapped[str] = mapped_column(String(20), default="dry_van", server_default="dry_van")
    weight_lbs: Mapped[int | None] = mapped_column(Integer)
    customer_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "load_number"),
        # Keyset pagination, status filters/board, and the customer FK.
        Index("ix_loads_org_created", "organization_id", "created_at", "id"),
        Index("ix_loads_org_status", "organization_id", "status"),
        Index("ix_loads_org_customer", "organization_id", "customer_id"),
        ForeignKeyConstraint(["organization_id", "customer_id"], ["customers.organization_id", "customers.id"],
                             name="fk_loads_customer"),
        CheckConstraint(f"status IN {LOAD_STATUSES}", name="status_valid"),
        CheckConstraint(f"equipment_type IN {EQUIPMENT}", name="equipment_valid"),
        CheckConstraint("customer_rate >= 0", name="rate_nonneg"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
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


class LoadStatusEvent(Base, IdMixin, TenantScoped):
    """Append-only history of load status changes (no UPDATE/DELETE grant)."""
    __tablename__ = "load_status_events"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_load_status_events_load", ondelete="CASCADE"),
        Index("ix_load_status_events_load", "organization_id", "load_id"),
    )
