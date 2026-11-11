"""Keyset (cursor) pagination ordered by (created_at DESC, id DESC)."""
import base64
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, or_
from sqlalchemy.orm import Session

from app.core.errors import Invalid


def encode_cursor(created_at: datetime, id_: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{created_at.isoformat()}|{id_}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, id_ = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(ts), uuid.UUID(id_)
    except Exception as e:  # noqa: BLE001
        raise Invalid("Invalid cursor") from e


def paginate(db: Session, stmt: Select, model: Any, cursor: str | None, limit: int) -> tuple[list, str | None]:
    limit = max(1, min(limit, 200))
    if cursor:
        ts, id_ = decode_cursor(cursor)
        stmt = stmt.where(or_(model.created_at < ts, and_(model.created_at == ts, model.id < id_)))
    rows = list(db.scalars(stmt.order_by(model.created_at.desc(), model.id.desc()).limit(limit + 1)))
    nxt = None
    if len(rows) > limit:
        rows = rows[:limit]
        nxt = encode_cursor(rows[-1].created_at, rows[-1].id)
    return rows, nxt
