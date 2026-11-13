"""Assignment: eligibility with reasons, schedule conflicts, concurrency, reassignment, and the board."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from tests.conftest import act, assign, deliver, new_load, seed, stops


def iso(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(days=days, hours=hours)).isoformat()


def reasons(candidate: dict) -> set[str]:
    return {r["code"] for r in candidate["reasons"]}


def eligible(api, load, kind: str, record: dict) -> dict:
    found = api.get("/dispatch/eligible-resources", params={"load_id": load["id"]}).json()
    return next(c for c in found[kind] if c["id"] == record["id"])


def test_the_panel_explains_who_can_take_a_load_and_why_not(org):
    s = seed(org)
    yesterday = str((datetime.now(UTC) - timedelta(days=2)).date())
    soon = str((datetime.now(UTC) + timedelta(days=10)).date())
    expired = org.post("/drivers", {"first_name": "Ed", "last_name": "Expired", "cdl_expiry": yesterday,
                                    "medical_cert_expiry": "2035-01-01"}, 201).json()
    expiring = org.post("/drivers", {"first_name": "Sue", "last_name": "Soon", "cdl_expiry": "2035-01-01",
                                     "medical_cert_expiry": soon}, 201).json()
    inactive = org.post("/drivers", {"first_name": "Ian", "last_name": "Inactive", "status": "inactive",
                                     "cdl_expiry": "2035-01-01", "medical_cert_expiry": "2035-01-01"}, 201).json()
    shop = org.post("/vehicles", {"unit_number": "SHOP-1", "status": "in_maintenance", "insurance_expiry": "2035-01-01",
                                  "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}, 201).json()
    lapsed = org.post("/vehicles", {"unit_number": "LAPSED-1", "insurance_expiry": yesterday,
                                    "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}, 201).json()
    flatbed = org.post("/trailers", {"unit_number": "FB-1", "type": "flatbed", "insurance_expiry": "2035-01-01",
                                     "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}, 201).json()
    load = new_load(org, s["customer"]["id"])

    found = org.get("/dispatch/eligible-resources", params={"load_id": load["id"]}).json()
    assert found["needs_trailer"] is True and found["drivers"][0]["eligible"] is True      # eligible first
    by_id = {c["id"]: c for group in ("drivers", "vehicles", "trailers") for c in found[group]}
    assert by_id[s["driver"]["id"]]["eligible"] and by_id[s["driver"]["id"]]["reasons"] == []
    assert not by_id[expired["id"]]["eligible"] and reasons(by_id[expired["id"]]) == {"CDL_EXPIRED"}
    assert by_id[expiring["id"]]["eligible"] and reasons(by_id[expiring["id"]]) == {"MEDICAL_EXPIRING"}   # a warning only
    assert not by_id[inactive["id"]]["eligible"] and reasons(by_id[inactive["id"]]) == {"DRIVER_NOT_ACTIVE"}
    assert not by_id[shop["id"]]["eligible"] and reasons(by_id[shop["id"]]) == {"UNIT_NOT_ACTIVE"}
    assert not by_id[lapsed["id"]]["eligible"] and reasons(by_id[lapsed["id"]]) == {"INSURANCE_EXPIRED"}
    assert by_id[flatbed["id"]]["eligible"] and reasons(by_id[flatbed["id"]]) == {"EQUIPMENT_MISMATCH"}

    # What the panel shows is what the API enforces.
    for swap in ({"driver_id": expired["id"]}, {"driver_id": inactive["id"]}, {"vehicle_id": shop["id"]},
                 {"vehicle_id": lapsed["id"]}):
        body = assign(org, load, s, expect=409, **swap)["error"]
        assert body["code"] == "ASSIGNMENT_CONFLICT" and body["details"]["reasons"][0]["severity"] == "blocking"
    assert assign(org, load, s, driver_id=expiring["id"], trailer_id=flatbed["id"])["status"] == "assigned"
    assert [c["name"] for c in org.get("/dispatch/eligible-resources", params={"load_id": load["id"], "q": "soon"}).json()["drivers"]] == ["Sue Soon"]


def test_a_required_qualification_blocks_only_when_expired(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    q = org.post(f"/drivers/{s['driver']['id']}/qualifications", {"type": "hazmat", "expires_on": "2020-01-01"}, 201).json()
    assert eligible(org, load, "drivers", s["driver"])["eligible"] is True          # optional: a warning
    org.patch(f"/drivers/{s['driver']['id']}/qualifications/{q['id']}", {"required": True}, 200)
    blocked = eligible(org, load, "drivers", s["driver"])
    assert blocked["eligible"] is False and reasons(blocked) == {"QUALIFICATION_HAZMAT_EXPIRED"}
    assert org.get(f"/drivers/{s['driver']['id']}").json()["compliance"]["status"] == "expired"
    org.patch(f"/drivers/{s['driver']['id']}/qualifications/{q['id']}", {"expires_on": "2035-01-01"}, 200)
    assert eligible(org, load, "drivers", s["driver"])["reasons"] == []


def test_overlapping_work_is_blocked_and_back_to_back_work_is_not(org):
    s = seed(org)
    first = assign(org, new_load(org, s["customer"]["id"]), s)                       # 10 to 12 March 2031

    clash = new_load(org, s["customer"]["id"], stops=stops("2031-03-11T08:00:00Z", "2031-03-13T08:00:00Z"))
    candidate = eligible(org, clash, "drivers", s["driver"])
    assert candidate["eligible"] is False and reasons(candidate) == {"SCHEDULE_CONFLICT"}
    assert candidate["reasons"][0]["load_number"] == first["load_number"] and candidate["current_load"]["id"] == first["id"]
    body = assign(org, clash, s, expect=409)["error"]
    assert body["code"] == "ASSIGNMENT_CONFLICT"
    assert {r["message"].split(" ")[0] for r in body["details"]["reasons"]} == {"Driver", "Truck", "Trailer"}
    assert org.get(f"/loads/{clash['id']}").json()["status"] == "planned"

    later = new_load(org, s["customer"]["id"], stops=stops("2031-03-12T14:00:00Z", "2031-03-14T08:00:00Z"))
    assert assign(org, later, s)["status"] == "assigned"                             # starts as the first one ends

    # A load without a schedule can't be shown to fit around other work, so it counts as a clash.
    open_ended = new_load(org, s["customer"]["id"], stops=[{"type": "pickup", "city": "A"}, {"type": "delivery", "city": "B"}])
    assert assign(org, open_ended, s, expect=409)["error"]["code"] == "ASSIGNMENT_CONFLICT"


def test_a_truck_that_is_running_late_is_still_busy(org):
    s = seed(org)
    past = new_load(org, s["customer"]["id"], stops=stops(iso(days=-3), iso(days=-2)))
    act(org, assign(org, past, s), "dispatch")                                       # should have delivered two days ago
    today = new_load(org, s["customer"]["id"], stops=stops(iso(hours=-1), iso(hours=6)))
    assert assign(org, today, s, expect=409)["error"]["code"] == "ASSIGNMENT_CONFLICT"
    tomorrow = new_load(org, s["customer"]["id"], stops=stops(iso(days=1), iso(days=2)))
    assert assign(org, tomorrow, s)["status"] == "assigned"                          # it can be booked for afterwards


def test_two_dispatchers_cannot_book_the_same_driver_at_once(org):
    s = seed(org)
    loads = [new_load(org, s["customer"]["id"]) for _ in range(4)]                   # four loads, same hours
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda load: org.post("/dispatch/assignments", {
            "load_id": load["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"],
            "trailer_id": s["trailer"]["id"], "version": load["version"]}), loads))
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert all(r.json()["error"]["code"] == "ASSIGNMENT_CONFLICT" for r in results if r.status_code == 409)
    assert sorted(x["status"] for x in org.items("/loads")) == ["assigned", "planned", "planned", "planned"]


def test_a_double_click_assigns_once(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    body = {"load_id": load["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"],
            "trailer_id": s["trailer"]["id"], "version": load["version"]}
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first, second = org.post("/dispatch/assignments", body, 201, headers=key), org.post("/dispatch/assignments", body, 201, headers=key)
    assert second.headers["Idempotent-Replay"] == "true" and second.json()["id"] == first.json()["id"]
    # Without a key the second click is caught by the version check instead.
    assert org.post("/dispatch/assignments", body, 409).json()["error"]["code"] == "VERSION_CONFLICT"
    assert len(org.get(f"/loads/{load['id']}").json()["assignments"]) == 1


def test_reassign_keeps_history_and_unassign_returns_the_load_to_planned(org):
    s = seed(org)
    other = org.post("/drivers", {"first_name": "Rita", "last_name": "Relief", "cdl_expiry": "2035-01-01",
                                  "medical_cert_expiry": "2035-01-01"}, 201).json()
    load = assign(org, new_load(org, s["customer"]["id"]), s)
    first_assignment = load["assignment"]["id"]

    load = org.patch(f"/dispatch/assignments/{first_assignment}", {"driver_id": other["id"], "version": load["version"]}, 200).json()
    assert load["status"] == "assigned" and load["assignment"]["driver"]["name"] == "Rita Relief"
    assert load["assignment"]["vehicle"]["id"] == s["truck"]["id"]                   # what wasn't sent is kept
    assert [(a["driver"]["name"], a["status"]) for a in load["assignments"]] == [("Rita Relief", "active"), ("Dana Driver", "released")]
    assert load["events"][-1]["action"] == "reassign"
    # The replaced assignment is history; acting on it is refused.
    org.error("PATCH", f"/dispatch/assignments/{first_assignment}", 409, "STATE_CONFLICT",
              json={"driver_id": s["driver"]["id"], "version": load["version"]})
    assert org.get(f"/drivers/{s['driver']['id']}").json()["current_load"] is None

    dropped = org.patch(f"/dispatch/assignments/{load['assignment']['id']}", {"trailer_id": None, "version": load["version"]}, 200).json()
    assert dropped["assignment"]["trailer"] is None

    planned = org.post(f"/dispatch/assignments/{dropped['assignment']['id']}/release",
                       {"version": dropped["version"], "reason": "Customer pushed the date"}, 200).json()
    assert planned["status"] == "planned" and planned["assignment"] is None and planned["events"][-1]["action"] == "unassign"
    assert planned["assignments"][0]["release_reason"] == "Customer pushed the date"


def test_swapping_drivers_mid_trip_needs_a_reason_and_dispatched_loads_cannot_be_unassigned(org):
    s = seed(org)
    relief = org.post("/drivers", {"first_name": "Rita", "last_name": "Relief", "cdl_expiry": "2035-01-01",
                                   "medical_cert_expiry": "2035-01-01"}, 201).json()
    load = act(org, assign(org, new_load(org, s["customer"]["id"]), s), "dispatch")
    url = f"/dispatch/assignments/{load['assignment']['id']}"
    assert org.error("PATCH", url, 422, "VALIDATION_ERROR", json={"driver_id": relief["id"], "version": load["version"]})[
        "field_errors"].keys() == {"reason"}
    swapped = org.patch(url, {"driver_id": relief["id"], "version": load["version"], "reason": "Hours of service"}, 200).json()
    assert swapped["status"] == "dispatched" and swapped["assignment"]["driver"]["name"] == "Rita Relief"
    org.error("POST", f"/dispatch/assignments/{swapped['assignment']['id']}/release", 409, "INVALID_TRANSITION",
              json={"version": swapped["version"]})


def test_dispatch_rechecks_eligibility(org):
    s = seed(org)
    load = assign(org, new_load(org, s["customer"]["id"]), s)
    org.patch(f"/vehicles/{s['truck']['id']}", {"status": "out_of_service"}, 200)    # pulled for repair after assigning
    body = act(org, org.get(f"/loads/{load['id']}").json(), "dispatch", expect=409)["error"]
    assert body["code"] == "ASSIGNMENT_CONFLICT" and body["details"]["reasons"][0]["code"] == "UNIT_NOT_ACTIVE"
    unassigned = new_load(org, s["customer"]["id"], stops=stops("2032-01-01T10:00:00Z", "2032-01-02T10:00:00Z"))
    assert act(org, unassigned, "dispatch", expect=409)["error"]["code"] == "INVALID_TRANSITION"


def test_people_and_equipment_in_use_cannot_be_retired_or_removed(org):
    s = seed(org)
    load = assign(org, new_load(org, s["customer"]["id"]), s)
    assert load["load_number"] in org.error("PATCH", f"/drivers/{s['driver']['id']}", 409, "STATE_CONFLICT",
                                            json={"status": "terminated"})["message"]
    org.error("PATCH", f"/vehicles/{s['truck']['id']}", 409, "STATE_CONFLICT", json={"status": "retired"})
    org.error("DELETE", f"/trailers/{s['trailer']['id']}", 409, "STATE_CONFLICT")
    truck = org.get(f"/vehicles/{s['truck']['id']}").json()
    assert truck["current_load"]["load_number"] == load["load_number"] and truck["compliance"]["status"] == "ok"
    act(org, load, "cancel", reason="x")
    assert org.patch(f"/drivers/{s['driver']['id']}", {"status": "terminated"}, 200).json()["status"] == "terminated"


def test_board_views_filters_sorting_and_summary(org):
    s = seed(org)
    yard = org.post("/terminals", {"name": "North yard"}, 201).json()
    c = s["customer"]["id"]
    late = new_load(org, c, stops=stops(iso(hours=-5), iso(days=1)), reference="LATE")
    soon = new_load(org, c, stops=stops(iso(hours=6), iso(days=2)), reference="SOON", terminal_id=yard["id"])
    far = new_load(org, c, stops=stops(iso(days=20), iso(days=22)), reference="FAR")
    rolling = act(org, assign(org, new_load(org, c, stops=stops(iso(days=5), iso(days=6)), reference="ROLL"), s), "dispatch")
    s2 = seed(org)
    delivered = deliver(org, new_load(org, c, stops=stops(iso(days=8), iso(days=9)), reference="DONE"), s2)
    draft = org.post("/loads", {"customer_id": c, "status": "draft", "reference": "DRAFT"}, 201).json()
    cancelled = act(org, new_load(org, c, reference="GONE"), "cancel", reason="x")

    def refs(url="/dispatch/board", **params) -> set[str]:
        return {x["reference"] for x in org.items(url, **params)}

    # The board is what dispatch is still working: no drafts, nothing finished or cancelled.
    assert refs() == {"LATE", "SOON", "FAR", "ROLL", "DONE"}
    assert refs("/loads") == {"LATE", "SOON", "FAR", "ROLL", "DONE", "DRAFT", "GONE"}
    assert refs(view="unassigned") == {"LATE", "SOON", "FAR"}
    assert refs(view="at_risk") == {"LATE", "SOON"} and refs(view="in_transit") == {"ROLL"}
    assert refs(view="missing_pod") == {"DONE"} and refs(status="cancelled") == {"GONE"}
    assert refs(terminal_id=yard["id"]) == {"SOON"} and refs(driver_id=s["driver"]["id"]) == {"ROLL"}
    assert refs(q="roll") == {"ROLL"} and refs(q="dallas") == refs() and refs(origin_state="il") == refs()
    assert refs("/loads", status=["draft", "cancelled"]) == {"DRAFT", "GONE"}
    day = str((datetime.now(UTC) + timedelta(days=20)).date())
    assert "FAR" in refs(pickup_from=day, pickup_to=day)

    risks = {x["reference"]: [r["code"] for r in x["risks"]] for x in org.items("/dispatch/board")}
    assert risks == {"LATE": ["LATE_PICKUP"], "SOON": ["UNASSIGNED_SOON"], "FAR": [], "ROLL": [], "DONE": ["MISSING_POD"]}

    by_pickup = [x["reference"] for x in org.items("/dispatch/board", sort="pickup_at")]
    assert by_pickup == ["LATE", "SOON", "ROLL", "DONE", "FAR"]
    assert [x["reference"] for x in org.items("/dispatch/board", sort="-pickup_at")] == by_pickup[::-1]
    first_page = org.get("/dispatch/board", params={"sort": "pickup_at", "limit": 2}).json()
    second_page = org.items("/dispatch/board", sort="pickup_at", limit=2, cursor=first_page["page"]["next_cursor"])
    assert [x["reference"] for x in first_page["items"] + second_page] == by_pickup[:4]

    summary = org.get("/dispatch/summary").json()
    assert summary == {"active": 5, "unassigned": 3, "pickups_today": summary["pickups_today"],
                       "deliveries_today": summary["deliveries_today"], "at_risk": 2, "in_transit": 1,
                       "missing_pod": 1, "on_hold": 0}
    assert org.get("/dispatch/summary", params={"terminal_id": yard["id"]}).json()["active"] == 1
    assert all(x for x in (late, soon, far, rolling, delivered, draft, cancelled))


def test_a_driver_sees_and_moves_only_their_own_loads(org):
    s = seed(org, with_login=True)
    driver = s["driver_api"]
    load = assign(org, new_load(org, s["customer"]["id"], instructions="Call ahead"), s)
    assert driver.get("/driver/loads").json() == []                 # assigned, but not yet sent to the driver
    load = act(org, load, "dispatch")
    mine = driver.get("/driver/loads").json()
    assert [x["load_number"] for x in mine] == [load["load_number"]] and mine[0]["allowed_actions"] == ["arrive"]
    assert mine[0]["instructions"] == "Call ahead" and "customer_rate" not in mine[0] and "revenue" not in mine[0]

    step = driver.post(f"/driver/loads/{load['id']}/transitions", {"action": "arrive", "version": mine[0]["version"]}, 200).json()
    assert step["status"] == "at_pickup" and step["allowed_actions"] == ["depart"]
    driver.post(f"/driver/loads/{load['id']}/tracking", {"note": "Loading now"}, 201)
    assert org.get(f"/loads/{load['id']}").json()["tracking"][0]["source"] == "driver"
    driver.error("POST", f"/driver/loads/{load['id']}/transitions", 409, "VERSION_CONFLICT",
                 json={"action": "depart", "version": 1})

    # Another driver's load is invisible, and so is everything outside the driver screens.
    s2 = seed(org, with_login=True)
    other = act(org, assign(org, new_load(org, s2["customer"]["id"]), s2), "dispatch")
    driver.error("GET", f"/driver/loads/{other['id']}", 404, "NOT_FOUND")
    driver.error("POST", f"/driver/loads/{other['id']}/transitions", 404, "NOT_FOUND", json={"action": "arrive", "version": other["version"]})
    driver.error("GET", f"/loads/{load['id']}", 403, "FORBIDDEN")
    unlinked = org.add_user("driver")
    unlinked.error("GET", "/driver/loads", 403, "DRIVER_NOT_LINKED")
