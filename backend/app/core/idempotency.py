"""Idempotency-Key support.

The first request with a key runs and stores its response; replays return the stored response without
re-executing. The key row is inserted in the same transaction as the work, so concurrent duplicates block on
the unique index until the first commits, then replay.
"""
import hashlib
import json
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.core.errors import Conflict, Invalid
from app.modules.organizations.models import IdempotencyKey


def run_idempotent(db: Session, p: Principal, key: str | None, endpoint: str, payload: Any,
                   fn: Callable[[], tuple[int, Any]]) -> JSONResponse:
    if key is not None and not (1 <= len(key) <= 128):
        raise Invalid("Idempotency-Key must be 1-128 characters")

    if key is None:
        status, body = fn()
        db.commit()
        return JSONResponse(jsonable_encoder(body), status_code=status)

    digest = hashlib.sha256(json.dumps(jsonable_encoder(payload), sort_keys=True).encode()).hexdigest()
    inserted = db.execute(
        insert(IdempotencyKey)
        .values(organization_id=p.org_id, key=key, endpoint=endpoint, request_hash=digest)
        .on_conflict_do_nothing()
        .returning(IdempotencyKey.key)
    ).first()

    if inserted is None:
        existing = db.scalar(select(IdempotencyKey).where(IdempotencyKey.key == key))
        db.rollback()
        if existing is None or existing.endpoint != endpoint or existing.request_hash != digest:
            raise Invalid("Idempotency-Key was already used with a different request")
        if existing.response_status is None:
            raise Conflict("A request with this Idempotency-Key is still in progress", code="idempotency_in_progress")
        return JSONResponse(existing.response_body, status_code=existing.response_status,
                            headers={"Idempotent-Replay": "true"})

    status, body = fn()
    encoded = jsonable_encoder(body)
    db.execute(update(IdempotencyKey)
               .where(IdempotencyKey.key == key)
               .values(response_status=status, response_body=encoded))
    db.commit()
    return JSONResponse(encoded, status_code=status)
