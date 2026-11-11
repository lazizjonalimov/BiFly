import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

EQUIPMENT = "('dry_van','reefer','flatbed','step_deck','box_truck','tanker','other')"


class Vehicle(Base, IdMixin, TimestampMixin):
    """Power unit (truck/tractor)."""
    __tablename__ = "vehicles"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    unit_number: Mapped[str] = mapped_column(String(40))
    vin: Mapped[str | None] = mapped_column(String(25))
    plate: Mapped[str | None] = mapped_column(String(20))
    make: Mapped[str | None] = mapped_column(String(60))
    model: Mapped[str | None] = mapped_column(String(60))
    year: Mapped[int | None] = mapped_column(Integer)
    insurance_expiry: Mapped[date | None] = mapped_column(Date)
    registration_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "unit_number"),
        CheckConstraint("status IN ('active','maintenance','inactive')", name="status_valid"),
    )


class Trailer(Base, IdMixin, TimestampMixin):
    __tablename__ = "trailers"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    unit_number: Mapped[str] = mapped_column(String(40))
    type: Mapped[str] = mapped_column(String(20), default="dry_van", server_default="dry_van")
    vin: Mapped[str | None] = mapped_column(String(25))
    plate: Mapped[str | None] = mapped_column(String(20))
    insurance_expiry: Mapped[date | None] = mapped_column(Date)
    registration_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "unit_number"),
        CheckConstraint(f"type IN {EQUIPMENT}", name="type_valid"),
        CheckConstraint("status IN ('active','maintenance','inactive')", name="status_valid"),
    )
