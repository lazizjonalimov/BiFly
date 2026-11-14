"""Tests run against a real PostgreSQL database, connecting as the restricted runtime role, so row-level
security is exercised exactly as in production.

Defaults match docker-compose and local development; override with FLYFLEET_TEST_DATABASE_URL and
FLYFLEET_TEST_OWNER_URL.
"""
import os
import tempfile
import uuid

import pytest

APP_URL = os.environ.get("FLYFLEET_TEST_DATABASE_URL",
                         "postgresql+psycopg://flyfleet_app:flyfleet_app_dev@localhost:5432/flyfleet_test")
OWNER_URL = os.environ.get("FLYFLEET_TEST_OWNER_URL",
                           "postgresql+psycopg://flyfleet_owner:flyfleet_owner_dev@localhost:5432/flyfleet_test")

os.environ.update({
    "FLYFLEET_ENV": "test",
    "FLYFLEET_DATABASE_URL": APP_URL,
    "FLYFLEET_MIGRATION_DATABASE_URL": OWNER_URL,
    "ALEMBIC_URL": OWNER_URL,
    "FLYFLEET_STORAGE_DIR": tempfile.mkdtemp(prefix="flyfleet-test-storage-"),
})

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from alembic import command  # noqa: E402

PASSWORD = "correct-horse-battery"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


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


@pytest.fixture
def sql():
    """A connection as the restricted runtime role, for checking the database's own defences."""
    engine = create_engine(APP_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def owner_sql():
    """A connection as the schema owner, for arranging states the API refuses to create."""
    engine = create_engine(OWNER_URL)
    yield engine
    engine.dispose()


class Api:
    """A client bound to one user's session in one company."""

    def __init__(self, client: TestClient, token: str, org_id: str, email: str = ""):
        self.c, self.token, self.org_id, self.email = client, token, org_id, email
        self.h = {"Authorization": f"Bearer {token}"}
        self.user_id: str | None = None

    def _go(self, method, url, expect=None, headers=None, **kw):
        r = self.c.request(method, "/api/v1" + url, headers={**self.h, **(headers or {})}, **kw)
        if expect is not None:
            assert r.status_code == expect, f"{method} {url} -> {r.status_code}: {r.text}"
        return r

    def get(self, url, expect=200, **kw): return self._go("GET", url, expect, **kw)
    def post(self, url, json=None, expect=None, **kw): return self._go("POST", url, expect, json=json, **kw)
    def put(self, url, json=None, expect=None, **kw): return self._go("PUT", url, expect, json=json, **kw)
    def patch(self, url, json=None, expect=None, **kw): return self._go("PATCH", url, expect, json=json, **kw)
    def delete(self, url, expect=None, **kw): return self._go("DELETE", url, expect, **kw)

    def items(self, url, **params) -> list[dict]:
        return self.get(url, params=params).json()["items"]

    def error(self, method: str, url: str, status: int, code: str, **kw) -> dict:
        """Call expecting a failure; returns the error body."""
        r = self._go(method, url, status, **kw)
        body = r.json()["error"]
        assert body["code"] == code, body
        return body

    def add_user(self, role: str) -> "Api":
        email = f"{role}-{uuid.uuid4().hex[:8]}@example.com"
        member = self.post("/members", {"email": email, "full_name": role.replace("_", " ").title(),
                                        "password": PASSWORD, "role": role}, 201).json()
        api = login(self.c, email, self.org_id)
        api.user_id = member["user_id"]
        return api

    def switch(self, org_id: str) -> "Api":
        session = self.post("/auth/switch", {"organization_id": org_id}, 200).json()
        api = Api(self.c, session["access_token"], org_id, self.email)
        api.user_id = self.user_id
        return api


def login(client: TestClient, email: str, org_id: str | None = None, password: str = PASSWORD) -> Api:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password,
                                                 **({"organization_id": org_id} if org_id else {})})
    assert r.status_code == 200, r.text
    body = r.json()
    return Api(client, body["access_token"], body["organization"]["id"], email)


@pytest.fixture
def make_org(client):
    def _make(name: str = "Acme Trucking", **signup) -> Api:
        email = f"owner-{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/v1/auth/signup", json={"organization_name": name, "full_name": "Olive Owner",
                                                      "email": email, "password": PASSWORD, **signup})
        assert r.status_code == 201, r.text
        return Api(client, r.json()["access_token"], r.json()["organization"]["id"], email)
    return _make


@pytest.fixture
def org(make_org) -> Api:
    return make_org()


def stops(pickup: str = "2031-03-10T14:00:00Z", delivery: str = "2031-03-12T14:00:00Z") -> list[dict]:
    return [
        {"type": "pickup", "name": "Shipper DC", "city": "Chicago", "state": "IL", "appt_start": pickup},
        {"type": "delivery", "name": "Receiver", "city": "Dallas", "state": "TX", "appt_start": delivery},
    ]


def seed(api: Api, *, with_login: bool = False) -> dict:
    """A customer, a qualified driver, a truck and a trailer."""
    out = {"customer": api.post("/customers", {"name": "Globex", "payment_terms_days": 15}, 201).json()}
    driver = {"first_name": "Dana", "last_name": "Driver", "cdl_number": "D1234567", "cdl_state": "il",
              "cdl_expiry": "2035-01-01", "medical_cert_expiry": "2035-01-01"}
    if with_login:
        out["driver_api"] = api.add_user("driver")
        driver["user_id"] = out["driver_api"].user_id
    out["driver"] = api.post("/drivers", driver, 201).json()
    dates = {"insurance_expiry": "2035-01-01", "registration_expiry": "2035-01-01", "inspection_expiry": "2035-01-01"}
    out["truck"] = api.post("/vehicles", {"unit_number": f"T-{uuid.uuid4().hex[:5]}", **dates}, 201).json()
    out["trailer"] = api.post("/trailers", {"unit_number": f"TR-{uuid.uuid4().hex[:5]}", "type": "dry_van", **dates},
                              201).json()
    return out


def new_load(api: Api, customer_id: str, **extra) -> dict:
    body = {"customer_id": customer_id, "commodity": "Paper", "customer_rate": "2500.00", "miles": 920,
            "stops": stops(), **extra}
    return api.post("/loads", body, 201).json()


def assign(api: Api, load: dict, s: dict, expect: int = 201, **extra):
    r = api.post("/dispatch/assignments", {
        "load_id": load["id"], "driver_id": s["driver"]["id"], "vehicle_id": s["truck"]["id"],
        "trailer_id": s["trailer"]["id"], "version": load["version"], **extra}, expect)
    return r.json()


def act(api: Api, load: dict, action: str, expect: int = 200, **extra) -> dict:
    """Run a lifecycle action using the load's current version."""
    return api.post(f"/loads/{load['id']}/transitions", {"action": action, "version": load["version"], **extra},
                    expect).json()


def upload(api: Api, entity_type: str, entity_id: str, doc_type: str = "pod", *, content: bytes = PDF,
           filename: str = "paperwork.pdf", content_type: str = "application/pdf", **extra) -> dict:
    """The three-step upload: intent, file, complete."""
    intent = api.post("/documents/upload-intents", {
        "filename": filename, "content_type": content_type, "size_bytes": len(content), "type": doc_type,
        "entity_type": entity_type, "entity_id": entity_id, **extra}, 201).json()
    api.put(intent["upload"]["url"], content=content, headers=intent["upload"]["headers"], expect=204)
    return api.post(f"/documents/{intent['document']['id']}/complete", expect=200).json()


def deliver(api: Api, load: dict, s: dict) -> dict:
    """Assign, dispatch and run the truck through both stops."""
    load = assign(api, load, s)
    for action in ("dispatch", "arrive", "depart", "arrive", "depart"):
        load = act(api, load, action)
    assert load["status"] == "delivered", load["status"]
    return load


def complete(api: Api, s: dict, **extra) -> dict:
    """A load all the way to completed, ready to invoice."""
    load = deliver(api, new_load(api, s["customer"]["id"], **extra), s)
    upload(api, "load", load["id"])
    load = api.get(f"/loads/{load['id']}").json()
    assert load["status"] == "pod_review"
    return act(api, load, "approve_pod")
