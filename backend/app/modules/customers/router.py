import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.crud import ListParams, child_router, resource_router
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Invalid
from app.core.money import Money
from app.modules.customers.models import Customer, CustomerAddress, CustomerContact
from app.modules.finance.models import Invoice, Payment, PaymentAllocation
from app.modules.loads.models import Load


# ---------------------------------------------------------------- schemas
class CustomerBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    code: str | None = Field(default=None, max_length=30)
    legal_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    billing_email: EmailStr | None = None
    billing_address: str | None = Field(default=None, max_length=300)
    billing_city: str | None = Field(default=None, max_length=80)
    billing_state: str | None = Field(default=None, max_length=40)
    billing_postal_code: str | None = Field(default=None, max_length=20)
    payment_terms_days: int = Field(default=30, ge=0, le=365)
    credit_limit: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    code: str | None = Field(default=None, max_length=30)
    legal_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    billing_email: EmailStr | None = None
    billing_address: str | None = Field(default=None, max_length=300)
    billing_city: str | None = Field(default=None, max_length=80)
    billing_state: str | None = Field(default=None, max_length=40)
    billing_postal_code: str | None = Field(default=None, max_length=20)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    credit_limit: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)


class CustomerRead(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    created_at: datetime


class CustomerListParams(ListParams):
    status: Literal["active", "archived"] | None = None


ContactKind = Literal["operations", "billing", "other"]


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=80)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    kind: ContactKind = "operations"
    is_primary: bool = False


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=80)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    kind: ContactKind | None = None
    is_primary: bool | None = None


class ContactRead(ContactCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    customer_id: uuid.UUID


class AddressCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    kind: Literal["billing", "facility"] = "facility"
    address: str | None = Field(default=None, max_length=300)
    city: str = Field(min_length=1, max_length=80)
    state: str | None = Field(default=None, max_length=40)
    postal_code: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class AddressUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Literal["billing", "facility"] | None = None
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, min_length=1, max_length=80)
    state: str | None = Field(default=None, max_length=40)
    postal_code: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class AddressRead(AddressCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    customer_id: uuid.UUID


class CustomerStats(BaseModel):
    loads_total: int
    loads_open: int
    # Present only for roles that may see invoices.
    open_balance: Money | None = None
    currency: str | None = None


class CustomerDetail(CustomerRead):
    contacts: list[ContactRead]
    addresses: list[AddressRead]
    stats: CustomerStats


# ---------------------------------------------------------------- routes
router = APIRouter()

OPEN_LOAD_STATUSES = ("draft", "planned", "assigned", "dispatched", "at_pickup", "in_transit", "at_delivery",
                      "delivered", "pod_review", "on_hold")


def open_balance(db: Session, customer_id: uuid.UUID | None = None) -> Decimal:
    """Issued, unpaid invoice totals minus what has been applied to them."""
    invoiced = select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.status == "issued")
    applied = (select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
               .join(Payment, Payment.id == PaymentAllocation.payment_id)
               .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
               .where(Payment.status == "recorded", Invoice.status == "issued"))
    if customer_id:
        invoiced = invoiced.where(Invoice.customer_id == customer_id)
        applied = applied.where(Invoice.customer_id == customer_id)
    return Decimal(db.scalar(invoiced)) - Decimal(db.scalar(applied))


@router.get("/customers/{customer_id}", response_model=CustomerDetail, tags=["customers"])
def get_customer(customer_id: uuid.UUID, p: Principal = Depends(require("customers.read")),
                 db: Session = Depends(get_db)):
    customer = get_or_404(db, Customer, customer_id, "Customer")
    contacts = list(db.scalars(select(CustomerContact).where(CustomerContact.customer_id == customer_id)
                               .order_by(CustomerContact.is_primary.desc(), CustomerContact.name)))
    addresses = list(db.scalars(select(CustomerAddress).where(CustomerAddress.customer_id == customer_id)
                                .order_by(CustomerAddress.kind, CustomerAddress.label)))
    total, open_ = db.execute(
        select(func.count(), func.count().filter(Load.status.in_(OPEN_LOAD_STATUSES)))
        .where(Load.customer_id == customer_id)).one()
    money = {"open_balance": open_balance(db, customer_id), "currency": p.currency} if p.can("invoices.read") else {}
    stats = CustomerStats(loads_total=total, loads_open=open_, **money)
    return CustomerDetail(**CustomerRead.model_validate(customer).model_dump(),
                          contacts=[ContactRead.model_validate(c) for c in contacts],
                          addresses=[AddressRead.model_validate(a) for a in addresses], stats=stats)


def _single_primary(db: Session, p: Principal, contact: CustomerContact) -> None:
    """A customer has at most one primary contact: making one primary demotes the others."""
    if contact.is_primary:
        db.execute(update(CustomerContact).where(CustomerContact.customer_id == contact.customer_id,
                                                 CustomerContact.id != contact.id).values(is_primary=False))


def _contact_fields(db: Session, p: Principal, data: dict, contact) -> None:
    for required in ("name", "kind", "is_primary"):
        if required in data and data[required] is None:
            raise Invalid("This field can't be empty", field=required)


router.include_router(resource_router(
    prefix="/customers", tag="customers", entity="customer", label="customer", model=Customer,
    create_schema=CustomerCreate, update_schema=CustomerUpdate, read_schema=CustomerRead,
    read_perm="customers.read", write_perm="customers.manage", list_params=CustomerListParams,
    search=("name", "code", "billing_email"),
    sort={"name": Customer.name, "created_at": Customer.created_at}, default_sort="name",
    archivable=True, detail=False))
router.include_router(child_router(
    prefix="/customers/{parent_id}/contacts", tag="customers", entity="customer_contact", label="contact",
    model=CustomerContact, parent_model=Customer, parent_fk="customer_id", parent_label="Customer",
    create_schema=ContactCreate, update_schema=ContactUpdate, read_schema=ContactRead,
    read_perm="customers.read", write_perm="customers.manage", order_by=CustomerContact.name,
    before_save=_contact_fields, after_save=_single_primary))
router.include_router(child_router(
    prefix="/customers/{parent_id}/addresses", tag="customers", entity="customer_address", label="address",
    model=CustomerAddress, parent_model=Customer, parent_fk="customer_id", parent_label="Customer",
    create_schema=AddressCreate, update_schema=AddressUpdate, read_schema=AddressRead,
    read_perm="customers.read", write_perm="customers.manage", order_by=CustomerAddress.label))
