"""Who and what can haul a load, and why not.

The same checks back the assignment panel (to explain) and the assignment itself (to enforce), so what the
dispatcher is shown is exactly what the API will accept.
"""
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crud import like
from app.modules.dispatch.models import DispatchAssignment
from app.modules.drivers.models import Driver, DriverQualification
from app.modules.equipment.models import Trailer, Vehicle
from app.modules.loads.models import Load
from app.modules.safety.rules import driver_issues, unit_issues

# A load in one of these states has a claim on its driver and equipment.
HOLDS_RESOURCES = ("assigned", "dispatched", "at_pickup", "in_transit", "at_delivery", "on_hold")
IN_PROGRESS = ("dispatched", "at_pickup", "in_transit", "at_delivery")
# Loads that need no trailer.
NO_TRAILER = ("box_truck",)

Kind = Literal["driver", "vehicle", "trailer"]


class Reason(BaseModel):
    code: str
    message: str
    severity: Literal["blocking", "warning"]
    load_id: uuid.UUID | None = None
    load_number: str | None = None


class OtherLoad(BaseModel):
    id: uuid.UUID
    load_number: str
    status: str
    pickup_at: datetime | None
    delivery_at: datetime | None


class Candidate(BaseModel):
    id: uuid.UUID
    name: str
    detail: str | None
    terminal_id: uuid.UUID | None
    eligible: bool
    reasons: list[Reason]
    current_load: OtherLoad | None


class EligibleResources(BaseModel):
    load_id: uuid.UUID
    load_number: str
    needs_trailer: bool
    drivers: list[Candidate]
    vehicles: list[Candidate]
    trailers: list[Candidate]


def overlaps(load: Load, other: OtherLoad, now: datetime) -> bool:
    """Would hauling `load` collide with `other`?

    A load that is under way holds its driver and equipment from now until it delivers, however late it is
    running. Without both windows there is nothing to compare, so it counts as a collision.
    """
    start, end = other.pickup_at, other.delivery_at
    if other.status in IN_PROGRESS or other.status == "on_hold":
        start = min(start, now) if start else now
        end = max(end, now) if end else None
    if None in (load.pickup_at, load.delivery_at, start, end):
        return True
    return load.pickup_at < end and start < load.delivery_at


def commitments(db: Session, load: Load) -> dict[tuple[Kind, uuid.UUID], list[OtherLoad]]:
    """Every other load that currently has a claim on a driver, truck or trailer."""
    rows = db.execute(
        select(DispatchAssignment.driver_id, DispatchAssignment.vehicle_id, DispatchAssignment.trailer_id,
               Load.id, Load.load_number, Load.status, Load.pickup_at, Load.delivery_at)
        .join(Load, Load.id == DispatchAssignment.load_id)
        .where(DispatchAssignment.status == "active", Load.id != load.id, Load.status.in_(HOLDS_RESOURCES))
        .order_by(Load.pickup_at.nulls_last())
    ).all()
    out: dict[tuple[Kind, uuid.UUID], list[OtherLoad]] = {}
    for driver_id, vehicle_id, trailer_id, *rest in rows:
        other = OtherLoad(id=rest[0], load_number=rest[1], status=rest[2], pickup_at=rest[3], delivery_at=rest[4])
        for kind, rid in (("driver", driver_id), ("vehicle", vehicle_id), ("trailer", trailer_id)):
            if rid:
                out.setdefault((kind, rid), []).append(other)
    return out


def _schedule(load: Load, others: list[OtherLoad], now: datetime, what: str) -> list[Reason]:
    return [Reason(code="SCHEDULE_CONFLICT", severity="blocking", load_id=o.id, load_number=o.load_number,
                   message=f"{what} is on load {o.load_number} at the same time")
            for o in others if overlaps(load, o, now)]


def _compliance(issues) -> list[Reason]:
    # "Nothing on file" is not a reason to stop a truck; it shows up in the expirations queue instead.
    return [Reason(code=i.code, message=i.message, severity=i.severity) for i in issues if i.severity != "info"]


def driver_reasons(load: Load, driver: Driver, qualifications, others: list[OtherLoad], today: date,
                   now: datetime) -> list[Reason]:
    reasons: list[Reason] = []
    if driver.status != "active":
        reasons.append(Reason(code="DRIVER_NOT_ACTIVE", severity="blocking",
                              message=f"Driver is {driver.status.replace('_', ' ')}"))
    reasons += _compliance(driver_issues(driver, qualifications, today))
    reasons += _schedule(load, others, now, "Driver")
    if load.terminal_id and driver.terminal_id and driver.terminal_id != load.terminal_id:
        reasons.append(Reason(code="OTHER_TERMINAL", severity="warning", message="Based at another terminal"))
    return reasons


def unit_reasons(load: Load, unit: Vehicle | Trailer, others: list[OtherLoad], today: date, now: datetime,
                 what: str) -> list[Reason]:
    reasons: list[Reason] = []
    if unit.status != "active":
        reasons.append(Reason(code="UNIT_NOT_ACTIVE", severity="blocking",
                              message=f"{what} is {unit.status.replace('_', ' ')}"))
    reasons += _compliance(unit_issues(unit, today))
    reasons += _schedule(load, others, now, what)
    if isinstance(unit, Trailer) and unit.type != load.equipment_type:
        reasons.append(Reason(code="EQUIPMENT_MISMATCH", severity="warning",
                              message=f"Trailer is a {unit.type.replace('_', ' ')}; the load calls for "
                                      f"{load.equipment_type.replace('_', ' ')}"))
    if load.terminal_id and unit.terminal_id and unit.terminal_id != load.terminal_id:
        reasons.append(Reason(code="OTHER_TERMINAL", severity="warning", message="Based at another terminal"))
    return reasons


def blocking(reasons: list[Reason]) -> list[Reason]:
    return [r for r in reasons if r.severity == "blocking"]


def qualifications_by_driver(db: Session, driver_ids) -> dict[uuid.UUID, list[DriverQualification]]:
    out: dict[uuid.UUID, list[DriverQualification]] = {}
    if driver_ids:
        for q in db.scalars(select(DriverQualification).where(DriverQualification.driver_id.in_(driver_ids))):
            out.setdefault(q.driver_id, []).append(q)
    return out


def check_trio(db: Session, load: Load, driver: Driver, vehicle: Vehicle, trailer: Trailer | None, today: date,
               now: datetime) -> list[Reason]:
    """Everything wrong with assigning exactly these three to the load. Call it with the rows locked."""
    held = commitments(db, load)
    quals = qualifications_by_driver(db, [driver.id]).get(driver.id, [])
    reasons = driver_reasons(load, driver, quals, held.get(("driver", driver.id), []), today, now)
    reasons += unit_reasons(load, vehicle, held.get(("vehicle", vehicle.id), []), today, now, "Truck")
    if trailer is not None:
        reasons += unit_reasons(load, trailer, held.get(("trailer", trailer.id), []), today, now, "Trailer")
    return reasons


def evaluate(db: Session, load: Load, today: date, now: datetime, *, q: str | None = None,
             terminal_id: uuid.UUID | None = None, limit: int = 200) -> EligibleResources:
    """Every driver, truck and trailer that could be considered for the load, eligible ones first."""
    held = commitments(db, load)

    def pick(model, search: tuple, order):
        stmt = select(model).where(model.status.notin_(("terminated", "retired")))
        if terminal_id:
            stmt = stmt.where(model.terminal_id == terminal_id)
        if q:
            pattern = like(q.strip())
            condition = search[0].ilike(pattern)
            for column in search[1:]:
                condition = condition | column.ilike(pattern)
            stmt = stmt.where(condition)
        return list(db.scalars(stmt.order_by(*order).limit(limit)))

    def current(others: list[OtherLoad]) -> OtherLoad | None:
        under_way = [o for o in others if o.status in IN_PROGRESS]
        return (under_way or others or [None])[0]

    def ranked(candidates: list[Candidate]) -> list[Candidate]:
        return sorted(candidates, key=lambda c: (not c.eligible, len(c.reasons), c.name.lower()))

    drivers = pick(Driver, (Driver.first_name, Driver.last_name, Driver.employee_number),
                   (Driver.last_name, Driver.first_name))
    quals = qualifications_by_driver(db, [d.id for d in drivers])
    driver_out = []
    for d in drivers:
        others = held.get(("driver", d.id), [])
        reasons = driver_reasons(load, d, quals.get(d.id, []), others, today, now)
        driver_out.append(Candidate(id=d.id, name=f"{d.first_name} {d.last_name}",
                                    detail=d.driver_type.replace("_", " "), terminal_id=d.terminal_id,
                                    eligible=not blocking(reasons), reasons=reasons, current_load=current(others)))

    def units(model, kind: Kind, what: str) -> list[Candidate]:
        out = []
        for u in pick(model, (model.unit_number, model.plate, model.vin), (model.unit_number,)):
            others = held.get((kind, u.id), [])
            reasons = unit_reasons(load, u, others, today, now, what)
            detail = (u.type.replace("_", " ") if isinstance(u, Trailer)
                      else " ".join(str(x) for x in (u.year, u.make, u.model) if x) or None)
            out.append(Candidate(id=u.id, name=u.unit_number, detail=detail, terminal_id=u.terminal_id,
                                 eligible=not blocking(reasons), reasons=reasons, current_load=current(others)))
        return out

    return EligibleResources(
        load_id=load.id, load_number=load.load_number, needs_trailer=load.equipment_type not in NO_TRAILER,
        drivers=ranked(driver_out), vehicles=ranked(units(Vehicle, "vehicle", "Truck")),
        trailers=ranked(units(Trailer, "trailer", "Trailer")))


def current_loads(db: Session, kind: Kind, ids) -> dict[uuid.UUID, OtherLoad]:
    """For lists: the load each driver or unit is on now, or failing that the next one it is booked on."""
    if not ids:
        return {}
    column = {"driver": DispatchAssignment.driver_id, "vehicle": DispatchAssignment.vehicle_id,
              "trailer": DispatchAssignment.trailer_id}[kind]
    rows = db.execute(
        select(column, Load.id, Load.load_number, Load.status, Load.pickup_at, Load.delivery_at)
        .join(Load, Load.id == DispatchAssignment.load_id)
        .where(DispatchAssignment.status == "active", column.in_(ids), Load.status.in_(HOLDS_RESOURCES))
        .order_by(Load.pickup_at.nulls_last())
    ).all()
    out: dict[uuid.UUID, OtherLoad] = {}
    for rid, load_id, number, status, pickup_at, delivery_at in rows:
        other = OtherLoad(id=load_id, load_number=number, status=status, pickup_at=pickup_at, delivery_at=delivery_at)
        if rid not in out or (other.status in IN_PROGRESS and out[rid].status not in IN_PROGRESS):
            out[rid] = other
    return out
