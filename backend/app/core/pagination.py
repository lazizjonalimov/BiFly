"""List responses: database-side sorting, opaque keyset cursors, one envelope (decision 0004).

    {"items": [...], "page": {"next_cursor", "has_more", "total_count"}, "meta": {"request_id", "generated_at"}}

Sorting, filtering and pagination all happen in PostgreSQL over the whole matching set, so page N of a sorted
list is correct however large the table is. Each endpoint allowlists the keys it can be sorted by.
"""
import base64
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.context import current_request_id
from app.core.errors import Invalid

T = TypeVar("T")

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


class PageInfo(BaseModel):
    next_cursor: str | None = None
    has_more: bool = False
    total_count: int | None = None


class Meta(BaseModel):
    request_id: str | None = None
    generated_at: datetime


class Page(BaseModel, Generic[T]):
    items: list[T]
    page: PageInfo
    meta: Meta


def envelope(items: list, info: PageInfo) -> dict:
    return {"items": items, "page": info, "meta": Meta(request_id=current_request_id(), generated_at=datetime.now(UTC))}


@dataclass(frozen=True)
class Sort:
    key: str
    column: ColumnElement
    descending: bool


def parse_sort(value: str | None, allowed: dict[str, ColumnElement], default: str) -> Sort:
    """`name` sorts ascending, `-name` descending. Unknown keys are rejected rather than ignored."""
    raw = value or default
    descending = raw.startswith("-")
    key = raw.lstrip("-")
    if key not in allowed:
        raise Invalid(f"Cannot sort by '{key}'. Allowed: {', '.join(sorted(allowed))}", field="sort")
    return Sort(key, allowed[key], descending)


def _dump(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, Decimal | uuid.UUID):
        return str(v)
    return v


def _load(raw: Any, python_type: type) -> Any:
    if raw is None:
        return None
    if python_type is datetime:
        return datetime.fromisoformat(raw)
    if python_type is date:
        return date.fromisoformat(raw)
    if python_type is Decimal:
        return Decimal(raw)
    if python_type is uuid.UUID:
        return uuid.UUID(raw)
    return python_type(raw)


def _encode(sort: Sort, value: Any, row_id: uuid.UUID) -> str:
    payload = json.dumps([sort.key, sort.descending, _dump(value), str(row_id)])
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode(cursor: str, sort: Sort) -> tuple[Any, uuid.UUID]:
    try:
        key, descending, value, row_id = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if key != sort.key or descending != sort.descending:
            raise ValueError("cursor belongs to a different sort order")
        return _load(value, sort.column.type.python_type), uuid.UUID(row_id)
    except Exception as e:  # noqa: BLE001
        raise Invalid("This page link is no longer valid. Start again from the first page.", field="cursor") from e


def paginate(db: Session, stmt: Select, sort: Sort, id_column: ColumnElement, *, cursor: str | None,
             limit: int = DEFAULT_LIMIT, count: bool = False) -> tuple[list, PageInfo]:
    """Run `stmt` one page at a time. Returns the page's rows (as selected by `stmt`) and the page info.

    `sort.column` must never be NULL (wrap nullable columns in coalesce), because keyset comparison with NULL
    would silently drop rows. The row id breaks ties so the order is total and pages never overlap.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) if count else None

    col = sort.column
    if cursor:
        value, last_id = _decode(cursor, sort)
        if sort.descending:
            stmt = stmt.where(or_(col < value, and_(col == value, id_column < last_id)))
        else:
            stmt = stmt.where(or_(col > value, and_(col == value, id_column > last_id)))
    order = (col.desc(), id_column.desc()) if sort.descending else (col.asc(), id_column.asc())
    n = len(stmt.column_descriptions)  # what the caller selected: one entity, or several entities/columns
    paged = stmt.add_columns(col.label("_sort_value"), id_column.label("_sort_id")).order_by(*order).limit(limit + 1)
    rows = db.execute(paged).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode(sort, rows[-1]._sort_value, rows[-1]._sort_id) if has_more and rows else None
    # Hand back rows shaped like the caller's select: a single entity unwrapped, otherwise a tuple.
    items = [r[0] for r in rows] if n == 1 else [tuple(r[:n]) for r in rows]
    return items, PageInfo(next_cursor=next_cursor, has_more=has_more, total_count=total)
