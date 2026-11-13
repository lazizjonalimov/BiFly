"""Signing in, roles and what each may do, the team, passwords and session revocation."""
import uuid

import pytest

from tests.conftest import PASSWORD, Api, login, new_load, seed


def test_signup_creates_an_account_with_its_first_company(make_org):
    api = make_org("Northwind Carriers", timezone="America/Chicago", dot_number="1234567")
    me = api.get("/auth/me").json()
    assert me["organization"]["name"] == "Northwind Carriers" and me["organization"]["role"] == "owner"
    assert me["organization"]["timezone"] == "America/Chicago" and me["organization"]["slug"].startswith("northwind-carriers-")
    assert me["account"] == {"id": me["account"]["id"], "name": "Northwind Carriers", "is_owner": True,
                             "max_companies": 10}
    assert len(me["memberships"]) == 1 and "users.manage" in me["permissions"]
    org = api.get("/organization").json()
    assert org["dot_number"] == "1234567" and org["base_currency"] == "USD"


def test_signup_validation_and_duplicates(client, make_org):
    api = make_org()
    body = {"organization_name": "Other", "full_name": "X", "email": api.email.upper(), "password": PASSWORD}
    r = client.post("/api/v1/auth/signup", json=body)
    assert r.status_code == 409 and r.json()["error"]["field_errors"] == {
        "email": "An account with this email already exists"}
    r = client.post("/api/v1/auth/signup", json={**body, "email": "new@example.com", "password": "short",
                                                  "timezone": "Mars/Olympus"})
    assert r.status_code == 422 and set(r.json()["error"]["field_errors"]) == {"password", "timezone"}


def test_login_rejects_bad_credentials_without_revealing_which_part_was_wrong(client, make_org):
    api = make_org()
    wrong_password = client.post("/api/v1/auth/login", json={"email": api.email, "password": "wrong-password-1"})
    unknown_email = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["error"]["message"] == unknown_email.json()["error"]["message"]
    assert login(client, api.email.upper()).org_id == api.org_id      # email is case-insensitive


def test_repeated_failed_logins_are_throttled(client, make_org):
    api = make_org()
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"email": api.email, "password": "nope-nope-nope"}).status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": api.email, "password": PASSWORD})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


def test_tokens_are_rejected_when_missing_forged_or_malformed(client, make_org):
    make_org()
    for headers in ({}, {"Authorization": "Bearer not-a-token"}, {"Authorization": "Basic abc"}):
        r = client.get("/api/v1/auth/me", headers=headers)
        assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


ROLE_CHECKS = [
    # role, (method, url, body, allowed?)
    ("dispatcher", [("POST", "/customers", {"name": "New"}, True), ("POST", "/drivers", {"first_name": "A", "last_name": "B"}, False),
                    ("POST", "/vehicles", {"unit_number": "X1"}, False), ("GET", "/invoices", None, True),
                    ("GET", "/payments", None, False), ("GET", "/members", None, False),
                    ("GET", "/audit-logs", None, False), ("GET", "/dispatch/board", None, True)]),
    ("safety_manager", [("POST", "/drivers", {"first_name": "A", "last_name": "B"}, True), ("POST", "/customers", {"name": "N"}, False),
                        ("GET", "/safety/expirations", None, True), ("GET", "/invoices", None, False),
                        ("POST", "/vehicles", {"unit_number": "X2"}, False)]),
    ("fleet_manager", [("POST", "/vehicles", {"unit_number": "X3"}, True), ("POST", "/trailers", {"unit_number": "X4"}, True),
                       ("POST", "/drivers", {"first_name": "A", "last_name": "B"}, False), ("GET", "/invoices", None, False)]),
    ("accountant", [("GET", "/invoices", None, True), ("GET", "/payments", None, True), ("GET", "/finance/receivables", None, True),
                    ("POST", "/customers", {"name": "N"}, False), ("GET", "/dispatch/board", None, False),
                    ("GET", "/reports/ar-aging", None, True)]),
    ("viewer", [("GET", "/loads", None, True), ("GET", "/customers", None, True), ("GET", "/invoices", None, True),
                ("GET", "/dispatch/board", None, True), ("POST", "/customers", {"name": "N"}, False),
                ("GET", "/audit-logs", None, False), ("GET", "/members", None, False)]),
    ("driver", [("GET", "/loads", None, False), ("GET", "/customers", None, False), ("GET", "/dispatch/board", None, False),
                ("GET", "/dashboard/summary", None, False), ("GET", "/invoices", None, False)]),
]


@pytest.mark.parametrize("role,checks", ROLE_CHECKS, ids=[r for r, _ in ROLE_CHECKS])
def test_each_role_is_held_to_its_permissions(org, role, checks):
    user = org.add_user(role)
    assert user.get("/auth/me").json()["organization"]["role"] == role
    for method, url, body, allowed in checks:
        r = user._go(method, url, json=body)
        if allowed:
            assert r.status_code in (200, 201), f"{role} {method} {url} -> {r.status_code}: {r.text}"
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN", f"{role} {method} {url} -> {r.status_code}"


def test_viewer_can_read_but_never_write(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    viewer = org.add_user("viewer")
    assert viewer.get(f"/loads/{load['id']}").json()["allowed_actions"] == []
    viewer.error("POST", f"/loads/{load['id']}/transitions", 403, "FORBIDDEN",
                 json={"action": "cancel", "version": load["version"], "reason": "x"})
    viewer.error("PATCH", f"/loads/{load['id']}", 403, "FORBIDDEN", json={"version": load["version"], "miles": 1})
    viewer.error("POST", "/dispatch/assignments", 403, "FORBIDDEN", json={
        "load_id": load["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"], "version": 1})


def test_role_matrix_lists_roles_and_permissions(org):
    matrix = org.get("/roles").json()
    keys = [r["key"] for r in matrix["roles"]]
    assert keys[:2] == ["owner", "admin"] and "customer" not in keys and "driver" in keys
    dispatcher = next(r for r in matrix["roles"] if r["key"] == "dispatcher")
    assert "dispatch.assign" in dispatcher["permissions"] and "payments.record" not in dispatcher["permissions"]
    assert {g["name"] for g in matrix["groups"]} >= {"Operations", "Finance", "Administration"}


def test_owner_rules(org):
    admin = org.add_user("admin")
    # An admin runs the company but can't mint or unseat owners.
    admin.error("POST", "/members", 403, "FORBIDDEN", json={
        "email": "o2@example.com", "full_name": "O", "password": PASSWORD, "role": "owner"})
    me = org.get("/auth/me").json()["user"]["id"]
    admin.error("PATCH", f"/members/{me}", 403, "FORBIDDEN", json={"role": "viewer"})
    admin.error("PATCH", f"/members/{me}", 403, "FORBIDDEN", json={"active": False})
    # The last owner can't be demoted or deactivated, even by themselves.
    org.error("PATCH", f"/members/{me}", 409, "LAST_OWNER", json={"role": "admin"})
    org.error("PATCH", f"/members/{me}", 409, "LAST_OWNER", json={"active": False})
    second = org.add_user("owner")
    assert org.patch(f"/members/{second.user_id}", {"role": "dispatcher"}, 200).json()["role"] == "dispatcher"
    org.error("POST", "/members", 403, "FORBIDDEN", json={
        "email": "c@example.com", "full_name": "C", "password": PASSWORD, "role": "customer"})


def test_role_change_and_deactivation_take_effect_on_the_next_request(org):
    user = org.add_user("dispatcher")
    user.post("/customers", {"name": "Before"}, 201)
    org.patch(f"/members/{user.user_id}", {"role": "viewer"}, 200)
    user.error("POST", "/customers", 403, "FORBIDDEN", json={"name": "After"})     # same token, new role
    org.patch(f"/members/{user.user_id}", {"active": False}, 200)
    user.error("GET", "/customers", 401, "UNAUTHENTICATED")                         # removed member loses access
    r = user.c.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert r.status_code == 401


def test_adding_a_member_needs_a_password_only_for_a_new_sign_in(org, make_org):
    body = org.error("POST", "/members", 422, "VALIDATION_ERROR",
                     json={"email": f"new-{uuid.uuid4().hex[:6]}@example.com", "full_name": "New", "role": "viewer"})
    assert list(body["field_errors"]) == ["password"]
    # Someone who already has a BiFly sign-in is simply given access; their password is untouched.
    other = make_org("Elsewhere")
    added = org.post("/members", {"email": other.email, "full_name": "ignored", "role": "accountant"}, 201).json()
    assert added["full_name"] == "Olive Owner"
    org.error("POST", "/members", 409, "DUPLICATE_REFERENCE",
              json={"email": other.email, "full_name": "x", "role": "viewer"})
    both = other.get("/auth/me").json()["memberships"]
    assert {m["role"] for m in both} == {"owner", "accountant"}


def test_password_change_revokes_every_earlier_token(org, client):
    old = org.h
    body = org.error("POST", "/auth/password", 403, "WRONG_PASSWORD",
                     json={"current_password": "not-my-password", "new_password": "a-brand-new-password"})
    assert "current_password" in body["field_errors"]
    org.error("POST", "/auth/password", 422, "VALIDATION_ERROR",
              json={"current_password": PASSWORD, "new_password": PASSWORD})
    fresh = org.post("/auth/password", {"current_password": PASSWORD, "new_password": "a-brand-new-password"}, 200).json()
    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    assert Api(client, fresh["access_token"], org.org_id).get("/auth/me").json()["user"]["email"] == org.email
    assert client.post("/api/v1/auth/login", json={"email": org.email, "password": PASSWORD}).status_code == 401
    assert login(client, org.email, password="a-brand-new-password").org_id == org.org_id


def test_company_settings_terminals_preferences_and_saved_views(org):
    settings = org.patch("/organization", {"legal_name": "Acme Trucking LLC", "timezone": "America/Denver",
                                           "load_number_prefix": "AC", "default_payment_terms_days": 45}, 200).json()
    assert settings["timezone"] == "America/Denver" and settings["load_number_prefix"] == "AC"
    org.error("PATCH", "/organization", 422, "VALIDATION_ERROR", json={"timezone": "Nowhere/None"})
    s = seed(org)
    assert new_load(org, s["customer"]["id"])["load_number"] == "AC-1001"

    yard = org.post("/terminals", {"name": "Chicago yard", "code": "CHI", "city": "Chicago", "state": "IL"}, 201).json()
    org.error("POST", "/terminals", 409, "DUPLICATE_REFERENCE", json={"name": "Chicago yard"})
    assert org.post(f"/terminals/{yard['id']}/archive", expect=200).json()["status"] == "archived"
    assert [t["name"] for t in org.items("/terminals", status="active")] == []
    dispatcher = org.add_user("dispatcher")
    assert dispatcher.items("/terminals")[0]["code"] == "CHI"            # everyone can read terminals
    dispatcher.error("POST", "/terminals", 403, "FORBIDDEN", json={"name": "Nope"})

    # Preferences belong to one user in one company.
    org.put("/preferences/loads.columns", {"value": ["load_number", "status"]}, 204)
    org.put("/preferences/loads.columns", {"value": ["load_number"]}, 204)
    assert org.get("/preferences").json() == {"loads.columns": ["load_number"]}
    assert dispatcher.get("/preferences").json() == {}
    org.error("PUT", "/preferences/Bad Key!", 422, "VALIDATION_ERROR", json={"value": 1})

    mine = dispatcher.post("/saved-views", {"resource": "loads", "name": "My late loads", "params": {"view": "at_risk"}}, 201).json()
    dispatcher.error("POST", "/saved-views", 403, "FORBIDDEN",
                     json={"resource": "loads", "name": "For all", "params": {}, "shared": True})
    shared = org.post("/saved-views", {"resource": "loads", "name": "Unassigned", "params": {"view": "unassigned"},
                                       "shared": True}, 201).json()
    assert [v["name"] for v in dispatcher.get("/saved-views", params={"resource": "loads"}).json()] == ["Unassigned", "My late loads"]
    assert [v["name"] for v in org.get("/saved-views", params={"resource": "loads"}).json()] == ["Unassigned"]
    dispatcher.error("DELETE", f"/saved-views/{shared['id']}", 403, "FORBIDDEN")
    dispatcher.delete(f"/saved-views/{mine['id']}", expect=204)


def test_audit_log_records_who_did_what_and_is_searchable(org):
    s = seed(org)
    dispatcher = org.add_user("dispatcher")
    load = new_load(dispatcher, s["customer"]["id"])
    entries = org.items("/audit-logs", entity_type="load", entity_id=load["id"])
    assert [e["action"] for e in entries] == ["load.created"]
    assert entries[0]["actor_name"] == "Dispatcher" and entries[0]["request_id"]
    assert org.items("/audit-logs", action="member.added")[0]["data"]["role"] == "dispatcher"
    assert org.items("/audit-logs", actor_user_id=dispatcher.user_id)[0]["action"] == "load.created"
    assert org.get("/audit-logs", params={"count": "true", "limit": 2}).json()["page"]["total_count"] >= 5
