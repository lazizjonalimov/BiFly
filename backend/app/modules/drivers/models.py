import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class Driver(Base, IdMixin, TimestampMixin):
    __tablename__ = "drivers"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    # Optional link to a login (role=driver) so the mobile app can find "my" assignments.
    user_id: Mapped[uuid.UUID | None] = mapped_column()
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(254))
    cdl_number: Mapped[str | None] = mapped_column(String(40))
    cdl_state: Mapped[str | None] = mapped_column(String(2))
    cdl_expiry: Mapped[date | None] = mapped_column(Date)
    medical_cert_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "user_id"),
        # user must be a member of the same organization
        ForeignKeyConstraint(["organization_id", "user_id"],
                             ["organization_memberships.organization_id", "organization_memberships.user_id"],
                             name="fk_drivers_membership"),
        CheckConstraint("status IN ('active','inactive')", name="status_valid"),
    )
