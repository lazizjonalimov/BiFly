import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Equipment = Literal["dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other"]


class StopIn(BaseModel):
    type: Literal["pickup", "delivery"]
    name: str | None = Field(default=None, max_length=160)
    address: str | None = Field(default=None, max_length=300)
    city: str = Field(min_length=1, max_length=80)
    state: str | None = Field(default=None, max_length=40)
    postal_code: str | None = Field(default=None, max_length=20)
    appt_start: datetime | None = None
    appt_end: datetime | None = None

    @model_validator(mode="after")
    def _appt_order(self):
        if self.appt_start and self.appt_end and self.appt_end < self.appt_start:
            raise ValueError("appt_end must not be before appt_start")
        return self


def _check_stops(stops: list[StopIn]) -> list[StopIn]:
    if stops[0].type != "pickup" or stops[-1].type != "delivery":
        raise ValueError("The first stop must be a pickup and the last stop a delivery")
    return stops


class LoadCreate(BaseModel):
    customer_id: uuid.UUID
    reference: str | None = Field(default=None, max_length=80)
    commodity: str | None = Field(default=None, max_length=200)
    equipment_type: Equipment = "dry_van"
    weight_lbs: int | None = Field(default=None, ge=0, le=200_000)
    customer_rate: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)
    stops: list[StopIn] = Field(min_length=2, max_length=30)

    @model_validator(mode="after")
    def _stops_ok(self):
        _check_stops(self.stops)
        return self


class LoadUpdate(BaseModel):
    reference: str | None = Field(default=None, max_length=80)
    commodity: str | None = Field(default=None, max_length=200)
    equipment_type: Equipment | None = None
    weight_lbs: int | None = Field(default=None, ge=0, le=200_000)
    customer_rate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)
    stops: list[StopIn] | None = Field(default=None, min_length=2, max_length=30)

    @model_validator(mode="after")
    def _stops_ok(self):
        if self.stops:
            _check_stops(self.stops)
        return self


class StopOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    seq: int
    type: str
    name: str | None
    address: str | None
    city: str
    state: str | None
    postal_code: str | None
    appt_start: datetime | None
    appt_end: datetime | None
    arrived_at: datetime | None
    departed_at: datetime | None


class AssignmentOut(BaseModel):
    id: uuid.UUID
    driver_id: uuid.UUID
    driver_name: str
    vehicle_id: uuid.UUID
    vehicle_unit: str
    trailer_id: uuid.UUID | None
    trailer_unit: str | None


class LoadSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    load_number: str
    status: str
    customer_id: uuid.UUID
    customer_name: str | None = None
    reference: str | None
    commodity: str | None
    equipment_type: str
    customer_rate: Decimal
    origin: str | None = None
    destination: str | None = None
    pickup_at: datetime | None = None
    created_at: datetime


class StatusEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    from_status: str | None
    to_status: str
    actor_user_id: uuid.UUID | None
    note: str | None
    created_at: datetime


class LoadDetail(LoadSummary):
    weight_lbs: int | None
    notes: str | None
    stops: list[StopOut]
    assignment: AssignmentOut | None = None
    events: list[StatusEventOut] = []
    has_pod: bool = False
    invoice_id: uuid.UUID | None = None


class StopEventIn(BaseModel):
    event: Literal["arrived", "departed"]
    occurred_at: datetime | None = Field(default=None, description="Device time; defaults to server time")


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
