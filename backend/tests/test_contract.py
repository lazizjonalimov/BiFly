"""The API contract every client relies on (decision 0004): error shape, list shape, sorting, paging."""
import uuid

from tests.conftest import new_load, seed


def test_errors_share_one_shape_and_carry_the_request_id(org, client):
    r = org.get(f"/customers/{uuid.uuid4()}", expect=404, headers={"X-Request-ID": "trace-12345678"})
    assert r.headers["X-Request-ID"] == "trace-12345678"
    assert r.json() == {"error": {"code": "NOT_FOUND", "message": "Customer not found", "field_errors": {},
                                  "details": {}, "request_id": "trace-12345678"}}

    r = client.get("/api/v1/customers")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r.headers["X-Request-ID"] == r.json()["error"]["request_id"]
    assert r.headers["Cache-Control"] == "no-store"

    r = client.get("/api/v1/nothing-here")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_validation_errors_are_keyed_by_field_path(org):
    s = seed(org)
    body = org.error("POST", "/customers", 422, "VALIDATION_ERROR",
                     json={"name": "", "billing_email": "not-an-email", "payment_terms_days": 999})
    assert set(body["field_errors"]) == {"name", "billing_email", "payment_terms_days"}

    bad = {"customer_id": s["customer"]["id"], "stops": [
        {"type": "pickup", "city": "Chicago"},
        {"type": "delivery", "city": "", "appt_start": "2031-01-02T10:00:00Z", "appt_end": "2031-01-01T10:00:00Z"}]}
    body = org.error("POST", "/loads", 422, "VALIDATION_ERROR", json=bad)
    assert "stops.1.city" in body["field_errors"] and "stops.1.appt_end" in body["field_errors"]

    body = org.error("POST", "/loads", 422, "VALIDATION_ERROR", json={"customer_id": str(uuid.uuid4()), "stops": []})
    assert body["field_errors"] == {"customer_id": "Customer not found"}


def test_duplicates_and_references_map_to_409(org):
    s = seed(org)
    org.post("/vehicles", {"unit_number": "DUP-1"}, 201)
    org.error("POST", "/vehicles", 409, "DUPLICATE_REFERENCE", json={"unit_number": "DUP-1"})
    new_load(org, s["customer"]["id"])
    # A customer with loads can't be deleted, only archived.
    org.error("DELETE", f"/customers/{s['customer']['id']}", 409, "STATE_CONFLICT")
    assert org.post(f"/customers/{s['customer']['id']}/archive", expect=200).json()["status"] == "archived"


def test_lists_are_sorted_and_paged_in_the_database(org):
    names = ["Echo", "alpha", "Delta", "Bravo", "Charlie", "Foxtrot", "Golf"]
    for n in names:
        org.post("/customers", {"name": n}, 201)

    page = org.get("/customers", params={"limit": 3, "sort": "name", "count": "true"}).json()
    assert set(page) == {"items", "page", "meta"}
    assert page["page"]["has_more"] is True and page["page"]["total_count"] == 7
    assert page["meta"]["request_id"] and page["meta"]["generated_at"]

    seen, cursor = [], None
    while True:
        params = {"limit": 3, "sort": "-name", **({"cursor": cursor} if cursor else {})}
        page = org.get("/customers", params=params).json()
        seen += [c["name"] for c in page["items"]]
        cursor = page["page"]["next_cursor"]
        if not page["page"]["has_more"]:
            break
    # Every row exactly once, in the database's order, across page boundaries.
    assert len(seen) == 7 and set(seen) == set(names)
    in_db_order = [c["name"] for c in org.items("/customers", sort="-name", limit=100)]
    assert seen == in_db_order

    assert [c["name"] for c in org.items("/customers", q="ALPH")] == ["alpha"]
    assert org.items("/customers", q="100%") == []          # LIKE wildcards are taken literally


def test_unknown_sort_filter_and_stale_cursor_are_rejected(org):
    assert org.error("GET", "/customers", 422, "VALIDATION_ERROR",
                     params={"sort": "password_hash"})["field_errors"].keys() == {"sort"}
    org.error("GET", "/customers", 422, "VALIDATION_ERROR", params={"no_such_filter": "x"})
    org.error("GET", "/customers", 422, "VALIDATION_ERROR", params={"limit": 1000})
    for n in ("A", "B", "C"):
        org.post("/customers", {"name": n}, 201)
    cursor = org.get("/customers", params={"limit": 1, "sort": "name"}).json()["page"]["next_cursor"]
    # A cursor only makes sense with the sort it was issued for.
    assert "cursor" in org.error("GET", "/customers", 422, "VALIDATION_ERROR",
                                 params={"limit": 1, "sort": "-created_at", "cursor": cursor})["field_errors"]
    org.error("GET", "/customers", 422, "VALIDATION_ERROR", params={"cursor": "garbage"})


def test_money_travels_as_decimal_strings(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"], customer_rate="1234.50")
    assert load["customer_rate"] == "1234.50" and load["revenue"] == "1234.50" and load["currency"] == "USD"
    assert org.items("/loads")[0]["revenue"] == "1234.50"


def test_idempotency_key_replays_instead_of_repeating(org):
    s = seed(org)
    body = {"customer_id": s["customer"]["id"], "customer_rate": "100.00",
            "stops": [{"type": "pickup", "city": "A"}, {"type": "delivery", "city": "B"}]}
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first = org.post("/loads", body, 201, headers=key)
    again = org.post("/loads", body, 201, headers=key)
    assert again.json()["id"] == first.json()["id"] and again.headers["Idempotent-Replay"] == "true"
    assert len(org.items("/loads")) == 1
    org.error("POST", "/loads", 409, "IDEMPOTENCY_KEY_REUSED", json={**body, "customer_rate": "999.00"}, headers=key)


def test_openapi_document_describes_the_error_shape(client):
    spec = client.get("/api/openapi.json").json()
    assert spec["info"]["title"] == "FlyFleet API"
    responses = spec["paths"]["/api/v1/loads"]["post"]["responses"]
    assert responses["422"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    assert "ErrorResponse" in spec["components"]["schemas"]


def test_every_schema_in_the_contract_has_its_own_name(client):
    # Two modules defining a model with the same name make FastAPI fall back to module-path names
    # ("app__modules__x__schemas__LineOut"), which silently renames a type the web app depends on.
    names = client.get("/api/openapi.json").json()["components"]["schemas"]
    assert [n for n in names if "__" in n] == []
