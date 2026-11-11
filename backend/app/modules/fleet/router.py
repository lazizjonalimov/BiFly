import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.core.crud import crud_router
from app.modules.fleet.models import Trailer, Vehicle

Status = Literal["active", "maintenance", "inactive"]
TrailerType = Literal["dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other"]


class VehicleBase(BaseModel):
    unit_number: str = Field(min_length=1, max_length=40)
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    make: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=60)
    year: int | None = Field(default=None, ge=1980, le=2100)
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    status: Status = "active"


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    unit_number: str | None = Field(default=None, min_length=1, max_length=40)
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    make: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=60)
    year: int | None = Field(default=None, ge=1980, le=2100)
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    status: Status | None = None


class VehicleRead(VehicleBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime


class TrailerBase(BaseModel):
    unit_number: str = Field(min_length=1, max_length=40)
    type: TrailerType = "dry_van"
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    status: Status = "active"


class TrailerCreate(TrailerBase):
    pass


class TrailerUpdate(BaseModel):
    unit_number: str | None = Field(default=None, min_length=1, max_length=40)
    type: TrailerType | None = None
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    status: Status | None = None


class TrailerRead(TrailerBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime


router = APIRouter()
router.include_router(crud_router(
    prefix="/vehicles", tag="fleet", entity="vehicle", model=Vehicle, create_schema=VehicleCreate,
    update_schema=VehicleUpdate, read_schema=VehicleRead, read_perm="fleet:read", write_perm="fleet:write",
    search=("unit_number", "plate", "vin"), filters=("status",)))
router.include_router(crud_router(
    prefix="/trailers", tag="fleet", entity="trailer", model=Trailer, create_schema=TrailerCreate,
    update_schema=TrailerUpdate, read_schema=TrailerRead, read_perm="fleet:read", write_perm="fleet:write",
    search=("unit_number", "plate", "vin"), filters=("status",)))
