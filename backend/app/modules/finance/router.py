import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import func, literal, or_, select
from sqlalchemy.orm import Session

from app.core.crud import like
from app.core.deps import Principal, get_db, require
from app.core.errors import NotFound
from app.core.idempotency import run_idempotent
from app.core.money import ZERO
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.modules.customers.models import Customer
from app.modules.finance import schemas as s
from app.modules.finance import service
from app.modules.finance.models import Invoice, InvoiceLine, Payment, PaymentAllocation
from app.modules.loads.models import Load
from app.modules.loads.schemas import Ref
from app.modules.organizations.models import Organization, User

router = APIRouter(tags=["finance"])
FAR = date(9999, 1, 1)


# ---------------------------------------------------------------- invoices: reading
def _paid():
    return (select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .join(Payment, Payment.id == PaymentAllocation.payment_id)
            .where(PaymentAllocation.invoice_id == Invoice.id, Payment.status == "recorded")
            .correlate(Invoice).scalar_subquery())


def _invoice_rows():
    return select(Invoice, Customer.name, _paid().label("paid")).join(Customer, Customer.id == Invoice.customer_id)


def _invoice_item(row, today: date) -> dict:
    invoice, customer_name, paid = row
    paid = Decimal(paid)
    owed = invoice.status in ("draft", "issued")
    overdue = invoice.status == "issued" and invoice.due_date is not None and invoice.due_date < today
    return dict(
        id=invoice.id, invoice_number=invoice.invoice_number, status=invoice.status,
        customer=Ref(id=invoice.customer_id, name=customer_name), issue_date=invoice.issue_date,
        due_date=invoice.due_date, currency=invoice.currency, total=invoice.total, paid=paid,
        balance=(invoice.total - paid) if owed else ZERO, is_overdue=overdue,
        days_overdue=(today - invoice.due_date).days if overdue else 0, created_at=invoice.created_at)


def _invoice_detail(db: Session, p: Principal, invoice_id: uuid.UUID) -> s.InvoiceDetail:
    row = db.execute(_invoice_rows().where(Invoice.id == invoice_id)).first()
    if row is None:
        raise NotFound("Invoice not found")
    invoice: Invoice = row[0]
    org = db.get(Organization, p.org_id)
    customer = db.get(Customer, invoice.customer_id)
    lines = db.execute(select(InvoiceLine, Load.load_number).outerjoin(Load, Load.id == InvoiceLine.load_id)
                       .where(InvoiceLine.invoice_id == invoice_id)
                       .order_by(Load.load_number.nulls_last(), InvoiceLine.kind.desc(), InvoiceLine.id)).all()
    payments = db.execute(
        select(PaymentAllocation.amount, Payment).join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(PaymentAllocation.invoice_id == invoice_id).order_by(Payment.received_on, Payment.created_at)).all()
    issued_by = db.scalar(select(User.full_name).where(User.id == invoice.issued_by)) if invoice.issued_by else None

    # A draft shows the customer as they are now; an issued invoice shows them as they were when it was issued.
    snapshot = invoice.bill_to or {
        "name": customer.legal_name or customer.name, "address": customer.billing_address,
        "city": customer.billing_city, "state": customer.billing_state,
        "postal_code": customer.billing_postal_code, "email": customer.billing_email, "phone": customer.phone,
        "payment_terms_days": customer.payment_terms_days}
    terms = snapshot.get("payment_terms_days")
    paid = Decimal(row[2])
    actions: list[str] = []
    if p.can("invoices.create"):
        if invoice.status == "draft":
            actions += ["edit", "issue", "delete"]
        elif invoice.status == "issued" and paid == 0:
            actions.append("void")
    if invoice.status == "issued" and p.can("payments.record"):
        actions.append("record_payment")

    return s.InvoiceDetail(
        **_invoice_item(row, p.today()), notes=invoice.notes,
        seller=s.Party(name=org.legal_name or org.name, address=org.address, city=org.city, state=org.state,
                       postal_code=org.postal_code, email=org.email, phone=org.phone, dot_number=org.dot_number,
                       mc_number=org.mc_number),
        bill_to=s.Party(**{k: v for k, v in snapshot.items() if k in s.Party.model_fields}),
        payment_terms_days=terms,
        lines=[s.InvoiceLineOut(id=line.id, load_id=line.load_id, load_number=number, kind=line.kind,
                         description=line.description, quantity=line.quantity, unit_price=line.unit_price,
                         amount=line.amount) for line, number in lines],
        payments=[s.AppliedPayment(payment_id=pay.id, received_on=pay.received_on, method=pay.method,
                                   reference=pay.reference, amount=amount, status=pay.status)
                  for amount, pay in payments] if p.can("payments.read") else [],
        issued_at=invoice.issued_at, issued_by_name=issued_by, voided_at=invoice.voided_at,
        void_reason=invoice.void_reason, allowed_actions=actions)


@router.get("/invoices", response_model=Page[s.InvoiceListItem])
def list_invoices(params: Annotated[s.InvoiceListParams, Query()], p: Principal = Depends(require("invoices.read")),
                  db: Session = Depends(get_db)):
    today = p.today()
    stmt = _invoice_rows()
    if params.status:
        stmt = stmt.where(Invoice.status == params.status)
    if params.customer_id:
        stmt = stmt.where(Invoice.customer_id == params.customer_id)
    if params.overdue is not None:
        overdue = (Invoice.status == "issued") & (Invoice.due_date < today)
        stmt = stmt.where(overdue if params.overdue else ~overdue)
    if params.issued_from:
        stmt = stmt.where(Invoice.issue_date >= params.issued_from)
    if params.issued_to:
        stmt = stmt.where(Invoice.issue_date <= params.issued_to)
    if params.q:
        pattern = like(params.q.strip())
        stmt = stmt.where(or_(Invoice.invoice_number.ilike(pattern), Customer.name.ilike(pattern)))
    sortable = {"created_at": Invoice.created_at, "total": Invoice.total, "customer": Customer.name,
                "issue_date": func.coalesce(Invoice.issue_date, literal(FAR)),
                "due_date": func.coalesce(Invoice.due_date, literal(FAR))}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-created_at"), Invoice.id,
                          cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope([s.InvoiceListItem(**_invoice_item(r, today)) for r in rows], info)


@router.get("/invoices/{invoice_id}", response_model=s.InvoiceDetail)
def get_invoice(invoice_id: uuid.UUID, p: Principal = Depends(require("invoices.read")),
                db: Session = Depends(get_db)):
    return _invoice_detail(db, p, invoice_id)


# ---------------------------------------------------------------- invoices: changing
@router.post("/invoices", response_model=s.InvoiceDetail, status_code=201)
def create_invoice(body: s.InvoiceCreate, p: Principal = Depends(require("invoices.create")),
                   db: Session = Depends(get_db), idempotency_key: Annotated[str | None, Header()] = None):
    """Start a draft from completed loads. Nothing is final until the draft is issued."""
    def work():
        invoice = service.create_draft(db, p, body)
        return 201, _invoice_detail(db, p, invoice.id)
    return run_idempotent(db, p, idempotency_key, "POST /invoices", body.model_dump(mode="json"), work)


@router.patch("/invoices/{invoice_id}", response_model=s.InvoiceDetail)
def update_invoice(invoice_id: uuid.UUID, body: s.InvoicePatch, p: Principal = Depends(require("invoices.create")),
                   db: Session = Depends(get_db)):
    service.update_draft(db, p, invoice_id, body)
    db.commit()
    return _invoice_detail(db, p, invoice_id)


@router.put("/invoices/{invoice_id}/loads", response_model=s.InvoiceDetail)
def set_invoice_loads(invoice_id: uuid.UUID, body: s.InvoiceLoads, p: Principal = Depends(require("invoices.create")),
                      db: Session = Depends(get_db)):
    """Choose which loads a draft covers. Its lines are rebuilt from them."""
    service.set_loads(db, p, invoice_id, body.load_ids)
    db.commit()
    return _invoice_detail(db, p, invoice_id)


@router.post("/invoices/{invoice_id}/lines", response_model=s.InvoiceDetail, status_code=201)
def add_invoice_line(invoice_id: uuid.UUID, body: s.AdjustmentIn, p: Principal = Depends(require("invoices.create")),
                     db: Session = Depends(get_db)):
    service.add_adjustment(db, p, invoice_id, body)
    db.commit()
    return _invoice_detail(db, p, invoice_id)


@router.delete("/invoices/{invoice_id}/lines/{line_id}", response_model=s.InvoiceDetail)
def remove_invoice_line(invoice_id: uuid.UUID, line_id: uuid.UUID,
                        p: Principal = Depends(require("invoices.create")), db: Session = Depends(get_db)):
    service.remove_adjustment(db, p, invoice_id, line_id)
    db.commit()
    return _invoice_detail(db, p, invoice_id)


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: uuid.UUID, p: Principal = Depends(require("invoices.create")),
                   db: Session = Depends(get_db)):
    """Discard a draft. Its loads go back to being ready to invoice."""
    service.delete_draft(db, p, invoice_id)
    db.commit()


@router.post("/invoices/{invoice_id}/issue", response_model=s.InvoiceDetail)
def issue_invoice(invoice_id: uuid.UUID, p: Principal = Depends(require("invoices.create")),
                  db: Session = Depends(get_db), idempotency_key: Annotated[str | None, Header()] = None):
    """Number the invoice, fix its contents and start the clock on its due date. This can't be undone, only
    voided."""
    def work():
        service.issue(db, p, invoice_id)
        return 200, _invoice_detail(db, p, invoice_id)
    return run_idempotent(db, p, idempotency_key, f"POST /invoices/{invoice_id}/issue", {}, work)


@router.post("/invoices/{invoice_id}/void", response_model=s.InvoiceDetail)
def void_invoice(invoice_id: uuid.UUID, body: s.VoidIn, p: Principal = Depends(require("invoices.create")),
                 db: Session = Depends(get_db)):
    service.void(db, p, invoice_id, body.reason)
    db.commit()
    return _invoice_detail(db, p, invoice_id)


# ---------------------------------------------------------------- payments
def _applied():
    return (select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .where(PaymentAllocation.payment_id == Payment.id).correlate(Payment).scalar_subquery())


def _payment_rows():
    return select(Payment, Customer.name, _applied().label("applied")).join(Customer, Customer.id == Payment.customer_id)


def _payment_item(row) -> dict:
    payment, customer_name, applied = row
    live = payment.status == "recorded"
    applied = Decimal(applied) if live else ZERO
    return dict(
        id=payment.id, customer=Ref(id=payment.customer_id, name=customer_name), amount=payment.amount,
        applied=applied, unapplied=(payment.amount - applied) if live else ZERO, currency=payment.currency,
        received_on=payment.received_on, method=payment.method, reference=payment.reference,
        status=payment.status, created_at=payment.created_at)


def _payment_detail(db: Session, payment_id: uuid.UUID) -> s.PaymentDetail:
    row = db.execute(_payment_rows().where(Payment.id == payment_id)).first()
    if row is None:
        raise NotFound("Payment not found")
    payment: Payment = row[0]
    allocations = db.execute(
        select(PaymentAllocation, Invoice.invoice_number).join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
        .where(PaymentAllocation.payment_id == payment_id).order_by(PaymentAllocation.created_at)).all()
    recorded_by = db.scalar(select(User.full_name).where(User.id == payment.created_by)) if payment.created_by else None
    return s.PaymentDetail(
        **_payment_item(row), notes=payment.notes,
        allocations=[s.AllocationOut(invoice_id=a.invoice_id, invoice_number=number, amount=a.amount)
                     for a, number in allocations],
        reversed_at=payment.reversed_at, reversal_reason=payment.reversal_reason, recorded_by_name=recorded_by)


@router.get("/payments", response_model=Page[s.PaymentListItem])
def list_payments(params: Annotated[s.PaymentListParams, Query()], p: Principal = Depends(require("payments.read")),
                  db: Session = Depends(get_db)):
    stmt = _payment_rows()
    if params.status:
        stmt = stmt.where(Payment.status == params.status)
    if params.customer_id:
        stmt = stmt.where(Payment.customer_id == params.customer_id)
    if params.received_from:
        stmt = stmt.where(Payment.received_on >= params.received_from)
    if params.received_to:
        stmt = stmt.where(Payment.received_on <= params.received_to)
    if params.q:
        pattern = like(params.q.strip())
        stmt = stmt.where(or_(Payment.reference.ilike(pattern), Customer.name.ilike(pattern)))
    sortable = {"created_at": Payment.created_at, "received_on": Payment.received_on, "amount": Payment.amount,
                "customer": Customer.name}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-created_at"), Payment.id,
                          cursor=params.cursor, limit=params.limit, count=params.count)
    return envelope([s.PaymentListItem(**_payment_item(r)) for r in rows], info)


@router.get("/payments/{payment_id}", response_model=s.PaymentDetail)
def get_payment(payment_id: uuid.UUID, p: Principal = Depends(require("payments.read")),
                db: Session = Depends(get_db)):
    return _payment_detail(db, payment_id)


@router.post("/payments", response_model=s.PaymentDetail, status_code=201)
def record_payment(body: s.PaymentCreate, p: Principal = Depends(require("payments.record")),
                   db: Session = Depends(get_db), idempotency_key: Annotated[str | None, Header()] = None):
    """Record money received and, optionally, which invoices it pays. A retry with the same Idempotency-Key
    never records it twice."""
    def work():
        payment = service.record_payment(db, p, body)
        return 201, _payment_detail(db, payment.id)
    return run_idempotent(db, p, idempotency_key, "POST /payments", body.model_dump(mode="json"), work)


@router.post("/payments/{payment_id}/allocations", response_model=s.PaymentDetail)
def apply_payment(payment_id: uuid.UUID, body: s.AllocationsIn, p: Principal = Depends(require("payments.record")),
                  db: Session = Depends(get_db)):
    service.apply_payment(db, p, payment_id, body.allocations)
    db.commit()
    return _payment_detail(db, payment_id)


@router.post("/payments/{payment_id}/reverse", response_model=s.PaymentDetail)
def reverse_payment(payment_id: uuid.UUID, body: s.ReverseIn, p: Principal = Depends(require("payments.record")),
                    db: Session = Depends(get_db)):
    """Undo a payment recorded by mistake. The record stays; the invoices it paid are open again."""
    service.reverse_payment(db, p, payment_id, body.reason)
    db.commit()
    return _payment_detail(db, payment_id)


@router.get("/finance/receivables", response_model=s.Receivables)
def receivables(p: Principal = Depends(require("invoices.read")), db: Session = Depends(get_db)):
    return service.receivables(db, p)
