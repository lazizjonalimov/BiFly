"""The safety queue, the dashboard, global search and reports."""
import csv
import io
from datetime import UTC, datetime, timedelta

from tests.conftest import complete, deliver, new_load, seed, stops, upload


def day(offset: int) -> str:
    return str((datetime.now(UTC) + timedelta(days=offset)).date())


def iso(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(days=days, hours=hours)).isoformat()


def test_the_expirations_queue_lists_every_dated_item_in_order(org):
    yard = org.post("/terminals", {"name": "North yard"}, 201).json()
    driver = org.post("/drivers", {"first_name": "Ed", "last_name": "Expired", "cdl_expiry": day(-10),
                                   "medical_cert_expiry": day(5), "terminal_id": yard["id"]}, 201).json()
    org.post(f"/drivers/{driver['id']}/qualifications", {"type": "hazmat", "expires_on": day(20), "required": True}, 201)
    org.post(f"/drivers/{driver['id']}/qualifications", {"type": "training"}, 201)          # undated: not in the queue
    org.post("/drivers", {"first_name": "Gone", "last_name": "Away", "status": "terminated", "cdl_expiry": day(-99)}, 201)
    truck = org.post("/vehicles", {"unit_number": "101", "insurance_expiry": day(-2), "registration_expiry": day(300),
                                   "inspection_expiry": day(45)}, 201).json()
    org.post("/trailers", {"unit_number": "5301", "insurance_expiry": day(300), "registration_expiry": day(300),
                           "inspection_expiry": day(300), "status": "retired"}, 201)

    queue = org.items("/safety/expirations")
    assert [(x["entity_label"], x["item"], x["state"]) for x in queue] == [
        ("Ed Expired", "cdl", "expired"), ("Truck 101", "insurance", "expired"),
        ("Ed Expired", "medical", "expiring"), ("Ed Expired", "hazmat", "expiring")]
    assert queue[0]["days_left"] == -10 and queue[0]["item_label"] == "CDL" and queue[0]["blocks_dispatch"] is True
    assert queue[3]["item_label"] == "Hazmat endorsement" and queue[0]["entity_id"] == driver["id"]

    assert [x["item"] for x in org.items("/safety/expirations", state="expired")] == ["cdl", "insurance"]
    assert [x["item"] for x in org.items("/safety/expirations", state="expiring", within_days=10)] == ["medical"]
    assert [x["item"] for x in org.items("/safety/expirations", within_days=60)][-1] == "inspection"
    assert {x["entity_type"] for x in org.items("/safety/expirations", entity_type="vehicle")} == {"vehicle"}
    assert {x["entity_label"] for x in org.items("/safety/expirations", terminal_id=yard["id"])} == {"Ed Expired"}
    assert [x["entity_label"] for x in org.items("/safety/expirations", q="truck")] == ["Truck 101"]
    assert org.items("/safety/expirations", state="missing") == []
    assert [x["item"] for x in org.items("/safety/expirations", sort="-expires_on")] == ["hazmat", "medical", "insurance", "cdl"]

    first = org.get("/safety/expirations", params={"limit": 3, "count": "true"}).json()
    rest = org.items("/safety/expirations", limit=3, cursor=first["page"]["next_cursor"])
    assert first["page"]["total_count"] == 4 and len(first["items"]) == 3 and [x["item"] for x in rest] == ["hazmat"]

    assert org.get("/safety/summary").json() == {"expired": 2, "expiring": 2, "missing": 0, "drivers_blocked": 1,
                                                 "units_blocked": 1}
    org.patch(f"/vehicles/{truck['id']}", {"insurance_expiry": day(365)}, 200)
    assert org.get("/safety/summary").json()["units_blocked"] == 0
    org.add_user("accountant").error("GET", "/safety/expirations", 403, "FORBIDDEN")


def test_missing_dates_are_listed_separately(org):
    org.post("/drivers", {"first_name": "No", "last_name": "Dates"}, 201)
    org.post("/vehicles", {"unit_number": "202"}, 201)
    assert org.items("/safety/expirations") == []
    missing = org.items("/safety/expirations", state="missing")
    assert {(x["entity_label"], x["item"]) for x in missing} == {
        ("No Dates", "cdl"), ("No Dates", "medical"), ("Truck 202", "insurance"), ("Truck 202", "registration"),
        ("Truck 202", "inspection")}
    assert all(x["days_left"] is None and x["expires_on"] is None for x in missing)
    assert org.get("/safety/summary").json()["missing"] == 5


def test_documents_with_their_own_expiry_show_up(org):
    s = seed(org)
    upload(org, "vehicle", s["truck"]["id"], "insurance", filename="policy.pdf", expires_on=day(12))
    upload(org, "driver", s["driver"]["id"], "medical", filename="card.pdf", expires_on=day(-3))
    upload(org, "trailer", s["trailer"]["id"], "registration", filename="reg.pdf", expires_on=day(200))
    found = org.get("/safety/expiring-documents").json()
    assert [(d["filename"], d["state"], d["entity_type"]) for d in found] == [
        ("card.pdf", "expired", "driver"), ("policy.pdf", "expiring", "vehicle")]
    fleet = org.add_user("fleet_manager")           # may not see medical documents
    assert [d["filename"] for d in fleet.get("/safety/expiring-documents").json()] == ["policy.pdf"]


def test_the_dashboard_shows_each_role_its_own_blocks(org):
    s = seed(org)
    done = complete(org, s, stops=stops(iso(days=-3), iso(days=-2)))
    new_load(org, s["customer"]["id"], stops=stops(iso(hours=-4), iso(days=1)))                 # late, unassigned
    invoice = org.post("/invoices", {"customer_id": s["customer"]["id"], "load_ids": [done["id"]]}, 201).json()
    org.post(f"/invoices/{invoice['id']}/issue", expect=200)

    full = org.get("/dashboard/summary").json()
    assert full["loads"]["unassigned"] == 1 and full["loads"]["at_risk"] == 1
    assert full["fleet"] == {"drivers_active": 1, "drivers_on_load": 0, "trucks_active": 1, "trucks_on_load": 0,
                             "trucks_unavailable": 0, "trailers_active": 1}
    assert full["receivables"]["open_balance"] == "2500.00" and full["receivables"]["open_invoices"] == 1
    assert full["revenue"]["this_month"] in ("2500.00", "0.00") and full["revenue"]["currency"] == "USD"
    assert full["safety"]["expired"] == 0 and full["timezone"] == "UTC"

    safety = org.add_user("safety_manager").get("/dashboard/summary").json()
    assert safety["receivables"] is None and safety["revenue"] is None and safety["safety"] is not None
    accountant = org.add_user("accountant").get("/dashboard/summary").json()
    assert accountant["receivables"] is not None and accountant["safety"] is None and accountant["loads"] is not None
    org.add_user("driver").error("GET", "/dashboard/summary", 403, "FORBIDDEN")


def test_exceptions_point_at_the_work_that_needs_doing(org):
    s = seed(org)
    assert org.get("/dashboard/exceptions").json() == []                    # nothing wrong, nothing shown

    new_load(org, s["customer"]["id"], stops=stops(iso(hours=-4), iso(days=1)))
    delivered = deliver(org, new_load(org, s["customer"]["id"], stops=stops(iso(days=3), iso(days=4))), s)
    org.post("/drivers", {"first_name": "Ed", "last_name": "Expired", "cdl_expiry": day(-10),
                          "medical_cert_expiry": day(300)}, 201)
    found = {e["code"]: e for e in org.get("/dashboard/exceptions").json()}
    assert set(found) == {"LOADS_AT_RISK", "LOADS_UNASSIGNED", "MISSING_POD", "DRIVERS_BLOCKED"}
    assert found["LOADS_AT_RISK"]["resource"] == "loads" and found["LOADS_AT_RISK"]["params"] == {"view": "at_risk"}
    assert found["DRIVERS_BLOCKED"]["count"] == 1 and found["MISSING_POD"]["count"] == 1
    severities = [e["severity"] for e in org.get("/dashboard/exceptions").json()]
    assert severities == sorted(severities, key=["high", "medium", "low"].index)             # most urgent first
    # The list behind an exception really contains what was counted.
    assert len(org.items("/loads", **found["LOADS_AT_RISK"]["params"])) == found["LOADS_AT_RISK"]["count"]

    upload(org, "load", delivered["id"])
    codes = {e["code"] for e in org.get("/dashboard/exceptions").json()}
    assert "POD_REVIEW" in codes and "MISSING_POD" not in codes
    # Each role sees only what it can act on or see.
    assert {e["code"] for e in org.add_user("safety_manager").get("/dashboard/exceptions").json()} >= {"DRIVERS_BLOCKED"}
    assert "DRIVERS_BLOCKED" not in {e["code"] for e in org.add_user("accountant").get("/dashboard/exceptions").json()}


def test_search_finds_records_of_every_kind_the_role_may_see(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], reference="PO-GLOBEX-77")
    org.post("/vehicles", {"unit_number": "GLOBEX-TRUCK"}, 201)
    found = org.get("/search", params={"q": "globex"}).json()
    assert {(x["type"], x["title"]) for x in found} == {("load", load["load_number"]), ("customer", "Globex"),
                                                        ("vehicle", "Truck GLOBEX-TRUCK")}
    assert [x["title"] for x in org.get("/search", params={"q": "dana dri"}).json()] == ["Dana Driver"]
    assert org.get("/search", params={"q": load["load_number"]}).json()[0]["subtitle"] == "Chicago to Dallas"
    assert org.get("/search", params={"q": "100%"}).json() == []
    org.error("GET", "/search", 422, "VALIDATION_ERROR", params={"q": "x"})
    # A fleet manager can't see customers, so search doesn't show them.
    limited = org.add_user("fleet_manager").get("/search", params={"q": "globex"}).json()
    assert {x["type"] for x in limited} == {"load", "vehicle"}
    assert org.add_user("driver").get("/search", params={"q": "globex"}).json() == []


def test_revenue_and_performance_reports(org):
    s = seed(org)
    other = org.post("/customers", {"name": "Initech"}, 201).json()
    complete(org, s, customer_rate="3000.00", miles=1000, stops=stops(iso(days=5), iso(days=6)))
    complete(org, s, customer_rate="1000.00", miles=250, stops=stops(iso(days=7), iso(days=8)),
             charges=[{"type": "detention", "rate": "100.00"}])
    load = new_load(org, other["id"], customer_rate="500.00", miles=100, stops=stops(iso(days=9), iso(days=10)))
    deliver(org, load, s)
    new_load(org, other["id"], customer_rate="9999.00")                         # not delivered: not revenue yet

    report = org.get("/reports/revenue").json()
    assert report["name"] == "revenue-by-customer" and report["date_to"] == day(0) and report["currency"] == "USD"
    assert [(r["label"], r["loads"], r["miles"], r["revenue"], r["revenue_per_mile"]) for r in report["rows"]] == [
        ("Globex", 2, 1250, "4100.00", "3.28"), ("Initech", 1, 100, "500.00", "5.00")]
    assert report["totals"] == {"label": "Total", "loads": 3, "miles": 1350, "revenue": "4600.00", "revenue_per_mile": "3.41"}
    assert [c["key"] for c in report["columns"]] == ["label", "loads", "miles", "revenue", "revenue_per_mile"]
    by_month = org.get("/reports/revenue", params={"group_by": "month"}).json()
    assert [r["label"] for r in by_month["rows"]] == [datetime.now(UTC).strftime("%Y-%m")]
    assert org.get("/reports/revenue", params={"group_by": "terminal"}).json()["rows"][0]["label"] == "No terminal"
    assert org.get("/reports/revenue", params={"date_from": day(-60), "date_to": day(-30)}).json()["rows"] == []
    org.error("GET", "/reports/revenue", 422, "VALIDATION_ERROR", params={"date_from": day(0), "date_to": day(-5)})
    org.error("GET", "/reports/revenue", 422, "VALIDATION_ERROR", params={"date_from": day(-800), "date_to": day(0)})

    drivers = org.get("/reports/drivers").json()
    assert [(r["label"], r["loads"], r["miles"], r["on_time"], r["revenue"]) for r in drivers["rows"]] == [
        ("Dana Driver", 3, 1350, 100, "4600.00")]
    trucks = org.get("/reports/trucks").json()
    assert trucks["rows"][0]["label"] == s["truck"]["unit_number"] and trucks["rows"][0]["loads"] == 3
    # Roles without rates get the operational columns only.
    safety = org.add_user("safety_manager")
    assert "revenue" not in safety.get("/reports/drivers").json()["rows"][0]
    safety.error("GET", "/reports/revenue", 403, "FORBIDDEN")
    safety.error("GET", "/reports/ar-aging", 403, "FORBIDDEN")


def test_a_late_delivery_counts_against_on_time(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], stops=stops(iso(days=-3), iso(days=-2)))     # was due two days ago
    deliver(org, load, s)                                                                   # arrives now
    assert org.get("/reports/drivers").json()["rows"][0]["on_time"] == 0


def test_csv_export_needs_permission_is_audited_and_is_safe_to_open(org):
    s = seed(org)
    org.patch(f"/customers/{s['customer']['id']}", {"name": "=HYPERLINK(\"http://evil.example\")"}, 200)
    complete(org, s, stops=stops(iso(days=5), iso(days=6)))

    r = org.get("/reports/revenue", params={"format": "csv"})
    assert r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    assert f"bifly-revenue-by-customer-{day(0)[:8]}" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0] == ["Customer", "Loads", "Miles", "Revenue", "Revenue per mile"]
    assert rows[1][0].startswith("'=HYPERLINK") and rows[1][3] == "2500.00"       # a formula is defused, numbers are not
    assert rows[-1][0] == "Total"
    assert org.items("/audit-logs", action="report.exported")[0]["data"]["report"] == "revenue-by-customer"

    dispatcher = org.add_user("dispatcher")                 # may read reports, may not take the data away
    assert dispatcher.get("/reports/drivers").json()["rows"]
    dispatcher.error("GET", "/reports/drivers", 403, "FORBIDDEN", params={"format": "csv"})
    org.add_user("driver").error("GET", "/reports/drivers", 403, "FORBIDDEN")
