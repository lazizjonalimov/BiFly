import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.core.crud import ListParams
from app.core.money import Money as MoneyOut

EquipmentType = Literal["dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other"]
LoadStatus = Literal["draft", "planned", "assigned", "dispatched", "at_pickup", "in_transit", "at_delivery",
                     "delivered", "pod_review", "completed", "on_hold", "cancelled"]
BillingStatus = Literal["unbilled", "invoiced", "paid"]
ChargeType = Literal["detention", "layover", "lumper", "fuel_surcharge", "tarp", "extra_stop", "tonu", "other"]
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
# Views the dispatch board and the load list offer as one-click filters.
LoadView = Literal["active", "unassigned", "pickups_today", "deliveries_today", "at_risk", "in_transit",
                   "missing_pod", "ready_to_invoice"]
Action = Literal["mark_ready", "dispatch", "arrive", "depart", "approve_pod", "reject_pod", "hold", "release",
                 "cancel"]


# ---------------------------------------------------------------- stops, items, charges
class StopFields(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    address: str | None = Field(default=None, max_length=300)
    city: str = Field(min_length=1, max_length=80)
    state: str | None = Field(default=None, max_length=40)
    postal_code: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=40)
    reference: str | None = Field(default=None, max_length=80)
    instructions: str | None = Field(default=None, max_length=1000)
    appt_start: AwareDatetime | None = None
    appt_end: AwareDatetime | None = None

    @field_validator("appt_end")
    @classmethod
    def _window(cls, end: datetime | None, info: ValidationInfo) -> datetime | None:
        start = info.data.get("appt_start")
        if end and start and end < start:
            raise ValueError("The appointment can't end before it starts")
        return end


class StopIn(StopFields):
    type: Literal["pickup", "delivery"]


class StopPatch(BaseModel):
    """What can still change on a stop once the truck is rolling: the schedule and who to ask for."""
    version: int
    name: str | None = Field(default=None, max_length=160)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=40)
    reference: str | None = Field(default=None, max_length=80)
    instructions: str | None = Field(default=None, max_length=1000)
    appt_start: AwareDatetime | None = None
    appt_end: AwareDatetime | None = None


class StopOut(StopIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    seq: int
    arrived_at: datetime | None
    departed_at: datetime | None


class StopsReplace(BaseModel):
    version: int
    stops: list[StopIn] = Field(max_length=20)


class ItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    unit: str | None = Field(default=None, max_length=30)
    weight_lbs: int | None = Field(default=None, ge=0, le=1_000_000)


class ItemPatch(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=200)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    unit: str | None = Field(default=None, max_length=30)
    weight_lbs: int | None = Field(default=None, ge=0, le=1_000_000)


class ItemOut(ItemIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


class ChargeIn(BaseModel):
    type: ChargeType
    description: str | None = Field(default=None, max_length=200)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=10, decimal_places=2)
    rate: Decimal = Field(max_digits=12, decimal_places=2, description="Per unit. Negative for a deduction")
    billable: bool = True
    driver_payable: bool = False


class ChargePatch(BaseModel):
    type: ChargeType | None = None
    description: str | None = Field(default=None, max_length=200)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    rate: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)
    billable: bool | None = None
    driver_payable: bool | None = None


class ChargeOut(ChargeIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    amount: MoneyOut


# ---------------------------------------------------------------- load
class LoadFields(BaseModel):
    terminal_id: uuid.UUID | None = None
    reference: str | None = Field(default=None, max_length=80)
    bol_number: str | None = Field(default=None, max_length=80)
    commodity: str | None = Field(default=None, max_length=200)
    equipment_type: EquipmentType = "dry_van"
    weight_lbs: int | None = Field(default=None, ge=0, le=1_000_000)
    miles: int | None = Field(default=None, ge=0, le=50_000)
    instructions: str | None = Field(default=None, max_length=4000)
    customer_rate: Money = Decimal("0")


class LoadCreate(LoadFields):
    customer_id: uuid.UUID
    # draft: saved to finish later, nothing is checked beyond the fields themselves.
    # planned: ready to be assigned, so it needs a complete route.
    status: Literal["draft", "planned"] = "planned"
    stops: list[StopIn] = Field(default_factory=list, max_length=20)
    items: list[ItemIn] = Field(default_factory=list, max_length=50)
    charges: list[ChargeIn] = Field(default_factory=list, max_length=30)


class LoadUpdate(BaseModel):
    version: int = Field(description="The version you last saw. A stale one is rejected with VERSION_CONFLICT")
    customer_id: uuid.UUID | None = None
    terminal_id: uuid.UUID | None = None
    reference: str | None = Field(default=None, max_length=80)
    bol_number: str | None = Field(default=None, max_length=80)
    commodity: str | None = Field(default=None, max_length=200)
    equipment_type: EquipmentType | None = None
    weight_lbs: int | None = Field(default=None, ge=0, le=1_000_000)
    miles: int | None = Field(default=None, ge=0, le=50_000)
    instructions: str | None = Field(default=None, max_length=4000)
    customer_rate: Money | None = None


class TransitionIn(BaseModel):
    action: Action
    version: int
    reason: str | None = Field(default=None, max_length=500)
    stop_id: uuid.UUID | None = Field(default=None, description="For arrive/depart: the stop you mean")
    occurred_at: AwareDatetime | None = Field(default=None, description="When it happened, if recorded later")


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TrackingIn(BaseModel):
    kind: Literal["check_call", "exception"] = "check_call"
    occurred_at: AwareDatetime | None = None
    city: str | None = Field(default=None, max_length=80)
    state: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------- responses
class Ref(BaseModel):
    id: uuid.UUID
    name: str


class LoadRef(BaseModel):
    id: uuid.UUID
    load_number: str
    status: str


class AssignmentBrief(BaseModel):
    id: uuid.UUID
    status: str
    driver: Ref
    vehicle: Ref
    trailer: Ref | None


class AssignmentOut(AssignmentBrief):
    assigned_at: datetime
    assigned_by_name: str | None
    released_at: datetime | None
    release_reason: str | None


class Risk(BaseModel):
    code: str
    message: str


class LoadListItem(BaseModel):
    id: uuid.UUID
    load_number: str
    status: LoadStatus
    billing_status: BillingStatus
    version: int
    customer: Ref
    terminal_id: uuid.UUID | None
    reference: str | None
    equipment_type: str
    origin_city: str | None
    origin_state: str | None
    destination_city: str | None
    destination_state: str | None
    pickup_at: datetime | None
    delivery_at: datetime | None
    delivered_at: datetime | None
    miles: int | None
    weight_lbs: int | None
    # Hidden (null) from roles that may not see rates.
    revenue: MoneyOut | None
    currency: str
    assignment: AssignmentBrief | None
    risks: list[Risk]
    created_at: datetime
    updated_at: datetime


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    author_name: str | None
    created_at: datetime


class StatusEventOut(BaseModel):
    id: uuid.UUID
    action: str
    from_status: str | None
    to_status: str
    actor_name: str | None
    note: str | None
    created_at: datetime


class TrackingOut(BaseModel):
    id: uuid.UUID
    kind: str
    occurred_at: datetime
    city: str | None
    state: str | None
    note: str | None
    source: str
    actor_name: str | None


class InvoiceRef(BaseModel):
    id: uuid.UUID
    invoice_number: str | None
    status: str


class Editable(BaseModel):
    """What the caller may change right now, given the load's state and their role."""
    details: bool
    customer: bool
    stops: bool
    schedule: bool
    rates: bool


class LoadDetail(LoadListItem):
    bol_number: str | None
    commodity: str | None
    instructions: str | None
    customer_rate: MoneyOut | None
    charges_total: MoneyOut | None
    held_from_status: str | None
    invoice: InvoiceRef | None
    stops: list[StopOut]
    items: list[ItemOut]
    charges: list[ChargeOut]
    notes: list[NoteOut]
    events: list[StatusEventOut]
    tracking: list[TrackingOut]
    assignments: list[AssignmentOut]
    allowed_actions: list[str]
    editable: Editable


class LoadListParams(ListParams):
    status: list[LoadStatus] | None = None
    billing_status: BillingStatus | None = None
    view: LoadView | None = None
    customer_id: uuid.UUID | None = None
    terminal_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None
    equipment_type: EquipmentType | None = None
    # Calendar dates in the company's time zone, both inclusive.
    pickup_from: date | None = None
    pickup_to: date | None = None
    delivery_from: date | None = None
    delivery_to: date | None = None
    origin_state: str | None = Field(default=None, max_length=40)
    destination_state: str | None = Field(default=None, max_length=40)


class BoardSummary(BaseModel):
    """Counts behind the dispatch board's summary strip. Each matches the view of the same name."""
    active: int
    unassigned: int
    pickups_today: int
    deliveries_today: int
    at_risk: int
    in_transit: int
    missing_pod: int
    on_hold: int
