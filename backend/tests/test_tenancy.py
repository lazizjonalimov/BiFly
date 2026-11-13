"""Tenant isolation, enforced by PostgreSQL row-level security: tested through the API and directly in SQL."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import assign, new_load, seed, stops, upload


def test_api_cannot_see_or_touch_another_companys_records(make_org):
    a, b = make_org("Alpha Freight"), make_org("Bravo Haulage")
    sa = seed(a)
    load = new_load(a, sa["customer"]["id"])
    document = upload(a, "customer", sa["customer"]["id"], "other")

    for url in ("/customers", "/loads", "/drivers", "/vehicles", "/trailers", "/documents", "/invoices",
                "/dispatch/board"):
        assert b.items(url) == [], url
    b.get(f"/customers/{sa['customer']['id']}", expect=404)
    b.get(f"/loads/{load['id']}", expect=404)
    b.get(f"/documents/{document['id']}/download", expect=404)
    b.patch(f"/customers/{sa['customer']['id']}", {"name": "hijacked"}, expect=404)
    b.delete(f"/drivers/{sa['driver']['id']}", expect=404)
    b.post(f"/loads/{load['id']}/transitions", {"action": "cancel", "version": 1, "reason": "x"}, expect=404)
    b.get("/dispatch/eligible-resources", params={"load_id": load["id"]}, expect=404)
    assert b.get("/search", params={"q": "Globex"}).json() == []
    assert a.get(f"/customers/{sa['customer']['id']}").json()["name"] == "Globex"


def test_cannot_refer_to_another_companys_records(make_org):
    a, b = make_org(), make_org()
    sa, sb = seed(a), seed(b)
    # B books a load for A's customer
    assert b.error("POST", "/loads", 422, "VALIDATION_ERROR",
                   json={"customer_id": sa["customer"]["id"], "stops": stops()})["field_errors"] == {
        "customer_id": "Customer not found"}
    # B puts A's driver or truck on B's own load
    load = new_load(b, sb["customer"]["id"])
    for swap, field in (("driver", "driver_id"), ("truck", "vehicle_id"), ("trailer", "trailer_id")):
        body = b.post("/dispatch/assignments", {
            "load_id": load["id"], "driver_id": sb["driver"]["id"], "vehicle_id": sb["truck"]["id"],
            "trailer_id": sb["trailer"]["id"], "version": load["version"],
            field: sa[swap]["id"]}, 422).json()["error"]
        assert list(body["field_errors"]) == [field]
    # B attaches a document to A's load, or invoices A's load
    b.error("POST", "/documents/upload-intents", 422, "VALIDATION_ERROR", json={
        "filename": "x.pdf", "content_type": "application/pdf", "size_bytes": 10, "type": "bol",
        "entity_type": "load", "entity_id": new_load(a, sa["customer"]["id"])["id"]})
    b.error("POST", "/invoices", 422, "VALIDATION_ERROR",
            json={"customer_id": sb["customer"]["id"], "load_ids": [new_load(a, sa["customer"]["id"])["id"]]})


def test_team_members_of_other_companies_are_invisible(make_org):
    a, b = make_org(), make_org()
    emails = {m["email"] for m in b.get("/members").json()}
    assert a.email not in emails and b.email in emails
    b.patch(f"/members/{uuid.uuid4()}", {"role": "admin"}, expect=404)


def _context(conn, org_id):
    conn.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org_id or ""})


def test_every_table_is_under_forced_row_level_security(owner_sql):
    with owner_sql.connect() as c:
        unprotected = c.execute(text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'alembic_version' "
            "AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")).scalars().all()
        owned_by_app = c.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'bifly_app'")).scalars().all()
    assert unprotected == [] and owned_by_app == []


def test_no_context_sees_nothing(make_org, sql, owner_sql):
    a = make_org()
    s = seed(a)
    assign(a, new_load(a, s["customer"]["id"]), s)
    with owner_sql.connect() as c:
        tables = c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                                "AND tablename <> 'alembic_version'")).scalars().all()
    with sql.begin() as c:  # connected as the API's role, with no company set
        for table in tables:
            assert c.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0, table


def test_context_scopes_rows_and_blocks_cross_company_writes(make_org, sql):
    a, b = make_org(), make_org()
    seed(a)
    seed(b)
    with sql.begin() as c:
        _context(c, a.org_id)
        assert {str(r[0]) for r in c.execute(text("SELECT DISTINCT organization_id FROM customers"))} == {a.org_id}
        assert {str(r[0]) for r in c.execute(text("SELECT id FROM organizations"))} == {a.org_id}
        # UPDATE and DELETE aimed at another company match no rows at all
        assert c.execute(text("UPDATE customers SET name = 'x' WHERE organization_id = :o"), {"o": b.org_id}).rowcount == 0
        assert c.execute(text("DELETE FROM customers WHERE organization_id = :o"), {"o": b.org_id}).rowcount == 0
    # INSERT claiming another company's id is refused by the policy's WITH CHECK
    with pytest.raises(DBAPIError, match="row-level security"), sql.begin() as c:
        _context(c, a.org_id)
        c.execute(text("INSERT INTO customers (organization_id, name) VALUES (:o, 'smuggled')"), {"o": b.org_id})


def test_isolation_really_comes_from_the_policy(make_org, sql, owner_sql):
    """Mutation check: switch the policy off for one table and the leak appears; switch it on and it is gone.
    If this ever passes without the policy, the other tests would be proving nothing."""
    a, b = make_org(), make_org()
    seed(a)
    seed(b)

    def visible_companies() -> set[str]:
        with sql.begin() as c:
            _context(c, a.org_id)
            return {str(r[0]) for r in c.execute(text("SELECT DISTINCT organization_id FROM trailers"))}

    assert visible_companies() == {a.org_id}
    with owner_sql.begin() as c:
        c.execute(text("ALTER TABLE trailers DISABLE ROW LEVEL SECURITY"))
    try:
        assert b.org_id in visible_companies()
    finally:
        with owner_sql.begin() as c:
            c.execute(text("ALTER TABLE trailers ENABLE ROW LEVEL SECURITY"))
    assert visible_companies() == {a.org_id}


def test_history_tables_are_append_only_for_the_api_role(make_org, sql):
    a = make_org()
    s = seed(a)
    load = new_load(a, s["customer"]["id"])
    a.post(f"/loads/{load['id']}/notes", {"body": "Call before arrival"}, 201)
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs",
                      "UPDATE load_status_events SET to_status = 'completed'", "DELETE FROM load_status_events",
                      "UPDATE load_notes SET body = 'x'", "DELETE FROM loads", "DELETE FROM dispatch_assignments",
                      "UPDATE payments SET amount = 1", "DELETE FROM organization_memberships",
                      "UPDATE users SET email = 'x@example.com'", "DELETE FROM users",
                      "INSERT INTO users (email, full_name) VALUES ('x@example.com', 'x')"):
        with pytest.raises(DBAPIError, match="permission denied"), sql.begin() as c:
            _context(c, a.org_id)
            c.execute(text(statement))


def test_api_refuses_to_start_as_a_privileged_role(owner_sql):
    from app.core.db import assert_restricted_role
    with pytest.raises(RuntimeError, match="owns application tables"):
        assert_restricted_role(owner_sql)
