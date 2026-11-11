from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.core.deps import Principal, get_db, require
from app.modules.drivers.models import Driver
from app.modules.finance.models import Invoice, Payment
from app.modules.fleet.models import Trailer, Vehicle
from app.modules.loads.models import Load

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/operations")
def operations(p: Principal = Depends(require("reports:read")), db=Depends(get_db)):
    by_status = dict(db.execute(select(Load.status, func.count()).group_by(Load.status)).all())
    today = p.today()
    invoiced = Decimal(db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.status != "void")))
    open_total = Decimal(db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.status == "sent")))
    open_paid = Decimal(db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).join(Invoice, Invoice.id == Payment.invoice_id)
        .where(Invoice.status == "sent")))
    overdue = db.execute(select(func.count(), func.coalesce(func.sum(Invoice.total), 0))
                         .where(Invoice.status == "sent", Invoice.due_date < today)).one()
    return {
        "loads_by_status": by_status,
        "active_loads": sum(by_status.get(s, 0) for s in ("assigned", "dispatched", "in_transit")),
        "unassigned_loads": by_status.get("pending", 0),
        "awaiting_confirmation": by_status.get("delivered", 0),
        "ready_to_invoice": by_status.get("completed", 0),
        "invoiced_total": invoiced,
        "receivables_outstanding": open_total - open_paid,
        "overdue_invoices": {"count": overdue[0], "total": Decimal(overdue[1])},
    }


@router.get("/compliance")
def compliance(days: int = Query(30, ge=0, le=365), p: Principal = Depends(require("reports:read")),
               db=Depends(get_db)):
    """Credentials that are expired or expire within `days`."""
    today = p.today()
    horizon = today + timedelta(days=days)
    items: list[dict] = []

    def add(kind: str, label: str, entity_id, what: str, expiry: date | None) -> None:
        if expiry and expiry <= horizon:
            items.append({"entity": kind, "id": entity_id, "label": label, "credential": what,
                          "expires_on": expiry, "expired": expiry < today})

    drivers = select(Driver).where(Driver.status == "active",
                                   or_(Driver.cdl_expiry <= horizon, Driver.medical_cert_expiry <= horizon))
    for d in db.scalars(drivers):
        name = f"{d.first_name} {d.last_name}"
        add("driver", name, d.id, "CDL", d.cdl_expiry)
        add("driver", name, d.id, "Medical certificate", d.medical_cert_expiry)
    for model, kind in ((Vehicle, "vehicle"), (Trailer, "trailer")):
        units = select(model).where(model.status != "inactive",
                                    or_(model.insurance_expiry <= horizon, model.registration_expiry <= horizon))
        for v in db.scalars(units):
            add(kind, v.unit_number, v.id, "Insurance", v.insurance_expiry)
            add(kind, v.unit_number, v.id, "Registration", v.registration_expiry)
    items.sort(key=lambda x: x["expires_on"])
    return {"within_days": days, "items": items}
