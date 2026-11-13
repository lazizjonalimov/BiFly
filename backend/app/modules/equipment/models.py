import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

EQUIPMENT_TYPES = ("dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other")
EQUIPMENT_SQL = str(EQUIPMENT_TYPES)
# Stored status. "Assigned" and "available" are worked out from current assignments, never stored.
STATUSES = ("active", "in_maintenance", "out_of_service", "retired")
OWNERSHIP = ("owned", "leased", "owner_operator")


class Vehicle(Base, IdMixin, TenantScoped, TimestampMixin):
    """Power unit (truck or tractor)."""
    __tablename__ = "vehicles"
    unit_number: Mapped[str] = mapped_column(String(40))
    vin: Mapped[str | None] = mapped_column(String(25))
    plate: Mapped[str | None] = mapped_column(String(20))
    plate_state: Mapped[str | None] = mapped_column(String(2))
    make: Mapped[str | None] = mapped_column(String(60))
    model: Mapped[str | None] = mapped_column(String(60))
    year: Mapped[int | None] = mapped_column(Integer)
    ownership: Mapped[str] = mapped_column(String(20), default="owned", server_default="owned")
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    odometer: Mapped[int | None] = mapped_column(Integer)
    insurance_expiry: Mapped[date | None] = mapped_column(Date)
    registration_expiry: Mapped[date | None] = mapped_column(Date)
    inspection_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    notes: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "unit_number"),
        ForeignKeyConstraint(["organization_id", "terminal_id"], ["terminals.organization_id", "terminals.id"],
                             name="fk_vehicles_terminal"),
        Index("ix_vehicles_org_created", "organization_id", "created_at", "id"),
        CheckConstraint("status IN " + str(STATUSES), name="status_valid"),
        CheckConstraint("ownership IN " + str(OWNERSHIP), name="ownership_valid"),
        CheckConstraint("odometer IS NULL OR odometer >= 0", name="odometer_nonneg"),
    )


class Trailer(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "trailers"
    unit_number: Mapped[str] = mapped_column(String(40))
    type: Mapped[str] = mapped_column(String(20), default="dry_van", server_default="dry_van")
    vin: Mapped[str | None] = mapped_column(String(25))
    plate: Mapped[str | None] = mapped_column(String(20))
    plate_state: Mapped[str | None] = mapped_column(String(2))
    make: Mapped[str | None] = mapped_column(String(60))
    year: Mapped[int | None] = mapped_column(Integer)
    length_ft: Mapped[int | None] = mapped_column(Integer)
    ownership: Mapped[str] = mapped_column(String(20), default="owned", server_default="owned")
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    insurance_expiry: Mapped[date | None] = mapped_column(Date)
    registration_expiry: Mapped[date | None] = mapped_column(Date)
    inspection_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    notes: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "unit_number"),
        ForeignKeyConstraint(["organization_id", "terminal_id"], ["terminals.organization_id", "terminals.id"],
                             name="fk_trailers_terminal"),
        Index("ix_trailers_org_created", "organization_id", "created_at", "id"),
        CheckConstraint("type IN " + EQUIPMENT_SQL, name="type_valid"),
        CheckConstraint("status IN " + str(STATUSES), name="status_valid"),
        CheckConstraint("ownership IN " + str(OWNERSHIP), name="ownership_valid"),
    )
