import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.crud import ListParams, ensure_exists, resource_router
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid
from app.modules.dispatch.eligibility import OtherLoad, current_loads
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.loads.schemas import EquipmentType
from app.modules.organizations.models import Terminal
from app.modules.safety.rules import Compliance, summarize, unit_issues

UnitStatus = Literal["active", "in_maintenance", "out_of_service", "retired"]
Ownership = Literal["owned", "leased", "owner_operator"]
State = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
Year = Field(default=None, ge=1950, le=2100)


# ---------------------------------------------------------------- schemas
class UnitBase(BaseModel):
    unit_number: str = Field(min_length=1, max_length=40)
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    plate_state: str | None = State
    make: str | None = Field(default=None, max_length=60)
    year: int | None = Year
    ownership: Ownership = "owned"
    terminal_id: uuid.UUID | None = None
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    inspection_expiry: date | None = None
    status: UnitStatus = "active"
    notes: str | None = Field(default=None, max_length=4000)


class UnitPatch(BaseModel):
    unit_number: str | None = Field(default=None, min_length=1, max_length=40)
    vin: str | None = Field(default=None, max_length=25)
    plate: str | None = Field(default=None, max_length=20)
    plate_state: str | None = State
    make: str | None = Field(default=None, max_length=60)
    year: int | None = Year
    ownership: Ownership | None = None
    terminal_id: uuid.UUID | None = None
    insurance_expiry: date | None = None
    registration_expiry: date | None = None
    inspection_expiry: date | None = None
    status: UnitStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)


class UnitExtras(BaseModel):
    id: uuid.UUID
    compliance: Compliance
    # "Assigned" and "available" are never stored: a unit is assigned while this is set.
    current_load: OtherLoad | None
    created_at: datetime


class VehicleCreate(UnitBase):
    model: str | None = Field(default=None, max_length=60)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)


class VehicleUpdate(UnitPatch):
    model: str | None = Field(default=None, max_length=60)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)


class VehicleRead(VehicleCreate, UnitExtras):
    pass


class TrailerCreate(UnitBase):
    type: EquipmentType = "dry_van"
    length_ft: int | None = Field(default=None, ge=1, le=100)


class TrailerUpdate(UnitPatch):
    type: EquipmentType | None = None
    length_ft: int | None = Field(default=None, ge=1, le=100)


class TrailerRead(TrailerCreate, UnitExtras):
    pass


class UnitListParams(ListParams):
    status: UnitStatus | None = None
    ownership: Ownership | None = None
    terminal_id: uuid.UUID | None = None


class TrailerListParams(UnitListParams):
    type: EquipmentType | None = None


# ---------------------------------------------------------------- behaviour
def _presenter(kind: Literal["vehicle", "trailer"], schema, create_schema):
    fields = list(create_schema.model_fields)

    def present(db: Session, units: list, p: Principal) -> list:
        on_load = current_loads(db, kind, [u.id for u in units])
        today = p.today()
        return [schema(**{f: getattr(u, f) for f in fields}, id=u.id, created_at=u.created_at,
                       compliance=summarize(unit_issues(u, today)), current_load=on_load.get(u.id))
                for u in units]
    return present


def _guards(kind: Literal["vehicle", "trailer"], what: str):
    def before_save(db: Session, p: Principal, data: dict, unit) -> None:
        for required in ("unit_number", "ownership", "status", "type"):
            if required in data and data[required] is None:
                raise Invalid("This field can't be empty", field=required)
        if data.get("plate_state"):
            data["plate_state"] = data["plate_state"].upper()
        ensure_exists(db, Terminal, data.get("terminal_id"), "terminal_id", "Terminal")
        if unit is not None and data.get("status") == "retired" and unit.status != "retired":
            before_delete(db, p, unit)

    def before_delete(db: Session, p: Principal, unit) -> None:
        busy = current_loads(db, kind, [unit.id]).get(unit.id)
        if busy:
            raise Conflict(f"{what} {unit.unit_number} is on load {busy.load_number}. Reassign that load first.",
                           details={"load_id": str(busy.id), "load_number": busy.load_number})
    return before_save, before_delete


_vehicle_save, _vehicle_delete = _guards("vehicle", "Truck")
_trailer_save, _trailer_delete = _guards("trailer", "Trailer")

router = APIRouter()
router.include_router(resource_router(
    prefix="/vehicles", tag="equipment", entity="vehicle", label="truck", model=Vehicle,
    create_schema=VehicleCreate, update_schema=VehicleUpdate, read_schema=VehicleRead,
    read_perm="equipment.read", write_perm="equipment.manage", list_params=UnitListParams,
    search=("unit_number", "vin", "plate", "make", "model"),
    sort={"unit_number": Vehicle.unit_number, "created_at": Vehicle.created_at}, default_sort="unit_number",
    present=_presenter("vehicle", VehicleRead, VehicleCreate), before_save=_vehicle_save,
    before_delete=_vehicle_delete))
router.include_router(resource_router(
    prefix="/trailers", tag="equipment", entity="trailer", label="trailer", model=Trailer,
    create_schema=TrailerCreate, update_schema=TrailerUpdate, read_schema=TrailerRead,
    read_perm="equipment.read", write_perm="equipment.manage", list_params=TrailerListParams,
    search=("unit_number", "vin", "plate", "make"),
    sort={"unit_number": Trailer.unit_number, "created_at": Trailer.created_at}, default_sort="unit_number",
    present=_presenter("trailer", TrailerRead, TrailerCreate), before_save=_trailer_save,
    before_delete=_trailer_delete))
