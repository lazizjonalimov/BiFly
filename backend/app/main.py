import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import reports
from app.core.config import get_settings
from app.core.db import assert_restricted_role, get_engine, new_session
from app.core.errors import install_error_handlers
from app.modules.customers.router import router as customers_router
from app.modules.dispatch.driver_router import router as driver_router
from app.modules.dispatch.router import router as dispatch_router
from app.modules.documents.router import router as documents_router
from app.modules.drivers.router import router as drivers_router
from app.modules.finance.router import router as finance_router
from app.modules.fleet.router import router as fleet_router
from app.modules.loads.router import router as loads_router
from app.modules.organizations.router import auth_router
from app.modules.organizations.router import router as org_router

log = logging.getLogger("tms.access")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fail closed: never serve requests through a role that bypasses tenant isolation.
    assert_restricted_role(get_engine())
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = FastAPI(title="Carrier TMS API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
                  lifespan=lifespan)

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
                       expose_headers=["X-Request-ID", "Idempotent-Replay"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        # Correlation id: accepted from the caller if sane, otherwise generated; echoed and logged.
        rid = request.headers.get("X-Request-ID", "")
        if not (8 <= len(rid) <= 64 and rid.replace("-", "").isalnum()):
            rid = uuid.uuid4().hex
        request.state.request_id = rid
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        who = getattr(request.state, "principal", (None, None))
        log.info("request_id=%s method=%s path=%s status=%s ms=%.1f user=%s org=%s", rid, request.method,
                 request.url.path, response.status_code, (time.perf_counter() - start) * 1000, who[0], who[1])
        return response

    install_error_handlers(app)

    v1 = APIRouter(prefix="/api/v1")
    for r in (auth_router, org_router, customers_router, drivers_router, fleet_router, loads_router,
              dispatch_router, driver_router, documents_router, finance_router, reports.router):
        v1.include_router(r)
    app.include_router(v1)

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        db = new_session()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
        return {"status": "ok"}

    return app


app = create_app()
