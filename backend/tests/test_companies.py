"""One profile, up to ten companies (decision 0001)."""
import uuid

from sqlalchemy import text

from tests.conftest import PASSWORD, login, new_load, seed


def add_company(api, name="Second Co", expect=201, **extra):
    return api.post("/account/companies", {"name": name, **extra}, expect)


def test_owner_adds_a_company_and_switches_into_it(org, client):
    created = add_company(org, "Bravo Logistics", dot_number="7654321").json()
    assert created["status"] == "active" and created["copied"] == {}

    listing = org.get("/account/companies").json()
    assert listing["max_companies"] == 10 and listing["active_count"] == 2
    assert [c["name"] for c in listing["companies"]] == ["Acme Trucking", "Bravo Logistics"]

    second = org.switch(created["id"])
    me = second.get("/auth/me").json()
    assert me["organization"]["name"] == "Bravo Logistics" and me["organization"]["role"] == "owner"
    assert {m["name"] for m in me["memberships"]} == {"Acme Trucking", "Bravo Logistics"}
    # The company the owner last worked in is where the next sign-in lands.
    assert login(client, org.email).org_id == created["id"]
    # ...and an explicit choice at sign-in wins.
    assert login(client, org.email, org.org_id).org_id == org.org_id


def test_each_company_is_its_own_tenant(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    second = org.switch(add_company(org).json()["id"])
    # Same owner, same account: still nothing from the first company is visible in the second.
    for url in ("/customers", "/loads", "/drivers", "/vehicles", "/trailers"):
        assert second.items(url) == [], url
    second.get(f"/loads/{load['id']}", expect=404)
    second.get(f"/customers/{s['customer']['id']}", expect=404)
    assert second.error("POST", "/loads", 422, "VALIDATION_ERROR", json={"customer_id": s["customer"]["id"]})[
        "field_errors"] == {"customer_id": "Customer not found"}
    # Numbering starts again: each company keeps its own books.
    s2 = seed(second)
    assert new_load(second, s2["customer"]["id"])["load_number"] == load["load_number"] == "L-1001"


def test_copying_setup_makes_a_new_company_ready_to_operate(org):
    yard = org.post("/terminals", {"name": "Main yard", "code": "MAIN"}, 201).json()
    s = seed(org, with_login=True)
    org.patch(f"/drivers/{s['driver']['id']}", {"terminal_id": yard["id"]}, 200)
    org.post(f"/drivers/{s['driver']['id']}/qualifications", {"type": "hazmat", "expires_on": "2034-05-01",
                                                               "required": True}, 201)
    org.post(f"/customers/{s['customer']['id']}/contacts", {"name": "Bill Payer", "kind": "billing"}, 201)
    org.post(f"/customers/{s['customer']['id']}/addresses", {"label": "Dock 4", "city": "Joliet"}, 201)
    dispatcher = org.add_user("dispatcher")
    new_load(org, s["customer"]["id"])

    created = add_company(org, "Phoenix Freight", copy_from=org.org_id,
                          include=["team", "terminals", "customers", "drivers", "vehicles", "trailers"]).json()
    assert created["copied"] == {"team": 2, "terminals": 1, "customers": 1, "drivers": 1, "vehicles": 1, "trailers": 1}

    new = org.switch(created["id"])
    customer = new.items("/customers")[0]
    detail = new.get(f"/customers/{customer['id']}").json()
    assert customer["name"] == "Globex" and customer["id"] != s["customer"]["id"]
    assert [c["name"] for c in detail["contacts"]] == ["Bill Payer"] and [a["label"] for a in detail["addresses"]] == ["Dock 4"]
    driver = new.items("/drivers")[0]
    assert driver["full_name"] == "Dana Driver" and driver["cdl_number"] == "D1234567"   # re-encrypted, still readable
    assert driver["terminal_id"] == new.items("/terminals")[0]["id"] != yard["id"]
    assert driver["user_id"] == s["driver_api"].user_id                                   # the driver's sign-in came along
    assert [q["type"] for q in new.get(f"/drivers/{driver['id']}/qualifications").json()] == ["hazmat"]
    assert len(new.items("/vehicles")) == 1 and len(new.items("/trailers")) == 1
    assert {m["role"] for m in new.get("/members").json()} == {"owner", "dispatcher", "driver"}
    # Work and money are never copied.
    assert new.items("/loads") == [] and new.items("/invoices") == []
    # The dispatcher can switch too, and a copy is independent of its source.
    assert dispatcher.switch(created["id"]).items("/customers")[0]["name"] == "Globex"
    new.patch(f"/customers/{customer['id']}", {"name": "Globex West"}, 200)
    assert org.get(f"/customers/{s['customer']['id']}").json()["name"] == "Globex"


def test_copying_without_the_team_drops_the_drivers_sign_in_link(org):
    seed(org, with_login=True)
    created = add_company(org, "Lean Co", copy_from=org.org_id, include=["drivers"]).json()
    assert created["copied"] == {"drivers": 1}
    driver = org.switch(created["id"]).items("/drivers")[0]
    assert driver["user_id"] is None and driver["terminal_id"] is None


def test_at_most_ten_active_companies(org):
    for i in range(9):
        add_company(org, f"Company {i + 2}")
    body = add_company(org, "One too many", expect=409).json()["error"]
    assert body["code"] == "COMPANY_LIMIT_REACHED" and body["details"] == {"max_companies": 10, "active": 10}

    # Archiving one makes room, because archived companies don't count.
    listing = org.get("/account/companies").json()
    spare = next(c for c in listing["companies"] if c["name"] == "Company 5")
    assert org.post(f"/account/companies/{spare['id']}/archive", expect=200).json()["status"] == "archived"
    replacement = add_company(org, "Replacement").json()
    assert org.get("/account/companies").json()["active_count"] == 10
    # Restoring is held to the same limit.
    assert org.post(f"/account/companies/{spare['id']}/restore", expect=409).json()["error"]["code"] == "COMPANY_LIMIT_REACHED"
    org.post(f"/account/companies/{replacement['id']}/archive", expect=200)
    assert org.post(f"/account/companies/{spare['id']}/restore", expect=200).json()["status"] == "active"


def test_an_archived_company_is_read_only(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    second = add_company(org).json()
    org.post(f"/account/companies/{org.org_id}/archive", expect=200)

    assert org.get("/auth/me").json()["organization"]["status"] == "archived"
    assert org.get(f"/loads/{load['id']}").json()["load_number"] == "L-1001"          # still readable
    for method, url, body in (("POST", "/customers", {"name": "x"}),
                              ("PATCH", f"/loads/{load['id']}", {"version": 1, "miles": 5}),
                              ("POST", f"/loads/{load['id']}/transitions", {"action": "cancel", "version": 1, "reason": "x"}),
                              ("DELETE", f"/customers/{s['customer']['id']}", None)):
        assert org.error(method, url, 409, "ORGANIZATION_ARCHIVED", json=body)
    # Leaving for another company, or restoring this one, still works.
    assert org.switch(second["id"]).get("/auth/me").json()["organization"]["status"] == "active"
    org.post(f"/account/companies/{org.org_id}/restore", expect=200)
    org.post("/customers", {"name": "Back in business"}, 201)


def test_the_last_active_company_cannot_be_archived(org):
    org.error("POST", f"/account/companies/{org.org_id}/archive", 409, "LAST_ACTIVE_COMPANY")


def test_only_the_account_owner_manages_companies(org, make_org):
    admin = org.add_user("admin")
    admin.error("GET", "/account/companies", 403, "FORBIDDEN")
    admin.error("POST", "/account/companies", 403, "FORBIDDEN", json={"name": "Sneaky Co"})
    admin.error("POST", f"/account/companies/{org.org_id}/archive", 403, "FORBIDDEN")
    # A second owner of the company still isn't the account owner.
    co_owner = org.add_user("owner")
    co_owner.error("POST", "/account/companies", 403, "FORBIDDEN", json={"name": "Sneaky Co"})
    # Another account's owner can't reach into this one.
    stranger = make_org("Stranger Inc")
    stranger.error("POST", f"/account/companies/{org.org_id}/archive", 404, "NOT_FOUND")
    stranger.error("POST", "/account/companies", 404, "NOT_FOUND",
                   json={"name": "Clone", "copy_from": org.org_id, "include": ["customers", "drivers"]})
    assert [c["name"] for c in stranger.get("/account/companies").json()["companies"]] == ["Stranger Inc"]


def test_switching_requires_membership(org, make_org):
    other = make_org("Not Yours")
    org.error("POST", "/auth/switch", 403, "FORBIDDEN", json={"organization_id": other.org_id})
    org.error("POST", "/auth/switch", 403, "FORBIDDEN", json={"organization_id": str(uuid.uuid4())})


def test_sign_in_with_several_companies_and_no_history_asks_which_one(org, client, owner_sql):
    add_company(org, "Second Co")
    me = org.get("/auth/me").json()["user"]["id"]
    with owner_sql.begin() as c:   # as if this person had never chosen a company
        c.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": me})
        assert c.execute(text("UPDATE users SET last_organization_id = NULL WHERE id = :u"), {"u": me}).rowcount == 1
    body = client.post("/api/v1/auth/login", json={"email": org.email, "password": PASSWORD}).json()
    assert body["requires_organization_selection"] is True and body["access_token"] is None
    assert [o["name"] for o in body["organizations"]] == ["Acme Trucking", "Second Co"]
    assert client.post("/api/v1/auth/login", json={"email": org.email, "password": PASSWORD,
                                                   "organization_id": str(uuid.uuid4())}).status_code == 401


def test_company_creation_is_audited_in_the_new_company(org):
    created = add_company(org, "Audited Co", copy_from=org.org_id, include=["customers"]).json()
    entry = org.switch(created["id"]).items("/audit-logs", action="organization.created")[0]
    assert entry["data"]["copied_from"] == org.org_id and entry["actor_name"] == "Olive Owner"
