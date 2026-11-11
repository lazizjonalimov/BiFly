"""Role-based access control. Roles are per organization membership."""
from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    SAFETY_MANAGER = "safety_manager"
    FLEET_MANAGER = "fleet_manager"
    ACCOUNTANT = "accountant"
    DRIVER = "driver"
    CUSTOMER = "customer"  # portal access arrives in a later phase


ALL = {
    "org:manage", "users:manage", "audit:read",
    "customers:read", "customers:write",
    "drivers:read", "drivers:write",
    "fleet:read", "fleet:write",
    "loads:read", "loads:write", "dispatch:write",
    "documents:read", "documents:write",
    "invoices:read", "invoices:write", "payments:write",
    "reports:read",
}

ROLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.OWNER: set(ALL),
    Role.ADMIN: set(ALL),
    Role.DISPATCHER: {
        "customers:read", "customers:write", "drivers:read", "fleet:read",
        "loads:read", "loads:write", "dispatch:write",
        "documents:read", "documents:write", "invoices:read", "reports:read",
    },
    Role.SAFETY_MANAGER: {"drivers:read", "drivers:write", "fleet:read", "loads:read", "documents:read", "documents:write"},
    Role.FLEET_MANAGER: {"fleet:read", "fleet:write", "drivers:read", "loads:read", "documents:read", "documents:write"},
    Role.ACCOUNTANT: {
        "customers:read", "loads:read", "documents:read",
        "invoices:read", "invoices:write", "payments:write", "reports:read",
    },
    # Drivers only use /driver/* endpoints, which are scoped to their own assignments.
    Role.DRIVER: {"driver:self"},
    Role.CUSTOMER: set(),
}


def has_permission(role: str, perm: str) -> bool:
    try:
        return perm in ROLE_PERMISSIONS[Role(role)]
    except (ValueError, KeyError):
        return False
