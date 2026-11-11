"""Imports every model so Base.metadata is complete (used by Alembic and tests)."""
from app.core.db import Base  # noqa: F401
from app.modules.customers.models import Customer  # noqa: F401
from app.modules.dispatch.models import DispatchAssignment  # noqa: F401
from app.modules.documents.models import Document  # noqa: F401
from app.modules.drivers.models import Driver  # noqa: F401
from app.modules.finance.models import Invoice, InvoiceLine, Payment  # noqa: F401
from app.modules.fleet.models import Trailer, Vehicle  # noqa: F401
from app.modules.loads.models import Load, LoadStatusEvent, LoadStop  # noqa: F401
from app.modules.organizations.models import AuditLog, IdempotencyKey, Membership, Organization, User  # noqa: F401
