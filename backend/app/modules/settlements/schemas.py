import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.core.crud import ListParams
from app.core.money import Money
from app.modules.loads.schemas import Ref

SettlementStatus = Literal["draft", "approved", "paid", "void"]
LineKind = Literal["load_pay", "accessorial", "reimbursement", "deduction", "adjustment"]
PayMethod = Literal["ach", "check", "direct_deposit", "cash", "other"]


class SettlementCreate(BaseModel):
    driver_id: uuid.UUID
    period_start: date
    period_end: date
    notes: str | None = Field(default=None, max_length=2000)


class SettlementUpdate(BaseModel):
    version: int
    period_start: date | None = None
    period_end: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ManualLineIn(BaseModel):
    """A line entered by hand: a bonus or correction (adjustment, either sign), a deduction such as an
    insurance share or an advance being repaid, or a reimbursement not recorded as an expense."""
    kind: Literal["adjustment", "deduction", "reimbursement"] = "adjustment"
    description: str = Field(min_length=1, max_length=300)
    amount: Decimal = Field(max_digits=12, decimal_places=2, description="Deductions and reimbursements are entered "
                            "as positive amounts; an adjustment can be negative")
    version: int


class Versioned(BaseModel):
    version: int


class PayIn(BaseModel):
    version: int
    paid_on: date
    method: PayMethod
    reference: str | None = Field(default=None, max_length=80)


class SettlementVoidIn(BaseModel):
    version: int
    reason: str = Field(min_length=1, max_length=300)


class SettlementLineOut(BaseModel):
    id: uuid.UUID
    kind: LineKind
    load: Ref | None
    expense_id: uuid.UUID | None
    description: str
    quantity: Money
    rate: str = Field(description="Per unit, up to four decimal places (a per-mile rate)")
    amount: Money
    manual: bool


class PayTerms(BaseModel):
    pay_type: str
    pay_rate: str


class SettlementListItem(BaseModel):
    id: uuid.UUID
    number: str | None
    status: SettlementStatus
    driver: Ref
    period_start: date
    period_end: date
    currency: str
    earnings: Money
    reimbursements: Money
    deductions: Money
    net_pay: Money
    created_at: datetime
    approved_at: datetime | None
    paid_on: date | None
    version: int


class SettlementDetail(SettlementListItem):
    notes: str | None
    lines: list[SettlementLineOut]
    pay_terms: PayTerms = Field(description="The driver's pay terms now, which a recalculation uses")
    calculated_at: datetime | None
    created_by_name: str | None
    approved_by_name: str | None
    paid_method: PayMethod | None
    paid_reference: str | None
    voided_at: datetime | None
    void_reason: str | None
    allowed_actions: list[str]


class SettlementListParams(ListParams):
    status: SettlementStatus | None = None
    driver_id: uuid.UUID | None = None
    period_from: date | None = Field(default=None, description="Settlements whose period ends on or after this day")
    period_to: date | None = Field(default=None, description="Settlements whose period starts on or before this day")


class SettlementSummary(BaseModel):
    currency: str
    drafts: int
    to_pay: Money = Field(description="Approved and not yet paid")
    approved_unpaid: int
    paid_this_month: Money
