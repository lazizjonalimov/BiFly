"""Generic permissioned, audited CRUD router for simple master-data resources."""
import uuid
from typing import Generic, TypeVar

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.core.audit import audit
from app.core.deps import Principal, get_db, get_or_404, require
from app.core.pagination import paginate

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


def crud_router(*, prefix: str, tag: str, entity: str, model, create_schema, update_schema, read_schema,
                read_perm: str, write_perm: str, search: tuple[str, ...] = (), filters: tuple[str, ...] = ()
                ) -> APIRouter:
    r = APIRouter(prefix=prefix, tags=[tag])

    @r.get("", response_model=Page[read_schema])
    def list_(cursor: str | None = None, limit: int = Query(50, ge=1, le=200), q: str | None = None,
              status: str | None = None, p: Principal = Depends(require(read_perm)), db=Depends(get_db)):
        stmt = select(model)
        if q and search:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            stmt = stmt.where(or_(*[getattr(model, c).ilike(like) for c in search]))
        if status and "status" in filters:
            stmt = stmt.where(model.status == status)
        rows, nxt = paginate(db, stmt, model, cursor, limit)
        return {"items": rows, "next_cursor": nxt}

    @r.get("/{item_id}", response_model=read_schema)
    def get_(item_id: uuid.UUID, p: Principal = Depends(require(read_perm)), db=Depends(get_db)):
        return get_or_404(db, model, item_id, entity)

    @r.post("", response_model=read_schema, status_code=201)
    def create_(body: create_schema, p: Principal = Depends(require(write_perm)), db=Depends(get_db)):
        obj = model(organization_id=p.org_id, **body.model_dump())
        db.add(obj)
        db.flush()
        audit(db, p, f"{entity}.created", entity, obj.id, body.model_dump(mode="json"))
        db.commit()
        return obj

    @r.patch("/{item_id}", response_model=read_schema)
    def update_(item_id: uuid.UUID, body: update_schema, p: Principal = Depends(require(write_perm)),
                db=Depends(get_db)):
        obj = get_or_404(db, model, item_id, entity)
        changes = body.model_dump(exclude_unset=True)
        for k, v in changes.items():
            setattr(obj, k, v)
        db.flush()
        audit(db, p, f"{entity}.updated", entity, obj.id, body.model_dump(mode="json", exclude_unset=True))
        db.commit()
        return obj

    @r.delete("/{item_id}", status_code=204)
    def delete_(item_id: uuid.UUID, p: Principal = Depends(require(write_perm)), db=Depends(get_db)):
        obj = get_or_404(db, model, item_id, entity)
        db.delete(obj)
        db.flush()  # raises (-> 409) if referenced by loads etc.
        audit(db, p, f"{entity}.deleted", entity, item_id)
        db.commit()

    return r
