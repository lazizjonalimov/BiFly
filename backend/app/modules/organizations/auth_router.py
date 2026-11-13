"""Sign-up, sign-in, the current session, switching company, and changing your password."""
import re
import secrets
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import new_session
from app.core.deps import Principal, get_db, get_principal
from app.core.errors import Conflict, Forbidden, Invalid, Unauthorized
from app.core.permissions import Role
from app.core.ratelimit import FailureLimiter
from app.core.security import create_token, hash_password, verify_password
from app.modules.organizations import schemas as s
from app.modules.organizations.models import Account, AuditLog, Membership, Organization, User

router = APIRouter(prefix="/auth", tags=["auth"])

_limiter = FailureLimiter()


def make_slug(name: str) -> str:
    """URL name for a company. The random tail keeps it unique without revealing which names are taken."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50] or "company"
    return f"{base}-{secrets.token_hex(2)}"


def user_organizations(db: Session, user_id: uuid.UUID) -> list[s.OrgRef]:
    rows = db.execute(text("SELECT * FROM auth_user_organizations(:u)"), {"u": user_id})
    return [s.OrgRef(id=r.organization_id, name=r.name, slug=r.slug, role=r.role, status=r.status) for r in rows]


def _remember(user_id: uuid.UUID, org_id: uuid.UUID) -> None:
    """Record the company the user is now working in, so the next sign-in returns there."""
    db = new_session(org_id=org_id, user_id=user_id)
    try:
        db.execute(update(User).where(User.id == user_id).values(last_organization_id=org_id))
        db.commit()
    finally:
        db.close()


@router.post("/signup", response_model=s.SessionOut, status_code=201)
def signup(body: s.SignupIn):
    """Create an account (the owner's profile) with its first company."""
    settings = get_settings()
    if not settings.signup_enabled:
        raise Forbidden("Self-service sign-up is turned off")
    org_id, account_id = uuid.uuid4(), uuid.uuid4()
    slug = make_slug(body.organization_name)
    db = new_session(org_id=org_id)  # the new company is the tenant context for its own creation
    try:
        if db.execute(text("SELECT 1 FROM auth_lookup_user(:e)"), {"e": body.email}).first():
            raise Conflict("An account with this email already exists", code="DUPLICATE_REFERENCE",
                           field_errors={"email": "An account with this email already exists"})
        user_id = db.execute(text("SELECT auth_create_user(:e, :n, :h)"),
                             {"e": body.email, "n": body.full_name, "h": hash_password(body.password)}).scalar_one()
        db.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": str(user_id)})
        db.add(Account(id=account_id, name=body.organization_name, owner_user_id=user_id,
                       max_companies=settings.max_companies_per_account))
        db.flush()
        db.add(Organization(id=org_id, account_id=account_id, name=body.organization_name, slug=slug,
                            dot_number=body.dot_number, mc_number=body.mc_number, timezone=body.timezone))
        db.flush()
        db.add(Membership(organization_id=org_id, user_id=user_id, role=Role.OWNER.value))
        db.add(AuditLog(organization_id=org_id, actor_user_id=user_id, action="organization.created",
                        entity_type="organization", entity_id=org_id, data={"name": body.organization_name}))
        db.execute(update(User).where(User.id == user_id).values(last_organization_id=org_id))
        db.commit()
    finally:
        db.close()
    org = s.OrgRef(id=org_id, name=body.organization_name, slug=slug, role=Role.OWNER.value, status="active")
    return s.SessionOut(access_token=create_token(user_id, org_id, 0), organization=org, organizations=[org])


@router.post("/login", response_model=s.SessionOut)
def login(body: s.LoginIn, request: Request):
    key = f"login|{request.client.host if request.client else '?'}|{body.email.lower()}"
    _limiter.check(key)

    # No company is known yet, so identity lookups go through SECURITY DEFINER functions.
    db = new_session()
    try:
        row = db.execute(text("SELECT * FROM auth_lookup_user(:e)"), {"e": body.email}).first()
        ok = verify_password(body.password, row.password_hash if row else None)
        if not (ok and row and row.active):
            _limiter.fail(key)
            raise Unauthorized("Invalid email or password")
        orgs = user_organizations(db, row.id)
    finally:
        db.close()
    _limiter.reset(key)

    if not orgs:
        raise Unauthorized("This account no longer has access to any company")
    wanted = body.organization_id or row.last_organization_id
    chosen = next((o for o in orgs if o.id == wanted), None)
    if body.organization_id and chosen is None:
        raise Unauthorized("You are not a member of that company")
    if chosen is None and len(orgs) == 1:
        chosen = orgs[0]
    if chosen is None:
        return s.SessionOut(requires_organization_selection=True, organizations=orgs)
    _remember(row.id, chosen.id)
    return s.SessionOut(access_token=create_token(row.id, chosen.id, row.token_version), organization=chosen,
                        organizations=orgs)


@router.post("/switch", response_model=s.SessionOut)
def switch_organization(body: s.SwitchIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Move this session to another company the user belongs to. Membership is re-verified here; the web
    app discards everything it cached for the previous company."""
    orgs = user_organizations(db, p.user_id)
    chosen = next((o for o in orgs if o.id == body.organization_id), None)
    if chosen is None:
        raise Forbidden("You are not a member of that company")
    version = db.get(User, p.user_id).token_version
    _remember(p.user_id, chosen.id)
    return s.SessionOut(access_token=create_token(p.user_id, chosen.id, version), organization=chosen,
                        organizations=orgs)


@router.get("/me", response_model=s.MeOut)
def me(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    account = db.get(Account, p.account_id)
    return s.MeOut(
        user=s.MeUser(id=p.user_id, email=p.email, full_name=p.full_name),
        organization=s.MeOrganization(id=p.org_id, name=p.org_name, slug=p.org_slug, role=p.role,
                                      status=p.org_status, timezone=p.timezone, base_currency=p.currency),
        account=s.MeAccount(id=account.id, name=account.name, is_owner=p.is_account_owner,
                            max_companies=account.max_companies),
        memberships=user_organizations(db, p.user_id),
        permissions=sorted(p.permissions),
    )


@router.post("/password", response_model=s.SessionOut)
def change_password(body: s.PasswordChangeIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Change your own password. Every token issued before the change stops working; a fresh one is returned."""
    key = f"password|{p.user_id}"
    _limiter.check(key)
    user = db.get(User, p.user_id)
    if not verify_password(body.current_password, user.password_hash):
        _limiter.fail(key)
        # 403 rather than 401: the session itself is still valid.
        raise Forbidden("That isn't your current password", code="WRONG_PASSWORD",
                        field_errors={"current_password": "That isn't your current password"})
    _limiter.reset(key)
    if body.new_password == body.current_password:
        raise Invalid("Choose a password different from the current one", field="new_password")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    audit(db, p, "user.password_changed", "user", p.user_id)
    db.commit()
    org = s.OrgRef(id=p.org_id, name=p.org_name, slug=p.org_slug, role=p.role, status=p.org_status)
    return s.SessionOut(access_token=create_token(p.user_id, p.org_id, user.token_version), organization=org)
