"""Role-based access control.

A role belongs to a membership (a user in one company). Roles are fixed sets of permissions defined here; the
API checks a permission on every endpoint. Hiding a button in the web app is presentation, never security.
"""
from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    SAFETY_MANAGER = "safety_manager"
    FLEET_MANAGER = "fleet_manager"
    ACCOUNTANT = "accountant"
    VIEWER = "viewer"        # read-only manager
    DRIVER = "driver"        # driver app only
    CUSTOMER = "customer"    # customer portal only (not built yet)


ROLE_LABELS = {
    Role.OWNER: ("Owner", "Everything, including companies and ownership"),
    Role.ADMIN: ("Administrator", "Everything except granting ownership"),
    Role.DISPATCHER: ("Dispatcher", "Loads, dispatch, customers and load documents"),
    Role.SAFETY_MANAGER: ("Safety manager", "Driver qualification, inspections and compliance documents"),
    Role.FLEET_MANAGER: ("Fleet manager", "Trucks, trailers and maintenance"),
    Role.ACCOUNTANT: ("Accountant", "Invoices, payments, expenses and settlements"),
    Role.VIEWER: ("Read-only manager", "Can see operations and reports but change nothing"),
    Role.DRIVER: ("Driver", "Driver app only: own assignments"),
    Role.CUSTOMER: ("Customer", "Customer portal only"),
}

# Permission catalogue, grouped the way the role matrix screen shows it.
PERMISSION_GROUPS: dict[str, dict[str, str]] = {
    "Overview": {
        "dashboard.read": "See the dashboard",
        "reports.read": "See reports",
        "reports.export": "Export report data",
    },
    "Operations": {
        "loads.read": "See loads",
        "loads.create": "Create loads",
        "loads.update": "Edit loads, stops and notes",
        "loads.cancel": "Cancel or hold loads",
        "loads.close": "Review proof of delivery and complete loads",
        "loads.rates.read": "See customer rates and charges",
        "dispatch.read": "See the dispatch board",
        "dispatch.assign": "Assign, reassign and dispatch loads",
    },
    "Directory": {
        "customers.read": "See customers",
        "customers.manage": "Create, edit and archive customers",
        "drivers.read": "See drivers",
        "drivers.manage": "Create and edit drivers and qualifications",
        "drivers.sensitive.read": "See full licence numbers and pay settings",
        "equipment.read": "See trucks and trailers",
        "equipment.manage": "Create and edit trucks and trailers",
    },
    "Safety and fleet": {
        "safety.read": "See compliance status and inspections",
        "safety.manage": "Record inspections and review compliance documents",
        "maintenance.read": "See maintenance work orders",
        "maintenance.manage": "Create and close work orders",
        "documents.read": "See and download documents",
        "documents.upload": "Upload documents",
        "documents.delete": "Remove documents",
    },
    "Finance": {
        "invoices.read": "See invoices",
        "invoices.create": "Create, issue and void invoices",
        "payments.read": "See payments",
        "payments.record": "Record and reverse payments",
        "expenses.read": "See expenses and fuel",
        "expenses.manage": "Record expenses and fuel",
        "settlements.read": "See driver settlements",
        "settlements.manage": "Create, approve and pay settlements",
    },
    "Administration": {
        "users.manage": "Add users and change roles",
        "organization.manage": "Change company settings and terminals",
        "audit.read": "See the audit log",
    },
}

ALL: set[str] = {p for group in PERMISSION_GROUPS.values() for p in group}
READ: set[str] = {p for p in ALL if p.endswith(".read")}

ROLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.OWNER: set(ALL),
    Role.ADMIN: set(ALL),
    Role.DISPATCHER: {
        "dashboard.read", "reports.read",
        "loads.read", "loads.create", "loads.update", "loads.cancel", "loads.close", "loads.rates.read",
        "dispatch.read", "dispatch.assign",
        "customers.read", "customers.manage", "drivers.read", "equipment.read",
        "safety.read", "maintenance.read", "documents.read", "documents.upload",
        "invoices.read",
    },
    Role.SAFETY_MANAGER: {
        "dashboard.read", "reports.read",
        "loads.read", "dispatch.read",
        "drivers.read", "drivers.manage", "drivers.sensitive.read", "equipment.read",
        "safety.read", "safety.manage", "maintenance.read",
        "documents.read", "documents.upload", "documents.delete",
    },
    Role.FLEET_MANAGER: {
        "dashboard.read", "reports.read",
        "loads.read", "dispatch.read", "drivers.read",
        "equipment.read", "equipment.manage", "safety.read", "safety.manage",
        "maintenance.read", "maintenance.manage",
        "documents.read", "documents.upload", "expenses.read", "expenses.manage",
    },
    Role.ACCOUNTANT: {
        "dashboard.read", "reports.read", "reports.export",
        "loads.read", "loads.rates.read", "loads.close", "customers.read", "drivers.read",
        "drivers.sensitive.read", "equipment.read",
        "documents.read", "documents.upload",
        "invoices.read", "invoices.create", "payments.read", "payments.record",
        "expenses.read", "expenses.manage", "settlements.read", "settlements.manage",
    },
    Role.VIEWER: set(READ) - {"audit.read", "drivers.sensitive.read"},
    # Drivers use only /driver/* endpoints, which are tied to their own released assignments.
    Role.DRIVER: {"driver.self"},
    Role.CUSTOMER: set(),
}

# Roles that can be given to staff from the team screen.
ASSIGNABLE = [r for r in Role if r is not Role.CUSTOMER]


def permissions_for(role: str) -> set[str]:
    try:
        return ROLE_PERMISSIONS[Role(role)]
    except (ValueError, KeyError):
        return set()


def has_permission(role: str, permission: str) -> bool:
    return permission in permissions_for(role)
