"""Company administration: settings, team, roles, terminals, preferences, saved views, audit log."""
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.crud import like, resource_router
from app.core.deps import Principal, get_db, get_principal, require
from app.core.errors import Conflict, Forbidden, Invalid, NotFound
from app.core.pagination import Page, envelope, paginate, parse_sort
from app.core.permissions import ASSIGNABLE, PERMISSION_GROUPS, ROLE_LABELS, ROLE_PERMISSIONS, Role
from app.core.security import hash_password
from app.modules.organizations import schemas as s
from app.modules.organizations.models import (
    AuditLog,
    Membership,
    Organization,
    SavedView,
    Terminal,
    User,
    UserPreference,
)

router = APIRouter()

# ---------------------------------------------------------------- company settings
settings_router = APIRouter(tags=["organization"])


@settings_router.get("/organization", response_model=s.OrganizationOut)
def get_organization(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return db.get(Organization, p.org_id)


@settings_router.patch("/organization", response_model=s.OrganizationOut)
def update_organization(body: s.OrganizationPatch, p: Principal = Depends(require("organization.manage")),
                        db: Session = Depends(get_db)):
    org = db.get(Organization, p.org_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("name", "timezone", "default_payment_terms_days", "load_number_prefix", "invoice_number_prefix"):
        if required in changes and changes[required] is None:
            raise Invalid("This field can't be empty", field=required)
    for k, v in changes.items():
        setattr(org, k, v)
    audit(db, p, "organization.updated", "organization", org.id, body.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return org


# ---------------------------------------------------------------- team
team_router = APIRouter(tags=["team"])


def _member_out(m: Membership, u: User) -> s.MemberOut:
    return s.MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role, active=m.active)


def _check_grant(p: Principal, role: Role) -> None:
    if role is Role.CUSTOMER:
        raise Forbidden("Customer access is granted through the customer portal, not the team screen")
    if role is Role.OWNER and p.role != Role.OWNER.value:
        raise Forbidden("Only an owner can grant the owner role")


@team_router.get("/members", response_model=list[s.MemberOut])
def list_members(p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    rows = db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                      .where(Membership.organization_id == p.org_id).order_by(User.full_name)).all()
    return [_member_out(m, u) for m, u in rows]


@team_router.post("/members", response_model=s.MemberOut, status_code=201)
def add_member(body: s.MemberCreate, p: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)):
    _check_grant(p, body.role)
    existing = db.execute(text("SELECT id, full_name FROM auth_lookup_user(:e)"), {"e": body.email}).first()
    if existing:
        # A person with a BiFly sign-in already. They keep their own password; only access is added.
        if db.scalar(select(Membership.id).where(Membership.user_id == existing.id,
                                                 Membership.organization_id == p.org_id)):
            raise Conflict("This person is already on the team", code="DUPLICATE_REFERENCE",
                           field_errors={"email": "This person is already on the team"})
        uid, name = existing.id, existing.full_name
    else:
        if not body.password:
            raise Invalid("Set a temporary password for a new sign-in", field="password")
        uid = db.execute(text("SELECT auth_create_user(:e, :n, :h)"),
                         {"e": body.email, "n": body.full_name, "h": hash_password(body.password)}).scalar_one()
        name = body.full_name
    m = Membership(organization_id=p.org_id, user_id=uid, role=body.role.value)
    db.add(m)
    audit(db, p, "member.added", "user", uid, {"role": body.role.value, "email": body.email.lower(),
                                                "existing_account": existing is not None})
    db.commit()
    return s.MemberOut(user_id=uid, email=body.email.lower(), full_name=name, role=m.role, active=True)


@team_router.patch("/members/{user_id}", response_model=s.MemberOut)
def update_member(user_id: uuid.UUID, body: s.MemberPatch, p: Principal = Depends(require("users.manage")),
                  db: Session = Depends(get_db)):
    m = db.scalar(select(Membership).where(Membership.user_id == user_id, Membership.organization_id == p.org_id)
                  .with_for_update())
    if m is None:
        raise NotFound("Team member not found")
    u = db.get(User, user_id)
    is_owner_row = m.role == Role.OWNER.value
    if body.role:
        _check_grant(p, body.role)
    if is_owner_row and p.role != Role.OWNER.value and (body.role or body.active is False):
        raise Forbidden("Only an owner can change or deactivate an owner")
    demoting = (body.role is not None and body.role is not Role.OWNER) or body.active is False
    if is_owner_row and m.active and demoting:
        owners = db.scalar(select(func.count()).select_from(Membership).where(
            Membership.organization_id == p.org_id, Membership.role == Role.OWNER.value, Membership.active.is_(True)))
        if owners <= 1:
            raise Conflict("A company must keep at least one active owner", code="LAST_OWNER")
    if body.role:
        m.role = body.role.value
    if body.active is not None:
        m.active = body.active
    audit(db, p, "member.updated", "user", user_id, body.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return _member_out(m, u)


@team_router.get("/roles", response_model=s.RoleMatrixOut)
def role_matrix(p: Principal = Depends(get_principal)):
    """What each role can do. Roles are fixed for now; this is the readable matrix behind them."""
    return s.RoleMatrixOut(
        roles=[s.RoleOut(key=r.value, label=ROLE_LABELS[r][0], description=ROLE_LABELS[r][1],
                         assignable=r in ASSIGNABLE, permissions=sorted(ROLE_PERMISSIONS[r]))
               for r in Role if r is not Role.CUSTOMER],
        groups=[s.PermissionGroupOut(name=name, permissions=[s.PermissionOut(key=k, label=v) for k, v in perms.items()])
                for name, perms in PERMISSION_GROUPS.items()])


# ---------------------------------------------------------------- terminals
terminals_router = resource_router(
    prefix="/terminals", tag="terminals", entity="terminal", label="terminal", model=Terminal,
    create_schema=s.TerminalCreate, update_schema=s.TerminalUpdate, read_schema=s.TerminalRead,
    read_perm="dashboard.read", write_perm="organization.manage", list_params=s.TerminalListParams,
    search=("name", "code", "city"), sort={"name": Terminal.name, "created_at": Terminal.created_at},
    default_sort="name", archivable=True)


# ---------------------------------------------------------------- preferences and saved views
prefs_router = APIRouter(tags=["preferences"])


@prefs_router.get("/preferences", response_model=dict[str, Any])
def get_preferences(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """The caller's own settings in this company (table columns, chosen terminal and so on)."""
    rows = db.execute(select(UserPreference.key, UserPreference.value).where(UserPreference.user_id == p.user_id))
    return dict(rows.all())


@prefs_router.put("/preferences/{key}", status_code=204)
def set_preference(key: Annotated[str, Path(max_length=80, pattern=r"^[a-z0-9_.:-]+$")],
                   body: s.PreferenceIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    stmt = insert(UserPreference).values(organization_id=p.org_id, user_id=p.user_id, key=key, value=body.value)
    db.execute(stmt.on_conflict_do_update(index_elements=["organization_id", "user_id", "key"],
                                          set_={"value": stmt.excluded.value, "updated_at": func.now()}))
    db.commit()


@prefs_router.get("/saved-views", response_model=list[s.SavedViewOut])
def list_saved_views(resource: str = Query(max_length=40), p: Principal = Depends(get_principal),
                     db: Session = Depends(get_db)):
    """The caller's own views plus the ones shared with the whole company."""
    return list(db.scalars(select(SavedView).where(
        SavedView.resource == resource, or_(SavedView.owner_user_id == p.user_id, SavedView.shared.is_(True)))
        .order_by(SavedView.shared.desc(), SavedView.name)))


@prefs_router.post("/saved-views", response_model=s.SavedViewOut, status_code=201)
def create_saved_view(body: s.SavedViewCreate, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if body.shared and not p.can("organization.manage"):
        raise Forbidden("Only an administrator can share a view with the whole company")
    view = SavedView(organization_id=p.org_id, owner_user_id=p.user_id, **body.model_dump())
    db.add(view)
    db.commit()
    return view


@prefs_router.delete("/saved-views/{view_id}", status_code=204)
def delete_saved_view(view_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    view = db.get(SavedView, view_id)
    if view is None:
        raise NotFound("Saved view not found")
    if view.owner_user_id != p.user_id and not (view.shared and p.can("organization.manage")):
        raise Forbidden("You can only remove your own views")
    db.delete(view)
    db.commit()


# ---------------------------------------------------------------- audit log
audit_router = APIRouter(tags=["audit"])


@audit_router.get("/audit-logs", response_model=Page[s.AuditOut])
def audit_logs(params: Annotated[s.AuditListParams, Query()], p: Principal = Depends(require("audit.read")),
               db: Session = Depends(get_db)):
    stmt = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.actor_user_id)
    if params.actor_user_id:
        stmt = stmt.where(AuditLog.actor_user_id == params.actor_user_id)
    if params.action:
        stmt = stmt.where(AuditLog.action == params.action)
    if params.entity_type:
        stmt = stmt.where(AuditLog.entity_type == params.entity_type)
    if params.entity_id:
        stmt = stmt.where(AuditLog.entity_id == params.entity_id)
    if params.since:
        stmt = stmt.where(AuditLog.created_at >= params.since)
    if params.until:
        stmt = stmt.where(AuditLog.created_at < params.until)
    if params.q:
        stmt = stmt.where(or_(AuditLog.action.ilike(like(params.q)), AuditLog.request_id == params.q))
    rows, info = paginate(db, stmt, parse_sort(params.sort, {"created_at": AuditLog.created_at}, "-created_at"),
                          AuditLog.id, cursor=params.cursor, limit=params.limit, count=params.count)
    items = [s.AuditOut.model_validate(entry).model_copy(update={"actor_name": name}) for entry, name in rows]
    return envelope(items, info)


for sub in (settings_router, team_router, terminals_router, prefs_router, audit_router):
    router.include_router(sub)
