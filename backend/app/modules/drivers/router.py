import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.core.crud import ListParams, child_router, ensure_exists, resource_router
from app.core.crypto import mask
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid
from app.modules.dispatch.eligibility import OtherLoad, current_loads, qualifications_by_driver
from app.modules.drivers.models import Driver, DriverQualification
from app.modules.organizations.models import Membership, Terminal
from app.modules.safety.rules import Compliance, driver_issues, summarize

DriverType = Literal["company", "owner_operator", "contractor"]
DriverStatus = Literal["active", "inactive", "terminated"]
PayType = Literal["per_mile", "percent", "flat"]
QualificationType = Literal["mvr", "drug_test", "road_test", "employment_application", "annual_review", "hazmat",
                            "twic", "training", "other"]


# ---------------------------------------------------------------- schemas
class DriverCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    employee_number: str | None = Field(default=None, max_length=30)
    driver_type: DriverType = "company"
    hire_date: date | None = None
    terminal_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = Field(default=None, description="The team member (role: driver) this driver is")
    cdl_number: str | None = Field(default=None, max_length=40)
    cdl_state: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    cdl_class: Literal["A", "B", "C"] | None = None
    cdl_expiry: date | None = None
    medical_cert_expiry: date | None = None
    pay_type: PayType = "per_mile"
    pay_rate: Decimal = Field(default=Decimal("0"), ge=0, max_digits=10, decimal_places=4)
    status: DriverStatus = "active"
    notes: str | None = Field(default=None, max_length=4000)


class DriverUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    employee_number: str | None = Field(default=None, max_length=30)
    driver_type: DriverType | None = None
    hire_date: date | None = None
    terminal_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    cdl_number: str | None = Field(default=None, max_length=40)
    cdl_state: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    cdl_class: Literal["A", "B", "C"] | None = None
    cdl_expiry: date | None = None
    medical_cert_expiry: date | None = None
    pay_type: PayType | None = None
    pay_rate: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=4)
    status: DriverStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)


class DriverRead(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    full_name: str
    phone: str | None
    email: str | None
    employee_number: str | None
    driver_type: str
    hire_date: date | None
    terminal_id: uuid.UUID | None
    user_id: uuid.UUID | None
    # Always safe to show: the last four characters. The full number is sent only to roles allowed to see it.
    cdl_number_masked: str | None
    cdl_number: str | None
    cdl_state: str | None
    cdl_class: str | None
    cdl_expiry: date | None
    medical_cert_expiry: date | None
    # Null for roles that may not see pay settings.
    pay_type: str | None
    pay_rate: Decimal | None
    status: str
    notes: str | None
    compliance: Compliance
    current_load: OtherLoad | None
    created_at: datetime


class DriverListParams(ListParams):
    status: DriverStatus | None = None
    driver_type: DriverType | None = None
    terminal_id: uuid.UUID | None = None


class QualificationCreate(BaseModel):
    type: QualificationType
    issued_on: date | None = None
    expires_on: date | None = None
    required: bool = Field(default=False, description="When set, an expired item blocks dispatch")
    reference: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=500)


class QualificationUpdate(BaseModel):
    type: QualificationType | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    required: bool | None = None
    reference: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=500)


class QualificationRead(QualificationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    driver_id: uuid.UUID


# ---------------------------------------------------------------- behaviour
def present(db: Session, drivers: list[Driver], p: Principal) -> list[DriverRead]:
    """Shape drivers for the caller: mask what their role may not see, attach compliance and current work."""
    sensitive = p.can("drivers.sensitive.read")
    ids = [d.id for d in drivers]
    quals = qualifications_by_driver(db, ids)
    on_load = current_loads(db, "driver", ids)
    today = p.today()
    return [DriverRead(
        id=d.id, first_name=d.first_name, last_name=d.last_name, full_name=f"{d.first_name} {d.last_name}",
        phone=d.phone, email=d.email, employee_number=d.employee_number, driver_type=d.driver_type,
        hire_date=d.hire_date, terminal_id=d.terminal_id, user_id=d.user_id,
        cdl_number_masked=mask(d.cdl_number), cdl_number=d.cdl_number if sensitive else None,
        cdl_state=d.cdl_state, cdl_class=d.cdl_class, cdl_expiry=d.cdl_expiry,
        medical_cert_expiry=d.medical_cert_expiry, pay_type=d.pay_type if sensitive else None,
        pay_rate=d.pay_rate if sensitive else None, status=d.status, notes=d.notes,
        compliance=summarize(driver_issues(d, quals.get(d.id, []), today)), current_load=on_load.get(d.id),
        created_at=d.created_at) for d in drivers]


def _before_save(db: Session, p: Principal, data: dict, driver: Driver | None) -> None:
    for required in ("first_name", "last_name", "driver_type", "pay_type", "pay_rate", "status"):
        if required in data and data[required] is None:
            raise Invalid("This field can't be empty", field=required)
    if data.get("cdl_state"):
        data["cdl_state"] = data["cdl_state"].upper()
    ensure_exists(db, Terminal, data.get("terminal_id"), "terminal_id", "Terminal")
    if data.get("user_id"):
        member = db.scalar(select(Membership).where(Membership.user_id == data["user_id"]))
        if member is None:
            raise Invalid("That person is not on this company's team", field="user_id")
        if member.role != "driver":
            raise Invalid("Only a team member with the driver role can be linked to a driver", field="user_id")
        taken = db.scalar(select(Driver.id).where(Driver.user_id == data["user_id"]))
        if taken and (driver is None or taken != driver.id):
            raise Invalid("That sign-in is already linked to another driver", field="user_id")
    if driver is not None and data.get("status") in ("inactive", "terminated") and driver.status == "active":
        busy = current_loads(db, "driver", [driver.id]).get(driver.id)
        if busy:
            raise Conflict(f"{driver.first_name} {driver.last_name} is on load {busy.load_number}. Reassign that "
                           "load first.", details={"load_id": str(busy.id), "load_number": busy.load_number})


def _before_delete(db: Session, p: Principal, driver: Driver) -> None:
    busy = current_loads(db, "driver", [driver.id]).get(driver.id)
    if busy:
        raise Conflict(f"This driver is on load {busy.load_number}", details={"load_id": str(busy.id)})


def _check_dates(db: Session, p: Principal, data: dict, q: DriverQualification | None) -> None:
    issued = data.get("issued_on", q.issued_on if q is not None else None)
    expires = data.get("expires_on", q.expires_on if q is not None else None)
    if issued and expires and expires < issued:
        raise Invalid("The expiry date can't be before the issue date", field="expires_on")
    for required in ("type", "required"):
        if required in data and data[required] is None:
            raise Invalid("This field can't be empty", field=required)


router = APIRouter()
router.include_router(resource_router(
    prefix="/drivers", tag="drivers", entity="driver", label="driver", model=Driver,
    create_schema=DriverCreate, update_schema=DriverUpdate, read_schema=DriverRead,
    read_perm="drivers.read", write_perm="drivers.manage", list_params=DriverListParams,
    search=("first_name", "last_name", "employee_number", "phone", "email"),
    sort={"name": Driver.last_name, "created_at": Driver.created_at,
          "hire_date": func.coalesce(Driver.hire_date, literal(date(9999, 1, 1))),
          "cdl_expiry": func.coalesce(Driver.cdl_expiry, literal(date(9999, 1, 1))),
          "medical_cert_expiry": func.coalesce(Driver.medical_cert_expiry, literal(date(9999, 1, 1)))},
    default_sort="name", present=present, audit_redact=("cdl_number", "pay_rate"),
    before_save=_before_save, before_delete=_before_delete))
router.include_router(child_router(
    prefix="/drivers/{parent_id}/qualifications", tag="drivers", entity="driver_qualification",
    label="qualification", model=DriverQualification, parent_model=Driver, parent_fk="driver_id",
    parent_label="Driver", create_schema=QualificationCreate, update_schema=QualificationUpdate,
    read_schema=QualificationRead, read_perm="drivers.read", write_perm="drivers.manage",
    order_by=DriverQualification.type, before_save=_check_dates))
