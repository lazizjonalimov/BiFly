import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_ph = PasswordHasher()
# Verified against when the email is unknown, so timing doesn't reveal which emails exist.
_DUMMY_HASH = _ph.hash("not-a-real-password")


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str | None) -> bool:
    try:
        return _ph.verify(hashed or _DUMMY_HASH, pw) and hashed is not None
    except (VerificationError, InvalidHashError):
        return False


def create_token(user_id: uuid.UUID, org_id: uuid.UUID) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "org": str(org_id),
        "iss": s.jwt_issuer,
        "iat": now,
        "exp": now + timedelta(minutes=s.jwt_ttl_minutes),
    }
    return jwt.encode(claims, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=["HS256"], issuer=s.jwt_issuer,
                      options={"require": ["exp", "sub", "org", "iss"]})
