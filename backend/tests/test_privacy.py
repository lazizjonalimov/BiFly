"""Sensitive personal data: encrypted at rest, masked by role, and kept out of the audit trail."""
from sqlalchemy import text

from tests.conftest import seed


def test_cdl_numbers_are_encrypted_in_the_database(org, owner_sql):
    s = seed(org)
    with owner_sql.begin() as c:
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org.org_id})
        stored = c.execute(text("SELECT cdl_number_encrypted FROM drivers WHERE id = :d"), {"d": s["driver"]["id"]}).scalar()
        columns = c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'drivers'")).scalars().all()
    assert stored and "D1234567" not in stored and stored.startswith("gAAAA")       # a Fernet token, not the number
    assert "cdl_number" not in columns


def test_the_full_number_and_pay_are_shown_only_to_roles_allowed_to_see_them(org):
    s = seed(org)
    org.patch(f"/drivers/{s['driver']['id']}", {"pay_type": "per_mile", "pay_rate": "0.6200"}, 200)
    url = f"/drivers/{s['driver']['id']}"

    for role in ("owner", "safety_manager", "accountant"):
        seen = (org if role == "owner" else org.add_user(role)).get(url).json()
        assert seen["cdl_number"] == "D1234567" and seen["pay_rate"] == "0.6200", role
    for role in ("dispatcher", "fleet_manager", "viewer"):
        user = org.add_user(role)
        seen = user.get(url).json()
        assert seen["cdl_number"] is None and seen["pay_rate"] is None and seen["pay_type"] is None, role
        assert seen["cdl_number_masked"] == "••••4567" and seen["cdl_state"] == "IL"   # enough to recognise it
        assert user.items("/drivers")[0]["cdl_number"] is None
        assert "D1234567" not in user.get("/drivers").text


def test_sensitive_values_never_reach_the_audit_log(org):
    s = seed(org)
    org.patch(f"/drivers/{s['driver']['id']}", {"cdl_number": "X9988776", "pay_rate": "0.7000", "phone": "555-0101"}, 200)
    entries = org.items("/audit-logs", entity_type="driver", entity_id=s["driver"]["id"])
    assert [e["action"] for e in entries] == ["driver.updated", "driver.created"]
    assert entries[0]["data"] == {"cdl_number": "[redacted]", "pay_rate": "[redacted]", "phone": "555-0101"}
    assert entries[1]["data"]["cdl_number"] == "[redacted]"
    assert "X9988776" not in org.get("/audit-logs").text and "D1234567" not in org.get("/audit-logs").text


def test_password_hashes_and_tokens_are_never_returned(org, client):
    org.add_user("dispatcher")
    for url in ("/members", "/auth/me", "/audit-logs", "/organization"):
        body = org.get(url).text
        assert "password" not in body and "argon2" not in body and "token_version" not in body, url
    spec = client.get("/api/openapi.json").text
    assert "password_hash" not in spec and "cdl_number_encrypted" not in spec and "storage_key" not in spec


def test_the_encryption_key_can_be_rotated(monkeypatch):
    from cryptography.fernet import Fernet

    from app.core import crypto
    from app.core.config import get_settings

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()

    def use(keys: str) -> None:
        monkeypatch.setenv("BIFLY_FIELD_ENCRYPTION_KEYS", keys)
        get_settings.cache_clear()
        crypto._cipher.cache_clear()

    try:
        use(old)
        token = crypto.encrypt("D1234567")
        use(f"{new},{old}")                                   # new key first, old key kept for reading
        assert crypto.decrypt(token) == "D1234567"
        assert crypto.decrypt(crypto.encrypt("fresh")) == "fresh"
        use(new)                                              # the old key is gone: old values can't be read
        try:
            crypto.decrypt(token)
            raise AssertionError("decrypted without the key")
        except RuntimeError as e:
            assert "BIFLY_FIELD_ENCRYPTION_KEYS" in str(e)
    finally:
        monkeypatch.delenv("BIFLY_FIELD_ENCRYPTION_KEYS", raising=False)
        get_settings.cache_clear()
        crypto._cipher.cache_clear()


def test_production_refuses_to_start_with_development_secrets(monkeypatch):
    import pytest

    from app.core.config import get_settings
    try:
        monkeypatch.setenv("BIFLY_ENV", "production")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="BIFLY_JWT_SECRET"):
            get_settings()
        monkeypatch.setenv("BIFLY_JWT_SECRET", "x" * 48)
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="BIFLY_FIELD_ENCRYPTION_KEYS"):
            get_settings()
    finally:
        monkeypatch.setenv("BIFLY_ENV", "test")
        monkeypatch.delenv("BIFLY_JWT_SECRET", raising=False)
        get_settings.cache_clear()
