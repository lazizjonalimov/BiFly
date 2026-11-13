"""SQL used by migrations to put a table under tenant isolation.

Kept deliberately small and stable: migrations import it, so changing behaviour here would silently change what
old migrations do. Add new helpers rather than editing these.
"""
ORG = "nullif(current_setting('app.org_id', true), '')::uuid"
USR = "nullif(current_setting('app.user_id', true), '')::uuid"

READ_WRITE = "SELECT, INSERT, UPDATE, DELETE"
NO_DELETE = "SELECT, INSERT, UPDATE"
APPEND_ONLY = "SELECT, INSERT"


def secure_tenant_table(table: str, app_role: str, privileges: str = READ_WRITE) -> list[str]:
    """Statements that force row-level security on a table carrying organization_id and grant the runtime
    role only what it needs. Every tenant table must go through this in the migration that creates it."""
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation ON {table} USING (organization_id = {ORG}) "
        f"WITH CHECK (organization_id = {ORG})",
        f"GRANT {privileges} ON {table} TO {app_role}",
    ]
