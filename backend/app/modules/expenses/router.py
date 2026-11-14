"""Expenses, fuel included: what the company spent, on what, and what it means for drivers' pay."""
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.crud import like
from app.core.deps import Principal, get_db, require
from app.core.idempotency import run_idempotent
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.modules.expenses import schemas as s
from app.modules.expenses import service
from app.modules.expenses.models import Expense

router = APIRouter(prefix="/expenses", tags=["expenses"])
READ = require("expenses.read")
MANAGE = require("expenses.manage")


@router.get("/summary", response_model=s.ExpenseSummary)
def get_summary(date_from: date | None = None, date_to: date | None = None, p: Principal = Depends(READ),
                db: Session = Depends(get_db)):
    """Spending by category in a date range (default: this month so far), and what is owed to or by drivers."""
    return service.summary(db, p, date_from, date_to)


@router.get("/fuel-summary", response_model=s.FuelSummary)
def get_fuel_summary(date_from: date | None = None, date_to: date | None = None, p: Principal = Depends(READ),
                     db: Session = Depends(get_db)):
    """Fuel by state (for fuel-tax returns) and by truck, with miles per gallon from the loads each truck delivered."""
    return service.fuel_summary(db, p, date_from, date_to)


@router.get("", response_model=Page[s.ExpenseOut])
def list_expenses(params: Annotated[s.ExpenseListParams, Query()], p: Principal = Depends(READ), db: Session = Depends(get_db)):
    stmt = select(Expense)
    for field in ("category", "driver_id", "vehicle_id", "trailer_id", "load_id", "driver_treatment"):
        value = getattr(params, field)
        if value is not None:
            stmt = stmt.where(getattr(Expense, field) == value)
    if params.incurred_from:
        stmt = stmt.where(Expense.incurred_on >= params.incurred_from)
    if params.incurred_to:
        stmt = stmt.where(Expense.incurred_on <= params.incurred_to)
    if params.q and params.q.strip():
        pattern = like(params.q.strip())
        stmt = stmt.where(or_(Expense.vendor.ilike(pattern), Expense.description.ilike(pattern),
                              Expense.reference.ilike(pattern)))
    sortable = {"incurred_on": Expense.incurred_on, "amount": Expense.amount, "created_at": Expense.created_at}
    rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, "-incurred_on"), Expense.id, cursor=params.cursor,
                          limit=params.limit, count=params.count)
    return envelope(service.present(db, p, rows), info)


@router.post("", response_model=s.ExpenseOut, status_code=201)
def create_expense(body: s.ExpenseCreate, p: Principal = Depends(MANAGE), db: Session = Depends(get_db),
                   idempotency_key: Annotated[str | None, Header()] = None):
    """Record an expense. A reimbursement or deduction lands on the driver's open draft settlement, if there is one."""
    def work():
        expense = service.create(db, p, body)
        db.flush()
        return 201, service.get(db, p, expense.id)
    return run_idempotent(db, p, idempotency_key, "POST /expenses", body.model_dump(mode="json"), work)


@router.get("/{expense_id}", response_model=s.ExpenseOut)
def get_expense(expense_id: uuid.UUID, p: Principal = Depends(READ), db: Session = Depends(get_db)):
    return service.get(db, p, expense_id)


@router.patch("/{expense_id}", response_model=s.ExpenseOut)
def update_expense(expense_id: uuid.UUID, body: s.ExpenseUpdate, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    service.update(db, p, expense_id, body)
    db.commit()
    return service.get(db, p, expense_id)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(expense_id: uuid.UUID, p: Principal = Depends(MANAGE), db: Session = Depends(get_db)):
    service.delete(db, p, expense_id)
    db.commit()
