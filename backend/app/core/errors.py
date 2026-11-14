"""One error shape for the whole API (decision 0004):

    {"error": {"code", "message", "field_errors", "details", "request_id"}}

`code` is a stable upper-case identifier clients can branch on. `message` is safe to show to a person.
Exception text, SQL and stack traces never reach the response.
"""
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.context import current_request_id

log = logging.getLogger("flyfleet")


class AppError(Exception):
    status = 400
    code = "BAD_REQUEST"

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None,
                 field_errors: dict[str, str] | None = None, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.field_errors = field_errors or {}
        self.details = details or {}
        if code:
            self.code = code
        if status:
            self.status = status


class Unauthorized(AppError):
    status, code = 401, "UNAUTHENTICATED"


class Forbidden(AppError):
    status, code = 403, "FORBIDDEN"


class NotFound(AppError):
    status, code = 404, "NOT_FOUND"


class Conflict(AppError):
    """The request is well-formed but the current state of the data does not allow it."""
    status, code = 409, "STATE_CONFLICT"


class Invalid(AppError):
    status, code = 422, "VALIDATION_ERROR"

    def __init__(self, message: str = "Some fields need attention", *, field: str | None = None, **kw):
        if field is not None:
            kw.setdefault("field_errors", {field: message})
        super().__init__(message, **kw)


class ErrorBody(BaseModel):
    code: str = Field(description="Stable identifier to branch on, for example VERSION_CONFLICT")
    message: str = Field(description="Safe to show to the user")
    field_errors: dict[str, str] = Field(description="Problems with individual fields, keyed by field path")
    details: dict[str, Any]
    request_id: str | None


class ErrorResponse(BaseModel):
    """The shape of every error the API returns."""
    error: ErrorBody


def envelope(code: str, message: str, field_errors: dict | None = None, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "field_errors": field_errors or {},
                      "details": details or {}, "request_id": current_request_id()}}


def _field_path(loc: tuple) -> str:
    # ("body", "stops", 0, "city") -> "stops.0.city"
    return ".".join(str(p) for p in loc[1:]) if len(loc) > 1 else str(loc[0])


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(envelope(exc.code, exc.message, exc.field_errors, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for e in exc.errors():
            message = e["msg"].removeprefix("Value error, ")
            fields.setdefault(_field_path(e["loc"]), message[:1].upper() + message[1:])
        return JSONResponse(envelope("VALIDATION_ERROR", "Some fields need attention", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
                413: "PAYLOAD_TOO_LARGE", 429: "RATE_LIMITED"}.get(exc.status_code, "BAD_REQUEST")
        return JSONResponse(envelope(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        state = getattr(exc.orig, "sqlstate", None)
        if state == "23505":
            return JSONResponse(envelope("DUPLICATE_REFERENCE", "A record with these values already exists"),
                                status_code=409)
        if state == "23503":
            return JSONResponse(envelope("STATE_CONFLICT", "This record is still used by other records, or refers "
                                         "to one that no longer exists. Archive it instead of deleting it."),
                                status_code=409)
        if state == "23514":
            return JSONResponse(envelope("VALIDATION_ERROR", "A value breaks a data rule"), status_code=422)
        log.exception("integrity error request_id=%s", current_request_id())
        return JSONResponse(envelope("INTERNAL_ERROR", "Something went wrong on our side"), status_code=500)

    @app.exception_handler(OperationalError)
    async def _operational(_: Request, exc: OperationalError):
        # Two requests that needed the same rows in opposite order: PostgreSQL stops one of them. Nothing was
        # saved for the one that lost, so it is safe to simply try again.
        if getattr(exc.orig, "sqlstate", None) in ("40P01", "40001", "55P03"):
            return JSONResponse(envelope("CONCURRENT_UPDATE", "Someone else was changing this at the same "
                                         "moment. Nothing was saved; try again."), status_code=409)
        log.exception("database error request_id=%s", current_request_id())
        return JSONResponse(envelope("INTERNAL_ERROR", "Something went wrong on our side"), status_code=500)

