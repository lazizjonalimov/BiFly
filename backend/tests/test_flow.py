"""The MVP: one complete, auditable load from creation through delivery, invoicing and payment."""
import uuid

from tests.conftest import PASSWORD, STOPS, new_load, seed_basics

PDF = ("pod.pdf", b"%PDF-1.4 proof of delivery", "application/pdf")


def _assign(api, load, s, expect=None, **kw):
    return api.post("/dispatch/assignments", {"load_id": load["id"], "driver_id": s["driver"]["id"],
                                              "vehicle_id": s["truck"]["id"], "trailer_id": s["trailer"]["id"]},
                    expect=expect, **kw)


def test_end_to_end_load_lifecycle(org):
    s = seed_basics(org)
    dispatcher, accountant, driver = org.add_user("dispatcher"), org.add_user("accountant"), s["driver_api"]

    # 1-3. dispatcher creates the load with pickup and delivery
    load = new_load(dispatcher, s["customer"]["id"])
    assert load["status"] == "pending" and load["load_number"] == "L-000001"
    assert [st["type"] for st in load["stops"]] == ["pickup", "delivery"]
    lid = load["id"]

    # guards: nothing can be skipped
    dispatcher.post(f"/dispatch/loads/{lid}/dispatch", expect=409)
    dispatcher.post(f"/loads/{lid}/confirm-delivery", expect=409)
    accountant.post("/invoices", {"load_id": lid}, expect=409)

    # 4. assign driver, truck and trailer
    load = _assign(dispatcher, load, s, expect=201).json()
    assert load["status"] == "assigned" and load["assignment"]["driver_name"] == "Dana Driver"

    # driver doesn't see it until it is released
    assert driver.get("/driver/assignments").json() == []
    dispatcher.post(f"/dispatch/loads/{lid}/dispatch", expect=200)

    # 5. driver receives the assignment — without the customer's rate
    mine = driver.get("/driver/assignments").json()
    assert [m["id"] for m in mine] == [lid] and float(mine[0]["customer_rate"]) == 0
    pickup, delivery = mine[0]["stops"]

    # 6. driver works the stops, in order
    ev = lambda stop, e, **kw: driver.post(f"/driver/loads/{lid}/stops/{stop['id']}/events", {"event": e}, **kw)  # noqa: E731
    ev(delivery, "arrived", expect=409)            # can't deliver before picking up
    ev(pickup, "departed", expect=409)             # can't depart before arriving
    ev(pickup, "arrived", expect=200)
    assert ev(pickup, "departed", expect=200).json()["status"] == "in_transit"
    ev(delivery, "arrived", expect=200)
    assert ev(delivery, "departed", expect=200).json()["status"] == "delivered"

    # 8. dispatcher can't confirm without a POD ...
    r = dispatcher.post(f"/loads/{lid}/confirm-delivery", expect=409)
    assert r.json()["error"]["code"] == "pod_required"
    # 7. ... driver uploads it
    doc = driver.post(f"/driver/loads/{lid}/documents", expect=201, data={"type": "pod"}, files={"file": PDF}).json()
    assert dispatcher.get(f"/documents/{doc['id']}/download").content == PDF[1]
    assert dispatcher.post(f"/loads/{lid}/confirm-delivery", expect=200).json()["status"] == "completed"
    assert driver.get("/driver/assignments").json() == []

    # 9. invoice for the delivered load, due per the customer's terms
    dispatcher.post("/invoices", {"load_id": lid}, expect=403)
    inv = accountant.post("/invoices", {"load_id": lid}, expect=201).json()
    assert inv["invoice_number"] == "INV-000001" and inv["total"] == "2500.00" and inv["balance"] == "2500.00"
    assert inv["lines"][0]["amount"] == "2500.00"
    accountant.post("/invoices", {"load_id": lid}, expect=409)       # one live invoice per load
    dispatcher.patch(f"/loads/{lid}", {"customer_rate": "1.00"}, expect=409)  # locked once invoiced

    # payments: partial, overpayment rejected, then paid in full
    accountant.post(f"/invoices/{inv['id']}/payments", {"amount": "1000.00", "method": "ach"}, expect=201)
    accountant.post(f"/invoices/{inv['id']}/payments", {"amount": "1500.01"}, expect=409)
    accountant.post(f"/invoices/{inv['id']}/void", expect=409)       # has payments
    paid = accountant.post(f"/invoices/{inv['id']}/payments", {"amount": "1500.00"}, expect=201).json()
    assert paid["status"] == "paid" and paid["balance"] == "0.00"

    # auditable: full ordered status history + audit trail
    final = org.get(f"/loads/{lid}").json()
    assert final["status"] == "paid"
    assert [e["to_status"] for e in reversed(final["events"])] == [
        "pending", "assigned", "dispatched", "in_transit", "delivered", "completed", "invoiced", "paid"]
    actions = {a["action"] for a in org.get("/audit-logs?limit=200").json()["items"]}
    assert {"load.created", "dispatch.assigned", "stop.departed", "document.uploaded", "invoice.created",
            "payment.recorded"} <= actions

    ops = org.get("/reports/operations").json()
    assert ops["loads_by_status"] == {"paid": 1} and float(ops["receivables_outstanding"]) == 0


def test_double_click_assign_and_idempotency_keys(org):
    s = seed_basics(org)
    load = new_load(org, s["customer"]["id"])
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first = _assign(org, load, s, expect=201, headers=key)
    replay = _assign(org, load, s, expect=201, headers=key)
    assert replay.headers.get("Idempotent-Replay") == "true" and replay.json() == first.json()
    # same request without a key: recognised as already done, no second assignment
    assert _assign(org, load, s, expect=200).json()["assignment"]["id"] == first.json()["assignment"]["id"]
    # a key can't be reused for a different request
    other = new_load(org, s["customer"]["id"])
    org.post("/dispatch/assignments", {"load_id": other["id"], "driver_id": s["driver"]["id"],
                                       "vehicle_id": s["truck"]["id"], "trailer_id": s["trailer"]["id"]},
             expect=422, headers=key)


def test_driver_offline_replay_does_not_duplicate_events(org):
    s = seed_basics(org)
    load = new_load(org, s["customer"]["id"])
    _assign(org, load, s, expect=201)
    org.post(f"/dispatch/loads/{load['id']}/dispatch", expect=200)
    stop = load["stops"][0]["id"]
    url = f"/driver/loads/{load['id']}/stops/{stop}/events"
    body = {"event": "arrived", "occurred_at": "2026-01-05T10:00:00Z"}
    key = {"Idempotency-Key": "device-evt-" + uuid.uuid4().hex}
    a = s["driver_api"].post(url, body, expect=200, headers=key).json()
    b = s["driver_api"].post(url, body, expect=200, headers=key).json()            # retry after reconnect
    c = s["driver_api"].post(url, {"event": "arrived"}, expect=200).json()        # even with no key
    assert a["stops"][0]["arrived_at"] == b["stops"][0]["arrived_at"] == c["stops"][0]["arrived_at"]
    arrivals = [x for x in org.get("/audit-logs?limit=200").json()["items"] if x["action"] == "stop.arrived"]
    assert len(arrivals) == 1


def test_assignment_compliance_and_conflicts(org):
    s = seed_basics(org)
    cid = s["customer"]["id"]
    mk = lambda **kw: org.post("/dispatch/assignments", kw)  # noqa: E731
    base = {"driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"], "trailer_id": s["trailer"]["id"]}

    expired = org.post("/drivers", {"first_name": "Ed", "last_name": "Expired", "cdl_expiry": "2020-01-01"}, 201).json()
    r = mk(load_id=new_load(org, cid)["id"], **{**base, "driver_id": expired["id"]})
    assert r.status_code == 409 and "CDL expired" in r.json()["error"]["message"]

    shop = org.post("/vehicles", {"unit_number": "SHOP-1", "status": "maintenance"}, 201).json()
    assert mk(load_id=new_load(org, cid)["id"], **{**base, "vehicle_id": shop["id"]}).status_code == 409

    reefer_load = new_load(org, cid, equipment_type="reefer")
    r = mk(load_id=reefer_load["id"], **base)                      # dry van trailer on a reefer load
    assert r.status_code == 409 and r.json()["error"]["code"] == "equipment"
    assert mk(load_id=new_load(org, cid)["id"], **{**base, "trailer_id": None}).json()["error"]["code"] == "equipment"

    # a driver/truck that is on the road can't be put on a second load
    l1, l2 = new_load(org, cid), new_load(org, cid)
    assert mk(load_id=l1["id"], **base).status_code == 201
    org.post(f"/dispatch/loads/{l1['id']}/dispatch", expect=200)
    r = mk(load_id=l2["id"], **base)
    assert r.status_code == 409 and r.json()["error"]["code"] == "resource_busy"

    # cancelling frees them; dispatched loads can't be unassigned, only cancelled
    org.delete(f"/dispatch/assignments/{l1['id']}", expect=409)
    org.post(f"/loads/{l1['id']}/cancel", {"reason": "Customer cancelled"}, expect=200)
    assert mk(load_id=l2["id"], **base).status_code == 201
    org.delete(f"/dispatch/assignments/{l2['id']}", expect=200)
    assert org.get(f"/loads/{l2['id']}").json()["status"] == "pending"


def test_roles_and_permissions(org):
    s = seed_basics(org)
    dispatcher, accountant, fleet, safety = (org.add_user(r) for r in ("dispatcher", "accountant", "fleet_manager", "safety_manager"))
    driver = s["driver_api"]

    dispatcher.post("/vehicles", {"unit_number": "X"}, expect=403)
    fleet.post("/vehicles", {"unit_number": "F-1"}, expect=201)
    fleet.post("/loads", {"customer_id": s["customer"]["id"], "stops": STOPS}, expect=403)
    safety.post("/drivers", {"first_name": "A", "last_name": "B"}, expect=201)
    accountant.post("/customers", {"name": "Nope"}, expect=403)
    dispatcher.get("/users", expect=403)
    dispatcher.get("/audit-logs", expect=403)
    # a driver login can use nothing but the driver app endpoints
    for url in ("/loads", "/customers", "/drivers", "/invoices", "/dispatch/board", "/reports/operations"):
        driver.get(url, expect=403)
    # ... and only their own loads
    other = new_load(org, s["customer"]["id"])
    driver.get(f"/driver/loads/{other['id']}", expect=404)


def test_user_management_rules(org, client):
    admin = org.add_user("admin")
    admin.post("/users", {"email": "o2@example.com", "full_name": "X", "password": PASSWORD, "role": "owner"}, expect=403)
    me = org.get("/auth/me").json()
    org.patch(f"/users/{me['user_id']}", {"role": "dispatcher"}, expect=409)   # last owner
    org.patch(f"/users/{me['user_id']}", {"active": False}, expect=409)
    # deactivation takes effect immediately, even for an already-issued token
    org.patch(f"/users/{admin.user_id}", {"active": False}, expect=200)
    admin.get("/customers", expect=401)
    org.post("/users", {"email": "weak@example.com", "full_name": "W", "password": "short", "role": "admin"}, expect=422)


def test_auth_basics(client, org):
    assert client.get("/api/v1/customers").status_code == 401
    assert client.get("/api/v1/customers", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    bad = client.post("/api/v1/auth/login", json={"email": org.email, "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "unauthorized"
    assert client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "x" * 12}).status_code == 401
    dup = client.post("/api/v1/auth/signup", json={"organization_name": "Dup", "full_name": "D", "email": org.email,
                                                    "password": PASSWORD})
    assert dup.status_code == 409
    r = client.get("/api/v1/customers", headers={**org.h, "X-Request-ID": "trace-12345678"})
    assert r.headers["X-Request-ID"] == "trace-12345678"


def test_validation_pagination_and_master_data(org):
    r = org.post("/customers", {"name": "", "payment_terms_days": 999}, expect=422).json()
    assert {d["field"] for d in r["error"]["details"]} == {"name", "payment_terms_days"}
    org.post("/loads", {"customer_id": str(uuid.uuid4()), "stops": STOPS}, expect=404)
    c = org.post("/customers", {"name": "Pager"}, 201).json()
    org.post("/loads", {"customer_id": c["id"], "stops": STOPS[:1]}, expect=422)
    org.post("/loads", {"customer_id": c["id"], "stops": STOPS[::-1]}, expect=422)

    for i in range(5):
        org.post("/customers", {"name": f"Cust {i}"}, 201)
    seen, cursor = [], None
    while True:
        page = org.get("/customers?limit=2" + (f"&cursor={cursor}" if cursor else "")).json()
        seen += [x["id"] for x in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 6
    assert [x["name"] for x in org.get("/customers?q=Pager").json()["items"]] == ["Pager"]

    org.post("/vehicles", {"unit_number": "DUP"}, 201)
    assert org.post("/vehicles", {"unit_number": "DUP"}, expect=409).json()["error"]["code"] == "duplicate"
    new_load(org, c["id"])
    org.delete(f"/customers/{c['id']}", expect=409)   # in use by a load

    org.post("/drivers", {"first_name": "Soon", "last_name": "Expiring", "cdl_expiry": "2020-05-05"}, 201)
    comp = org.get("/reports/compliance?days=30").json()["items"]
    assert any(i["label"] == "Soon Expiring" and i["expired"] for i in comp)


def test_dispatch_board_and_invoice_list_views(org):
    s = seed_basics(org)
    cid = s["customer"]["id"]
    waiting, moving = new_load(org, cid), new_load(org, cid)
    _assign(org, moving, s, expect=201)
    org.post(f"/dispatch/loads/{moving['id']}/dispatch", expect=200)

    board = org.get("/dispatch/board").json()
    assert board["truncated"] is False
    assert set(board["columns"]) == {"pending", "assigned", "dispatched", "in_transit", "delivered"}
    assert [c["load_number"] for c in board["columns"]["pending"]] == [waiting["load_number"]]
    card = board["columns"]["dispatched"][0]
    assert (card["origin"], card["destination"], card["customer_name"]) == ("Chicago, IL", "Dallas, TX", "Globex")
    assert card["assignment"]["driver_name"] == "Dana Driver" and board["columns"]["pending"][0]["assignment"] is None

    # run the dispatched load through to an invoice with a part payment
    for stop in moving["stops"]:
        for event in ("arrived", "departed"):
            org.post(f"/loads/{moving['id']}/stops/{stop['id']}/events", {"event": event}, expect=200)
    org.post(f"/loads/{moving['id']}/documents", expect=201, data={"type": "pod"}, files={"file": PDF})
    org.post(f"/loads/{moving['id']}/confirm-delivery", expect=200)
    inv = org.post("/invoices", {"load_id": moving["id"]}, expect=201).json()
    org.post(f"/invoices/{inv['id']}/payments", {"amount": "400.00"}, expect=201)

    listed = org.get("/invoices").json()["items"]
    assert len(listed) == 1
    row = listed[0]
    assert (row["total"], row["paid_total"], row["balance"]) == ("2500.00", "400.00", "2100.00")
    assert (row["customer_name"], row["load_number"], row["overdue"]) == ("Globex", moving["load_number"], False)
    assert org.get("/invoices?status=overdue").json()["items"] == []
    assert float(org.get("/reports/operations").json()["receivables_outstanding"]) == 2100.0

    # voiding is blocked once money has been received; a clean invoice can be voided and re-issued
    org.post(f"/invoices/{inv['id']}/void", expect=409)


def test_search_treats_wildcards_literally(org):
    org.post("/customers", {"name": "100% Freight"}, 201)
    org.post("/customers", {"name": "Plain Logistics"}, 201)
    assert [c["name"] for c in org.get("/customers", params={"q": "%"}).json()["items"]] == ["100% Freight"]
    assert org.get("/customers", params={"q": "_"}).json()["items"] == []
    assert len(org.get("/customers", params={"q": "FREIGHT"}).json()["items"]) == 1


def test_load_creation_is_idempotent_and_money_carries_its_currency(org):
    s = seed_basics(org)
    body = {"customer_id": s["customer"]["id"], "customer_rate": "1800.00", "stops": STOPS}
    key = {"Idempotency-Key": uuid.uuid4().hex}

    first = org.post("/loads", body, expect=201, headers=key)
    again = org.post("/loads", body, expect=201, headers=key)          # e.g. the response was lost and the app retried
    assert again.json() == first.json() and again.headers.get("Idempotent-Replay") == "true"
    assert len(org.get("/loads").json()["items"]) == 1                  # one load, one load number
    org.post("/loads", {**body, "customer_rate": "1.00"}, expect=422, headers=key)   # same key, different request
    assert org.post("/loads", body, expect=201).json()["load_number"] == "L-000002"  # no key: a new load

    load = first.json()
    assert load["currency"] == "USD"
    _assign(org, load, s, expect=201)
    org.post(f"/dispatch/loads/{load['id']}/dispatch", expect=200)
    for stop in load["stops"]:
        for event in ("arrived", "departed"):
            org.post(f"/loads/{load['id']}/stops/{stop['id']}/events", {"event": event}, expect=200)
    org.post(f"/loads/{load['id']}/documents", expect=201, data={"type": "pod"}, files={"file": PDF})
    org.post(f"/loads/{load['id']}/confirm-delivery", expect=200)
    inv = org.post("/invoices", {"load_id": load["id"]}, expect=201).json()
    paid = org.post(f"/invoices/{inv['id']}/payments", {"amount": "1800.00"}, expect=201).json()
    assert inv["currency"] == "USD" and paid["payments"][0]["currency"] == "USD"
