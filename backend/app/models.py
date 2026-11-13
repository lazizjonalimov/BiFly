"""Imports every model so Base.metadata is complete (used by Alembic and tests)."""
from app.core.db import Base  # noqa: F401
from app.modules.customers.models import Customer, CustomerAddress, CustomerContact  # noqa: F401
from app.modules.dispatch.models import DispatchAssignment  # noqa: F401
from app.modules.documents.models import Document, DocumentLink  # noqa: F401
from app.modules.drivers.models import Driver, DriverQualification  # noqa: F401
from app.modules.equipment.models import Trailer, Vehicle  # noqa: F401
from app.modules.finance.models import Invoice, InvoiceLine, Payment, PaymentAllocation  # noqa: F401
from app.modules.loads.models import (  # noqa: F401
    Load,
    LoadCharge,
    LoadItem,
    LoadNote,
    LoadStatusEvent,
    LoadStop,
    TrackingEvent,
)
from app.modules.maintenance.models import Inspection, InspectionDefect, WorkOrder, WorkOrderLine  # noqa: F401
from app.modules.organizations.models import (  # noqa: F401
    Account,
    AuditLog,
    IdempotencyKey,
    Membership,
    Organization,
    SavedView,
    Terminal,
    User,
    UserPreference,
)
