import re
import time
import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, text

from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import new_session
from app.core.deps import Principal, get_db, get_principal, require
from app.core.errors import AppError, Conflict, Forbidden, NotFound, Unauthorized
from app.core.pagination import paginate
from app.core.permissions import ROLE_PERMISSIONS, Role
from app.core.security import create_token, hash_password, verify_password
from app.modules.organizations import schemas as s
from app.modules.organizations.models import AuditLog, Membership, Organization, User

auth_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(tags=["organization"])

# Simple per-process brute-force guard; the WAF/rate limiter is the real control in production.
_FAILS: dict[str, tuple[int, float]] = {}
_MAX_FAILS, _WINDOW = 10, 15 * 60


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "org"
    return f"{base}-{uuid.uuid4().hex[:6]}"


@auth_router.post("/signup", response_model=s.TokenOut, status_code=201)
def signup(body: s.SignupIn):
    """Create a new tenant organization with its first (owner) user."""
    if not get_settings().signup_enabled:
        raise Forbidden("Self-service signup is disabled")
    org_id = uuid.uuid4()
    db = new_session(org_id=org_id)
    try:
        existing = db.execute(text("SELECT 1 FROM auth_lookup_user(:e)"), {"e": body.email}).first()
        if existing:
            raise Conflict("An account with this email already exists")
        db.add(Organization(id=org_id, name=body.organization_name, slug=_slugify(body.organization_name),
                            dot_number=body.dot_number, mc_number=body.mc_number))
        db.flush()
        user_id = db.execute(text("SELECT auth_create_user(:e, :n, :h)"),
                             {"e": body.email, "n": body.full_name, "h": hash_password(body.password)}).scalar_one()
        db.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": str(user_id)})
        db.add(Membership(organization_id=org_id, user_id=user_id, role=Role.OWNER.value))
        db.add(AuditLog(organization_id=org_id, actor_user_id=user_id, action="organization.created",
                        entity_type="organization", entity_id=org_id, data={"name": body.organization_name}))
        db.commit()
    finally:
        db.close()
    return s.TokenOut(access_token=create_token(user_id, org_id),
                      organization=s.OrgChoice(id=org_id, name=body.organization_name, role=Role.OWNER.value))


@auth_router.post("/login", response_model=s.TokenOut)
def login(body: s.LoginIn, request: Request):
    key = f"{request.client.host if request.client else '?'}|{body.email.lower()}"
    n, until = _FAILS.get(key, (0, 0.0))
    if n >= _MAX_FAILS and until > time.time():
        raise AppError("Too many failed attempts. Try again later.", status=429, code="rate_limited")

    db = new_session()
    try:
        row = db.execute(text("SELECT * FROM auth_lookup_user(:e)"), {"e": body.email}).first()
    finally:
        db.close()
    ok = verify_password(body.password, row.password_hash if row else None)
    if not (ok and row and row.active):
        _FAILS[key] = ((n + 1) if until > time.time() else 1, time.time() + _WINDOW)
        raise Unauthorized("Invalid email or password")
    _FAILS.pop(key, None)

    db = new_session(user_id=row.id)
    try:
        orgs = [s.OrgChoice(id=o.id, name=o.name, role=o.role) for o in db.execute(
            select(Organization.id, Organization.name, Membership.role)
            .join(Membership, Membership.organization_id == Organization.id)
            .where(Membership.user_id == row.id, Membership.active.is_(True))
            .order_by(Organization.name)).all()]
    finally:
        db.close()
    if not orgs:
        raise Unauthorized("This account has no active organization")
    if body.organization_id:
        orgs = [o for o in orgs if o.id == body.organization_id]
        if not orgs:
            raise Unauthorized("You are not a member of that organization")
    if len(orgs) > 1:
        return s.TokenOut(requires_organization_selection=True, organizations=orgs)
    return s.TokenOut(access_token=create_token(row.id, orgs[0].id), organization=orgs[0])


@auth_router.get("/me", response_model=s.MeOut)
def me(p: Principal = Depends(get_principal), db=Depends(get_db)):
    org = db.get(Organization, p.org_id)
    return s.MeOut(user_id=p.user_id, email=p.email, full_name=p.full_name, role=p.role,
                   organization_id=p.org_id, organization_name=org.name,
                   permissions=sorted(ROLE_PERMISSIONS[Role(p.role)]))


@router.get("/organization", response_model=s.OrganizationOut)
def get_org(p: Principal = Depends(get_principal), db=Depends(get_db)):
    return db.get(Organization, p.org_id)


@router.patch("/organization", response_model=s.OrganizationOut)
def patch_org(body: s.OrganizationPatch, p: Principal = Depends(require("org:manage")), db=Depends(get_db)):
    org = db.get(Organization, p.org_id)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(org, k, v)
    audit(db, p, "organization.updated", "organization", org.id, changes)
    db.commit()
    return org


def _member_out(m, u) -> s.MemberOut:
    return s.MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role, active=m.active)


@router.get("/users", response_model=list[s.MemberOut])
def list_users(p: Principal = Depends(require("users:manage")), db=Depends(get_db)):
    rows = db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                      .order_by(User.full_name)).all()
    return [_member_out(m, u) for m, u in rows]


def _check_role_grant(p: Principal, role: Role) -> None:
    if role in (Role.OWNER,) and p.role != Role.OWNER.value:
        raise Forbidden("Only an owner can grant the owner role")


@router.post("/users", response_model=s.MemberOut, status_code=201)
def create_user(body: s.UserCreate, p: Principal = Depends(require("users:manage")), db=Depends(get_db)):
    _check_role_grant(p, body.role)
    if db.execute(text("SELECT 1 FROM auth_lookup_user(:e)"), {"e": body.email}).first():
        raise Conflict("A user with this email already exists")
    uid = db.execute(text("SELECT auth_create_user(:e, :n, :h)"),
                     {"e": body.email, "n": body.full_name, "h": hash_password(body.password)}).scalar_one()
    m = Membership(organization_id=p.org_id, user_id=uid, role=body.role.value)
    db.add(m)
    audit(db, p, "user.created", "user", uid, {"role": body.role.value, "email": body.email.lower()})
    db.commit()
    return s.MemberOut(user_id=uid, email=body.email.lower(), full_name=body.full_name, role=m.role, active=True)


@router.patch("/users/{user_id}", response_model=s.MemberOut)
def patch_member(user_id: uuid.UUID, body: s.MemberPatch, p: Principal = Depends(require("users:manage")),
                 db=Depends(get_db)):
    m = db.scalar(select(Membership).where(Membership.user_id == user_id).with_for_update())
    if m is None:
        raise NotFound("User not found")
    u = db.get(User, user_id)
    if body.role:
        _check_role_grant(p, body.role)
        if m.role == Role.OWNER.value and p.role != Role.OWNER.value:
            raise Forbidden("Only an owner can change an owner's role")
    demoting = (body.role and body.role != Role.OWNER) or body.active is False
    if m.role == Role.OWNER.value and m.active and demoting:
        owners = db.scalar(select(func.count()).select_from(Membership)
                           .where(Membership.role == "owner", Membership.active.is_(True)))
        if owners <= 1:
            raise Conflict("An organization must keep at least one active owner")
    if body.role:
        m.role = body.role.value
    if body.active is not None:
        m.active = body.active
    audit(db, p, "user.updated", "user", user_id, body.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return _member_out(m, u)


@router.get("/audit-logs")
def audit_logs(cursor: str | None = None, limit: int = Query(50, ge=1, le=200),
               entity_type: str | None = None, p: Principal = Depends(require("audit:read")), db=Depends(get_db)):
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    rows, nxt = paginate(db, stmt, AuditLog, cursor, limit)
    return {"items": [s.AuditOut.model_validate(r) for r in rows], "next_cursor": nxt}


__all__ = ["router", "auth_router", "AppError"]
