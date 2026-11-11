import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKeyConstraint, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedText
from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin


class Driver(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "drivers"
    # Optional link to a login (role=driver) so the mobile app can find "my" assignments.
    user_id: Mapped[uuid.UUID | None] = mapped_column()
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(254))
    # Sensitive personal identifier: encrypted before it reaches the database (see app/core/crypto.py).
    cdl_number: Mapped[str | None] = mapped_column("cdl_number_encrypted", EncryptedText())
    cdl_state: Mapped[str | None] = mapped_column(String(2))
    cdl_expiry: Mapped[date | None] = mapped_column(Date)
    medical_cert_expiry: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_drivers_org_created", "organization_id", "created_at", "id"),
        UniqueConstraint("organization_id", "user_id"),
        # user must be a member of the same organization
        ForeignKeyConstraint(["organization_id", "user_id"],
                             ["organization_memberships.organization_id", "organization_memberships.user_id"],
                             name="fk_drivers_membership"),
        CheckConstraint("status IN ('active','inactive')", name="status_valid"),
    )
