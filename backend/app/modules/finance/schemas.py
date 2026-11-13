import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.crud import ListParams
from app.core.money import Money
from app.modules.loads.schemas import Ref

Amount = Field(gt=0, max_digits=12, decimal_places=2)
InvoiceStatus = Literal["draft", "issued", "paid", "void"]
PaymentMethod = Literal["ach", "wire", "check", "card", "factoring", "cash", "other"]


# ---------------------------------------------------------------- invoices
class InvoiceCreate(BaseModel):
    customer_id: uuid.UUID
    load_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200,
                                      description="Completed, unbilled loads of this customer")
    notes: str | None = Field(default=None, max_length=2000)
    due_date: date | None = Field(default=None, description="Leave empty to use the customer's payment terms")


class InvoicePatch(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)
    due_date: date | None = None


class InvoiceLoads(BaseModel):
    load_ids: list[uuid.UUID] = Field(max_length=200)


class AdjustmentIn(BaseModel):
    """A line that isn't a load: a discount (negative) or an extra charge."""
    description: str = Field(min_length=1, max_length=300)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, max_digits=10, decimal_places=2)
    unit_price: Decimal = Field(max_digits=12, decimal_places=2)


class VoidIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class InvoiceLineOut(BaseModel):
    id: uuid.UUID
    load_id: uuid.UUID | None
    load_number: str | None
    kind: str
    description: str
    quantity: Money  # two decimal places, written the same way as money
    unit_price: Money
    amount: Money


class AppliedPayment(BaseModel):
    payment_id: uuid.UUID
    received_on: date
    method: str | None
    reference: str | None
    amount: Money
    status: str


class InvoiceListItem(BaseModel):
    id: uuid.UUID
    invoice_number: str | None
    status: InvoiceStatus
    customer: Ref
    issue_date: date | None
    due_date: date | None
    currency: str
    total: Money
    paid: Money
    balance: Money
    # Worked out from the due date in the company's time zone; never stored.
    is_overdue: bool
    days_overdue: int
    created_at: datetime


class Party(BaseModel):
    name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    email: str | None = None
    phone: str | None = None
    dot_number: str | None = None
    mc_number: str | None = None


class InvoiceDetail(InvoiceListItem):
    notes: str | None
    # Who is billing and who is billed. For an issued invoice `bill_to` is the snapshot taken at issue time.
    seller: Party
    bill_to: Party
    payment_terms_days: int | None
    lines: list[InvoiceLineOut]
    payments: list[AppliedPayment]
    issued_at: datetime | None
    issued_by_name: str | None
    voided_at: datetime | None
    void_reason: str | None
    allowed_actions: list[str]


class InvoiceListParams(ListParams):
    status: InvoiceStatus | None = None
    customer_id: uuid.UUID | None = None
    overdue: bool | None = None
    issued_from: date | None = None
    issued_to: date | None = None


# ---------------------------------------------------------------- payments
class AllocationIn(BaseModel):
    invoice_id: uuid.UUID
    amount: Decimal = Amount


class PaymentCreate(BaseModel):
    customer_id: uuid.UUID
    amount: Decimal = Amount
    received_on: date
    method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=80, description="Check or transaction number")
    notes: str | None = Field(default=None, max_length=500)
    allocations: list[AllocationIn] = Field(default_factory=list, max_length=100)


class AllocationsIn(BaseModel):
    allocations: list[AllocationIn] = Field(min_length=1, max_length=100)


class ReverseIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class AllocationOut(BaseModel):
    invoice_id: uuid.UUID
    invoice_number: str | None
    amount: Money


class PaymentListItem(BaseModel):
    id: uuid.UUID
    customer: Ref
    amount: Money
    applied: Money
    unapplied: Money
    currency: str
    received_on: date
    method: str | None
    reference: str | None
    status: Literal["recorded", "reversed"]
    created_at: datetime


class PaymentDetail(PaymentListItem):
    notes: str | None
    allocations: list[AllocationOut]
    reversed_at: datetime | None
    reversal_reason: str | None
    recorded_by_name: str | None


class PaymentListParams(ListParams):
    status: Literal["recorded", "reversed"] | None = None
    customer_id: uuid.UUID | None = None
    received_from: date | None = None
    received_to: date | None = None


class Receivables(BaseModel):
    """What customers owe right now."""
    currency: str
    open_balance: Money
    overdue_balance: Money
    open_invoices: int
    overdue_invoices: int
    draft_invoices: int
    ready_to_invoice_loads: int
    ready_to_invoice_amount: Money


def party(data: dict[str, Any] | None, fallback_name: str = "") -> Party:
    return Party(**{**{"name": fallback_name}, **(data or {})})
