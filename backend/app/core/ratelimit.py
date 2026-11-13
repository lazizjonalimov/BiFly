"""Small in-process guard against password guessing.

This is a backstop, not the primary control: it is per process (each API container counts separately) and the
real rate limiting belongs at the edge (AWS WAF) and in the identity provider once Cognito replaces local login.
"""
import threading
import time

from app.core.errors import AppError


class FailureLimiter:
    def __init__(self, max_failures: int = 10, window_seconds: int = 15 * 60, max_keys: int = 50_000):
        self.max_failures, self.window, self.max_keys = max_failures, window_seconds, max_keys
        self._fails: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Raise 429 if this key has too many recent failures."""
        with self._lock:
            n, until = self._fails.get(key, (0, 0.0))
        if n >= self.max_failures and until > time.time():
            raise AppError("Too many failed attempts. Try again later.", status=429, code="RATE_LIMITED")

    def fail(self, key: str) -> None:
        now = time.time()
        with self._lock:
            n, until = self._fails.get(key, (0, 0.0))
            self._fails[key] = ((n + 1) if until > now else 1, now + self.window)
            if len(self._fails) > self.max_keys:  # bound memory: drop everything that has expired
                self._fails = {k: v for k, v in self._fails.items() if v[1] > now}

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
