"""Maintenance: work orders and their costs, inspections and their defects, and the road back into service."""
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from tests.conftest import new_load, seed, upload

TODAY = datetime.now(UTC).date()      # test companies run on UTC
DATES = {"insurance_expiry": "2035-01-01", "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}


def work_order(api, unit: dict, *, unit_type: str = "vehicle", expect: int = 201, **extra) -> dict:
    body = {f"{unit_type}_id": unit["id"], "title": "Brake service", **extra}
    return api.post("/maintenance/work-orders", body, expect).json()


def move(api, wo: dict, action: str, expect: int = 200, **extra) -> dict:
    return api.post(f"/maintenance/work-orders/{wo['id']}/transitions", {"action": action, "version": wo["version"], **extra},
                    expect).json()


def inspect(api, unit: dict, *, unit_type: str = "vehicle", expect: int = 201, **extra) -> dict:
    body = {f"{unit_type}_id": unit["id"], "kind": "pre_trip", "inspected_on": str(TODAY), "result": "pass", **extra}
    return api.post("/maintenance/inspections", body, expect).json()


def back_on_the_road(api, unit: dict, unit_type: str = "vehicle", expect: int = 200):
    return api.post("/maintenance/return-to-service", {"unit_type": unit_type, "unit_id": unit["id"]}, expect)


def a_year_after(day):
    return day.replace(year=day.year + 1) if (day.month, day.day) != (2, 29) else day + timedelta(days=365)


def test_a_work_order_carries_its_costs_through_its_life(org):
    s = seed(org)
    org.patch(f"/vehicles/{s['truck']['id']}", {"odometer": 400_000}, 200)
    wo = work_order(org, s["truck"], vendor="Main Street Diesel", odometer=401_250, lines=[
        {"kind": "part", "description": "Brake pads", "quantity": "2", "unit_cost": "45.50"},
        {"kind": "labor", "description": "Labour", "quantity": "1.5", "unit_cost": "120.00"}])
    assert wo["number"] == "WO-1001" and wo["status"] == "open" and wo["priority"] == "normal"
    assert wo["unit"] == {"type": "vehicle", "id": s["truck"]["id"], "name": f"Truck {s['truck']['unit_number']}", "status": "active"}
    assert [x["amount"] for x in wo["lines"]] == ["91.00", "180.00"] and wo["total_cost"] == "271.00"
    assert wo["currency"] == "USD" and wo["created_by_name"] == "Olive Owner"
    assert set(wo["allowed_actions"]) == {"start", "complete", "cancel"} and wo["editable"] is True
    # A work order that doesn't say so leaves the unit on the road.
    assert org.get(f"/vehicles/{s['truck']['id']}").json()["status"] == "active"

    # Costs: adding, changing and removing a line keeps the total right and moves the version on.
    url = f"/maintenance/work-orders/{wo['id']}/lines"
    line = org.post(url, {"kind": "other", "description": "Shop supplies", "unit_cost": "19.99"}, 201).json()
    assert line["amount"] == "19.99" and line["quantity"] == "1.00"
    changed = org.patch(f"{url}/{line['id']}", {"quantity": "2"}, 200).json()
    assert changed["amount"] == "39.98"
    current = org.get(f"/maintenance/work-orders/{wo['id']}").json()
    assert current["total_cost"] == "310.98" and current["version"] == wo["version"] + 2
    org.delete(f"{url}/{line['id']}", 204)
    current = org.get(f"/maintenance/work-orders/{wo['id']}").json()
    assert current["total_cost"] == "271.00" and len(org.get(url).json()) == 2
    assert org.patch(f"{url}/{current['lines'][0]['id']}", {"unit_cost": None}, 422).json()["error"]["field_errors"] == \
        {"unit_cost": "This field can't be empty"}

    # Someone else's change is never overwritten.
    org.error("PATCH", f"/maintenance/work-orders/{wo['id']}", 409, "VERSION_CONFLICT",
              json={"version": wo["version"], "priority": "high"})
    current = org.patch(f"/maintenance/work-orders/{wo['id']}", {"version": current["version"], "priority": "high",
                                                                  "scheduled_for": str(TODAY)}, 200).json()
    assert current["priority"] == "high" and current["scheduled_for"] == str(TODAY)
    assert org.patch(f"/maintenance/work-orders/{wo['id']}", {"version": current["version"], "title": None}, 422) \
        .json()["error"]["field_errors"] == {"title": "This field can't be empty"}

    started = move(org, current, "start")
    assert started["status"] == "in_progress" and started["started_at"] and set(started["allowed_actions"]) == {"complete", "cancel"}
    done = move(org, started, "complete", notes="Pads and rotors replaced")
    assert done["status"] == "completed" and done["resolution"] == "Pads and rotors replaced"
    assert done["completed_by_name"] == "Olive Owner" and done["completed_at"] and done["allowed_actions"] == []
    assert done["editable"] is False
    # The truck's odometer follows the highest reading on record.
    assert org.get(f"/vehicles/{s['truck']['id']}").json()["odometer"] == 401_250

    # A finished work order is a record: no more changes.
    org.error("POST", f"/maintenance/work-orders/{wo['id']}/transitions", 409, "INVALID_TRANSITION",
              json={"action": "cancel", "version": done["version"], "notes": "Too late"})
    org.error("PATCH", f"/maintenance/work-orders/{wo['id']}", 409, "STATE_CONFLICT", json={"version": done["version"], "vendor": "X"})
    org.error("POST", url, 409, "STATE_CONFLICT", json={"description": "Late part", "unit_cost": "5.00"})
    org.error("DELETE", f"{url}/{done['lines'][0]['id']}", 409, "STATE_CONFLICT")

    actions = [e["action"] for e in org.items("/audit-logs", entity_type="work_order", entity_id=wo["id"])]
    assert actions == ["work_order.completed", "work_order.started", "work_order.updated", "work_order.created"]


def test_work_orders_are_numbered_per_company_and_validated(org, make_org):
    s = seed(org)
    first = work_order(org, s["truck"])
    second = work_order(org, s["trailer"], unit_type="trailer", title="Door seal")
    assert (first["number"], second["number"]) == ("WO-1001", "WO-1002")
    assert second["unit"]["type"] == "trailer" and second["unit"]["name"].startswith("Trailer ")

    other = make_org("Other Freight")
    theirs = seed(other)
    assert work_order(other, theirs["truck"])["number"] == "WO-1001"
    # Another company's truck can't be used, and its work orders aren't visible.
    assert work_order(org, theirs["truck"], expect=422)["error"]["field_errors"] == {"vehicle_id": "Truck not found"}
    org.error("GET", f"/maintenance/work-orders/{other.items('/maintenance/work-orders')[0]['id']}", 404, "NOT_FOUND")

    both = org.post("/maintenance/work-orders", {"vehicle_id": s["truck"]["id"], "trailer_id": s["trailer"]["id"],
                                                 "title": "Both"}, 422).json()
    assert both["error"]["field_errors"] == {"vehicle_id": "Choose either a truck or a trailer"}
    org.error("POST", "/maintenance/work-orders", 422, "VALIDATION_ERROR", json={"title": "Neither"})
    retired = org.post("/vehicles", {"unit_number": "OLD-1", "status": "retired"}, 201).json()
    assert work_order(org, retired, expect=422)["error"]["field_errors"] == {"vehicle_id": "This unit is retired"}
    org.error("POST", "/maintenance/work-orders", 422, "VALIDATION_ERROR",
              json={"vehicle_id": s["truck"]["id"], "title": "x", "lines": [{"description": "Bad", "unit_cost": "-1"}]})

    # Cancelling needs a reason.
    org.error("POST", f"/maintenance/work-orders/{first['id']}/transitions", 422, "VALIDATION_ERROR",
              json={"action": "cancel", "version": first["version"]})
    cancelled = move(org, first, "cancel", notes="Duplicate")
    assert cancelled["status"] == "cancelled" and cancelled["resolution"] == "Duplicate"

    assert [x["number"] for x in org.items("/maintenance/work-orders", open="true")] == ["WO-1002"]
    assert [x["number"] for x in org.items("/maintenance/work-orders", status="cancelled")] == ["WO-1001"]
    assert [x["number"] for x in org.items("/maintenance/work-orders", unit_type="trailer")] == ["WO-1002"]
    assert [x["number"] for x in org.items("/maintenance/work-orders", vehicle_id=s["truck"]["id"])] == ["WO-1001"]
    assert [x["number"] for x in org.items("/maintenance/work-orders", q="door")] == ["WO-1002"]
    assert [x["number"] for x in org.items("/maintenance/work-orders", q=s["truck"]["unit_number"])] == ["WO-1001"]
    org.error("GET", "/maintenance/work-orders", 422, "VALIDATION_ERROR", params={"sort": "vendor"})


def test_an_out_of_service_work_order_keeps_the_unit_off_the_road_until_it_is_returned(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    wo = work_order(org, s["truck"], out_of_service=True, priority="urgent")
    truck = org.get(f"/vehicles/{s['truck']['id']}").json()
    assert truck["status"] == "in_maintenance" and wo["unit"]["status"] == "in_maintenance"
    found = org.get("/dispatch/eligible-resources", params={"load_id": load["id"]}).json()
    candidate = next(c for c in found["vehicles"] if c["id"] == s["truck"]["id"])
    assert candidate["eligible"] is False and "UNIT_NOT_ACTIVE" in {r["code"] for r in candidate["reasons"]}

    # Not while the work order is open, whichever way it is tried.
    assert back_on_the_road(org, s["truck"], expect=409).json()["error"]["code"] == "OPEN_WORK_ORDERS"
    org.error("PATCH", f"/vehicles/{s['truck']['id']}", 409, "OPEN_WORK_ORDERS", json={"status": "active"})

    done = move(org, wo, "complete", notes="Fixed")
    # Completing the repair doesn't put the truck back by itself: somebody signs it off.
    assert done["unit"]["status"] == "in_maintenance"
    assert back_on_the_road(org, s["truck"]).json() == {**done["unit"], "status": "active"}
    assert org.get(f"/vehicles/{s['truck']['id']}").json()["status"] == "active"
    assert back_on_the_road(org, s["truck"], expect=409).json()["error"]["code"] == "STATE_CONFLICT"
    entries = org.items("/audit-logs", entity_type="vehicle", entity_id=s["truck"]["id"])
    assert {"vehicle.status_changed", "vehicle.returned_to_service"} <= {e["action"] for e in entries}

    # Marking an open work order out of service later takes the unit off the road then.
    later = work_order(org, s["trailer"], unit_type="trailer")
    assert org.get(f"/trailers/{s['trailer']['id']}").json()["status"] == "active"
    org.patch(f"/maintenance/work-orders/{later['id']}", {"version": later["version"], "out_of_service": True}, 200)
    assert org.get(f"/trailers/{s['trailer']['id']}").json()["status"] == "in_maintenance"
    # Cancelling the only thing that held it there lets it go back.
    later = org.get(f"/maintenance/work-orders/{later['id']}").json()
    move(org, later, "cancel", notes="Not needed")
    org.patch(f"/trailers/{s['trailer']['id']}", {"status": "active"}, 200)


def test_inspections_record_what_was_found_and_act_on_it(org):
    s = seed(org)
    org.patch(f"/vehicles/{s['truck']['id']}", {"odometer": 100_000}, 200)
    yesterday = str(TODAY - timedelta(days=1))
    lapsed = org.post("/trailers", {"unit_number": "TR-LAPSED", **DATES, "inspection_expiry": yesterday}, 201).json()

    # What an inspection says has to hang together.
    def refused(field: str, **body) -> None:
        r = org.post("/maintenance/inspections", {"vehicle_id": s["truck"]["id"], "kind": "pre_trip",
                                                  "inspected_on": str(TODAY), "result": "pass", **body}, 422)
        assert field in r.json()["error"]["field_errors"], r.json()
    refused("result", defects=[{"item": "Mirror"}])
    refused("defects", result="defects")
    refused("result", result="defects", defects=[{"item": "Brakes", "severity": "out_of_service"}])
    refused("inspected_on", inspected_on=str(TODAY + timedelta(days=1)))
    refused("vehicle_id", trailer_id=s["trailer"]["id"])
    refused("driver_id", driver_id=s["customer"]["id"])

    # A passed annual inspection is good for a year.
    annual = inspect(org, lapsed, unit_type="trailer", kind="annual", inspector="State DOT", report_number="A-77")
    assert annual["result"] == "pass" and annual["defects"] == [] and annual["unit"]["name"] == "Trailer TR-LAPSED"
    renewed = org.get(f"/trailers/{lapsed['id']}").json()
    assert renewed["inspection_expiry"] == str(a_year_after(TODAY))
    assert not [x for x in org.items("/safety/expirations", state="expired") if x["entity_id"] == lapsed["id"]]

    # A roadside inspection that puts the truck out of service.
    roadside = inspect(org, s["truck"], kind="roadside", result="out_of_service",
                       driver_id=s["driver"]["id"], odometer=100_500, location="I-80 MM 112", defects=[
                           {"item": "Brake chamber", "severity": "out_of_service", "description": "Air leak, left rear"},
                           {"item": "Marker lamp", "severity": "minor"}])
    assert roadside["driver"] == {"id": s["driver"]["id"], "name": "Dana Driver"}
    assert [(d["item"], d["severity"], d["work_order"]) for d in roadside["defects"]] == [
        ("Brake chamber", "out_of_service", None), ("Marker lamp", "minor", None)]
    truck = org.get(f"/vehicles/{s['truck']['id']}").json()
    assert truck["status"] == "out_of_service" and truck["odometer"] == 100_500
    assert org.get(f"/maintenance/inspections/{roadside['id']}").json() == roadside
    assert [x["id"] for x in org.items("/maintenance/inspections", result="out_of_service")] == [roadside["id"]]
    assert [x["id"] for x in org.items("/maintenance/inspections", unit_type="trailer")] == [annual["id"]]
    assert [x["id"] for x in org.items("/maintenance/inspections", q="I-80")] == [roadside["id"]]

    # The defect that took it off the road has to be repaired before it goes back.
    error = back_on_the_road(org, s["truck"], expect=409).json()["error"]
    assert error["code"] == "UNRESOLVED_DEFECTS" and error["details"]["defects"] == ["Brake chamber"]
    brake = roadside["defects"][0]
    repair = org.post(f"/maintenance/inspections/{roadside['id']}/defects/{brake['id']}/work-order", expect=201).json()
    assert (repair["title"], repair["priority"], repair["out_of_service"]) == ("Brake chamber", "urgent", True)
    assert repair["description"] == "Air leak, left rear" and repair["odometer"] == 100_500
    assert repair["defects"] == [{"inspection_id": roadside["id"], "inspection_kind": "roadside", "inspected_on": str(TODAY),
                                  "item": "Brake chamber", "severity": "out_of_service"}]
    # Already out of service: a work order doesn't soften that to "in maintenance".
    assert repair["unit"]["status"] == "out_of_service"
    org.error("POST", f"/maintenance/inspections/{roadside['id']}/defects/{brake['id']}/work-order", 409, "DUPLICATE_REFERENCE")
    linked = org.get(f"/maintenance/inspections/{roadside['id']}").json()["defects"][0]["work_order"]
    assert linked == {"id": repair["id"], "number": repair["number"], "status": "open"}

    assert back_on_the_road(org, s["truck"], expect=409).json()["error"]["code"] == "OPEN_WORK_ORDERS"
    move(org, repair, "complete", notes="Chamber replaced")
    # The minor defect never kept it off the road.
    assert back_on_the_road(org, s["truck"]).json()["status"] == "active"


def test_roles_decide_who_sees_and_changes_maintenance(org):
    s = seed(org)
    wo = work_order(org, s["truck"])
    roadside = inspect(org, s["truck"], kind="roadside", result="defects", defects=[{"item": "Wiper", "severity": "major"}])
    body = {"vehicle_id": s["truck"]["id"], "title": "Oil change"}

    dispatcher = org.add_user("dispatcher")
    seen = dispatcher.get(f"/maintenance/work-orders/{wo['id']}").json()
    assert seen["allowed_actions"] == [] and seen["editable"] is False
    dispatcher.error("POST", "/maintenance/work-orders", 403, "FORBIDDEN", json=body)
    dispatcher.error("POST", f"/maintenance/work-orders/{wo['id']}/lines", 403, "FORBIDDEN",
                     json={"description": "x", "unit_cost": "1.00"})

    safety = org.add_user("safety_manager")
    inspect(safety, s["trailer"], unit_type="trailer")
    safety.error("POST", "/maintenance/work-orders", 403, "FORBIDDEN", json=body)
    safety.error("POST", f"/maintenance/inspections/{roadside['id']}/defects/{roadside['defects'][0]['id']}/work-order",
                 403, "FORBIDDEN")
    safety.error("POST", "/maintenance/return-to-service", 403, "FORBIDDEN",
                 json={"unit_type": "vehicle", "unit_id": s["truck"]["id"]})

    fleet = org.add_user("fleet_manager")
    raised = fleet.post(f"/maintenance/inspections/{roadside['id']}/defects/{roadside['defects'][0]['id']}/work-order",
                        expect=201).json()
    assert raised["priority"] == "high" and raised["out_of_service"] is False
    move(fleet, wo, "start")

    accountant = org.add_user("accountant")
    accountant.error("GET", "/maintenance/work-orders", 403, "FORBIDDEN")
    accountant.error("GET", "/maintenance/inspections", 403, "FORBIDDEN")
    # Documents follow the record's permission: no attaching paperwork to a work order you can't see.
    accountant.error("POST", "/documents/upload-intents", 403, "FORBIDDEN", json={
        "filename": "invoice.pdf", "content_type": "application/pdf", "size_bytes": 10, "type": "maintenance",
        "entity_type": "work_order", "entity_id": wo["id"]})

    viewer = org.add_user("viewer")
    assert viewer.get(f"/maintenance/inspections/{roadside['id']}").json()["id"] == roadside["id"]
    viewer.error("POST", "/maintenance/inspections", 403, "FORBIDDEN",
                 json={"vehicle_id": s["truck"]["id"], "kind": "pre_trip", "inspected_on": str(TODAY), "result": "pass"})


def test_paperwork_summary_alerts_and_search(org):
    s = seed(org)
    yesterday = str(TODAY - timedelta(days=1))
    urgent = work_order(org, s["truck"], priority="urgent", out_of_service=True, title="Coolant leak")
    late = work_order(org, s["trailer"], unit_type="trailer", scheduled_for=yesterday, title="Annual service",
                      lines=[{"description": "Service", "unit_cost": "350.00"}])

    doc = upload(org, "work_order", late["id"], "maintenance", filename="shop-invoice.pdf")
    assert doc["links"][0]["label"] == f"Work order {late['number']}"
    assert [d["id"] for d in org.items("/documents", entity_type="work_order", entity_id=late["id"])] == [doc["id"]]

    summary = org.get("/maintenance/summary").json()
    assert summary == {"open_work_orders": 2, "urgent_open": 1, "overdue": 1, "units_out_of_service": 1,
                       "currency": "USD", "spend_this_month": "0.00"}
    alerts = {e["code"]: e for e in org.get("/dashboard/exceptions").json()}
    assert alerts["WORK_ORDERS_URGENT"]["count"] == 1 and alerts["WORK_ORDERS_URGENT"]["severity"] == "high"
    assert alerts["WORK_ORDERS_URGENT"]["params"] == {"priority": "urgent", "open": "true"}
    assert alerts["WORK_ORDERS_OVERDUE"]["resource"] == "maintenance" and alerts["WORK_ORDERS_OVERDUE"]["params"] == {"overdue": "true"}
    assert [x["id"] for x in org.items("/maintenance/work-orders", overdue="true")] == [late["id"]]
    ranked = [x["number"] for x in org.items("/maintenance/work-orders", sort="priority")]
    assert ranked == [urgent["number"], late["number"]]

    move(org, late, "complete")
    summary = org.get("/maintenance/summary").json()
    assert (summary["open_work_orders"], summary["overdue"], summary["spend_this_month"]) == (1, 0, "350.00")

    found = org.get("/search", params={"q": "coolant"}).json()
    assert [(r["type"], r["id"], r["title"]) for r in found] == [("work_order", urgent["id"], f"Work order {urgent['number']}")]


def test_a_retried_request_opens_one_work_order_and_a_double_click_moves_it_once(org):
    s = seed(org)
    key = {"Idempotency-Key": "wo-retry-1"}
    body = {"vehicle_id": s["truck"]["id"], "title": "Tyres"}
    first = org.post("/maintenance/work-orders", body, 201, headers=key)
    again = org.post("/maintenance/work-orders", body, 201, headers=key)
    assert again.json()["id"] == first.json()["id"] and again.headers.get("Idempotent-Replay") == "true"
    assert len(org.items("/maintenance/work-orders")) == 1

    wo = first.json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: org.post(f"/maintenance/work-orders/{wo['id']}/transitions",
                                                   {"action": "start", "version": wo["version"]}), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    assert next(r for r in results if r.status_code == 409).json()["error"]["code"] in ("VERSION_CONFLICT", "CONCURRENT_UPDATE")
