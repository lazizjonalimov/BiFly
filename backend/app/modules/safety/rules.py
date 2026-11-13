"""Compliance rules: what is expired, what is about to expire, and what that means for dispatch.

This is the only place that decides it. The driver and equipment lists, the assignment panel, the expirations
queue and the dashboard all ask here, so they can never disagree.
"""
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

# How far ahead an upcoming expiry starts to be flagged.
WARN_DAYS = 30

Severity = Literal["blocking", "warning", "info"]

QUALIFICATION_LABELS = {
    "mvr": "Motor vehicle record", "drug_test": "Drug and alcohol test", "road_test": "Road test",
    "employment_application": "Employment application", "annual_review": "Annual review",
    "hazmat": "Hazmat endorsement", "twic": "TWIC card", "training": "Training", "other": "Qualification",
}
ITEM_LABELS = {
    "cdl": "CDL", "medical": "Medical certificate", "insurance": "Insurance", "registration": "Registration",
    "inspection": "Annual inspection", **QUALIFICATION_LABELS,
}


class Issue(BaseModel):
    """blocking: must not be dispatched. warning: allowed, needs attention soon. info: nothing on file."""
    code: str
    message: str
    severity: Severity
    expires_on: date | None = None


class Compliance(BaseModel):
    status: Literal["ok", "expiring", "expired", "incomplete"]
    issues: list[Issue]


def fmt(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def dated(label: str, code: str, expires_on: date | None, today: date, *, blocks: bool = True,
          flag_missing: bool = True) -> Issue | None:
    """Judge one dated item. An item is good through its expiry date and expired the day after."""
    if expires_on is None:
        return Issue(code=f"{code}_MISSING", message=f"No {label} date on file", severity="info") \
            if flag_missing else None
    if expires_on < today:
        return Issue(code=f"{code}_EXPIRED", message=f"{label} expired on {fmt(expires_on)}",
                     severity="blocking" if blocks else "warning", expires_on=expires_on)
    if expires_on <= today + timedelta(days=WARN_DAYS):
        return Issue(code=f"{code}_EXPIRING", message=f"{label} expires on {fmt(expires_on)}",
                     severity="warning", expires_on=expires_on)
    return None


def driver_issues(driver, qualifications, today: date) -> list[Issue]:
    found = [
        dated("CDL", "CDL", driver.cdl_expiry, today),
        dated("Medical certificate", "MEDICAL", driver.medical_cert_expiry, today),
    ]
    for q in qualifications:
        label = QUALIFICATION_LABELS.get(q.type, "Qualification")
        # Only items the company marked as required stop a driver from being dispatched.
        found.append(dated(label, f"QUALIFICATION_{q.type.upper()}", q.expires_on, today, blocks=q.required,
                           flag_missing=False))
    return [i for i in found if i]


def unit_issues(unit, today: date) -> list[Issue]:
    """A truck or a trailer."""
    found = [
        dated("Insurance", "INSURANCE", unit.insurance_expiry, today),
        dated("Registration", "REGISTRATION", unit.registration_expiry, today),
        dated("Annual inspection", "INSPECTION", unit.inspection_expiry, today),
    ]
    return [i for i in found if i]


def summarize(issues: list[Issue]) -> Compliance:
    severities = {i.severity for i in issues}
    status = ("expired" if "blocking" in severities else "expiring" if "warning" in severities
              else "incomplete" if "info" in severities else "ok")
    order = {"blocking": 0, "warning": 1, "info": 2}
    return Compliance(status=status, issues=sorted(issues, key=lambda i: (order[i.severity], i.expires_on or date.max)))
