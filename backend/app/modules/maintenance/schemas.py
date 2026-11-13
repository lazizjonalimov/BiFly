import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.crud import ListParams
from app.core.money import Money

UnitType = Literal["vehicle", "trailer"]
Priority = Literal["low", "normal", "high", "urgent"]
WorkOrderStatus = Literal["open", "in_progress", "completed", "cancelled"]
LineKind = Literal["labor", "part", "other"]
InspectionKind = Literal["pre_trip", "post_trip", "annual", "roadside", "other"]
InspectionResult = Literal["pass", "defects", "out_of_service"]
Severity = Literal["minor", "major", "out_of_service"]


class OneUnit(BaseModel):
    """A truck or a trailer: exactly one of the two (checked by the service, which names the field)."""
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None


class UnitRef(BaseModel):
    type: UnitType
    id: uuid.UUID
    name: str
    status: str


class Ref(BaseModel):
    id: uuid.UUID
    name: str


# ---------------------------------------------------------------- work orders
class CostLineIn(BaseModel):
    kind: LineKind = "part"
    description: str = Field(min_length=1, max_length=200)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=10, decimal_places=2)
    unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class CostLinePatch(BaseModel):
    kind: LineKind | None = None
    description: str | None = Field(default=None, min_length=1, max_length=200)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class CostLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    description: str
    quantity: Money  # two decimal places, written the same way as money
    unit_cost: Money
    amount: Money


class WorkOrderCreate(OneUnit):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    priority: Priority = "normal"
    vendor: str | None = Field(default=None, max_length=160)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    scheduled_for: date | None = None
    out_of_service: bool = Field(default=False, description="Keep the unit off the road until it is returned to service")
    lines: list[CostLineIn] = Field(default_factory=list, max_length=100)


class WorkOrderUpdate(BaseModel):
    version: int
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    priority: Priority | None = None
    vendor: str | None = Field(default=None, max_length=160)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    scheduled_for: date | None = None
    out_of_service: bool | None = None


class WorkOrderTransition(BaseModel):
    action: Literal["start", "complete", "cancel"]
    version: int
    notes: str | None = Field(default=None, max_length=4000, description="What was done, or why it was cancelled")


class WorkOrderListItem(BaseModel):
    id: uuid.UUID
    number: str
    status: WorkOrderStatus
    priority: Priority
    title: str
    unit: UnitRef
    vendor: str | None
    scheduled_for: date | None
    out_of_service: bool
    total_cost: Money
    currency: str
    created_at: datetime
    completed_at: datetime | None
    version: int


class DefectSource(BaseModel):
    inspection_id: uuid.UUID
    inspection_kind: str
    inspected_on: date
    item: str
    severity: str


class WorkOrderDetail(WorkOrderListItem):
    description: str | None
    odometer: int | None
    started_at: datetime | None
    resolution: str | None
    created_by_name: str | None
    completed_by_name: str | None
    lines: list[CostLineOut]
    defects: list[DefectSource]
    allowed_actions: list[str]
    editable: bool


class WorkOrderListParams(ListParams):
    status: WorkOrderStatus | None = None
    open: bool | None = Field(default=None, description="Only work orders not yet completed or cancelled")
    overdue: bool | None = Field(default=None, description="Open work orders scheduled for a day that has passed")
    priority: Priority | None = None
    unit_type: UnitType | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None


# ---------------------------------------------------------------- inspections
class DefectIn(BaseModel):
    item: str = Field(min_length=1, max_length=120)
    severity: Severity = "minor"
    description: str | None = Field(default=None, max_length=500)


class InspectionCreate(OneUnit):
    driver_id: uuid.UUID | None = None
    kind: InspectionKind
    inspected_on: date
    result: InspectionResult
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    location: str | None = Field(default=None, max_length=160)
    inspector: str | None = Field(default=None, max_length=160)
    report_number: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=4000)
    defects: list[DefectIn] = Field(default_factory=list, max_length=50)


class WorkOrderRef(BaseModel):
    id: uuid.UUID
    number: str
    status: str


class DefectOut(BaseModel):
    id: uuid.UUID
    item: str
    severity: str
    description: str | None
    work_order: WorkOrderRef | None


class InspectionOut(BaseModel):
    id: uuid.UUID
    unit: UnitRef
    driver: Ref | None
    kind: InspectionKind
    inspected_on: date
    result: InspectionResult
    odometer: int | None
    location: str | None
    inspector: str | None
    report_number: str | None
    notes: str | None
    created_by_name: str | None
    created_at: datetime
    defects: list[DefectOut]


class InspectionListParams(ListParams):
    kind: InspectionKind | None = None
    result: InspectionResult | None = None
    unit_type: UnitType | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None


class ReturnToServiceIn(BaseModel):
    unit_type: UnitType
    unit_id: uuid.UUID
    notes: str | None = Field(default=None, max_length=1000)


class MaintenanceSummary(BaseModel):
    open_work_orders: int
    urgent_open: int
    overdue: int
    units_out_of_service: int
    currency: str
    spend_this_month: Money
