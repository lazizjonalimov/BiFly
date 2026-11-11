"""Align with the architecture blueprint: encrypted driver identifiers, explicit currency, company time zone,
RLS forced on every table, immutable payments.

Revision ID: 0003
Revises: 0002

What changes
------------
* drivers.cdl_number (plain text) becomes drivers.cdl_number_encrypted. Existing values are encrypted in place,
  and licence numbers that earlier versions copied into the audit log are redacted.
* loads, invoices and payments store their currency explicitly.
* organizations get a time zone, so "today" means the company's local date.
* Row-level security is now FORCEd on the three identity tables as well. The SECURITY DEFINER login functions
  still work because the schema owner gets narrow, explicit policies (read these tables, insert users) instead
  of bypassing RLS altogether.
* The application role can no longer UPDATE payments or invoice lines: financial entries are corrected with
  new entries, never edited.

This migration needs TMS_FIELD_ENCRYPTION_KEYS (the same value the API runs with) when there are existing
driver records to encrypt.
"""
import os
from contextlib import contextmanager

import sqlalchemy as sa
from alembic import op

from app.core.crypto import decrypt, encrypt

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

APP_ROLE = os.environ.get("TMS_APP_ROLE", "tms_app")
IDENTITY_TABLES = ("organizations", "organization_memberships", "users")
MONEY_TABLES = ("loads", "invoices", "payments")


@contextmanager
def _unforced(table: str):
    """The owner is subject to FORCEd RLS too, so a data fix inside a migration lifts it for that table briefly.

    If the body fails, the whole migration transaction rolls back, which also restores FORCE.
    """
    op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    yield
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def upgrade() -> None:
    conn = op.get_bind()

    # --- encrypt driver licence numbers ---------------------------------------------------------------
    op.add_column("drivers", sa.Column("cdl_number_encrypted", sa.Text(), nullable=True))
    with _unforced("drivers"):
        rows = conn.execute(sa.text("SELECT id, cdl_number FROM drivers WHERE cdl_number IS NOT NULL")).all()
        for row in rows:
            conn.execute(sa.text("UPDATE drivers SET cdl_number_encrypted = :c WHERE id = :i"),
                         {"c": encrypt(row.cdl_number), "i": row.id})
    op.drop_column("drivers", "cdl_number")
    with _unforced("audit_logs"):
        op.execute(
            "UPDATE audit_logs SET data = jsonb_set(data, '{cdl_number}', '\"[redacted]\"') "
            "WHERE entity_type = 'driver' AND data ->> 'cdl_number' IS NOT NULL"
        )

    # --- explicit currency ----------------------------------------------------------------------------
    for table in MONEY_TABLES:
        op.add_column(table, sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False))
        op.create_check_constraint(op.f(f"ck_{table}_currency_code"), table, "currency ~ '^[A-Z]{3}$'")

    # --- company time zone ----------------------------------------------------------------------------
    op.add_column("organizations", sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False))

    # --- force RLS everywhere; the owner keeps only what the login functions need ---------------------
    for table in IDENTITY_TABLES:
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY definer_read ON {table} FOR SELECT TO CURRENT_USER USING (true)")
    op.execute("CREATE POLICY definer_insert ON users FOR INSERT TO CURRENT_USER WITH CHECK (true)")

    # --- financial entries are immutable for the application ------------------------------------------
    op.execute(f"REVOKE UPDATE ON payments, invoice_lines FROM {APP_ROLE}")


def downgrade() -> None:
    conn = op.get_bind()

    op.execute(f"GRANT UPDATE ON payments, invoice_lines TO {APP_ROLE}")

    op.execute("DROP POLICY IF EXISTS definer_insert ON users")
    for table in IDENTITY_TABLES:
        op.execute(f"DROP POLICY IF EXISTS definer_read ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")

    op.drop_column("organizations", "timezone")
    for table in MONEY_TABLES:
        op.drop_constraint(op.f(f"ck_{table}_currency_code"), table, type_="check")
        op.drop_column(table, "currency")

    # Audit entries stay redacted: the original values are deliberately not recoverable from the log.
    op.add_column("drivers", sa.Column("cdl_number", sa.String(length=40), nullable=True))
    with _unforced("drivers"):
        rows = conn.execute(sa.text(
            "SELECT id, cdl_number_encrypted FROM drivers WHERE cdl_number_encrypted IS NOT NULL")).all()
        for row in rows:
            conn.execute(sa.text("UPDATE drivers SET cdl_number = :c WHERE id = :i"),
                         {"c": decrypt(row.cdl_number_encrypted), "i": row.id})
    op.drop_column("drivers", "cdl_number_encrypted")
