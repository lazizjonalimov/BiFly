"""Companies under one account (decision 0001): list, add (optionally copying setup), archive, restore.

Each company is a separate tenant. The account owner is the only person who can act across them, and does so
through explicitly scoped sessions: one bound to the source company to read, one bound to the new company to
write. Row-level security stays in force throughout.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.db import new_session
from app.core.deps import Principal, get_db, require_account_owner
from app.core.errors import Conflict, NotFound
from app.core.permissions import Role
from app.modules.customers.models import Customer, CustomerAddress, CustomerContact
from app.modules.drivers.models import Driver, DriverQualification
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.organizations import schemas as s
from app.modules.organizations.auth_router import make_slug
from app.modules.organizations.models import Account, AuditLog, Membership, Organization, Terminal

router = APIRouter(prefix="/account", tags=["account"])

_SKIP = {"id", "organization_id", "created_at", "updated_at"}


def _companies(db: Session, account_id: uuid.UUID) -> list[s.CompanyOut]:
    rows = db.execute(text("SELECT * FROM auth_account_companies(:a)"), {"a": account_id})
    return [s.CompanyOut(id=r.id, name=r.name, slug=r.slug, status=r.status, dot_number=r.dot_number,
                         mc_number=r.mc_number, created_at=r.created_at) for r in rows]


def _clone(obj, org_id: uuid.UUID, **overrides):
    """A copy of a record for another company: same values, new identity."""
    data = {a.key: getattr(obj, a.key) for a in sa_inspect(type(obj)).mapper.column_attrs if a.key not in _SKIP}
    data.update(overrides)
    return type(obj)(id=uuid.uuid4(), organization_id=org_id, **data)


def _lock_account(db: Session, account_id: uuid.UUID) -> Account:
    """Serialise company creation per account so two requests can't both slip under the limit."""
    return db.scalar(select(Account).where(Account.id == account_id).with_for_update())


def _check_limit(db: Session, account: Account) -> list[s.CompanyOut]:
    companies = _companies(db, account.id)
    active = sum(1 for c in companies if c.status == "active")
    if active >= account.max_companies:
        raise Conflict(
            f"Your account can have up to {account.max_companies} active companies. "
            "Archive one you no longer operate to add another.",
            code="COMPANY_LIMIT_REACHED", details={"max_companies": account.max_companies, "active": active})
    return companies


@router.get("/companies", response_model=s.CompaniesOut)
def list_companies(p: Principal = Depends(require_account_owner), db: Session = Depends(get_db)):
    account = db.get(Account, p.account_id)
    companies = _companies(db, account.id)
    return s.CompaniesOut(account_id=account.id, account_name=account.name, max_companies=account.max_companies,
                          active_count=sum(1 for c in companies if c.status == "active"), companies=companies)


@router.post("/companies", response_model=s.CompanyCreated, status_code=201)
def create_company(body: s.CompanyCreate, p: Principal = Depends(require_account_owner),
                   db: Session = Depends(get_db)):
    """Add a company to the account. With `copy_from`, the chosen parts of an existing company are copied so
    the new one is ready to operate at once. Loads and financial records are never copied."""
    current = db.get(Organization, p.org_id)
    existing = {c.id for c in _companies(db, p.account_id)}
    if body.copy_from and body.copy_from not in existing:
        raise NotFound("The company to copy from was not found in your account")

    # Read what is to be copied, in a session bound to the source company.
    source: dict[str, list] = {}
    if body.copy_from and body.include:
        src = new_session(org_id=body.copy_from, user_id=p.user_id)
        try:
            wanted = set(body.include)
            if "team" in wanted:
                source["team"] = list(src.scalars(select(Membership).where(
                    Membership.active.is_(True), Membership.user_id != p.user_id)))
            if "terminals" in wanted:
                source["terminals"] = list(src.scalars(select(Terminal)))
            if "customers" in wanted:
                source["customers"] = list(src.scalars(select(Customer)))
                source["contacts"] = list(src.scalars(select(CustomerContact)))
                source["addresses"] = list(src.scalars(select(CustomerAddress)))
            if "drivers" in wanted:
                source["drivers"] = list(src.scalars(select(Driver)))
                source["qualifications"] = list(src.scalars(select(DriverQualification)))
            if "vehicles" in wanted:
                source["vehicles"] = list(src.scalars(select(Vehicle)))
            if "trailers" in wanted:
                source["trailers"] = list(src.scalars(select(Trailer)))
            for rows in source.values():
                for row in rows:
                    src.expunge(row)
        finally:
            src.close()

    new_id = uuid.uuid4()
    slug = make_slug(body.name)
    dst = new_session(org_id=new_id, user_id=p.user_id)
    try:
        account = _lock_account(dst, p.account_id)
        _check_limit(dst, account)
        dst.add(Organization(
            id=new_id, account_id=account.id, name=body.name, legal_name=body.legal_name, slug=slug,
            dot_number=body.dot_number, mc_number=body.mc_number, timezone=body.timezone or current.timezone,
            base_currency=current.base_currency, default_payment_terms_days=current.default_payment_terms_days,
            load_number_prefix=current.load_number_prefix, invoice_number_prefix=current.invoice_number_prefix))
        dst.flush()
        dst.add(Membership(organization_id=new_id, user_id=p.user_id, role=Role.OWNER.value))

        copied: dict[str, int] = {}
        members = {m.user_id for m in source.get("team", [])}
        for m in source.get("team", []):
            dst.add(Membership(organization_id=new_id, user_id=m.user_id, role=m.role))
        if "team" in source:
            copied["team"] = len(members)
        dst.flush()

        terminal_ids: dict[uuid.UUID, uuid.UUID] = {}
        for t in source.get("terminals", []):
            clone = _clone(t, new_id)
            terminal_ids[t.id] = clone.id
            dst.add(clone)
        if "terminals" in source:
            copied["terminals"] = len(terminal_ids)
        dst.flush()

        def terminal(old: uuid.UUID | None) -> uuid.UUID | None:
            return terminal_ids.get(old) if old else None

        customer_ids: dict[uuid.UUID, uuid.UUID] = {}
        for c in source.get("customers", []):
            clone = _clone(c, new_id)
            customer_ids[c.id] = clone.id
            dst.add(clone)
        dst.flush()
        for child in [*source.get("contacts", []), *source.get("addresses", [])]:
            dst.add(_clone(child, new_id, customer_id=customer_ids[child.customer_id]))
        if "customers" in source:
            copied["customers"] = len(customer_ids)

        driver_ids: dict[uuid.UUID, uuid.UUID] = {}
        for d in source.get("drivers", []):
            # Keep the link to the driver's sign-in only if that person came across with the team.
            clone = _clone(d, new_id, terminal_id=terminal(d.terminal_id),
                           user_id=d.user_id if d.user_id in members else None)
            driver_ids[d.id] = clone.id
            dst.add(clone)
        dst.flush()
        for q in source.get("qualifications", []):
            dst.add(_clone(q, new_id, driver_id=driver_ids[q.driver_id]))
        if "drivers" in source:
            copied["drivers"] = len(driver_ids)

        for kind in ("vehicles", "trailers"):
            for unit in source.get(kind, []):
                dst.add(_clone(unit, new_id, terminal_id=terminal(unit.terminal_id)))
            if kind in source:
                copied[kind] = len(source[kind])

        dst.add(AuditLog(organization_id=new_id, actor_user_id=p.user_id, action="organization.created",
                         entity_type="organization", entity_id=new_id,
                         data={"name": body.name, "copied_from": str(body.copy_from) if body.copy_from else None,
                               "copied": copied}))
        dst.commit()
    finally:
        dst.close()

    return s.CompanyCreated(id=new_id, name=body.name, slug=slug, status="active", dot_number=body.dot_number,
                            mc_number=body.mc_number, created_at=datetime.now(UTC), copied=copied)


def _set_status(company_id: uuid.UUID, status: str, p: Principal, db: Session) -> s.CompanyOut:
    companies = {c.id: c for c in _companies(db, p.account_id)}
    company = companies.get(company_id)
    if company is None:
        raise NotFound("Company not found in your account")
    if company.status == status:
        return company
    if status == "archived" and sum(1 for c in companies.values() if c.status == "active") <= 1:
        raise Conflict("Keep at least one active company. Add or restore another before archiving this one.",
                       code="LAST_ACTIVE_COMPANY")

    target = new_session(org_id=company_id, user_id=p.user_id)
    try:
        if status == "active":
            _check_limit(target, _lock_account(target, p.account_id))
        org = target.get(Organization, company_id)
        org.status = status
        org.archived_at = datetime.now(UTC) if status == "archived" else None
        target.add(AuditLog(organization_id=company_id, actor_user_id=p.user_id,
                            action=f"organization.{'archived' if status == 'archived' else 'restored'}",
                            entity_type="organization", entity_id=company_id))
        target.commit()
    finally:
        target.close()
    return company.model_copy(update={"status": status})


@router.post("/companies/{company_id}/archive", response_model=s.CompanyOut)
def archive_company(company_id: uuid.UUID, p: Principal = Depends(require_account_owner),
                    db: Session = Depends(get_db)):
    """Stop operating a company. Its records stay readable; nothing in it can be changed until it is restored."""
    return _set_status(company_id, "archived", p, db)


@router.post("/companies/{company_id}/restore", response_model=s.CompanyOut)
def restore_company(company_id: uuid.UUID, p: Principal = Depends(require_account_owner),
                    db: Session = Depends(get_db)):
    return _set_status(company_id, "active", p, db)
