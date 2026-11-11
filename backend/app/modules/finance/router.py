import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.core.audit import audit
from app.core.deps import Principal, get_db, require
from app.core.errors import Conflict, NotFound
from app.core.idempotency import run_idempotent
from app.core.pagination import paginate
from app.modules.customers.models import Customer
from app.modules.finance.models import Invoice, InvoiceLine, Payment
from app.modules.loads.models import Load
from app.modules.loads.service import change_status, lock_load_or_404, next_number

router = APIRouter(prefix="/invoices", tags=["finance"])


class InvoiceCreate(BaseModel):
    load_id: uuid.UUID


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    paid_on: date | None = None
    method: Literal["ach", "check", "wire", "card", "cash", "other"] | None = None
    reference: str | None = Field(default=None, max_length=80)


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    amount: Decimal
    paid_on: date
    method: str | None
    reference: str | None
    created_at: datetime


class InvoiceOut(BaseModel):
    id: uuid.UUID
    invoice_number: str
    load_id: uuid.UUID
    load_number: str | None = None
    customer_id: uuid.UUID
    customer_name: str | None = None
    status: str
    issued_date: date
    due_date: date
    total: Decimal
    paid_total: Decimal
    balance: Decimal
    overdue: bool
    created_at: datetime
    lines: list[LineOut] = []
    payments: list[PaymentOut] = []


def _lock_invoice(db, invoice_id: uuid.UUID) -> Invoice:
    inv = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update())
    if inv is None:
        raise NotFound("Invoice not found")
    return inv


def _views(db, invoices: list[Invoice], *, full: bool) -> list[InvoiceOut]:
    """Build API views for many invoices with a fixed number of queries."""
    if not invoices:
        return []
    ids = [i.id for i in invoices]
    paid = dict(db.execute(select(Payment.invoice_id, func.sum(Payment.amount))
                           .where(Payment.invoice_id.in_(ids)).group_by(Payment.invoice_id)).all())
    load_numbers = dict(db.execute(select(Load.id, Load.load_number)
                                   .where(Load.id.in_({i.load_id for i in invoices}))).all())
    customers = dict(db.execute(select(Customer.id, Customer.name)
                                .where(Customer.id.in_({i.customer_id for i in invoices}))).all())
    lines: dict[uuid.UUID, list[LineOut]] = {}
    payments: dict[uuid.UUID, list[PaymentOut]] = {}
    if full:
        for ln in db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id.in_(ids))):
            lines.setdefault(ln.invoice_id, []).append(LineOut.model_validate(ln))
        for pay in db.scalars(select(Payment).where(Payment.invoice_id.in_(ids)).order_by(Payment.created_at)):
            payments.setdefault(pay.invoice_id, []).append(PaymentOut.model_validate(pay))
    today = date.today()
    out = []
    for inv in invoices:
        paid_total = Decimal(paid.get(inv.id) or 0)
        out.append(InvoiceOut(
            id=inv.id, invoice_number=inv.invoice_number, load_id=inv.load_id, customer_id=inv.customer_id,
            status=inv.status, issued_date=inv.issued_date, due_date=inv.due_date, total=inv.total,
            paid_total=paid_total, balance=inv.total - paid_total,
            overdue=inv.status == "sent" and inv.due_date < today, created_at=inv.created_at,
            load_number=load_numbers.get(inv.load_id), customer_name=customers.get(inv.customer_id),
            lines=lines.get(inv.id, []), payments=payments.get(inv.id, [])))
    return out


def _view(db, inv: Invoice) -> InvoiceOut:
    return _views(db, [inv], full=True)[0]


class InvoicePage(BaseModel):
    items: list[InvoiceOut]
    next_cursor: str | None = None


@router.get("", response_model=InvoicePage)
def list_invoices(cursor: str | None = None, limit: int = Query(50, ge=1, le=200),
                  status: Literal["sent", "paid", "void", "overdue"] | None = None,
                  customer_id: uuid.UUID | None = None,
                  p: Principal = Depends(require("invoices:read")), db=Depends(get_db)):
    stmt = select(Invoice)
    if status == "overdue":
        stmt = stmt.where(Invoice.status == "sent", Invoice.due_date < date.today())
    elif status:
        stmt = stmt.where(Invoice.status == status)
    if customer_id:
        stmt = stmt.where(Invoice.customer_id == customer_id)
    rows, nxt = paginate(db, stmt, Invoice, cursor, limit)
    return {"items": _views(db, rows, full=False), "next_cursor": nxt}


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, p: Principal = Depends(require("invoices:read")), db=Depends(get_db)):
    inv = db.get(Invoice, invoice_id)
    if inv is None:
        raise NotFound("Invoice not found")
    return _view(db, inv)


@router.post("", response_model=InvoiceOut, status_code=201)
def create_invoice(body: InvoiceCreate, p: Principal = Depends(require("invoices:write")), db=Depends(get_db),
                   idempotency_key: str | None = Header(default=None)):
    """Invoice a completed (delivery-confirmed) load for its agreed rate."""
    def work():
        load = lock_load_or_404(db, body.load_id)
        if load.status != "completed":
            raise Conflict(f"Only completed loads can be invoiced (this load is {load.status})", code="not_invoiceable")
        cust = db.get(Customer, load.customer_id)
        issued = date.today()
        inv = Invoice(organization_id=p.org_id, invoice_number=next_number(db, p.org_id, "invoice_seq", "INV"),
                      load_id=load.id, customer_id=load.customer_id, status="sent", issued_date=issued,
                      due_date=issued + timedelta(days=cust.payment_terms_days), total=load.customer_rate)
        db.add(inv)
        db.flush()
        db.add(InvoiceLine(organization_id=p.org_id, invoice_id=inv.id,
                           description=f"Line haul — load {load.load_number}", quantity=Decimal("1"),
                           unit_price=load.customer_rate, amount=load.customer_rate))
        change_status(db, p, load, "invoiced", f"Invoice {inv.invoice_number} issued")
        audit(db, p, "invoice.created", "invoice", inv.id, {"load_id": str(load.id), "total": str(inv.total)})
        db.flush()
        return 201, _view(db, inv).model_dump(mode="json")
    return run_idempotent(db, p, idempotency_key, "invoice.create", body.model_dump(mode="json"), work)


@router.post("/{invoice_id}/payments", response_model=InvoiceOut, status_code=201)
def add_payment(invoice_id: uuid.UUID, body: PaymentIn, p: Principal = Depends(require("payments:write")),
                db=Depends(get_db), idempotency_key: str | None = Header(default=None)):
    def work():
        inv = _lock_invoice(db, invoice_id)
        if inv.status != "sent":
            raise Conflict(f"A {inv.status} invoice cannot receive payments")
        paid = Decimal(db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.invoice_id == inv.id)))
        balance = inv.total - paid
        if body.amount > balance:
            raise Conflict(f"Payment exceeds the outstanding balance of {balance}", code="overpayment")
        pay = Payment(organization_id=p.org_id, invoice_id=inv.id, amount=body.amount,
                      paid_on=body.paid_on or date.today(), method=body.method, reference=body.reference,
                      created_by=p.user_id)
        db.add(pay)
        db.flush()
        audit(db, p, "payment.recorded", "invoice", inv.id, {"amount": str(body.amount)})
        if body.amount == balance:
            inv.status = "paid"
            change_status(db, p, lock_load_or_404(db, inv.load_id), "paid", f"Invoice {inv.invoice_number} paid in full")
        db.flush()
        return 201, _view(db, inv).model_dump(mode="json")
    return run_idempotent(db, p, idempotency_key, f"invoice.pay:{invoice_id}", body.model_dump(mode="json"), work)


@router.post("/{invoice_id}/void", response_model=InvoiceOut)
def void_invoice(invoice_id: uuid.UUID, p: Principal = Depends(require("invoices:write")), db=Depends(get_db)):
    inv = _lock_invoice(db, invoice_id)
    if inv.status != "sent":
        raise Conflict(f"A {inv.status} invoice cannot be voided")
    if db.scalar(select(func.count()).select_from(Payment).where(Payment.invoice_id == inv.id)):
        raise Conflict("An invoice with recorded payments cannot be voided")
    inv.status = "void"
    change_status(db, p, lock_load_or_404(db, inv.load_id), "completed", f"Invoice {inv.invoice_number} voided")
    audit(db, p, "invoice.voided", "invoice", inv.id)
    db.commit()
    return _view(db, inv)
