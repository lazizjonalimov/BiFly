"""Row-level security, least-privilege grants, append-only tables, auth functions.

Revision ID: 0002
Revises: 0001

Security model
--------------
* The application connects as a restricted role (default ``tms_app``) that owns nothing and cannot bypass RLS.
* Every request sets two transaction-local settings: ``app.org_id`` and ``app.user_id``.
* Every tenant table only exposes rows whose ``organization_id`` equals ``app.org_id`` — no exceptions.
* ``users`` are global identities: a session can read itself and co-members of its organization, and can
  update only itself, and only a few columns.
* The few things that must work before a tenant is known (login) go through SECURITY DEFINER functions owned by
  the table owner. Those functions read ``users``, ``organizations`` and ``organization_memberships``, so RLS is
  enabled but not FORCEd on those three tables (the owner bypasses it; the application role never does).
  Every other table is FORCEd, so even an owner connection is tenant-scoped.
"""
import os

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("TMS_APP_ROLE", "tms_app")

ORG = "nullif(current_setting('app.org_id', true), '')::uuid"
USR = "nullif(current_setting('app.user_id', true), '')::uuid"

# Every table whose rows carry organization_id. All get the same policy.
TENANT_TABLES = [
    "organization_memberships",
    "customers", "drivers", "vehicles", "trailers", "loads", "load_stops", "load_status_events",
    "dispatch_assignments", "documents", "invoices", "invoice_lines", "payments",
    "audit_logs", "idempotency_keys",
]
APPEND_ONLY = {"audit_logs", "load_status_events"}                       # history can never be rewritten
NO_DELETE = {"invoices", "invoice_lines", "payments", "organization_memberships"}  # voided/deactivated, never deleted
NOT_FORCED = {"organization_memberships"}                                 # read by the login functions (see above)

FUNCTIONS = ["auth_lookup_user(text)", "auth_create_user(text, text, text)", "auth_user_organizations(uuid)"]


def upgrade() -> None:
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")

    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        if t not in NOT_FORCED:
            op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t} "
            f"USING (organization_id = {ORG}) WITH CHECK (organization_id = {ORG})"
        )
        if t in APPEND_ONLY:
            op.execute(f"GRANT SELECT, INSERT ON {t} TO {APP_ROLE}")
        elif t in NO_DELETE:
            op.execute(f"GRANT SELECT, INSERT, UPDATE ON {t} TO {APP_ROLE}")
        else:
            op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO {APP_ROLE}")

    # The organization row itself (keyed by id rather than organization_id).
    op.execute("ALTER TABLE organizations ENABLE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY tenant_isolation ON organizations USING (id = {ORG}) WITH CHECK (id = {ORG})")
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON organizations TO {APP_ROLE}")

    # Users: read yourself and co-members of the current organization; update only yourself.
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY user_read ON users FOR SELECT USING (id = {USR} OR id IN "
        f"(SELECT user_id FROM organization_memberships WHERE organization_id = {ORG}))"
    )
    op.execute(f"CREATE POLICY user_update_self ON users FOR UPDATE USING (id = {USR}) WITH CHECK (id = {USR})")
    op.execute(f"GRANT SELECT ON users TO {APP_ROLE}")
    # No INSERT/DELETE, and email/active can't be changed by the application role at all.
    op.execute(f"GRANT UPDATE (full_name, password_hash, token_version, updated_at) ON users TO {APP_ROLE}")

    op.execute(
        """
        CREATE FUNCTION auth_lookup_user(p_email text)
        RETURNS TABLE (id uuid, password_hash text, active boolean, full_name text, token_version integer)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT u.id, u.password_hash, u.active, u.full_name, u.token_version
           FROM users u WHERE u.email = lower(p_email) $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION auth_create_user(p_email text, p_name text, p_hash text)
        RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
        $$ DECLARE new_id uuid;
        BEGIN
          INSERT INTO users (email, full_name, password_hash) VALUES (lower(p_email), p_name, p_hash)
          RETURNING id INTO new_id;
          RETURN new_id;
        END $$
        """
    )
    # Which organizations can this user sign in to? Needed at login, before any tenant context exists.
    op.execute(
        """
        CREATE FUNCTION auth_user_organizations(p_user_id uuid)
        RETURNS TABLE (organization_id uuid, name text, role text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT o.id, o.name::text, m.role::text
           FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = p_user_id AND m.active
           ORDER BY o.name $$
        """
    )
    for fn in FUNCTIONS:
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO {APP_ROLE}")


def downgrade() -> None:
    for fn in FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
    op.execute("DROP POLICY IF EXISTS user_update_self ON users")
    op.execute("DROP POLICY IF EXISTS user_read ON users")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY")
    for t in ["organizations", *TENANT_TABLES]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {APP_ROLE}")
