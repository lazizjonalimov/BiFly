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
                 "DELETE FROM invoices", "DELETE FROM payments", "UPDATE payments SET amount = 1",
                 "UPDATE invoice_lines SET amount = 1", "DELETE FROM invoice_lines"):
        with pytest.raises(DBAPIError, match="permission denied"), sql.begin() as c:
            _ctx(c, a.org_id)
            c.execute(text(stmt))


def test_orm_layer_scopes_reads_independently_of_rls(make_org):
    """Defence in depth: point the database context at org B while the session belongs to org A.

    RLS then only lets B's rows through, and the ORM filter only lets A's rows through, so an ORM query sees
    nothing — while the same query in raw SQL (which skips the ORM filter) sees B's rows.
    """
    from sqlalchemy import select

    from app.core.db import new_session
    from app.modules.customers.models import Customer
    from app.modules.loads.models import Load

    a, b = make_org(), make_org()
    sa_, sb = seed_basics(a), seed_basics(b)
    new_load(a, sa_["customer"]["id"])
    new_load(b, sb["customer"]["id"])

    db = new_session(org_id=uuid.UUID(a.org_id))
    try:
        assert {c.name for c in db.scalars(select(Customer))} == {"Globex"}          # normal: A's own data
        db.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": b.org_id})  # simulate a wrong DB context
        assert db.execute(text("SELECT count(*) FROM customers")).scalar() == 1         # RLS now exposes B's row...
        assert list(db.scalars(select(Customer))) == []                                 # ...but the ORM won't load it
        assert db.scalar(select(Customer.name)) is None                                 # column selects
        assert list(db.execute(select(Load.load_number, Customer.name).join(Customer, Customer.id == Load.customer_id))) == []
        assert db.get(Customer, uuid.UUID(sb["customer"]["id"])) is None                # primary-key lookups
    finally:
        db.rollback()
        db.close()


def test_api_refuses_to_run_as_a_role_that_bypasses_rls():
    from app.core.db import assert_restricted_role
    from tests.conftest import OWNER_URL

    app_engine, owner_engine = create_engine(APP_URL), create_engine(OWNER_URL)
    try:
        assert_restricted_role(app_engine)  # the runtime role is fine
        with pytest.raises(RuntimeError, match="owns application tables"):
            assert_restricted_role(owner_engine)
    finally:
        app_engine.dispose()
        owner_engine.dispose()


def test_every_table_forces_row_level_security():
    """No table may be left where even the schema owner sees all tenants by default."""
    from tests.conftest import OWNER_URL
    eng = create_engine(OWNER_URL)
    try:
        with eng.connect() as c:
            unprotected = c.execute(text(
                "SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace "
                "AND relname <> 'alembic_version' AND NOT (relrowsecurity AND relforcerowsecurity)")).scalars().all()
            # the owner's only exceptions are explicit, read-mostly policies for the login functions
            owner_policies = {(r.tablename, r.cmd) for r in c.execute(text(
                "SELECT tablename, cmd FROM pg_policies WHERE policyname LIKE 'definer%'"))}
    finally:
        eng.dispose()
    assert unprotected == []
    assert owner_policies == {("organizations", "SELECT"), ("organization_memberships", "SELECT"),
                              ("users", "SELECT"), ("users", "INSERT")}


def test_tenant_context_does_not_survive_on_a_pooled_connection(make_org):
    """One physical connection, reused: a company's context must be gone when the next transaction starts."""
    from sqlalchemy import select
    from sqlalchemy.orm import sessionmaker

    from app.modules.customers.models import Customer

    a, b = make_org(), make_org()
    a.post("/customers", {"name": "Only for A"}, 201)
    b.post("/customers", {"name": "Only for B"}, 201)

    engine = create_engine(APP_URL, pool_size=1, max_overflow=0)  # every session gets the same connection
    factory = sessionmaker(engine, expire_on_commit=False)
    pids = set()

    def names(org_id):
        s = factory()
        s.info["org_id"] = uuid.UUID(org_id) if org_id else None
        try:
            pids.add(s.execute(text("SELECT pg_backend_pid()")).scalar())
            return {c.name for c in s.scalars(select(Customer))}, s.execute(text("SELECT count(*) FROM customers")).scalar()
        finally:
            s.commit()
            s.close()

    try:
        assert names(a.org_id) == ({"Only for A"}, 1)
        assert names(None) == (set(), 0)          # same connection, no context: nothing leaks from A
        assert names(b.org_id) == ({"Only for B"}, 1)
        assert names(a.org_id) == ({"Only for A"}, 1)
        with engine.connect() as c:                # and a raw checkout of that connection starts clean
            pids.add(c.execute(text("SELECT pg_backend_pid()")).scalar())
            assert c.execute(text("SELECT current_setting('app.org_id', true)")).scalar() in (None, "")
            assert c.execute(text("SELECT count(*) FROM customers")).scalar() == 0
    finally:
        engine.dispose()
    assert len(pids) == 1, "the test must have reused a single database connection"
