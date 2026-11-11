import uuid

from sqlalchemy import ForeignKeyConstraint, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class DispatchAssignment(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "dispatch_assignments"
    load_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    trailer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(15), default="active", server_default="active")
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
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
        # "Is this driver/truck/trailer busy?" lookups, and the FKs.
        Index("ix_assign_org_driver", "organization_id", "driver_id"),
        Index("ix_assign_org_vehicle", "organization_id", "vehicle_id"),
        Index("ix_assign_org_trailer", "organization_id", "trailer_id"),
        # A load has at most one active assignment — this is what makes a double "Assign" click safe.
        Index("uq_assignment_one_active_per_load", "load_id", unique=True, postgresql_where=text("status = 'active'")),
    )
