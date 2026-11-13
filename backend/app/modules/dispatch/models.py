import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class DispatchAssignment(Base, IdMixin, TenantScoped, TimestampMixin):
    """Who and what is hauling a load. Rows are never edited in place: a reassignment releases the old row
    and adds a new one, so the load keeps its assignment history."""
    __tablename__ = "dispatch_assignments"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(15), default="active", server_default="active")
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_reason: Mapped[str | None] = mapped_column(String(200))
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(["organization_id", "load_id"], ["loads.organization_id", "loads.id"],
                             name="fk_assign_load"),
        ForeignKeyConstraint(["organization_id", "driver_id"], ["drivers.organization_id", "drivers.id"],
                             name="fk_assign_driver"),
        ForeignKeyConstraint(["organization_id", "vehicle_id"], ["vehicles.organization_id", "vehicles.id"],
                             name="fk_assign_vehicle"),
        ForeignKeyConstraint(["organization_id", "trailer_id"], ["trailers.organization_id", "trailers.id"],
                             name="fk_assign_trailer"),
        Index("ix_assign_org_load", "organization_id", "load_id"),
        Index("ix_assign_org_driver", "organization_id", "driver_id", "status"),
        Index("ix_assign_org_vehicle", "organization_id", "vehicle_id", "status"),
        Index("ix_assign_org_trailer", "organization_id", "trailer_id", "status"),
        # A load has at most one active assignment: this is what makes a double "Assign" click safe.
        Index("uq_assignment_one_active_per_load", "load_id", unique=True, postgresql_where=text("status = 'active'")),
        CheckConstraint("status IN ('active','released','completed')", name="status_valid"),
    )
