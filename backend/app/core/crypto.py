"""Application-level encryption for sensitive columns.

Values are encrypted before they reach PostgreSQL, so a database dump, a backup, or a read replica never
contains them in the clear. Uses Fernet (AES-128-CBC with an HMAC-SHA256 integrity check).

Rotation: put the new key first in FLYFLEET_FIELD_ENCRYPTION_KEYS and keep the old one after it. New writes use the
new key, old rows still decrypt, and re-saving a row re-encrypts it.
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy.types import Text, TypeDecorator

from app.core.config import get_settings

# Used only when no key is configured (development and tests). Production refuses to start without real keys.
_DEV_KEY = base64.urlsafe_b64encode(hashlib.sha256(b"flyfleet development field key - not for production").digest())


@lru_cache
def _cipher() -> MultiFernet:
    keys = [k.strip() for k in get_settings().field_encryption_keys.split(",") if k.strip()] or [_DEV_KEY]
    try:
        return MultiFernet([Fernet(k) for k in keys])
    except (ValueError, TypeError) as e:
        raise RuntimeError("FLYFLEET_FIELD_ENCRYPTION_KEYS must be a comma-separated list of Fernet keys") from e


def validate_encryption_keys() -> None:
    """Fail at startup, not on the first request that touches an encrypted column."""
    _cipher()


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _cipher().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("A stored value could not be decrypted. Is FLYFLEET_FIELD_ENCRYPTION_KEYS missing the key "
                           "it was encrypted with?") from e


class EncryptedText(TypeDecorator):
    """A text column that is encrypted at rest and transparently decrypted when loaded."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:  # noqa: ANN001
        return None if value is None else encrypt(value)

    def process_result_value(self, value: str | None, dialect) -> str | None:  # noqa: ANN001
        return None if value is None else decrypt(value)


def mask(value: str | None, visible: int = 4) -> str | None:
    """'D1234567' -> '••••4567'. For showing that a value exists without revealing it."""
    if not value:
        return value
    return "••••" + (value[-visible:] if len(value) > visible else "")
