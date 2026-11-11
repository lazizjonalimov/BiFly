"""Row-level security, least-privilege grants, append-only tables, auth functions.

Revision ID: 0002
Revises: 0001
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

# Tables whose rows all carry organization_id and use the plain tenant policy.
TENANT_TABLES = [
    "customers", "drivers", "vehicles", "trailers", "loads", "load_stops", "load_status_events",
    "dispatch_assignments", "documents", "invoices", "invoice_lines", "payments",
    "audit_logs", "idempotency_keys",
]
APPEND_ONLY = ["audit_logs", "load_status_events"]
NO_DELETE = ["invoices", "invoice_lines", "payments"]  # financial records are voided, never deleted


def upgrade() -> None:
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")

    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
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

    # Memberships: visible inside your org, and to the user they describe (to resolve their orgs at login).
    op.execute("ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY membership_access ON organization_memberships "
        f"USING (organization_id = {ORG} OR user_id = {USR}) WITH CHECK (organization_id = {ORG})"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON organization_memberships TO {APP_ROLE}")

    # Organizations: the current org, plus orgs you are a member of.
    op.execute("ALTER TABLE organizations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE organizations FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY org_access ON organizations USING (id = {ORG} OR id IN "
        f"(SELECT organization_id FROM organization_memberships WHERE user_id = {USR})) "
        f"WITH CHECK (id = {ORG})"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON organizations TO {APP_ROLE}")

    # Users are global identities: you may see yourself and members of your current org. No direct INSERT;
    # creation and email lookup go through SECURITY DEFINER functions below.
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY user_access ON users USING (id = {USR} OR id IN "
        f"(SELECT user_id FROM organization_memberships WHERE organization_id = {ORG})) "
        f"WITH CHECK (id = {USR} OR id IN (SELECT user_id FROM organization_memberships WHERE organization_id = {ORG}))"
    )
    op.execute(f"GRANT SELECT, UPDATE ON users TO {APP_ROLE}")

    op.execute(
        """
        CREATE FUNCTION auth_lookup_user(p_email text)
        RETURNS TABLE (id uuid, password_hash text, active boolean, full_name text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT u.id, u.password_hash, u.active, u.full_name FROM users u WHERE u.email = lower(p_email) $$
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
    for fn in ("auth_lookup_user(text)", "auth_create_user(text, text, text)"):
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS auth_create_user(text, text, text)")
    op.execute("DROP FUNCTION IF EXISTS auth_lookup_user(text)")
    op.execute("DROP POLICY IF EXISTS user_access ON users")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS org_access ON organizations")
    op.execute("DROP POLICY IF EXISTS membership_access ON organization_memberships")
    for t in ("organizations", "organization_memberships"):
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    for t in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_ROLE}")
