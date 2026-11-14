"""Driver settlements: built from delivered loads and expenses, approved once and then fixed, paid, voided."""
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import deliver, new_load, seed, stops

TODAY = datetime.now(UTC).date()      # test companies run on UTC
WEEK = {"period_start": str(TODAY - timedelta(days=6)), "period_end": str(TODAY)}


def terms(api, s, pay_type="per_mile", pay_rate="0.62"):
    api.patch(f"/drivers/{s['driver']['id']}", {"pay_type": pay_type, "pay_rate": pay_rate}, 200)


def delivered(api, s, **extra):
    """A load delivered today by the seeded driver. Each one is booked a week after the previous so they never clash."""
    count = len(api.items("/loads"))
    day = datetime.now(UTC) + timedelta(days=7 * count + 1)
    load = new_load(api, s["customer"]["id"], stops=stops(day.isoformat(), (day + timedelta(days=1)).isoformat()), **extra)
    return deliver(api, load, s)


def draft(api, s, expect=201, **extra):
    return api.post("/settlements", {"driver_id": s["driver"]["id"], **WEEK, **extra}, expect).json()


def act(api, st, action, expect=200, **body):
    return api.post(f"/settlements/{st['id']}/{action}", {"version": st["version"], **body}, expect).json()


def expense(api, s, category, amount, treatment, **extra):
    return api.post("/expenses", {"category": category, "incurred_on": str(TODAY), "amount": amount,
                                  "driver_id": s["driver"]["id"], "driver_treatment": treatment, **extra}, 201).json()


def test_a_draft_pays_the_weeks_loads_charges_reimbursements_and_deductions(org):
    s = seed(org)
    terms(org, s)
    load = delivered(org, s)                                                      # 920 miles
    org.post(f"/loads/{load['id']}/charges", {"type": "detention", "quantity": "2", "rate": "75.00", "driver_payable": True}, 201)
    org.post(f"/loads/{load['id']}/charges", {"type": "fuel_surcharge", "rate": "120.00"}, 201)    # billed, not the driver's
    lumper = expense(org, s, "lumper", "85.00", "reimburse", vendor="Capstone")
    advance = expense(org, s, "advance", "200.00", "deduct")
    expense(org, s, "tolls", "12.00", "none")                                     # the company's own cost

    st = draft(org, s, notes="Week 46")
    assert st["status"] == "draft" and st["number"] is None and st["driver"]["name"] == "Dana Driver"
    lines = [(x["kind"], x["description"], x["quantity"], x["rate"], x["amount"]) for x in st["lines"]]
    assert lines == [
        ("load_pay", "L-1001 Chicago, IL to Dallas, TX: 920 mi at 0.62 per mile", "920.00", "0.62", "570.40"),
        ("accessorial", "L-1001: Detention", "2.00", "75.00", "150.00"),
        ("reimbursement", f"Lumper, {TODAY.isoformat()}: Capstone", "1.00", "85.00", "85.00"),
        ("deduction", f"Cash advance, {TODAY.isoformat()}", "1.00", "-200.00", "-200.00"),
    ]
    assert (st["earnings"], st["reimbursements"], st["deductions"], st["net_pay"]) == ("720.40", "85.00", "200.00", "605.40")
    assert st["lines"][0]["load"] == {"id": load["id"], "name": "L-1001"}
    assert set(st["allowed_actions"]) == {"edit", "recalculate", "add_line", "approve", "delete"}
    assert st["pay_terms"] == {"pay_type": "per_mile", "pay_rate": "0.62"}
    # The expenses know where they went.
    assert org.get(f"/expenses/{lumper['id']}").json()["settlement"] == {"id": st["id"], "number": None, "status": "draft"}

    # One draft per driver.
    assert draft(org, s, 409)["error"]["code"] == "SETTLEMENT_DRAFT_EXISTS"

    # Changing an expense on the draft changes the draft; a new one for the driver joins it.
    org.patch(f"/expenses/{advance['id']}", {"amount": "150.00"}, 200)
    expense(org, s, "scales", "13.50", "reimburse")
    st = org.get(f"/settlements/{st['id']}").json()
    assert (st["reimbursements"], st["deductions"], st["net_pay"]) == ("98.50", "150.00", "668.90")
    org.delete(f"/expenses/{lumper['id']}", 204)
    assert org.get(f"/settlements/{st['id']}").json()["net_pay"] == "583.90"


def test_hand_entered_lines_survive_a_recalculation_and_figures_follow_the_pay_terms(org):
    s = seed(org)
    terms(org, s, "percent", "25")
    delivered(org, s, customer_rate="2000.00")
    st = draft(org, s)
    assert [(x["description"], x["amount"]) for x in st["lines"]] == [
        ("L-1001 Chicago, IL to Dallas, TX: 25% of 2000.00 USD", "500.00")]

    st = act(org, st, "lines", 201, kind="adjustment", description="Safety bonus", amount="50.00")
    st = act(org, st, "lines", 201, kind="deduction", description="Occupational insurance", amount="35.00")
    assert (st["earnings"], st["deductions"], st["net_pay"]) == ("550.00", "35.00", "515.00")
    assert act(org, st, "lines", 422, kind="adjustment", description="Nothing", amount="0")["error"]["field_errors"] == \
        {"amount": "Enter an amount other than zero"}

    # New pay terms, then a recalculation: the load line follows, the hand-entered lines stay.
    terms(org, s, "flat", "650")
    st = act(org, st, "recalculate")
    assert [(x["kind"], x["amount"], x["manual"]) for x in st["lines"]] == [
        ("load_pay", "650.00", False), ("adjustment", "50.00", True), ("deduction", "-35.00", True)]
    assert st["net_pay"] == "665.00"

    auto = next(x for x in st["lines"] if not x["manual"])
    org.error("DELETE", f"/settlements/{st['id']}/lines/{auto['id']}", 409, "STATE_CONFLICT", params={"version": st["version"]})
    bonus = next(x for x in st["lines"] if x["description"] == "Safety bonus")
    org.error("DELETE", f"/settlements/{st['id']}/lines/{bonus['id']}", 409, "VERSION_CONFLICT", params={"version": st["version"] - 1})
    st = org.delete(f"/settlements/{st['id']}/lines/{bonus['id']}", 200, params={"version": st["version"]}).json()
    assert st["net_pay"] == "615.00"

    # The period decides which loads: one delivered after it is left for next time.
    st = org.patch(f"/settlements/{st['id']}", {"version": st["version"], "period_end": str(TODAY - timedelta(days=1)),
                                                "period_start": str(TODAY - timedelta(days=7))}, 200).json()
    assert [x["kind"] for x in st["lines"]] == ["deduction"] and st["net_pay"] == "-35.00"
    assert org.patch(f"/settlements/{st['id']}", {"version": st["version"], "period_end": str(TODAY - timedelta(days=9))}, 422) \
        .json()["error"]["field_errors"] == {"period_end": "The period ends before it starts"}


def test_approval_numbers_and_fixes_it_then_it_is_paid(org, owner_sql):
    s = seed(org)
    terms(org, s)
    delivered(org, s)
    advance = expense(org, s, "advance", "100.00", "deduct")
    st = draft(org, s)
    org.error("POST", f"/settlements/{st['id']}/approve", 409, "VERSION_CONFLICT", json={"version": st["version"] - 1})
    st = act(org, st, "approve")
    assert (st["status"], st["number"], st["net_pay"]) == ("approved", "ST-1001", "470.40")
    assert set(st["allowed_actions"]) == {"pay", "void"} and st["approved_at"]

    # Fixed: no route changes it, its expenses are locked, and the database refuses too.
    org.error("POST", f"/settlements/{st['id']}/lines", 409, "SETTLEMENT_NOT_DRAFT",
              json={"kind": "adjustment", "description": "x", "amount": "1.00", "version": st["version"]})
    org.error("POST", f"/settlements/{st['id']}/recalculate", 409, "SETTLEMENT_NOT_DRAFT", json={"version": st["version"]})
    org.error("DELETE", f"/settlements/{st['id']}", 409, "SETTLEMENT_NOT_DRAFT")
    org.error("PATCH", f"/expenses/{advance['id']}", 409, "EXPENSE_SETTLED", json={"amount": "1.00"})
    org.error("DELETE", f"/expenses/{advance['id']}", 409, "EXPENSE_SETTLED")
    assert org.get(f"/expenses/{advance['id']}").json()["editable"] is False
    for statement in ("UPDATE driver_settlements SET net_pay = 1 WHERE id = :i", "DELETE FROM driver_settlements WHERE id = :i",
                      "UPDATE settlement_lines SET amount = 1 WHERE settlement_id = :i",
                      "UPDATE expenses SET amount = 1 WHERE settlement_id = :i"):
        with pytest.raises(DBAPIError, match="approved settlement|Only a draft"), owner_sql.begin() as c:
            c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org.org_id})
            c.execute(text(statement), {"i": st["id"]})

    # The loads it paid are not offered again.
    second = draft(org, s)
    assert second["lines"] == [] and second["net_pay"] == "0.00"
    assert act(org, second, "approve", 409)["error"]["code"] == "SETTLEMENT_EMPTY"
    org.delete(f"/settlements/{second['id']}", 204)

    assert act(org, st, "pay", 422, paid_on=str(TODAY + timedelta(days=1)), method="ach")["error"]["field_errors"] == \
        {"paid_on": "The payment date can't be in the future"}
    st = act(org, st, "pay", paid_on=str(TODAY), method="direct_deposit", reference="DD-5521")
    assert (st["status"], st["paid_on"], st["paid_method"], st["paid_reference"]) == ("paid", str(TODAY), "direct_deposit", "DD-5521")
    assert act(org, st, "void", 409, reason="Too late")["error"]["code"] == "INVALID_TRANSITION"

    summary = org.get("/settlements/summary").json()
    assert (summary["drafts"], summary["approved_unpaid"], summary["to_pay"], summary["paid_this_month"]) == (0, 0, "0.00", "470.40")
    actions = [e["action"] for e in org.items("/audit-logs", entity_type="settlement", entity_id=st["id"])]
    assert actions == ["settlement.paid", "settlement.approved", "settlement.created"]


def test_voiding_frees_its_loads_and_expenses_for_another_settlement(org):
    s = seed(org)
    terms(org, s, "flat", "500")
    delivered(org, s)
    advance = expense(org, s, "advance", "100.00", "deduct")
    st = act(org, draft(org, s), "approve")
    assert act(org, st, "void", 422)["error"]["code"] == "VALIDATION_ERROR"           # a reason is required
    voided = act(org, st, "void", reason="Wrong pay rate")
    assert (voided["status"], voided["void_reason"], voided["allowed_actions"]) == ("void", "Wrong pay rate", [])
    assert org.get(f"/expenses/{advance['id']}").json()["settlement"] is None

    again = draft(org, s)
    assert [(x["kind"], x["amount"]) for x in again["lines"]] == [("load_pay", "500.00"), ("deduction", "-100.00")]
    assert act(org, again, "approve")["number"] == "ST-1002"
    assert [x["number"] for x in org.items("/settlements", status="void")] == ["ST-1001"]


def test_only_delivered_loads_hauled_by_the_driver_count(org):
    s = seed(org)
    terms(org, s, "flat", "400")
    delivered(org, s)
    # Another driver's delivered load, and this driver's load still on the road.
    other = org.post("/drivers", {"first_name": "Omar", "last_name": "Other", "cdl_expiry": "2035-01-01",
                                  "medical_cert_expiry": "2035-01-01"}, 201).json()
    truck = org.post("/vehicles", {"unit_number": "T-OTHER", "insurance_expiry": "2035-01-01",
                                   "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}, 201).json()
    delivered(org, {**s, "driver": other, "truck": truck})
    rolling = new_load(org, s["customer"]["id"], stops=stops((datetime.now(UTC) + timedelta(days=60)).isoformat(),
                                                             (datetime.now(UTC) + timedelta(days=61)).isoformat()))
    org.post("/dispatch/assignments", {"load_id": rolling["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"],
                                       "trailer_id": s["trailer"]["id"], "version": rolling["version"]}, 201)
    st = draft(org, s)
    assert [x["load"]["name"] for x in st["lines"]] == ["L-1001"]


def test_roles_and_companies(org, make_org):
    s = seed(org)
    terms(org, s)
    delivered(org, s)
    accountant = org.add_user("accountant")
    st = draft(accountant, s)
    for role in ("dispatcher", "fleet_manager"):
        org.add_user(role).error("GET", "/settlements", 403, "FORBIDDEN")
    viewer = org.add_user("viewer")
    seen = viewer.get(f"/settlements/{st['id']}").json()
    assert seen["allowed_actions"] == [] and seen["net_pay"] == st["net_pay"]
    viewer.error("POST", f"/settlements/{st['id']}/approve", 403, "FORBIDDEN", json={"version": st["version"]})
    other = make_org("Other Freight")
    other.error("GET", f"/settlements/{st['id']}", 404, "NOT_FOUND")
    assert other.post("/settlements", {"driver_id": s["driver"]["id"], **WEEK}, 422).json()["error"]["field_errors"] == \
        {"driver_id": "Driver not found"}


def test_two_people_starting_the_same_drivers_settlement_at_once_get_one_draft(org):
    s = seed(org)
    terms(org, s)
    delivered(org, s)
    body = {"driver_id": s["driver"]["id"], **WEEK}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: org.post("/settlements", body), range(2)))
    assert sorted(r.status_code for r in results) == [201, 409]
    assert next(r for r in results if r.status_code == 409).json()["error"]["code"] in ("SETTLEMENT_DRAFT_EXISTS", "DUPLICATE_REFERENCE")
    assert len(org.items("/settlements")) == 1


def test_the_dashboard_says_when_approved_pay_is_waiting(org):
    s = seed(org)
    terms(org, s, "flat", "300")
    delivered(org, s)
    act(org, draft(org, s), "approve")
    alerts = {e["code"]: e for e in org.get("/dashboard/exceptions").json()}
    assert alerts["SETTLEMENTS_TO_PAY"]["count"] == 1 and alerts["SETTLEMENTS_TO_PAY"]["detail"] == "300.00 USD to pay out"
    assert alerts["SETTLEMENTS_TO_PAY"]["params"] == {"status": "approved"}
