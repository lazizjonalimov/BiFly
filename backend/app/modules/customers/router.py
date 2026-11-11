import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.crud import crud_router
from app.modules.customers.models import Customer


class CustomerBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    billing_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=300)
    payment_terms_days: int = Field(default=30, ge=0, le=365)
    status: Literal["active", "inactive"] = "active"
    notes: str | None = Field(default=None, max_length=4000)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    billing_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=300)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    status: Literal["active", "inactive"] | None = None
    notes: str | None = Field(default=None, max_length=4000)


class CustomerRead(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime


router = crud_router(prefix="/customers", tag="customers", entity="customer", model=Customer,
                     create_schema=CustomerCreate, update_schema=CustomerUpdate, read_schema=CustomerRead,
                     read_perm="customers:read", write_perm="customers:write",
                     search=("name", "billing_email"), filters=("status",))
