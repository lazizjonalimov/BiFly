"""Generic, permissioned, audited routers for directory-style records.

`resource_router` builds list/get/create/update (plus archive/restore or delete) for a top-level record.
`child_router` does the same for records that live under a parent (a customer's contacts, a load's charges).

Anything with real business rules (loads, dispatch, invoices, settlements) gets a hand-written router instead.
"""
import uuid
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.errors import Conflict, Invalid, NotFound
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, envelope, paginate, parse_sort


class ListParams(BaseModel):
    """Query parameters every list endpoint accepts. Subclass it to allowlist a resource's filters."""
    model_config = ConfigDict(extra="forbid")

    cursor: str | None = Field(None, description="Opaque cursor from the previous page")
    limit: int = Field(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    sort: str | None = Field(None, description="Sort key; prefix with - for descending")
    q: str | None = Field(None, max_length=100, description="Search text")
    count: bool = Field(False, description="Also return the total number of matching records")


_COMMON = set(ListParams.model_fields)


def like(q: str) -> str:
    """A LIKE pattern that treats the user's text literally."""
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def apply_filters(stmt, model, params: ListParams, search: tuple[str, ...]):
    if params.q and search:
        pattern = like(params.q.strip())
        stmt = stmt.where(or_(*[getattr(model, c).ilike(pattern) for c in search]))
    for name in type(params).model_fields:
        if name in _COMMON:
            continue
        value = getattr(params, name)
        if value is not None:
            stmt = stmt.where(getattr(model, name) == value)
    return stmt


Hook = Callable[[Session, Principal, dict[str, Any], Any], None]
Guard = Callable[[Session, Principal, Any], None]


def ensure_exists(db: Session, model, value: uuid.UUID | None, field: str, label: str) -> None:
    """Reject a reference to a record that isn't there (or belongs to another company) as a field error."""
    if value is not None and db.get(model, value) is None:
        raise Invalid(f"{label} not found", field=field)


def _redactor(fields: tuple[str, ...]):
    def redact(data: dict) -> dict:
        return {k: ("[redacted]" if k in fields and v is not None else v) for k, v in data.items()}
    return redact


def resource_router(
    *, prefix: str, tag: str, entity: str, label: str, model, create_schema, update_schema, read_schema,
    read_perm: str, write_perm: str, list_params: type[ListParams] = ListParams,
    search: tuple[str, ...] = (), sort: dict[str, Any] | None = None, default_sort: str = "-created_at",
    present: Callable[[Session, list[Any], Principal], list[Any]] | None = None,
    audit_redact: tuple[str, ...] = (), before_save: Hook | None = None, before_delete: Guard | None = None,
    archivable: bool = False, deletable: bool = True, detail: bool = True,
) -> APIRouter:
    """
    present        shapes a page of rows for a particular caller in one go (masking a field for some roles,
                   attaching values worked out from other tables) without a query per row
    before_save    validates or adjusts incoming data against the database; raise to reject
    before_delete  raise to refuse a delete or an archive
    archivable     adds /archive and /restore (status 'archived' <-> 'active') for records that must not vanish
    """
    r = APIRouter(prefix=prefix, tags=[tag])
    redact = _redactor(audit_redact)

    def show_all(db: Session, rows: list, p: Principal) -> list:
        return present(db, rows, p) if present else rows

    def show(db: Session, obj, p: Principal):
        return show_all(db, [obj], p)[0]
    sortable = sort or {"created_at": model.created_at}

    @r.get("", response_model=Page[read_schema], summary=f"List {label}s")
    def list_(params: Annotated[list_params, Query()], p: Principal = Depends(require(read_perm)),
              db: Session = Depends(get_db)):
        stmt = apply_filters(select(model), model, params, search)
        rows, info = paginate(db, stmt, parse_sort(params.sort, sortable, default_sort), model.id,
                              cursor=params.cursor, limit=params.limit, count=params.count)
        return envelope(show_all(db, rows, p), info)

    if detail:
        @r.get("/{item_id}", response_model=read_schema, summary=f"Get one {label}")
        def get_(item_id: uuid.UUID, p: Principal = Depends(require(read_perm)), db: Session = Depends(get_db)):
            return show(db, get_or_404(db, model, item_id, label.capitalize()), p)

    @r.post("", response_model=read_schema, status_code=201, summary=f"Create a {label}")
    def create_(body: create_schema, p: Principal = Depends(require(write_perm)), db: Session = Depends(get_db)):
        data = body.model_dump()
        if before_save:
            before_save(db, p, data, None)
        obj = model(organization_id=p.org_id, **data)
        db.add(obj)
        db.flush()
        audit(db, p, f"{entity}.created", entity, obj.id, redact(body.model_dump(mode="json", exclude_none=True)))
        db.commit()
        return show(db, obj, p)

    @r.patch("/{item_id}", response_model=read_schema, summary=f"Update a {label}")
    def update_(item_id: uuid.UUID, body: update_schema, p: Principal = Depends(require(write_perm)),
                db: Session = Depends(get_db)):
        obj = get_or_404(db, model, item_id, label.capitalize())
        changes = body.model_dump(exclude_unset=True)
        if before_save:
            before_save(db, p, changes, obj)
        for k, v in changes.items():
            setattr(obj, k, v)
        db.flush()
        audit(db, p, f"{entity}.updated", entity, obj.id, redact(body.model_dump(mode="json", exclude_unset=True)))
        db.commit()
        return show(db, obj, p)

    if archivable:
        def _set_status(item_id: uuid.UUID, status: str, action: str, p: Principal, db: Session):
            obj = get_or_404(db, model, item_id, label.capitalize())
            if obj.status == status:
                return show(db, obj, p)
            if status == "archived" and before_delete:
                before_delete(db, p, obj)
            obj.status = status
            db.flush()
            audit(db, p, f"{entity}.{action}", entity, obj.id)
            db.commit()
            return show(db, obj, p)

        @r.post("/{item_id}/archive", response_model=read_schema, summary=f"Archive a {label}")
        def archive_(item_id: uuid.UUID, p: Principal = Depends(require(write_perm)), db: Session = Depends(get_db)):
            return _set_status(item_id, "archived", "archived", p, db)

        @r.post("/{item_id}/restore", response_model=read_schema, summary=f"Restore an archived {label}")
        def restore_(item_id: uuid.UUID, p: Principal = Depends(require(write_perm)), db: Session = Depends(get_db)):
            return _set_status(item_id, "active", "restored", p, db)

    if deletable:
        @r.delete("/{item_id}", status_code=204, summary=f"Delete a {label} that nothing refers to")
        def delete_(item_id: uuid.UUID, p: Principal = Depends(require(write_perm)), db: Session = Depends(get_db)):
            obj = get_or_404(db, model, item_id, label.capitalize())
            if before_delete:
                before_delete(db, p, obj)
            db.delete(obj)
            db.flush()  # a foreign key from another record turns this into a 409
            audit(db, p, f"{entity}.deleted", entity, item_id)
            db.commit()

    return r


def child_router(
    *, prefix: str, tag: str, entity: str, label: str, model, parent_model, parent_fk: str, parent_label: str,
    create_schema, update_schema, read_schema, read_perm: str, write_perm: str, order_by=None,
    before_save: Hook | None = None, parent_guard: Guard | None = None, after_save: Guard | None = None,
    after_change: Guard | None = None,
) -> APIRouter:
    """Records under a parent, e.g. prefix="/customers/{parent_id}/contacts".

    parent_guard  raise to refuse changes given the parent's state (an invoiced load's charges, say)
    after_save    called with the child once it has been created or updated
    after_change  called with the parent after any create/update/delete, inside the same transaction
    """
    r = APIRouter(prefix=prefix, tags=[tag])
    fk = getattr(model, parent_fk)

    def _parent(db: Session, parent_id: uuid.UUID, *, lock: bool = False):
        if not lock:
            return get_or_404(db, parent_model, parent_id, parent_label)
        # Writers queue on the parent row, so totals worked out from the children are never based on a
        # sibling change that hasn't committed yet.
        parent = db.scalar(select(parent_model).where(parent_model.id == parent_id).with_for_update())
        if parent is None:
            raise NotFound(f"{parent_label} not found")
        return parent

    def _child(db: Session, parent_id: uuid.UUID, item_id: uuid.UUID):
        obj = db.get(model, item_id)
        if obj is None or getattr(obj, parent_fk) != parent_id:
            raise NotFound(f"{label.capitalize()} not found")
        return obj

    @r.get("", response_model=list[read_schema], summary=f"List a {parent_label.lower()}'s {label}s")
    def list_(parent_id: uuid.UUID, p: Principal = Depends(require(read_perm)), db: Session = Depends(get_db)):
        _parent(db, parent_id)
        ordering = order_by if order_by is not None else model.created_at
        columns = ordering if isinstance(ordering, tuple | list) else (ordering,)
        return list(db.scalars(select(model).where(fk == parent_id).order_by(*columns, model.id)))

    @r.post("", response_model=read_schema, status_code=201, summary=f"Add a {label}")
    def create_(parent_id: uuid.UUID, body: create_schema, p: Principal = Depends(require(write_perm)),
                db: Session = Depends(get_db)):
        parent = _parent(db, parent_id, lock=True)
        if parent_guard:
            parent_guard(db, p, parent)
        data = body.model_dump()
        if before_save:
            before_save(db, p, data, None)
        obj = model(organization_id=p.org_id, **{parent_fk: parent_id}, **data)
        db.add(obj)
        db.flush()
        if after_save:
            after_save(db, p, obj)
        if after_change:
            after_change(db, p, parent)
        audit(db, p, f"{entity}.created", entity, obj.id, {parent_fk: str(parent_id)})
        db.commit()
        return obj

    @r.patch("/{item_id}", response_model=read_schema, summary=f"Update a {label}")
    def update_(parent_id: uuid.UUID, item_id: uuid.UUID, body: update_schema,
                p: Principal = Depends(require(write_perm)), db: Session = Depends(get_db)):
        parent = _parent(db, parent_id, lock=True)
        if parent_guard:
            parent_guard(db, p, parent)
        obj = _child(db, parent_id, item_id)
        changes = body.model_dump(exclude_unset=True)
        if before_save:
            before_save(db, p, changes, obj)
        for k, v in changes.items():
            setattr(obj, k, v)
        db.flush()
        if after_save:
            after_save(db, p, obj)
        if after_change:
            after_change(db, p, parent)
        audit(db, p, f"{entity}.updated", entity, obj.id, {parent_fk: str(parent_id)})
        db.commit()
        return obj

    @r.delete("/{item_id}", status_code=204, summary=f"Remove a {label}")
    def delete_(parent_id: uuid.UUID, item_id: uuid.UUID, p: Principal = Depends(require(write_perm)),
                db: Session = Depends(get_db)):
        parent = _parent(db, parent_id, lock=True)
        if parent_guard:
            parent_guard(db, p, parent)
        obj = _child(db, parent_id, item_id)
        db.delete(obj)
        db.flush()
        if after_change:
            after_change(db, p, parent)
        audit(db, p, f"{entity}.deleted", entity, item_id, {parent_fk: str(parent_id)})
        db.commit()

    return r


__all__ = ["ListParams", "Conflict", "apply_filters", "child_router", "ensure_exists", "like", "resource_router"]
