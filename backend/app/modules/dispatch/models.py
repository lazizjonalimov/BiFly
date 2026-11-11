import uuid

from sqlalchemy import ForeignKey, ForeignKeyConstraint, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.db import Base, IdMixin, TimestampMixin


class DispatchAssignment(Base, IdMixin, TimestampMixin):
    __tablename__ = "dispatch_assignments"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
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
        # A load has at most one active assignment — this is what makes a double "Assign" click safe.
        Index("uq_assignment_one_active_per_load", "load_id", unique=True, postgresql_where=text("status = 'active'")),
    )
