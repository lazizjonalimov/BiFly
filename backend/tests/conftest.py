"""Tests run against a real PostgreSQL database, connecting as the restricted runtime role so that
row-level security is exercised exactly as in production.

Defaults match docker-compose / local dev; override with TMS_TEST_DATABASE_URL and TMS_TEST_OWNER_URL.
"""
import os
import tempfile
import uuid

import pytest

APP_URL = os.environ.get("TMS_TEST_DATABASE_URL", "postgresql+psycopg://tms_app:tms_app_dev@localhost:5432/tms_test")
OWNER_URL = os.environ.get("TMS_TEST_OWNER_URL", "postgresql+psycopg://tms_owner:tms_owner_dev@localhost:5432/tms_test")

os.environ.update({
    "TMS_ENV": "test",
    "TMS_DATABASE_URL": APP_URL,
    "TMS_MIGRATION_DATABASE_URL": OWNER_URL,
    "ALEMBIC_URL": OWNER_URL,
    "TMS_STORAGE_DIR": tempfile.mkdtemp(prefix="tms-test-storage-"),
})

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from alembic import command  # noqa: E402

PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _database():
    owner = create_engine(OWNER_URL)
    with owner.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")
    owner.dispose()
    yield


@pytest.fixture(scope="session")
def client(_database):
    from app.main import app
    with TestClient(app) as c:
        yield c


class Api:
    """A client bound to one user's token."""

    def __init__(self, client: TestClient, token: str, org_id: str):
        self.c, self.h, self.org_id = client, {"Authorization": f"Bearer {token}"}, org_id

    def _go(self, method, url, expect=None, headers=None, **kw):
        r = self.c.request(method, "/api/v1" + url, headers={**self.h, **(headers or {})}, **kw)
        if expect is not None:
            assert r.status_code == expect, f"{method} {url} -> {r.status_code}: {r.text}"
        return r

    def get(self, url, expect=200, **kw): return self._go("GET", url, expect, **kw)
    def post(self, url, json=None, expect=None, **kw): return self._go("POST", url, expect, json=json, **kw)
    def patch(self, url, json=None, expect=None, **kw): return self._go("PATCH", url, expect, json=json, **kw)
    def delete(self, url, expect=None, **kw): return self._go("DELETE", url, expect, **kw)

    def add_user(self, role: str) -> "Api":
        email = f"{role}-{uuid.uuid4().hex[:8]}@example.com"
        u = self.post("/users", {"email": email, "full_name": role.title(), "password": PASSWORD, "role": role}, 201).json()
        tok = self.c.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
        api = Api(self.c, tok, self.org_id)
        api.user_id = u["user_id"]
        return api


@pytest.fixture
def make_org(client):
    def _make(name: str = "Acme Trucking") -> Api:
        email = f"owner-{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/v1/auth/signup", json={"organization_name": name, "full_name": "Olive Owner",
                                                      "email": email, "password": PASSWORD})
        assert r.status_code == 201, r.text
        api = Api(client, r.json()["access_token"], r.json()["organization"]["id"])
        api.email = email
        return api
    return _make


@pytest.fixture
def org(make_org) -> Api:
    return make_org()


STOPS = [
    {"type": "pickup", "name": "Shipper DC", "city": "Chicago", "state": "IL", "appt_start": "2031-03-10T14:00:00Z"},
    {"type": "delivery", "name": "Receiver", "city": "Dallas", "state": "TX", "appt_start": "2031-03-12T14:00:00Z"},
]


def seed_basics(api: Api) -> dict:
    """Customer, driver (with login), truck and trailer for one org."""
    cust = api.post("/customers", {"name": "Globex", "payment_terms_days": 15}, 201).json()
    driver_api = api.add_user("driver")
    driver = api.post("/drivers", {"first_name": "Dana", "last_name": "Driver", "cdl_expiry": "2035-01-01",
                                   "medical_cert_expiry": "2035-01-01", "user_id": driver_api.user_id}, 201).json()
    truck = api.post("/vehicles", {"unit_number": f"T-{uuid.uuid4().hex[:5]}", "insurance_expiry": "2035-01-01"}, 201).json()
    trailer = api.post("/trailers", {"unit_number": f"TR-{uuid.uuid4().hex[:5]}", "type": "dry_van"}, 201).json()
    return {"customer": cust, "driver": driver, "driver_api": driver_api, "truck": truck, "trailer": trailer}


def new_load(api: Api, customer_id: str, **extra) -> dict:
    return api.post("/loads", {"customer_id": customer_id, "commodity": "Paper", "customer_rate": "2500.00",
                               "stops": STOPS, **extra}, 201).json()
