"""Database engine/session with PostgreSQL row-level-security tenant context.

Every transaction started by a Session re-applies `app.org_id` / `app.user_id` via
set_config(..., is_local=true) in an `after_begin` hook. Values are transaction-local, so a
pooled connection can never carry one tenant's context into another request.
"""
import uuid
from datetime import datetime

from sqlalchemy import MetaData, create_engine, event, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import DateTime, Uuid

from app.core.config import get_settings

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=func.gen_random_uuid()
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


_engine = None
_factory = None


def get_engine():
    global _engine, _factory
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_size=10, max_overflow=10, pool_pre_ping=True)
        _factory = sessionmaker(_engine, expire_on_commit=False, autoflush=True)
    return _engine


def reset_engine() -> None:
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine = _factory = None


@event.listens_for(Session, "after_begin")
def _apply_tenant_context(session: Session, transaction, connection) -> None:  # noqa: ANN001
    org = session.info.get("org_id")
    user = session.info.get("user_id")
    connection.execute(
        text("SELECT set_config('app.org_id', :o, true), set_config('app.user_id', :u, true)"),
        {"o": str(org) if org else "", "u": str(user) if user else ""},
    )


def new_session(*, org_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> Session:
    get_engine()
    s = _factory()
    s.info["org_id"] = org_id
    s.info["user_id"] = user_id
    return s
