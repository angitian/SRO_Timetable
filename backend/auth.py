"""JWT issuance + identity resolution for the SRO Timetable API.

Identity model (POC, optional login):
  - Logged-in users send `Authorization: Bearer <jwt>` (issued by /auth/google/callback).
    The JWT carries `sub` = google_sub, `email`, `name`. We use `sub` as user_id.
  - Guests send `X-User-Id: <device_id>` (frontend-generated, stored in localStorage).
  - Endpoints that require identity use the `get_identity` dependency, which accepts
    either form and returns a `UserIdentity` with `user_id` and `is_authenticated`.
  - `require_authenticated` rejects guests (403) — used by future user-only endpoints.

Backward compatible with the existing `_require_user_id` flow: `get_identity` returns
a guest identity when only `X-User-Id` is present, so existing endpoints keep working.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Header, HTTPException, Request

from config import settings


@dataclass
class UserIdentity:
    """Resolved caller identity. `is_authenticated` distinguishes JWT vs guest."""
    user_id: str
    is_authenticated: bool  # True = JWT (google login), False = guest device id
    email: Optional[str] = None
    name: Optional[str] = None


def create_token(sub: str, email: str, name: str) -> str:
    """Issue a signed JWT for the given google sub + profile."""
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "email": email,
        "name": name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.JWT_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Verify + decode a JWT. Raises HTTPException(401) on invalid/expired tokens."""
    if not settings.JWT_SECRET:
        raise HTTPException(status_code=503, detail="Auth is not configured (JWT_SECRET missing)")
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _extract_bearer(request: Request) -> Optional[str]:
    """Pull the bearer token from the Authorization header, if present."""
    auth = request.headers.get("Authorization") or request.headers.get("authorization")
    if not auth:
        return None
    parts = auth.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def get_identity(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
) -> UserIdentity:
    """Resolve caller identity from either a Bearer JWT or an X-User-Id guest header.

    Used as a FastAPI dependency. Returns a `UserIdentity` (never raises on missing
    identity — endpoints that require identity should use `require_identity` instead).
    """
    token = _extract_bearer(request)
    if token:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Token missing sub claim")
        return UserIdentity(
            user_id=str(sub),
            is_authenticated=True,
            email=payload.get("email"),
            name=payload.get("name"),
        )
    # Fall back to guest device id
    if x_user_id and x_user_id.strip():
        return UserIdentity(user_id=x_user_id.strip(), is_authenticated=False)
    raise HTTPException(status_code=401, detail="Authentication required (Bearer token or X-User-Id)")


def get_optional_identity(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
) -> UserIdentity | None:
    """Like `get_identity` but returns None instead of raising 401 when no identity is present.

    Used by endpoints that accept anonymous access (e.g. generate-and-save for
    guests) but attribute ownership when an identity is supplied.
    """
    token = _extract_bearer(request)
    if token:
        try:
            payload = decode_token(token)
        except HTTPException:
            return None
        sub = payload.get("sub")
        if sub:
            return UserIdentity(
                user_id=str(sub),
                is_authenticated=True,
                email=payload.get("email"),
                name=payload.get("name"),
            )
    if x_user_id and x_user_id.strip():
        return UserIdentity(user_id=x_user_id.strip(), is_authenticated=False)
    return None


def require_authenticated(identity: UserIdentity = None) -> UserIdentity:
    """Dependency factory: require a JWT-authenticated user (reject guests with 403).

    Usage:
        @router.get("/...", dependencies=[Depends(require_authenticated)])
    or as a parameter:
        identity: UserIdentity = Depends(require_authenticated)
    """
    # When used as a direct dependency, FastAPI calls with no args — wrap get_identity.
    if identity is None:
        # This branch is never hit when used via Depends(); included for safety.
        raise HTTPException(status_code=401, detail="Authentication required")
    if not identity.is_authenticated:
        raise HTTPException(status_code=403, detail="Login required for this action")
    return identity


def identity_dependency():
    """Returns the `get_identity` callable for use in `Depends()`.

    Convenience wrapper so callers don't import the underlying function directly.
    """
    return get_identity
