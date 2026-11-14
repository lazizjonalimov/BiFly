"""The outermost layer around every request: correlation id, response headers, body size limit, access log,
and the last-resort error response."""
import json
import logging
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.context import request_id_var
from app.core.errors import envelope

log = logging.getLogger("flyfleet.access")


class _TooLarge(Exception):
    pass


class RequestContext:
    def __init__(self, app: ASGIApp, max_body_bytes: int):
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        # Correlation id: taken from the caller if it looks sane, otherwise generated. Echoed, logged, and
        # included in every error body so a user can quote it to support.
        rid = headers.get("x-request-id", "")
        if not (8 <= len(rid) <= 64 and rid.replace("-", "").isalnum()):
            rid = uuid.uuid4().hex
        token = request_id_var.set(rid)
        state = scope.setdefault("state", {})
        started_at = time.perf_counter()
        status = 500
        started = False
        received = 0

        async def send_with_headers(message: Message) -> None:
            nonlocal status, started
            if message["type"] == "http.response.start":
                started, status = True, message["status"]
                out = MutableHeaders(scope=message)
                out["X-Request-ID"] = rid
                out["X-Content-Type-Options"] = "nosniff"
                # Responses carry one company's data for one user: nothing in between may keep a copy.
                out.setdefault("Cache-Control", "no-store")
            await send(message)

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise _TooLarge
            return message

        async def reply(code: int, error: str, text: str) -> None:
            body = json.dumps(envelope(error, text)).encode()
            await send_with_headers({"type": "http.response.start", "status": code, "headers": [
                (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send_with_headers({"type": "http.response.body", "body": body})

        try:
            declared = headers.get("content-length", "")
            if declared.isdigit() and int(declared) > self.max_body_bytes:
                raise _TooLarge
            await self.app(scope, limited_receive, send_with_headers)
        except _TooLarge:
            if started:
                raise
            await reply(413, "PAYLOAD_TOO_LARGE", "That is too large to upload")
        except Exception:
            log.exception("unhandled error request_id=%s", rid)
            if started:
                raise
            await reply(500, "INTERNAL_ERROR", "Something went wrong on our side")
        finally:
            who = state.get("principal", (None, None))
            log.info("request_id=%s method=%s path=%s status=%s ms=%.1f user=%s org=%s", rid, scope["method"],
                     scope["path"], status, (time.perf_counter() - started_at) * 1000, who[0], who[1])
            request_id_var.reset(token)
