import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.modules.organizations.models import AuditLog


def audit(db: Session, p: Principal, action: str, entity_type: str, entity_id: uuid.UUID | None,
          data: dict[str, Any] | None = None, request_id: str | None = None) -> None:
    db.add(AuditLog(organization_id=p.org_id, actor_user_id=p.user_id, action=action,
                    entity_type=entity_type, entity_id=entity_id, data=data, request_id=request_id))
