import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import new_session
from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.permissions import has_permission
from app.core.security import decode_token
from app.modules.organizations.models import Membership, User

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: str
    full_name: str
    email: str


def get_principal(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Principal:
    if creds is None:
        raise Unauthorized("Authentication required")
    try:
        claims = decode_token(creds.credentials)
        user_id, org_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["org"])
    except (jwt.PyJWTError, ValueError, KeyError) as e:
        raise Unauthorized("Invalid or expired token") from e

    # Re-check membership on every request so role changes/deactivation take effect immediately.
    db = new_session(org_id=org_id, user_id=user_id)
    try:
        row = db.execute(
            select(Membership.role, User.full_name, User.email)
            .join(User, User.id == Membership.user_id)
            .where(Membership.user_id == user_id, Membership.organization_id == org_id,
                   Membership.active.is_(True), User.active.is_(True))
        ).first()
    finally:
        db.close()
    if row is None:
        raise Unauthorized("Account is not active in this organization")
    request.state.principal = (user_id, org_id)
    return Principal(user_id, org_id, row.role, row.full_name, row.email)


def get_db(p: Principal = Depends(get_principal)) -> Iterator[Session]:
    """One transaction per request, scoped to the caller's organization by RLS.

    Routers commit explicitly; anything uncommitted is rolled back.
    """
    db = new_session(org_id=p.org_id, user_id=p.user_id)
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def require(permission: str) -> Callable[[Principal], Principal]:
    def dep(p: Principal = Depends(get_principal)) -> Principal:
        if not has_permission(p.role, permission):
            raise Forbidden(f"Your role ({p.role}) lacks permission: {permission}")
        return p
    return dep


def get_or_404(db: Session, model, id_: uuid.UUID, what: str):
    obj = db.get(model, id_)
    if obj is None:  # RLS makes other tenants' rows indistinguishable from missing ones
        raise NotFound(f"{what} not found")
    return obj
