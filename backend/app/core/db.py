"""Database engine/session and the two layers of tenant isolation.

1. PostgreSQL row-level security (the authoritative layer). Every transaction started by a Session re-applies
   `app.org_id` / `app.user_id` via set_config(..., is_local=true) in an `after_begin` hook. The values are
   transaction-local, so a pooled connection can never carry one tenant's context into another request.
2. An ORM-level filter (defence in depth). Every ORM SELECT issued by a tenant session is additionally
   restricted to that organization, independently of the database policies.
"""
import uuid
from datetime import datetime

from sqlalchemy import Engine, ForeignKey, MetaData, create_engine, event, func, text
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    ORMExecuteState,
    Session,
    mapped_column,
    sessionmaker,
    with_loader_criteria,
)
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


class TenantScoped:
    """Every table that belongs to one organization. Carries the column both isolation layers key on."""
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))


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


@event.listens_for(Session, "do_orm_execute")
def _scope_orm_reads_to_tenant(state: ORMExecuteState) -> None:
    org_id = state.session.info.get("org_id")
    if org_id is None or not state.is_select or state.is_column_load or state.is_relationship_load:
        return
    state.statement = state.statement.options(
        with_loader_criteria(TenantScoped, lambda cls: cls.organization_id == org_id, include_aliases=True)
    )


def assert_restricted_role(engine: Engine) -> None:
    """Refuse to run with a database role that row-level security does not apply to.

    A superuser or BYPASSRLS role ignores every policy, and a table owner ignores the policies on the identity
    tables. Pointing the API at such a role would silently expose every tenant, so fail closed instead.
    """
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT current_user AS name, r.rolsuper, r.rolbypassrls, "
            "(SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owned "
            "FROM pg_roles r WHERE r.rolname = current_user")).one()
    problems = [label for label, bad in (("is a superuser", row.rolsuper), ("has BYPASSRLS", row.rolbypassrls),
                                         ("owns application tables", row.owned > 0)) if bad]
    if problems:
        raise RuntimeError(
            f"Refusing to start: database role '{row.name}' {' and '.join(problems)}, so row-level security would "
            "not isolate tenants. Set FLYFLEET_DATABASE_URL to the restricted application role.")


def new_session(*, org_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> Session:
    get_engine()
    s = _factory()
    s.info["org_id"] = org_id
    s.info["user_id"] = user_id
    return s
