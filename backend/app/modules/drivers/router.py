import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.crud import crud_router
from app.core.crypto import mask
from app.core.deps import Principal
from app.core.permissions import has_permission
from app.modules.drivers.models import Driver


class DriverBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    cdl_number: str | None = Field(default=None, max_length=40)
    cdl_state: str | None = Field(default=None, min_length=2, max_length=2)
    cdl_expiry: date | None = None
    medical_cert_expiry: date | None = None
    status: Literal["active", "inactive"] = "active"
    user_id: uuid.UUID | None = Field(default=None, description="Login (role=driver) used by the mobile app")


class DriverCreate(DriverBase):
    pass


class DriverUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    cdl_number: str | None = Field(default=None, max_length=40)
    cdl_state: str | None = Field(default=None, min_length=2, max_length=2)
    cdl_expiry: date | None = None
    medical_cert_expiry: date | None = None
    status: Literal["active", "inactive"] | None = None
    user_id: uuid.UUID | None = None


class DriverRead(DriverBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime


def present(driver: Driver, p: Principal) -> DriverRead:
    """Only roles that manage driver qualification see the full licence number; everyone else gets the last 4."""
    out = DriverRead.model_validate(driver)
    if not has_permission(p.role, "drivers:write"):
        out = out.model_copy(update={"cdl_number": mask(out.cdl_number)})
    return out


router = crud_router(prefix="/drivers", tag="drivers", entity="driver", model=Driver,
                     create_schema=DriverCreate, update_schema=DriverUpdate, read_schema=DriverRead,
                     read_perm="drivers:read", write_perm="drivers:write",
                     search=("first_name", "last_name", "phone"), filters=("status",),
                     present=present, audit_redact=("cdl_number",))
