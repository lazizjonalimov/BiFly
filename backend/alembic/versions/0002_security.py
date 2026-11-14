"""Tenant isolation, least-privilege grants, immutability guards and sign-in functions.

Revision ID: 0002
Revises: 0001

Security model
--------------
* The API connects as a restricted role (default ``flyfleet_app``) that owns nothing and cannot bypass RLS.
  Migrations run as the schema owner.
* Every request sets two transaction-local settings: ``app.org_id`` (the company) and ``app.user_id``.
* Row-level security is FORCEd on every table. A tenant table exposes only rows whose ``organization_id``
  equals ``app.org_id``. With no company set, nothing is visible.
* ``users`` and ``accounts`` span companies, so they have their own narrow policies.
* What must work before a company is known (sign-in, listing a person's companies) goes through SECURITY
  DEFINER functions. They run as the schema owner, which is given exactly the read access they need.
* History tables are insert-only for the API. Issued invoices are protected by triggers as well as by the API.
"""
import os

from alembic import op

from app.core.rls import APPEND_ONLY, NO_DELETE, ORG, READ_WRITE, USR, secure_tenant_table

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("FLYFLEET_APP_ROLE", "flyfleet_app")

TENANT_TABLES = {
    "organization_memberships": NO_DELETE,      # deactivated, never deleted
    "terminals": READ_WRITE,
    "user_preferences": READ_WRITE,
    "saved_views": READ_WRITE,
    "idempotency_keys": READ_WRITE,
    "audit_logs": APPEND_ONLY,
    "customers": READ_WRITE,
    "customer_contacts": READ_WRITE,
    "customer_addresses": READ_WRITE,
    "drivers": READ_WRITE,
    "driver_qualifications": READ_WRITE,
    "vehicles": READ_WRITE,
    "trailers": READ_WRITE,
    "loads": NO_DELETE,                         # cancelled, never deleted
    "load_stops": READ_WRITE,
    "load_items": READ_WRITE,
    "load_charges": READ_WRITE,
    "load_notes": APPEND_ONLY,
    "load_status_events": APPEND_ONLY,
    "tracking_events": APPEND_ONLY,
    "dispatch_assignments": NO_DELETE,          # released, never deleted
    "documents": READ_WRITE,
    "document_links": READ_WRITE,
    "invoices": READ_WRITE,                     # only drafts can change or go; see invoices_guard
    "invoice_lines": READ_WRITE,                # only under a draft invoice; see invoice_lines_guard
    "payment_allocations": APPEND_ONLY,
}
IDENTITY_TABLES = ("users", "accounts", "organizations", "organization_memberships")
FUNCTIONS = ("auth_lookup_user(text)", "auth_create_user(text, text, text)", "auth_user_organizations(uuid)",
             "auth_account_companies(uuid)")


def upgrade() -> None:
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")

    for table, privileges in TENANT_TABLES.items():
        for statement in secure_tenant_table(table, APP_ROLE, privileges):
            op.execute(statement)

    # Payments: amounts are never edited. A payment can only be marked reversed.
    for statement in secure_tenant_table("payments", APP_ROLE, APPEND_ONLY):
        op.execute(statement)
    op.execute(f"GRANT UPDATE (status, reversed_at, reversal_reason) ON payments TO {APP_ROLE}")

    # --- companies ------------------------------------------------------------------------------------
    op.execute("ALTER TABLE organizations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE organizations FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY tenant_isolation ON organizations USING (id = {ORG}) WITH CHECK (id = {ORG})")
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON organizations TO {APP_ROLE}")

    # --- accounts: the owner, and anyone working inside one of the account's companies ----------------
    op.execute("ALTER TABLE accounts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE accounts FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY account_read ON accounts FOR SELECT USING (owner_user_id = {USR} OR id IN "
        f"(SELECT account_id FROM organizations WHERE id = {ORG}))"
    )
    op.execute(f"CREATE POLICY account_insert ON accounts FOR INSERT WITH CHECK (owner_user_id = {USR})")
    op.execute(f"CREATE POLICY account_update ON accounts FOR UPDATE USING (owner_user_id = {USR}) "
               f"WITH CHECK (owner_user_id = {USR})")
    op.execute(f"GRANT SELECT, INSERT ON accounts TO {APP_ROLE}")
    op.execute(f"GRANT UPDATE (name, updated_at) ON accounts TO {APP_ROLE}")

    # --- users: read yourself and co-members of the current company; update only yourself -------------
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY user_read ON users FOR SELECT USING (id = {USR} OR id IN "
        f"(SELECT user_id FROM organization_memberships WHERE organization_id = {ORG}))"
    )
    op.execute(f"CREATE POLICY user_update_self ON users FOR UPDATE USING (id = {USR}) WITH CHECK (id = {USR})")
    op.execute(f"GRANT SELECT ON users TO {APP_ROLE}")
    # No INSERT or DELETE, and email/active can't be changed by the application role at all.
    op.execute(f"GRANT UPDATE (full_name, password_hash, token_version, last_organization_id, updated_at) "
               f"ON users TO {APP_ROLE}")

    # --- what the schema owner may see, for the SECURITY DEFINER functions below ----------------------
    for table in IDENTITY_TABLES:
        op.execute(f"CREATE POLICY definer_read ON {table} FOR SELECT TO CURRENT_USER USING (true)")
    op.execute("CREATE POLICY definer_insert ON users FOR INSERT TO CURRENT_USER WITH CHECK (true)")

    op.execute(
        """
        CREATE FUNCTION auth_lookup_user(p_email text)
        RETURNS TABLE (id uuid, password_hash text, active boolean, full_name text, token_version integer,
                       last_organization_id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT u.id, u.password_hash::text, u.active, u.full_name::text, u.token_version,
                  u.last_organization_id
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
    # The companies a person can work in. Needed at sign-in and for the company switcher.
    op.execute(
        """
        CREATE FUNCTION auth_user_organizations(p_user_id uuid)
        RETURNS TABLE (organization_id uuid, name text, slug text, role text, status text, account_id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT o.id, o.name::text, o.slug::text, m.role::text, o.status::text, o.account_id
           FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = p_user_id AND m.active
           ORDER BY (o.status = 'archived'), o.name $$
        """
    )
    # Every company in an account, for its owner only: the function checks the caller itself.
    op.execute(
        f"""
        CREATE FUNCTION auth_account_companies(p_account_id uuid)
        RETURNS TABLE (id uuid, name text, slug text, status text, dot_number text, mc_number text,
                       created_at timestamptz)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT o.id, o.name::text, o.slug::text, o.status::text, o.dot_number::text, o.mc_number::text,
                  o.created_at
           FROM organizations o JOIN accounts a ON a.id = o.account_id
           WHERE a.id = p_account_id AND a.owner_user_id = {USR}
           ORDER BY (o.status = 'archived'), o.created_at $$
        """
    )
    for fn in FUNCTIONS:
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO {APP_ROLE}")

    # --- issued invoices cannot be rewritten, whatever the application does ---------------------------
    op.execute(
        """
        CREATE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status <> 'draft' THEN
              RAISE EXCEPTION 'An issued invoice cannot be deleted' USING ERRCODE = 'check_violation';
            END IF;
            RETURN OLD;
          END IF;
          IF OLD.status <> 'draft' AND
             (NEW.total, NEW.customer_id, NEW.currency, NEW.invoice_number, NEW.issue_date, NEW.due_date,
              NEW.bill_to::text)
             IS DISTINCT FROM
             (OLD.total, OLD.customer_id, OLD.currency, OLD.invoice_number, OLD.issue_date, OLD.due_date,
              OLD.bill_to::text) THEN
            RAISE EXCEPTION 'An issued invoice cannot be changed' USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.status = 'void' AND NEW.status <> 'void' THEN
            RAISE EXCEPTION 'A void invoice cannot be reopened' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END $$
        """
    )
    op.execute("CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices "
               "FOR EACH ROW EXECUTE FUNCTION invoices_guard()")
    op.execute(
        """
        CREATE FUNCTION invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS
        $$ DECLARE parent_status text;
        BEGIN
          SELECT status INTO parent_status FROM invoices
          WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
          -- parent_status is NULL while a draft invoice is being deleted together with its lines
          IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
            RAISE EXCEPTION 'Lines of an issued invoice cannot be changed' USING ERRCODE = 'check_violation';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END $$
        """
    )
    op.execute("CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines "
               "FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard()")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS invoice_lines_guard ON invoice_lines")
    op.execute("DROP TRIGGER IF EXISTS invoices_guard ON invoices")
    op.execute("DROP FUNCTION IF EXISTS invoice_lines_guard()")
    op.execute("DROP FUNCTION IF EXISTS invoices_guard()")
    for fn in FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
    op.execute("DROP POLICY IF EXISTS definer_insert ON users")
    for table in IDENTITY_TABLES:
        op.execute(f"DROP POLICY IF EXISTS definer_read ON {table}")
    for policy, table in (("user_update_self", "users"), ("user_read", "users"), ("account_update", "accounts"),
                          ("account_insert", "accounts"), ("account_read", "accounts")):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
    for table in ["users", "accounts", "organizations", "payments", *TENANT_TABLES]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {APP_ROLE}")
