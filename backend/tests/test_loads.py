"""The load lifecycle (decision 0002): states, transitions, stops, charges and optimistic concurrency."""
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from tests.conftest import act, assign, complete, deliver, new_load, seed, stops, upload


def iso(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(days=days, hours=hours)).isoformat()


def test_a_load_is_booked_with_its_route_items_and_charges(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], reference="PO-778", equipment_type="reefer",
                    items=[{"description": "Frozen peas", "quantity": 22, "unit": "pallets", "weight_lbs": 38000}],
                    charges=[{"type": "fuel_surcharge", "quantity": "1", "rate": "180.00"},
                             {"type": "lumper", "rate": "95.50", "billable": False, "driver_payable": True}])
    assert load["load_number"] == "L-1001" and load["status"] == "planned" and load["version"] == 1
    assert load["billing_status"] == "unbilled" and load["customer"]["name"] == "Globex"
    # The ends of the route are copied onto the load for the board to filter and sort on.
    assert (load["origin_city"], load["destination_state"]) == ("Chicago", "TX")
    assert load["pickup_at"].startswith("2031-03-10") and load["delivery_at"].startswith("2031-03-12")
    assert [x["seq"] for x in load["stops"]] == [1, 2] and load["items"][0]["quantity"] == 22
    # Revenue is the rate plus billable charges only.
    assert load["customer_rate"] == "2500.00" and load["charges_total"] == "180.00" and load["revenue"] == "2680.00"
    assert [e["action"] for e in load["events"]] == ["created"] and load["events"][0]["actor_name"] == "Olive Owner"
    assert set(load["allowed_actions"]) == {"hold", "cancel", "assign"}
    assert new_load(org, s["customer"]["id"])["load_number"] == "L-1002"


def test_a_planned_load_needs_a_real_route_but_a_draft_does_not(org):
    s = seed(org)
    for bad in ([], stops()[:1], list(reversed(stops()))):
        body = org.error("POST", "/loads", 422, "VALIDATION_ERROR", json={"customer_id": s["customer"]["id"], "stops": bad})
        assert "stops" in body["field_errors"] or "stops.1.appt_start" in body["field_errors"]
    backwards = stops("2031-03-12T10:00:00Z", "2031-03-10T10:00:00Z")
    assert "stops.1.appt_start" in org.error("POST", "/loads", 422, "VALIDATION_ERROR", json={
        "customer_id": s["customer"]["id"], "stops": backwards})["field_errors"]

    draft = org.post("/loads", {"customer_id": s["customer"]["id"], "status": "draft"}, 201).json()
    assert draft["status"] == "draft" and draft["stops"] == [] and set(draft["allowed_actions"]) == {"mark_ready", "cancel"}
    assert act(org, draft, "mark_ready", expect=422)["error"]["field_errors"].keys() == {"stops"}
    draft = org.put(f"/loads/{draft['id']}/stops", {"version": draft["version"], "stops": stops()}, 200).json()
    ready = act(org, draft, "mark_ready")
    assert ready["status"] == "planned" and [e["action"] for e in ready["events"]] == ["created", "mark_ready"]


def test_booking_for_an_archived_customer_is_refused(org):
    s = seed(org)
    org.post(f"/customers/{s['customer']['id']}/archive", expect=200)
    assert org.error("POST", "/loads", 422, "VALIDATION_ERROR", json={
        "customer_id": s["customer"]["id"], "stops": stops()})["field_errors"].keys() == {"customer_id"}


def test_the_whole_lifecycle_from_booking_to_completed(org):
    s = seed(org)
    load = assign(org, new_load(org, s["customer"]["id"]), s)
    assert load["status"] == "assigned" and load["assignment"]["driver"]["name"] == "Dana Driver"
    load = act(org, load, "dispatch")
    load = act(org, load, "arrive")
    assert load["status"] == "at_pickup" and load["stops"][0]["arrived_at"] and not load["stops"][0]["departed_at"]
    load = act(org, load, "depart")
    assert load["status"] == "in_transit"
    load = act(org, load, "arrive", stop_id=load["stops"][1]["id"])
    assert load["status"] == "at_delivery"
    load = act(org, load, "depart")
    assert load["status"] == "delivered" and load["delivered_at"]
    # Delivery frees the driver and equipment, but the load still shows who hauled it.
    assert load["assignment"]["status"] == "completed" and org.get(f"/drivers/{s['driver']['id']}").json()["current_load"] is None
    assert [r["code"] for r in load["risks"]] == ["MISSING_POD"]
    assert act(org, load, "approve_pod", expect=409)["error"]["code"] == "INVALID_TRANSITION"

    upload(org, "load", load["id"])                       # the POD arriving moves the load into review by itself
    load = org.get(f"/loads/{load['id']}").json()
    assert load["status"] == "pod_review" and set(load["allowed_actions"]) == {"approve_pod", "reject_pod"}
    load = act(org, load, "approve_pod")
    assert load["status"] == "completed" and load["allowed_actions"] == []
    assert [e["action"] for e in load["events"]] == ["created", "assign", "dispatch", "arrive", "depart", "arrive",
                                                     "depart", "pod_uploaded", "approve_pod"]
    assert [(e["from_status"], e["to_status"]) for e in load["events"]][-1] == ("pod_review", "completed")
    document = org.items("/documents", entity_type="load", entity_id=load["id"])[0]
    assert document["review_status"] == "approved" and document["reviewed_by_name"] == "Olive Owner"


def test_a_rejected_pod_sends_the_load_back_for_a_new_one(org):
    s = seed(org)
    load = deliver(org, new_load(org, s["customer"]["id"]), s)
    upload(org, "load", load["id"])
    load = org.get(f"/loads/{load['id']}").json()
    assert act(org, load, "reject_pod", expect=422)["error"]["field_errors"] == {"reason": "Give a reason"}
    load = act(org, load, "reject_pod", reason="Signature is missing")
    assert load["status"] == "delivered" and load["events"][-1]["note"] == "Signature is missing"
    rejected = org.items("/documents", entity_type="load", entity_id=load["id"])[0]
    assert rejected["review_status"] == "rejected" and rejected["review_note"] == "Signature is missing"
    # A rejected POD doesn't count; a fresh one does.
    upload(org, "load", load["id"], filename="pod-signed.pdf")
    load = org.get(f"/loads/{load['id']}").json()
    assert load["status"] == "pod_review" and act(org, load, "approve_pod")["status"] == "completed"


def test_a_pod_uploaded_early_is_waiting_when_the_load_delivers(org):
    s = seed(org)
    load = act(org, assign(org, new_load(org, s["customer"]["id"]), s), "dispatch")
    upload(org, "load", load["id"])
    assert org.get(f"/loads/{load['id']}").json()["status"] == "dispatched"
    for action in ("arrive", "depart", "arrive", "depart"):
        load = act(org, org.get(f"/loads/{load['id']}").json(), action)
    assert load["status"] == "pod_review" and [e["action"] for e in load["events"]][-2:] == ["depart", "pod_uploaded"]


ILLEGAL = [("planned", "dispatch"), ("planned", "arrive"), ("planned", "approve_pod"), ("planned", "release"),
           ("assigned", "arrive"), ("assigned", "mark_ready"), ("dispatched", "depart"), ("dispatched", "approve_pod"),
           ("in_transit", "hold"), ("in_transit", "cancel"), ("delivered", "cancel"), ("delivered", "arrive"),
           ("completed", "cancel"), ("completed", "hold"), ("cancelled", "mark_ready"), ("cancelled", "dispatch")]


@pytest.fixture(scope="module")
def loads_by_status(client):
    """One load parked in each status, shared by the illegal-transition checks."""
    from tests.conftest import PASSWORD, Api
    r = client.post("/api/v1/auth/signup", json={"organization_name": "Transition Co", "full_name": "T",
                                                  "email": f"transitions-{datetime.now(UTC).timestamp()}@example.com",
                                                  "password": PASSWORD})
    api = Api(client, r.json()["access_token"], r.json()["organization"]["id"])
    made = {}
    for i, target in enumerate(("planned", "assigned", "dispatched", "in_transit", "delivered", "completed", "cancelled")):
        s = seed(api)
        window = stops(f"2032-0{i + 1}-10T14:00:00Z", f"2032-0{i + 1}-12T14:00:00Z")
        load = new_load(api, s["customer"]["id"], stops=window)
        if target == "cancelled":
            load = act(api, load, "cancel", reason="Customer cancelled")
        elif target == "completed":
            load = complete(api, s, stops=window)
        elif target == "delivered":
            load = deliver(api, load, s)
        elif target != "planned":
            load = assign(api, load, s)
            for action in {"assigned": (), "dispatched": ("dispatch",), "in_transit": ("dispatch", "arrive", "depart")}[target]:
                load = act(api, load, action)
        assert load["status"] == target
        made[target] = load
    return api, made


@pytest.mark.parametrize("status,action", ILLEGAL, ids=[f"{s}-{a}" for s, a in ILLEGAL])
def test_illegal_transitions_are_refused_and_change_nothing(loads_by_status, status, action):
    api, made = loads_by_status
    load = api.get(f"/loads/{made[status]['id']}").json()
    body = act(api, load, action, expect=409, reason="because")["error"]
    assert body["code"] == "INVALID_TRANSITION" and body["details"]["status"] == status
    after = api.get(f"/loads/{load['id']}").json()
    assert (after["status"], after["version"], len(after["events"])) == (status, load["version"], len(load["events"]))


def test_status_cannot_be_set_directly(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    # There is no such field to patch: the lifecycle is the only way to change status.
    org.patch(f"/loads/{load['id']}", {"version": load["version"], "status": "completed"}, 200)
    assert org.get(f"/loads/{load['id']}").json()["status"] == "planned"


def test_hold_release_and_cancel(org):
    s = seed(org)
    load = assign(org, new_load(org, s["customer"]["id"]), s)
    assert act(org, load, "hold", expect=422)["error"]["field_errors"] == {"reason": "Give a reason"}
    held = act(org, load, "hold", reason="Waiting on customer")
    assert held["status"] == "on_hold" and held["held_from_status"] == "assigned"
    assert held["assignment"]["status"] == "active"            # a held load keeps its truck
    assert act(org, held, "release")["status"] == "assigned"   # and goes back to where it was

    load = org.get(f"/loads/{load['id']}").json()
    cancelled = act(org, act(org, load, "hold", reason="again"), "cancel", reason="Shipper cancelled")
    assert cancelled["status"] == "cancelled" and cancelled["assignment"] is None
    assert cancelled["assignments"][0]["status"] == "released" and cancelled["assignments"][0]["release_reason"] == "Load cancelled"
    assert org.get(f"/drivers/{s['driver']['id']}").json()["current_load"] is None
    org.error("PATCH", f"/loads/{load['id']}", 409, "STATE_CONFLICT", json={"version": cancelled["version"], "miles": 5})


def test_a_stale_version_is_rejected_everywhere(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    fresh = org.patch(f"/loads/{load['id']}", {"version": load["version"], "reference": "PO-1"}, 200).json()
    assert fresh["version"] == load["version"] + 1 and fresh["reference"] == "PO-1"

    stale = load["version"]
    body = org.error("PATCH", f"/loads/{load['id']}", 409, "VERSION_CONFLICT", json={"version": stale, "reference": "PO-2"})
    assert body["details"] == {"current_version": fresh["version"], "your_version": stale}
    org.error("POST", f"/loads/{load['id']}/transitions", 409, "VERSION_CONFLICT",
              json={"action": "cancel", "version": stale, "reason": "x"})
    org.error("PUT", f"/loads/{load['id']}/stops", 409, "VERSION_CONFLICT", json={"version": stale, "stops": stops()})
    org.error("POST", "/dispatch/assignments", 409, "VERSION_CONFLICT", json={
        "load_id": load["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"], "version": stale})
    assert org.get(f"/loads/{load['id']}").json()["reference"] == "PO-1"       # nothing was overwritten


def test_two_people_acting_on_the_same_version_cannot_both_win(org):
    s = seed(org)
    load = assign(org, new_load(org, s["customer"]["id"]), s)

    def attempt(action):
        return org.post(f"/loads/{load['id']}/transitions", {"action": action, "version": load["version"], "reason": "r"})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, ["dispatch", "hold"]))
    assert sorted(r.status_code for r in results) == [200, 409]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json()["error"]["code"] == "VERSION_CONFLICT"
    assert len(org.get(f"/loads/{load['id']}").json()["events"]) == 3      # created, assign, and exactly one more


def test_route_edits_stop_at_dispatch_but_appointments_can_still_move(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    three = [*stops()[:1], {"type": "delivery", "city": "St. Louis", "state": "MO", "appt_start": "2031-03-11T09:00:00Z"},
             *stops()[1:]]
    load = org.put(f"/loads/{load['id']}/stops", {"version": load["version"], "stops": three}, 200).json()
    assert [x["city"] for x in load["stops"]] == ["Chicago", "St. Louis", "Dallas"]
    org.error("PUT", f"/loads/{load['id']}/stops", 422, "VALIDATION_ERROR", json={"version": load["version"], "stops": stops()[:1]})

    load = act(org, assign(org, load, s), "dispatch")
    assert load["editable"] == {"details": True, "customer": False, "stops": False, "schedule": True, "rates": True}
    org.error("PUT", f"/loads/{load['id']}/stops", 409, "INVALID_TRANSITION", json={"version": load["version"], "stops": stops()})
    last = load["stops"][-1]
    moved = org.patch(f"/loads/{load['id']}/stops/{last['id']}", {
        "version": load["version"], "appt_start": "2031-03-13T08:00:00Z", "appt_end": "2031-03-13T12:00:00Z"}, 200).json()
    assert moved["delivery_at"].startswith("2031-03-13T12") and moved["version"] == load["version"] + 1
    # Once the truck has left a stop, that stop is history.
    moved = act(org, act(org, moved, "arrive"), "depart")
    org.error("PATCH", f"/loads/{load['id']}/stops/{moved['stops'][0]['id']}", 409, "STATE_CONFLICT",
              json={"version": moved["version"], "reference": "late edit"})


def test_arrivals_and_departures_keep_time_in_order(org):
    s = seed(org)
    load = act(org, assign(org, new_load(org, s["customer"]["id"]), s), "dispatch")
    assert "occurred_at" in act(org, load, "arrive", expect=422, occurred_at=iso(days=1))["error"]["field_errors"]
    load = act(org, load, "arrive", occurred_at=iso(hours=-3))
    assert "occurred_at" in act(org, load, "depart", expect=422, occurred_at=iso(hours=-4))["error"]["field_errors"]
    load = act(org, load, "depart", occurred_at=iso(hours=-2))
    assert "occurred_at" in act(org, load, "arrive", expect=422, occurred_at=iso(hours=-2.5))["error"]["field_errors"]
    # Naming the wrong stop (a stale screen, a double tap) is caught rather than applied to the next stop.
    assert act(org, load, "arrive", expect=409, stop_id=load["stops"][0]["id"])["error"]["code"] == "STATE_CONFLICT"


def test_charges_keep_revenue_in_step_and_close_when_invoiced(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    charge = org.post(f"/loads/{load['id']}/charges", {"type": "detention", "quantity": "2.5", "rate": "60.00",
                                                       "description": "2.5 h at receiver"}, 201).json()
    assert charge["amount"] == "150.00"
    assert org.get(f"/loads/{load['id']}").json()["revenue"] == "2650.00"
    org.patch(f"/loads/{load['id']}/charges/{charge['id']}", {"quantity": "3"}, 200)
    org.post(f"/loads/{load['id']}/charges", {"type": "other", "rate": "-50.00", "description": "Late fee"}, 201)
    after = org.get(f"/loads/{load['id']}").json()
    assert after["charges_total"] == "130.00" and after["revenue"] == "2630.00" and after["version"] > load["version"]
    org.error("POST", f"/loads/{load['id']}/charges", 422, "VALIDATION_ERROR", json={"type": "other", "rate": "-9999.00"})
    org.delete(f"/loads/{load['id']}/charges/{charge['id']}", expect=204)
    assert org.get(f"/loads/{load['id']}").json()["revenue"] == "2450.00"

    done = complete(org, s)
    invoice = org.post("/invoices", {"customer_id": s["customer"]["id"], "load_ids": [done["id"]]}, 201).json()
    org.post(f"/invoices/{invoice['id']}/issue", expect=200)
    org.error("POST", f"/loads/{done['id']}/charges", 409, "STATE_CONFLICT", json={"type": "lumper", "rate": "40.00"})
    locked = org.get(f"/loads/{done['id']}").json()
    org.error("PATCH", f"/loads/{done['id']}", 409, "STATE_CONFLICT", json={"version": locked["version"], "customer_rate": "1.00"})
    assert locked["editable"]["rates"] is False and locked["invoice"]["status"] == "issued"


def test_concurrent_charges_never_lose_one_from_the_total(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], customer_rate="1000.00")
    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(lambda i: org.post(f"/loads/{load['id']}/charges", {"type": "other", "rate": "10.00"}).status_code,
                              range(6)))
    assert codes == [201] * 6
    assert org.get(f"/loads/{load['id']}").json()["charges_total"] == "60.00"


def test_notes_and_check_calls(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    noted = org.post(f"/loads/{load['id']}/notes", {"body": "  Dock closes at 4pm  "}, 201).json()
    assert noted["notes"][0]["body"] == "Dock closes at 4pm" and noted["notes"][0]["author_name"] == "Olive Owner"
    assert noted["version"] == load["version"]                 # a note doesn't invalidate what others have open
    load = act(org, assign(org, load, s), "dispatch")
    org.error("POST", f"/loads/{load['id']}/tracking", 422, "VALIDATION_ERROR", json={})
    tracked = org.post(f"/loads/{load['id']}/tracking", {"city": "Springfield", "state": "IL", "note": "Rolling"}, 201).json()
    org.post(f"/loads/{load['id']}/tracking", {"kind": "exception", "note": "Flat tire, 2 h delay"}, 201)
    latest = org.get(f"/loads/{load['id']}").json()["tracking"]
    assert [t["kind"] for t in latest] == ["exception", "check_call"] and tracked["tracking"][0]["source"] == "dispatcher"


def test_rates_are_hidden_from_roles_that_may_not_see_them(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], charges=[{"type": "lumper", "rate": "50.00"}])
    safety = org.add_user("safety_manager")
    seen = safety.get(f"/loads/{load['id']}").json()
    assert seen["revenue"] is None and seen["customer_rate"] is None and seen["charges_total"] is None and seen["charges"] == []
    assert safety.items("/loads")[0]["revenue"] is None
    safety.error("GET", f"/loads/{load['id']}/charges", 403, "FORBIDDEN")
    safety.error("GET", "/loads", 422, "VALIDATION_ERROR", params={"sort": "revenue"})
    assert org.items("/loads", sort="-revenue")[0]["revenue"] == "2550.00"
