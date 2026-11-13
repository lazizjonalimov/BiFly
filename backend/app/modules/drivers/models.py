import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKeyConstraint, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.crypto import EncryptedText
from app.core.db import Base, IdMixin, TenantScoped, TimestampMixin

QUALIFICATION_TYPES = ("mvr", "drug_test", "road_test", "employment_application", "annual_review", "hazmat",
                       "twic", "training", "other")


class Driver(Base, IdMixin, TenantScoped, TimestampMixin):
    __tablename__ = "drivers"
    # Optional link to a sign-in (role=driver) so the driver app can find "my" assignments.
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(254))
    employee_number: Mapped[str | None] = mapped_column(String(30))
    driver_type: Mapped[str] = mapped_column(String(20), default="company", server_default="company")
    hire_date: Mapped[date | None] = mapped_column(Date)
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    # Sensitive personal identifier: encrypted before it reaches the database (see app/core/crypto.py).
    cdl_number: Mapped[str | None] = mapped_column("cdl_number_encrypted", EncryptedText())
    cdl_state: Mapped[str | None] = mapped_column(String(2))
    cdl_class: Mapped[str | None] = mapped_column(String(1))
    cdl_expiry: Mapped[date | None] = mapped_column(Date)
    medical_cert_expiry: Mapped[date | None] = mapped_column(Date)
    # How the driver is paid; used to draft settlements.
    pay_type: Mapped[str] = mapped_column(String(20), default="per_mile", server_default="per_mile")
    pay_rate: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"), server_default="0")
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    notes: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "user_id"),
        ForeignKeyConstraint(["organization_id", "user_id"],
                             ["organization_memberships.organization_id", "organization_memberships.user_id"],
                             name="fk_drivers_membership"),
        ForeignKeyConstraint(["organization_id", "terminal_id"], ["terminals.organization_id", "terminals.id"],
                             name="fk_drivers_terminal"),
        Index("ix_drivers_org_created", "organization_id", "created_at", "id"),
        Index("ix_drivers_org_name", "organization_id", "last_name", "first_name", "id"),
        CheckConstraint("status IN ('active','inactive','terminated')", name="status_valid"),
        CheckConstraint("driver_type IN ('company','owner_operator','contractor')", name="type_valid"),
        CheckConstraint("pay_type IN ('per_mile','percent','flat')", name="pay_type_valid"),
        CheckConstraint("pay_rate >= 0", name="pay_rate_nonneg"),
        CheckConstraint("cdl_class IS NULL OR cdl_class IN ('A','B','C')", name="cdl_class_valid"),
    )


class DriverQualification(Base, IdMixin, TenantScoped, TimestampMixin):
    """An item in a driver's qualification file, beyond the licence and medical card kept on the driver."""
    __tablename__ = "driver_qualifications"
    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    type: Mapped[str] = mapped_column(String(30))
    issued_on: Mapped[date | None] = mapped_column(Date)
    expires_on: Mapped[date | None] = mapped_column(Date)
    # When set, an expired item blocks the driver from being assigned.
    required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    reference: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(String(500))
    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(["organization_id", "driver_id"], ["drivers.organization_id", "drivers.id"],
                             name="fk_driver_qualifications_driver", ondelete="CASCADE"),
        Index("ix_driver_qualifications_org_driver", "organization_id", "driver_id"),
        Index("ix_driver_qualifications_org_expires", "organization_id", "expires_on"),
        CheckConstraint("type IN " + str(QUALIFICATION_TYPES), name="type_valid"),
        CheckConstraint("expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on", name="date_order"),
    )
