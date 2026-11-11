"""Sensitive driver identifiers: encrypted at rest, masked for roles that don't need them, kept out of the audit log."""
from sqlalchemy import create_engine, text

from tests.conftest import APP_URL

CDL = "D7700123456"


def test_driver_licence_number_is_encrypted_masked_and_kept_out_of_the_audit_log(org):
    safety, dispatcher = org.add_user("safety_manager"), org.add_user("dispatcher")
    driver = safety.post("/drivers", {"first_name": "Lena", "last_name": "Park", "cdl_number": CDL, "cdl_state": "IL"},
                         expect=201).json()
    assert driver["cdl_number"] == CDL  # the person who entered it gets it back

    # At rest: the database holds ciphertext only, even for a session inside the right company.
    eng = create_engine(APP_URL)
    try:
        with eng.begin() as c:
            c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org.org_id})
            stored = c.execute(text("SELECT cdl_number_encrypted FROM drivers WHERE id = :i"), {"i": driver["id"]}).scalar()
            dump = c.execute(text("SELECT string_agg(d::text, ' ') FROM drivers d")).scalar()
    finally:
        eng.dispose()
    assert stored and CDL not in stored and CDL not in dump

    # Roles that manage driver qualification see the number; everyone else sees only the last four characters.
    assert safety.get(f"/drivers/{driver['id']}").json()["cdl_number"] == CDL
    assert org.get(f"/drivers/{driver['id']}").json()["cdl_number"] == CDL
    for view in (dispatcher.get(f"/drivers/{driver['id']}").json(),
                 next(d for d in dispatcher.get("/drivers").json()["items"] if d["id"] == driver["id"])):
        assert view["cdl_number"] == "••••3456" and view["cdl_state"] == "IL"

    # It can't be fished out through search, and it never reaches the audit trail.
    assert dispatcher.get("/drivers", params={"q": CDL[:6]}).json()["items"] == []
    safety.patch(f"/drivers/{driver['id']}", {"cdl_number": "D7700999999"}, expect=200)
    audit = [a for a in org.get("/audit-logs?limit=200&entity_type=driver").json()["items"]]
    assert {a["action"] for a in audit} == {"driver.created", "driver.updated"}
    assert all(a["data"]["cdl_number"] == "[redacted]" for a in audit)
    assert "D7700" not in str(audit)

    # Clearing it works, and a missing number is not "masked" into something that looks like a value.
    safety.patch(f"/drivers/{driver['id']}", {"cdl_number": None}, expect=200)
    assert dispatcher.get(f"/drivers/{driver['id']}").json()["cdl_number"] is None


def test_encryption_keys_can_be_rotated(monkeypatch):
    from cryptography.fernet import Fernet

    from app.core import crypto
    from app.core.config import get_settings

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()

    def use(keys: str):
        monkeypatch.setenv("TMS_FIELD_ENCRYPTION_KEYS", keys)
        get_settings.cache_clear()
        crypto._cipher.cache_clear()

    try:
        use(old)
        token = crypto.encrypt("D1234567")
        use(f"{new},{old}")                       # new key first, old key kept for existing rows
        assert crypto.decrypt(token) == "D1234567"
        assert Fernet(new).decrypt(crypto.encrypt("D1234567").encode()) == b"D1234567"  # new writes use the new key
        use(new)                                  # old key dropped too early: fail loudly, never return garbage
        try:
            crypto.decrypt(token)
        except RuntimeError as e:
            assert "could not be decrypted" in str(e)
        else:
            raise AssertionError("decrypting with a missing key must fail")
    finally:
        monkeypatch.delenv("TMS_FIELD_ENCRYPTION_KEYS", raising=False)
        get_settings.cache_clear()
        crypto._cipher.cache_clear()
