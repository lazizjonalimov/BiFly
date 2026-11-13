"""Customers, drivers and equipment: the records everything else refers to."""
from datetime import UTC, datetime, timedelta

from tests.conftest import complete, new_load, seed


def day(offset: int) -> str:
    return str((datetime.now(UTC) + timedelta(days=offset)).date())


def test_customer_with_contacts_addresses_and_figures(org):
    customer = org.post("/customers", {"name": "Initech", "code": "INI", "billing_email": "ap@initech.example",
                                       "payment_terms_days": 45, "credit_limit": "50000.00"}, 201).json()
    org.error("POST", "/customers", 409, "DUPLICATE_REFERENCE", json={"name": "Another", "code": "INI"})
    url = f"/customers/{customer['id']}"

    ops = org.post(f"{url}/contacts", {"name": "Olga Ops", "kind": "operations", "is_primary": True}, 201).json()
    billing = org.post(f"{url}/contacts", {"name": "Bill Payer", "kind": "billing", "email": "bill@initech.example",
                                           "is_primary": True}, 201).json()
    contacts = {c["name"]: c for c in org.get(f"{url}/contacts").json()}
    assert contacts["Bill Payer"]["is_primary"] is True and contacts["Olga Ops"]["is_primary"] is False   # one primary
    org.patch(f"{url}/contacts/{ops['id']}", {"phone": "555-0100"}, 200)
    org.error("POST", f"{url}/contacts", 422, "VALIDATION_ERROR", json={"name": "X", "kind": "friend"})
    dock = org.post(f"{url}/addresses", {"label": "Dock 4", "city": "Joliet", "state": "IL", "kind": "facility"}, 201).json()

    detail = org.get(url).json()
    assert [c["name"] for c in detail["contacts"]] == ["Bill Payer", "Olga Ops"]
    assert detail["addresses"][0]["label"] == "Dock 4" and detail["credit_limit"] == "50000.00"
    assert detail["stats"] == {"loads_total": 0, "loads_open": 0, "open_balance": "0.00", "currency": "USD"}

    # A child can't be reached through the wrong parent.
    other = org.post("/customers", {"name": "Other"}, 201).json()
    org.error("PATCH", f"/customers/{other['id']}/contacts/{billing['id']}", 404, "NOT_FOUND", json={"name": "x"})
    org.error("DELETE", f"/customers/{other['id']}/addresses/{dock['id']}", 404, "NOT_FOUND")
    org.delete(f"{url}/contacts/{ops['id']}", expect=204)

    new_load(org, customer["id"])
    assert org.get(url).json()["stats"]["loads_open"] == 1
    assert [c["name"] for c in org.items("/customers", status="active", q="ini")] == ["Initech"]
    archived = org.post(f"{url}/archive", expect=200).json()
    assert archived["status"] == "archived" and org.items("/customers", status="active", q="ini") == []
    assert org.post(f"{url}/restore", expect=200).json()["status"] == "active"
    assert [e["action"] for e in org.items("/audit-logs", entity_type="customer", entity_id=customer["id"])] == [
        "customer.restored", "customer.archived", "customer.created"]


def test_driver_compliance_status_is_worked_out_from_dates(org):
    def driver(name, **dates):
        return org.post("/drivers", {"first_name": name, "last_name": "Test", **dates}, 201).json()

    good = driver("Good", cdl_expiry=day(400), medical_cert_expiry=day(400))
    soon = driver("Soon", cdl_expiry=day(400), medical_cert_expiry=day(12))
    bad = driver("Bad", cdl_expiry=day(-1), medical_cert_expiry=day(400))
    blank = driver("Blank")
    today = driver("Today", cdl_expiry=day(0), medical_cert_expiry=day(400))        # good through its last day

    assert good["compliance"] == {"status": "ok", "issues": []}
    assert soon["compliance"]["status"] == "expiring" and soon["compliance"]["issues"][0]["code"] == "MEDICAL_EXPIRING"
    assert bad["compliance"]["status"] == "expired" and bad["compliance"]["issues"][0]["severity"] == "blocking"
    assert blank["compliance"]["status"] == "incomplete" and {i["code"] for i in blank["compliance"]["issues"]} == {"CDL_MISSING", "MEDICAL_MISSING"}
    assert today["compliance"]["status"] == "expiring"

    names = [d["first_name"] for d in org.items("/drivers", sort="cdl_expiry")]
    assert names[:3] == ["Bad", "Today", "Good"] or names[:2] == ["Bad", "Today"]
    assert [d["first_name"] for d in org.items("/drivers", q="blank")] == ["Blank"]
    assert org.error("POST", "/drivers", 422, "VALIDATION_ERROR", json={
        "first_name": "X", "last_name": "Y", "cdl_state": "Illinois", "cdl_class": "Z", "pay_rate": "-1"})["field_errors"].keys() == {
        "cdl_state", "cdl_class", "pay_rate"}


def test_driver_links_and_qualifications(org):
    s = seed(org, with_login=True)
    dispatcher = org.add_user("dispatcher")
    url = f"/drivers/{s['driver']['id']}"
    assert org.error("PATCH", url, 422, "VALIDATION_ERROR", json={"user_id": dispatcher.user_id})["field_errors"].keys() == {"user_id"}
    other = org.post("/drivers", {"first_name": "Second", "last_name": "Driver"}, 201).json()
    assert "already linked" in org.error("PATCH", f"/drivers/{other['id']}", 422, "VALIDATION_ERROR",
                                         json={"user_id": s["driver_api"].user_id})["message"]
    org.error("PATCH", url, 422, "VALIDATION_ERROR", json={"terminal_id": "00000000-0000-0000-0000-000000000000"})

    q = org.post(f"{url}/qualifications", {"type": "mvr", "issued_on": day(-30), "expires_on": day(335), "reference": "MVR-22"}, 201).json()
    assert org.error("POST", f"{url}/qualifications", 422, "VALIDATION_ERROR",
                     json={"type": "drug_test", "issued_on": day(0), "expires_on": day(-5)})["field_errors"].keys() == {"expires_on"}
    assert org.patch(f"{url}/qualifications/{q['id']}", {"required": True}, 200).json()["required"] is True
    assert [x["type"] for x in org.get(f"{url}/qualifications").json()] == ["mvr"]
    org.add_user("viewer").error("POST", f"{url}/qualifications", 403, "FORBIDDEN", json={"type": "twic"})
    org.delete(f"{url}/qualifications/{q['id']}", expect=204)


def test_trucks_and_trailers(org):
    yard = org.post("/terminals", {"name": "Main yard"}, 201).json()
    truck = org.post("/vehicles", {"unit_number": "101", "vin": "1FUJGLDR5CLBP8834", "make": "Freightliner",
                                   "model": "Cascadia", "year": 2022, "plate": "P123", "plate_state": "il",
                                   "odometer": 412000, "terminal_id": yard["id"], "insurance_expiry": day(10),
                                   "registration_expiry": day(200), "inspection_expiry": day(-3)}, 201).json()
    assert truck["plate_state"] == "IL" and truck["current_load"] is None
    assert truck["compliance"]["status"] == "expired"
    assert [i["code"] for i in truck["compliance"]["issues"]] == ["INSPECTION_EXPIRED", "INSURANCE_EXPIRING"]
    trailer = org.post("/trailers", {"unit_number": "5301", "type": "reefer", "length_ft": 53}, 201).json()
    assert trailer["compliance"]["status"] == "incomplete"

    assert [v["unit_number"] for v in org.items("/vehicles", q="casc")] == ["101"]
    assert [v["unit_number"] for v in org.items("/vehicles", terminal_id=yard["id"], status="active")] == ["101"]
    assert org.items("/trailers", type="dry_van") == [] and len(org.items("/trailers", type="reefer")) == 1
    org.error("POST", "/vehicles", 422, "VALIDATION_ERROR", json={"unit_number": "102", "year": 1800})
    org.error("POST", "/trailers", 422, "VALIDATION_ERROR", json={"unit_number": "5302", "type": "spaceship"})
    retired = org.patch(f"/vehicles/{truck['id']}", {"status": "retired", "odometer": 415000}, 200).json()
    assert retired["status"] == "retired" and retired["odometer"] == 415000
    org.delete(f"/trailers/{trailer['id']}", expect=204)
    # A unit with history can't be deleted, only retired.
    s = seed(org)
    complete(org, s)
    org.error("DELETE", f"/vehicles/{s['truck']['id']}", 409, "STATE_CONFLICT")
