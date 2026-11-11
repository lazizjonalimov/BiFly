"""Structured error responses: {"error": {"code", "message", "details"}, "request_id"}."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("tms")


class AppError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, details: object = None, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.details = details
        if code:
            self.code = code
        if status:
            self.status = status


class NotFound(AppError):
    status, code = 404, "not_found"


class Conflict(AppError):
    status, code = 409, "conflict"


class Forbidden(AppError):
    status, code = 403, "forbidden"


class Unauthorized(AppError):
    status, code = 401, "unauthorized"


class Invalid(AppError):
    status, code = 422, "invalid"


def _body(request: Request, code: str, message: str, details: object = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details},
            "request_id": getattr(request.state, "request_id", None)}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(_body(request, exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(_body(request, "validation_error", "Request validation failed", details), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return JSONResponse(_body(request, "http_error", str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError):
        code = getattr(exc.orig, "sqlstate", None)
        if code == "23505":
            return JSONResponse(_body(request, "duplicate", "A record with these values already exists"), status_code=409)
        if code == "23503":
            return JSONResponse(_body(request, "referenced", "Referenced record is missing, or this record is still "
                                      "in use by other records. Set it to inactive instead of deleting."), status_code=409)
        if code == "23514":
            return JSONResponse(_body(request, "constraint_violation", "A value violates a data rule"), status_code=422)
        log.exception("integrity error request_id=%s", getattr(request.state, "request_id", None))
        return JSONResponse(_body(request, "internal_error", "Internal server error"), status_code=500)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error request_id=%s", getattr(request.state, "request_id", None))
        return JSONResponse(_body(request, "internal_error", "Internal server error"), status_code=500)
