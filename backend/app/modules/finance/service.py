"""Invoices and payments.

draft -> issued -> paid, or void. A draft follows its loads; issuing takes a snapshot and fixes it for good
(the database refuses changes to an issued invoice, see migration 0002). Money received is recorded once and
never edited: a mistake is reversed, which reopens whatever it had paid.
"""
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal
from app.core.errors import Conflict, Invalid, NotFound
from app.core.money import ZERO, money
from app.modules.customers.models import Customer
from app.modules.finance import schemas as s
from app.modules.finance.models import Invoice, InvoiceLine, Payment, PaymentAllocation
from app.modules.loads.models import Load, LoadCharge
from app.modules.organizations.models import Organization

CHARGE_LABELS = {
    "detention": "Detention", "layover": "Layover", "lumper": "Lumper", "fuel_surcharge": "Fuel surcharge",
    "tarp": "Tarp", "extra_stop": "Extra stop", "tonu": "Truck ordered, not used", "other": "Other charge",
}


# ---------------------------------------------------------------- shared
def lock_invoice(db: Session, invoice_id: uuid.UUID) -> Invoice:
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update())
    if invoice is None:
        raise NotFound("Invoice not found")
    return invoice


def paid_amounts(db: Session, invoice_ids) -> dict[uuid.UUID, Decimal]:
    """What has been received against each invoice. Reversed payments don't count."""
    ids = list(invoice_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(PaymentAllocation.invoice_id, func.sum(PaymentAllocation.amount))
        .join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(PaymentAllocation.invoice_id.in_(ids), Payment.status == "recorded")
        .group_by(PaymentAllocation.invoice_id))
    return {invoice_id: Decimal(amount) for invoice_id, amount in rows}


def _loads_on(db: Session, invoice_id: uuid.UUID, *, lock: bool = False) -> list[Load]:
    stmt = select(Load).where(Load.invoice_id == invoice_id).order_by(Load.load_number)
    return list(db.scalars(stmt.with_for_update() if lock else stmt))


def _route(load: Load) -> str:
    ends = [", ".join(x for x in pair if x) for pair in ((load.origin_city, load.origin_state),
                                                         (load.destination_city, load.destination_state))]
    return " to ".join(e for e in ends if e)


def sync_draft(db: Session, invoice: Invoice | None) -> None:
    """Rebuild a draft's load lines from its loads as they are now. Adjustment lines are left alone."""
    if invoice is None or invoice.status != "draft":
        return
    db.execute(delete(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id, InvoiceLine.kind != "adjustment"))
    loads = _loads_on(db, invoice.id)
    charges: dict[uuid.UUID, list[LoadCharge]] = {}
    if loads:
        for c in db.scalars(select(LoadCharge).where(LoadCharge.load_id.in_([x.id for x in loads]),
                                                     LoadCharge.billable.is_(True)).order_by(LoadCharge.created_at)):
            charges.setdefault(c.load_id, []).append(c)
    for load in loads:
        detail = " · ".join(x for x in (_route(load), f"Ref {load.reference}" if load.reference else "") if x)
        db.add(InvoiceLine(
            organization_id=invoice.organization_id, invoice_id=invoice.id, load_id=load.id, kind="line_haul",
            description=f"Load {load.load_number}" + (f": {detail}" if detail else ""), quantity=Decimal("1"),
            unit_price=load.customer_rate, amount=load.customer_rate))
        for c in charges.get(load.id, []):
            label = CHARGE_LABELS.get(c.type, "Charge")
            db.add(InvoiceLine(
                organization_id=invoice.organization_id, invoice_id=invoice.id, load_id=load.id,
                kind="accessorial", description=f"{label}: {c.description}" if c.description else label,
                quantity=c.quantity, unit_price=c.rate, amount=c.amount))
    db.flush()
    invoice.total = Decimal(db.scalar(select(func.coalesce(func.sum(InvoiceLine.amount), 0))
                                      .where(InvoiceLine.invoice_id == invoice.id)))
    if invoice.total < 0:
        raise Invalid("An invoice can't have a negative total")
    db.flush()


def _billable_loads(db: Session, customer_id: uuid.UUID, load_ids: list[uuid.UUID],
                    invoice_id: uuid.UUID | None = None) -> list[Load]:
    """Lock and check the loads about to go on an invoice."""
    ids = list(dict.fromkeys(load_ids))
    loads = list(db.scalars(select(Load).where(Load.id.in_(ids)).order_by(Load.id).with_for_update())) if ids else []
    if len(loads) != len(ids):
        raise Invalid("One of the loads could not be found", field="load_ids")
    for load in loads:
        if load.customer_id != customer_id:
            raise Invalid(f"Load {load.load_number} belongs to a different customer", field="load_ids")
        if load.status != "completed":
            raise Conflict(f"Load {load.load_number} isn't completed yet. A load can be invoiced once its proof "
                           "of delivery has been approved.", code="LOAD_NOT_BILLABLE",
                           details={"load_id": str(load.id)})
        if load.billing_status != "unbilled" or (load.invoice_id and load.invoice_id != invoice_id):
            raise Conflict(f"Load {load.load_number} is already on an invoice", code="LOAD_ALREADY_INVOICED",
                           details={"load_id": str(load.id)})
    if len({x.currency for x in loads}) > 1:
        raise Invalid("All loads on one invoice must be in the same currency", field="load_ids")
    return loads


def _draft(db: Session, invoice_id: uuid.UUID) -> Invoice:
    invoice = lock_invoice(db, invoice_id)
    if invoice.status != "draft":
        raise Conflict("This invoice has been issued and can no longer be changed. Void it and create a new "
                       "one to correct it.", code="INVOICE_NOT_DRAFT")
    return invoice


# ---------------------------------------------------------------- invoices
def create_draft(db: Session, p: Principal, body: s.InvoiceCreate) -> Invoice:
    if db.get(Customer, body.customer_id) is None:
        raise Invalid("Customer not found", field="customer_id")
    loads = _billable_loads(db, body.customer_id, body.load_ids)
    invoice = Invoice(organization_id=p.org_id, customer_id=body.customer_id,
                      currency=loads[0].currency if loads else p.currency, notes=body.notes,
                      due_date=body.due_date, created_by=p.user_id)
    db.add(invoice)
    db.flush()
    for load in loads:
        load.invoice_id = invoice.id
        load.version += 1
    db.flush()
    sync_draft(db, invoice)
    audit(db, p, "invoice.created", "invoice", invoice.id,
          {"customer_id": str(body.customer_id), "loads": [x.load_number for x in loads]})
    return invoice


def update_draft(db: Session, p: Principal, invoice_id: uuid.UUID, body: s.InvoicePatch) -> Invoice:
    invoice = _draft(db, invoice_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(invoice, k, v)
    audit(db, p, "invoice.updated", "invoice", invoice.id, body.model_dump(mode="json", exclude_unset=True))
    return invoice


def set_loads(db: Session, p: Principal, invoice_id: uuid.UUID, load_ids: list[uuid.UUID]) -> Invoice:
    invoice = _draft(db, invoice_id)
    wanted = _billable_loads(db, invoice.customer_id, load_ids, invoice.id)
    keep = {x.id for x in wanted}
    for load in _loads_on(db, invoice.id, lock=True):
        if load.id not in keep:
            load.invoice_id = None
            load.version += 1
    for load in wanted:
        if load.invoice_id != invoice.id:
            load.invoice_id = invoice.id
            load.version += 1
    if wanted:
        invoice.currency = wanted[0].currency
    db.flush()
    sync_draft(db, invoice)
    audit(db, p, "invoice.loads_changed", "invoice", invoice.id, {"loads": [x.load_number for x in wanted]})
    return invoice


def add_adjustment(db: Session, p: Principal, invoice_id: uuid.UUID, body: s.AdjustmentIn) -> Invoice:
    invoice = _draft(db, invoice_id)
    db.add(InvoiceLine(organization_id=p.org_id, invoice_id=invoice.id, kind="adjustment",
                       description=body.description.strip(), quantity=body.quantity, unit_price=body.unit_price,
                       amount=money(body.quantity * body.unit_price)))
    db.flush()
    sync_draft(db, invoice)
    audit(db, p, "invoice.line_added", "invoice", invoice.id, body.model_dump(mode="json"))
    return invoice


def remove_adjustment(db: Session, p: Principal, invoice_id: uuid.UUID, line_id: uuid.UUID) -> Invoice:
    invoice = _draft(db, invoice_id)
    line = db.get(InvoiceLine, line_id)
    if line is None or line.invoice_id != invoice.id:
        raise NotFound("Line not found")
    if line.kind != "adjustment":
        raise Conflict("This line comes from a load. Change the load, or take the load off the invoice.")
    db.delete(line)
    db.flush()
    sync_draft(db, invoice)
    audit(db, p, "invoice.line_removed", "invoice", invoice.id, {"description": line.description})
    return invoice


def delete_draft(db: Session, p: Principal, invoice_id: uuid.UUID) -> None:
    invoice = _draft(db, invoice_id)
    for load in _loads_on(db, invoice.id, lock=True):
        load.invoice_id = None
        load.version += 1
    db.flush()
    db.delete(invoice)
    audit(db, p, "invoice.deleted", "invoice", invoice_id)


def issue(db: Session, p: Principal, invoice_id: uuid.UUID) -> Invoice:
    invoice = lock_invoice(db, invoice_id)
    if invoice.status != "draft":
        raise Conflict("This invoice has already been issued", code="INVOICE_NOT_DRAFT")
    loads = _loads_on(db, invoice.id, lock=True)
    sync_draft(db, invoice)  # the last look at the loads before the invoice is fixed
    if not db.scalar(select(func.count()).select_from(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id)):
        raise Conflict("Add at least one load or line before issuing", code="INVOICE_EMPTY")
    if invoice.total <= 0:
        raise Conflict("An invoice needs a total above zero", code="INVOICE_EMPTY")

    customer = db.get(Customer, invoice.customer_id)
    today = p.today()
    if invoice.due_date and invoice.due_date < today:
        raise Invalid("The due date can't be in the past", field="due_date")
    # Numbers are handed out only here, under the company's row lock, so issued invoices are gapless.
    seq, prefix = db.execute(
        update(Organization).where(Organization.id == p.org_id).values(invoice_seq=Organization.invoice_seq + 1)
        .returning(Organization.invoice_seq, Organization.invoice_number_prefix)).one()
    invoice.invoice_number = f"{prefix}-{1000 + seq}"
    invoice.issue_date = today
    invoice.due_date = invoice.due_date or today + timedelta(days=customer.payment_terms_days)
    invoice.bill_to = {
        "name": customer.legal_name or customer.name, "address": customer.billing_address,
        "city": customer.billing_city, "state": customer.billing_state,
        "postal_code": customer.billing_postal_code, "email": customer.billing_email, "phone": customer.phone,
        "payment_terms_days": customer.payment_terms_days,
    }
    invoice.issued_by, invoice.issued_at = p.user_id, datetime.now(UTC)
    invoice.status = "issued"
    for load in loads:
        load.billing_status = "invoiced"
        load.version += 1
    db.flush()
    audit(db, p, "invoice.issued", "invoice", invoice.id,
          {"invoice_number": invoice.invoice_number, "total": str(invoice.total), "due_date": str(invoice.due_date)})
    return invoice


def void(db: Session, p: Principal, invoice_id: uuid.UUID, reason: str) -> Invoice:
    invoice = lock_invoice(db, invoice_id)
    if invoice.status == "void":
        return invoice
    if invoice.status == "draft":
        raise Conflict("A draft hasn't been issued, so there is nothing to void. Delete it instead.",
                       code="INVOICE_NOT_ISSUED")
    if paid_amounts(db, [invoice.id]).get(invoice.id, ZERO) > 0:
        raise Conflict("Payments have been applied to this invoice. Reverse them before voiding it.",
                       code="INVOICE_HAS_PAYMENTS")
    invoice.status, invoice.voided_at, invoice.void_reason = "void", datetime.now(UTC), reason.strip()
    for load in _loads_on(db, invoice.id, lock=True):  # free the loads to be invoiced again
        load.billing_status, load.invoice_id = "unbilled", None
        load.version += 1
    db.flush()
    audit(db, p, "invoice.voided", "invoice", invoice.id,
          {"invoice_number": invoice.invoice_number, "reason": invoice.void_reason})
    return invoice


# ---------------------------------------------------------------- payments
def _settle(db: Session, invoices: list[Invoice]) -> None:
    """Bring each invoice's status, and its loads' billing status, in line with what has been paid."""
    db.flush()
    paid = paid_amounts(db, [i.id for i in invoices])
    for invoice in invoices:
        target = "paid" if paid.get(invoice.id, ZERO) >= invoice.total else "issued"
        if invoice.status in ("issued", "paid") and invoice.status != target:
            invoice.status = target
            for load in _loads_on(db, invoice.id, lock=True):
                load.billing_status = "paid" if target == "paid" else "invoiced"
                load.version += 1


def _allocate(db: Session, payment: Payment, allocations: list[s.AllocationIn], prefix: str = "allocations") -> None:
    ids = [a.invoice_id for a in allocations]
    if len(set(ids)) != len(ids):
        raise Invalid("Each invoice can appear only once", field=prefix)
    invoices = {i.id: i for i in db.scalars(
        select(Invoice).where(Invoice.id.in_(ids)).order_by(Invoice.id).with_for_update())} if ids else {}
    already = Decimal(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
                                .where(PaymentAllocation.payment_id == payment.id)))
    if already + sum((a.amount for a in allocations), ZERO) > payment.amount:
        raise Invalid("The amounts applied add up to more than the payment", field=prefix)
    paid = paid_amounts(db, ids)
    for i, a in enumerate(allocations):
        invoice = invoices.get(a.invoice_id)
        if invoice is None or invoice.customer_id != payment.customer_id:
            raise Invalid("Invoice not found for this customer", field=f"{prefix}.{i}.invoice_id")
        if invoice.status != "issued":
            raise Conflict(f"Invoice {invoice.invoice_number or '(draft)'} is {invoice.status} and can't take a "
                           "payment", code="INVOICE_NOT_OPEN", details={"invoice_id": str(invoice.id)})
        if invoice.currency != payment.currency:
            raise Invalid("The invoice is in a different currency", field=f"{prefix}.{i}.invoice_id")
        balance = invoice.total - paid.get(invoice.id, ZERO)
        if a.amount > balance:
            raise Invalid(f"Only {money(balance)} is still owed on invoice {invoice.invoice_number}",
                          field=f"{prefix}.{i}.amount")
        db.add(PaymentAllocation(organization_id=payment.organization_id, payment_id=payment.id,
                                 invoice_id=invoice.id, amount=a.amount))
    _settle(db, list(invoices.values()))


def record_payment(db: Session, p: Principal, body: s.PaymentCreate) -> Payment:
    if db.get(Customer, body.customer_id) is None:
        raise Invalid("Customer not found", field="customer_id")
    if body.received_on > p.today():
        raise Invalid("The date received can't be in the future", field="received_on")
    payment = Payment(organization_id=p.org_id, customer_id=body.customer_id, amount=body.amount,
                      currency=p.currency, received_on=body.received_on, method=body.method,
                      reference=body.reference, notes=body.notes, created_by=p.user_id)
    db.add(payment)
    db.flush()
    _allocate(db, payment, body.allocations)
    audit(db, p, "payment.recorded", "payment", payment.id,
          {"customer_id": str(body.customer_id), "amount": str(body.amount),
           "allocations": [{"invoice_id": str(a.invoice_id), "amount": str(a.amount)} for a in body.allocations]})
    return payment


def lock_payment(db: Session, payment_id: uuid.UUID) -> Payment:
    payment = db.scalar(select(Payment).where(Payment.id == payment_id).with_for_update())
    if payment is None:
        raise NotFound("Payment not found")
    return payment


def apply_payment(db: Session, p: Principal, payment_id: uuid.UUID, allocations: list[s.AllocationIn]) -> Payment:
    """Apply money that was received but not yet matched to invoices."""
    payment = lock_payment(db, payment_id)
    if payment.status != "recorded":
        raise Conflict("This payment has been reversed", code="PAYMENT_REVERSED")
    _allocate(db, payment, allocations)
    audit(db, p, "payment.applied", "payment", payment.id,
          {"allocations": [{"invoice_id": str(a.invoice_id), "amount": str(a.amount)} for a in allocations]})
    return payment


def reverse_payment(db: Session, p: Principal, payment_id: uuid.UUID, reason: str) -> Payment:
    payment = lock_payment(db, payment_id)
    if payment.status == "reversed":
        return payment
    payment.status, payment.reversed_at, payment.reversal_reason = "reversed", datetime.now(UTC), reason.strip()
    db.flush()
    ids = list(db.scalars(select(PaymentAllocation.invoice_id).where(PaymentAllocation.payment_id == payment.id)))
    invoices = list(db.scalars(select(Invoice).where(Invoice.id.in_(ids)).order_by(Invoice.id)
                               .with_for_update())) if ids else []
    _settle(db, invoices)  # anything this payment had paid off is open again
    audit(db, p, "payment.reversed", "payment", payment.id,
          {"amount": str(payment.amount), "reason": payment.reversal_reason})
    return payment


# ---------------------------------------------------------------- figures
def receivables(db: Session, p: Principal) -> s.Receivables:
    today: date = p.today()
    paid = (select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .join(Payment, Payment.id == PaymentAllocation.payment_id)
            .where(PaymentAllocation.invoice_id == Invoice.id, Payment.status == "recorded")
            .correlate(Invoice).scalar_subquery())
    balance = Invoice.total - paid
    overdue = Invoice.due_date < today
    row = db.execute(select(
        func.coalesce(func.sum(balance).filter(Invoice.status == "issued"), 0),
        func.coalesce(func.sum(balance).filter(Invoice.status == "issued", overdue), 0),
        func.count().filter(Invoice.status == "issued"),
        func.count().filter(Invoice.status == "issued", overdue),
        func.count().filter(Invoice.status == "draft")).select_from(Invoice)).one()
    ready = db.execute(select(func.count(), func.coalesce(func.sum(Load.customer_rate + Load.charges_total), 0))
                       .where(Load.status == "completed", Load.billing_status == "unbilled",
                              Load.invoice_id.is_(None))).one()
    return s.Receivables(currency=p.currency, open_balance=row[0], overdue_balance=row[1], open_invoices=row[2],
                         overdue_invoices=row[3], draft_invoices=row[4], ready_to_invoice_loads=ready[0],
                         ready_to_invoice_amount=ready[1])
