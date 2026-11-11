"""Tenant isolation, enforced by PostgreSQL RLS — tested through the API and directly in SQL."""
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from tests.conftest import APP_URL, STOPS, new_load, seed_basics


def test_api_cannot_see_or_touch_another_tenants_records(make_org):
    a, b = make_org("Alpha Freight"), make_org("Bravo Haulage")
    sa = seed_basics(a)
    load_a = new_load(a, sa["customer"]["id"])

    assert b.get("/customers").json()["items"] == []
    assert b.get("/loads").json()["items"] == []
    b.get(f"/customers/{sa['customer']['id']}", expect=404)
    b.get(f"/loads/{load_a['id']}", expect=404)
    b.patch(f"/customers/{sa['customer']['id']}", {"name": "hijacked"}, expect=404)
    b.delete(f"/drivers/{sa['driver']['id']}", expect=404)
    b.post(f"/loads/{load_a['id']}/cancel", {"reason": "x"}, expect=404)
    assert a.get(f"/customers/{sa['customer']['id']}").json()["name"] == "Globex"


def test_cannot_reference_another_tenants_records(make_org):
    a, b = make_org(), make_org()
    sa, sb = seed_basics(a), seed_basics(b)
    # B creates a load for A's customer
    b.post("/loads", {"customer_id": sa["customer"]["id"], "stops": STOPS}, expect=404)
    # B assigns A's driver/truck to B's own load
    load_b = new_load(b, sb["customer"]["id"])
    b.post("/dispatch/assignments", {"load_id": load_b["id"], "driver_id": sa["driver"]["id"],
                                     "vehicle_id": sb["truck"]["id"], "trailer_id": sb["trailer"]["id"]}, expect=404)
    b.post("/dispatch/assignments", {"load_id": load_b["id"], "driver_id": sb["driver"]["id"],
                                     "vehicle_id": sa["truck"]["id"], "trailer_id": sb["trailer"]["id"]}, expect=404)


def test_users_of_other_tenants_are_invisible(make_org):
    a, b = make_org(), make_org()
    emails_seen_by_b = {u["email"] for u in b.get("/users").json()}
    assert a.email not in emails_seen_by_b and b.email in emails_seen_by_b
    b.patch(f"/users/{uuid.uuid4()}", {"role": "admin"}, expect=404)


@pytest.fixture
def sql():
    eng = create_engine(APP_URL)
    yield eng
    eng.dispose()


def _ctx(conn, org_id):
    conn.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org_id or ""})


def test_rls_in_sql_no_context_sees_nothing(make_org, sql):
    a = make_org()
    seed_basics(a)
    with sql.begin() as c:  # no tenant context at all
        for t in ("customers", "drivers", "vehicles", "loads", "organizations", "organization_memberships",
                  "users", "audit_logs"):
            assert c.execute(text(f"SELECT count(*) FROM {t}")).scalar() == 0, t


def test_rls_in_sql_context_scopes_rows_and_blocks_cross_tenant_writes(make_org, sql):
    a, b = make_org(), make_org()
    seed_basics(a)
    seed_basics(b)
    with sql.begin() as c:
        _ctx(c, a.org_id)
        orgs = {str(r[0]) for r in c.execute(text("SELECT DISTINCT organization_id FROM customers"))}
        assert orgs == {a.org_id}
        # UPDATE/DELETE aimed at another tenant silently match zero rows
        assert c.execute(text("UPDATE customers SET name='x' WHERE organization_id = :o"), {"o": b.org_id}).rowcount == 0
        assert c.execute(text("DELETE FROM customers WHERE organization_id = :o"), {"o": b.org_id}).rowcount == 0
    # INSERT claiming another tenant's organization_id violates the policy's WITH CHECK
    with pytest.raises(DBAPIError, match="row-level security"), sql.begin() as c:
        _ctx(c, a.org_id)
        c.execute(text("INSERT INTO customers (organization_id, name) VALUES (:o, 'smuggled')"), {"o": b.org_id})


def test_composite_fk_blocks_cross_tenant_links_even_without_rls(make_org):
    """Defence in depth: as table owner (RLS context set per statement), a load can't point at another org's customer."""
    from tests.conftest import OWNER_URL
    a, b = make_org(), make_org()
    sb = seed_basics(b)
    eng = create_engine(OWNER_URL)
    try:
        with pytest.raises(DBAPIError, match="fk_loads_customer"), eng.begin() as c:
            _ctx(c, a.org_id)
            c.execute(text("INSERT INTO loads (organization_id, load_number, customer_id) VALUES (:o, 'X-1', :c)"),
                      {"o": a.org_id, "c": sb["customer"]["id"]})
    finally:
        eng.dispose()


def test_history_tables_are_append_only_for_the_app_role(make_org, sql):
    a = make_org()
    s = seed_basics(a)
    new_load(a, s["customer"]["id"])
    for stmt in ("UPDATE load_status_events SET note = 'tampered'", "DELETE FROM load_status_events",
                 "UPDATE audit_logs SET action = 'tampered'", "DELETE FROM audit_logs",
                 "DELETE FROM invoices", "DELETE FROM payments"):
        with pytest.raises(DBAPIError, match="permission denied"), sql.begin() as c:
            _ctx(c, a.org_id)
            c.execute(text(stmt))
