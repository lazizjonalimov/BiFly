import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.core.crud import ListParams
from app.core.money import Money
from app.modules.loads.schemas import Ref

Category = Literal["fuel", "tolls", "lumper", "scales", "parking", "permits", "repairs", "tires", "insurance", "lodging",
                   "meals", "advance", "other"]
FuelType = Literal["diesel", "def", "gasoline", "reefer"]
PaidWith = Literal["company_card", "fuel_card", "cash", "check", "ach", "driver"]
DriverTreatment = Literal["none", "reimburse", "deduct"]
State = Field(default=None, pattern=r"^[A-Za-z]{2}$", description="Two-letter state or province code")


class ExpenseFields(BaseModel):
    vendor: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=300)
    paid_with: PaidWith | None = None
    reference: str | None = Field(default=None, max_length=80, description="Receipt, card or transaction number")
    load_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None
    gallons: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=3)
    fuel_type: FuelType | None = None
    jurisdiction: str | None = State
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    notes: str | None = Field(default=None, max_length=4000)


class ExpenseCreate(ExpenseFields):
    category: Category
    incurred_on: date
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    driver_treatment: DriverTreatment = Field(default="none", description="reimburse: paid back to the driver in their "
                                              "settlement; deduct: taken from it")


class ExpenseUpdate(ExpenseFields):
    category: Category | None = None
    incurred_on: date | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    driver_treatment: DriverTreatment | None = None


class SettlementRef(BaseModel):
    id: uuid.UUID
    number: str | None
    status: str


class ExpenseOut(BaseModel):
    id: uuid.UUID
    category: Category
    incurred_on: date
    amount: Money
    currency: str
    vendor: str | None
    description: str | None
    paid_with: PaidWith | None
    reference: str | None
    load: Ref | None
    driver: Ref | None
    vehicle: Ref | None
    trailer: Ref | None
    driver_treatment: DriverTreatment
    gallons: str | None = Field(description="Three decimal places")
    price_per_gallon: str | None = Field(description="Amount over gallons, three decimal places")
    fuel_type: FuelType | None
    jurisdiction: str | None
    odometer: int | None
    notes: str | None
    settlement: SettlementRef | None
    # False once the expense is part of an approved settlement, or for a role that can't change expenses.
    editable: bool
    created_by_name: str | None
    created_at: datetime


class ExpenseListParams(ListParams):
    category: Category | None = None
    driver_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None
    load_id: uuid.UUID | None = None
    driver_treatment: DriverTreatment | None = None
    incurred_from: date | None = None
    incurred_to: date | None = None


class CategoryTotal(BaseModel):
    category: Category
    amount: Money
    count: int


class ExpenseSummary(BaseModel):
    """Spending in a date range (default: this month so far)."""
    date_from: date
    date_to: date
    currency: str
    total: Money
    count: int
    by_category: list[CategoryTotal]
    to_reimburse: Money = Field(description="Owed back to drivers and not yet in an approved settlement")
    to_deduct: Money = Field(description="To take from drivers' pay and not yet in an approved settlement")


class JurisdictionFuel(BaseModel):
    jurisdiction: str
    gallons: str
    amount: Money
    purchases: int


class TruckFuel(BaseModel):
    vehicle: Ref
    gallons: str
    amount: Money
    miles: int = Field(description="Miles of loads this truck delivered in the range")
    mpg: str | None


class FuelSummary(BaseModel):
    """Fuel bought in a date range: by state (for fuel-tax returns) and by truck, with miles per gallon."""
    date_from: date
    date_to: date
    currency: str
    gallons: str
    amount: Money
    price_per_gallon: str | None
    purchases: int
    by_jurisdiction: list[JurisdictionFuel]
    by_truck: list[TruckFuel]
