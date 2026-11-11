"""Accounts: password changes, token revocation, multi-company sign-in, and what the app role may do to users."""
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from tests.conftest import APP_URL, OWNER_URL, PASSWORD, Api

NEW_PASSWORD = "an-even-better-passphrase"


def _login(client, email, password, **extra):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password, **extra})


def test_change_password_revokes_existing_tokens(org, client):
    user = org.add_user("dispatcher")
    email = user.get("/auth/me").json()["email"]
    # a second session for the same user (e.g. another device)
    other_device = Api(client, _login(client, email, PASSWORD).json()["access_token"], org.org_id)
    other_device.get("/auth/me")

    r = user.post("/auth/password", {"current_password": "definitely-wrong", "new_password": NEW_PASSWORD}, expect=403)
    assert r.json()["error"]["code"] == "wrong_password"
    user.post("/auth/password", {"current_password": PASSWORD, "new_password": "short"}, expect=422)
    user.post("/auth/password", {"current_password": PASSWORD, "new_password": PASSWORD}, expect=422)

    fresh = user.post("/auth/password", {"current_password": PASSWORD, "new_password": NEW_PASSWORD}, expect=200).json()

    # every token issued before the change is dead, on every device
    user.get("/auth/me", expect=401)
    other_device.get("/auth/me", expect=401)
    # the token returned by the change keeps this session going
    Api(client, fresh["access_token"], org.org_id).get("/auth/me")
    # and only the new password signs in
    assert _login(client, email, PASSWORD).status_code == 401
    assert _login(client, email, NEW_PASSWORD).status_code == 200
    assert "user.password_changed" in {a["action"] for a in org.get("/audit-logs?limit=200").json()["items"]}


def test_user_in_two_companies_chooses_one_and_stays_inside_it(make_org, client):
    a, b = make_org("Alpha Freight"), make_org("Bravo Haulage")
    a.post("/customers", {"name": "Alpha-only customer"}, 201)
    b.post("/customers", {"name": "Bravo-only customer"}, 201)
    a_owner_id = a.get("/auth/me").json()["user_id"]
    # There is no invitation flow yet, so grant the second membership the way an operator would.
    owner = create_engine(OWNER_URL)
    with owner.begin() as c:
        c.execute(text("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (:o, :u, 'dispatcher')"),
                  {"o": b.org_id, "u": a_owner_id})
    owner.dispose()

    r = _login(client, a.email, PASSWORD).json()
    assert r["access_token"] is None and r["requires_organization_selection"] is True
    assert {o["name"]: o["role"] for o in r["organizations"]} == {"Alpha Freight": "owner", "Bravo Haulage": "dispatcher"}

    in_b = Api(client, _login(client, a.email, PASSWORD, organization_id=b.org_id).json()["access_token"], b.org_id)
    me = in_b.get("/auth/me").json()
    assert (me["organization_name"], me["role"]) == ("Bravo Haulage", "dispatcher")
    assert [c["name"] for c in in_b.get("/customers").json()["items"]] == ["Bravo-only customer"]
    in_b.get("/users", expect=403)  # owner of Alpha, but only a dispatcher here

    # Back in Alpha, the membership in Bravo doesn't leak into team management...
    assert [u["role"] for u in a.get("/users").json() if u["user_id"] == a_owner_id] == ["owner"]
    # ...and being an owner elsewhere doesn't count towards Alpha's "at least one owner" rule.
    a.patch(f"/users/{a_owner_id}", {"role": "dispatcher"}, expect=409)

    assert _login(client, a.email, PASSWORD, organization_id=str(uuid.uuid4())).status_code == 401


def test_app_role_can_only_update_its_own_user_row_and_only_safe_columns(make_org):
    a = make_org()
    colleague = a.add_user("dispatcher")
    me_id = a.get("/auth/me").json()["user_id"]
    eng = create_engine(APP_URL)

    def ctx(conn):
        conn.execute(text("SELECT set_config('app.org_id', :o, true), set_config('app.user_id', :u, true)"),
                     {"o": a.org_id, "u": me_id})
    try:
        with eng.begin() as c:
            ctx(c)
            # can see a colleague, but can't take over their account
            assert c.execute(text("SELECT count(*) FROM users WHERE id = :i"), {"i": colleague.user_id}).scalar() == 1
            assert c.execute(text("UPDATE users SET password_hash = 'x' WHERE id = :i"), {"i": colleague.user_id}).rowcount == 0
            # own row: allowed columns only
            assert c.execute(text("UPDATE users SET full_name = 'Renamed' WHERE id = :i"), {"i": me_id}).rowcount == 1
        for stmt in ("UPDATE users SET email = 'x@example.com'", "UPDATE users SET active = false", "DELETE FROM users",
                     "INSERT INTO users (email, full_name) VALUES ('y@example.com', 'Y')",
                     "DELETE FROM organization_memberships"):
            with pytest.raises(DBAPIError, match="permission denied"), eng.begin() as c:
                ctx(c)
                c.execute(text(stmt))
    finally:
        eng.dispose()
    colleague.get("/auth/me")  # untouched


def test_repeated_bad_passwords_are_rate_limited(org, client):
    codes = [_login(client, org.email, f"wrong-password-{i}").status_code for i in range(12)]
    assert codes[:10] == [401] * 10 and codes[-1] == 429
    # even the right password is refused while locked out
    assert _login(client, org.email, PASSWORD).status_code == 429
