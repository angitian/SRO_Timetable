"""FastAPI router for Google OAuth login (optional).

Endpoints (all under /api/v1/auth):
  GET  /auth/google/url         → returns the Google consent URL + state
  GET  /auth/google/callback    → Google redirects here with ?code&state;
                                   we exchange the code, upsert the user,
                                   issue a JWT, and 302-redirect to the
                                   frontend /auth/callback?token=...
  GET  /auth/me                 → (Bearer) returns the current user profile

Auth is only enabled when `settings.google_configured` is True. Otherwise the
endpoints return 503 so the frontend can hide the login button.
"""
from __future__ import annotations

import secrets
import sys
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from auth import UserIdentity, create_token, get_identity
from config import settings
from d1_service import D1Error
from models import User
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# ── In-memory OAuth state store (CSRF protection) ────────────────────────────
# POC: works on a single Render instance. For multi-instance, move to D1/Redis.
_OAUTH_STATES: dict[str, float] = {}
_OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes


def _push_state(state: str) -> None:
    now = time.time()
    # Garbage-collect expired states on every push
    expired = [k for k, ts in _OAUTH_STATES.items() if now - ts > _OAUTH_STATE_TTL_SECONDS]
    for k in expired:
        _OAUTH_STATES.pop(k, None)
    _OAUTH_STATES[state] = now


def _pop_state(state: str) -> bool:
    ts = _OAUTH_STATES.pop(state, None)
    if ts is None:
        return False
    if time.time() - ts > _OAUTH_STATE_TTL_SECONDS:
        return False
    return True


def _require_google_configured() -> None:
    if not settings.google_configured:
        raise HTTPException(status_code=503, detail="Google login is not configured")


_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def redirect_uri() -> str:
    """The exact callback URI Google must redirect to.

    Must match an "Authorized redirect URI" in the Google Cloud Console
    character-for-character — including scheme, host and port. A mismatch shows
    up as `Error 400: redirect_uri_mismatch` on the Google consent page.
    """
    return f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/v1/auth/google/callback"


def _frontend_callback_url(**params: str) -> str:
    """Build the frontend /auth/callback URL used to hand control back to the app."""
    base = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/auth/callback"
    return f"{base}?{urlencode(params)}" if params else base


@router.get("/status")
async def auth_status() -> dict[str, Any]:
    """Non-secret auth config snapshot — useful for local-dev diagnostics.

    Deliberately not gated by `_require_google_configured()`: the whole point is
    to be able to tell *why* login is unavailable.
    """
    return {
        "configured": settings.google_configured,
        "redirect_uri": redirect_uri(),
        "backend_base_url": settings.BACKEND_BASE_URL.rstrip("/"),
        "frontend_base_url": settings.FRONTEND_BASE_URL.rstrip("/"),
    }


@router.get("/google/url")
async def google_login_url() -> dict[str, str]:
    """Return the Google OAuth consent URL the frontend should redirect to."""
    _require_google_configured()
    state = secrets.token_urlsafe(16)
    _push_state(state)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return {"url": url, "state": state}


@router.get("/google/callback")
async def google_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    store: Any = Depends(get_timetable_store),
):
    """Handle the Google redirect: exchange code → userinfo → JWT → frontend redirect.

    Every failure path redirects back to the frontend with `?error=<code>` so the
    user sees a proper Thai error screen instead of a raw JSON API error.
    """
    _require_google_configured()

    # Google sends `error` (no `code`) if the user cancels or consent is refused
    if error:
        if error_description:
            print(f"[auth] Google returned {error}: {error_description}", file=sys.stderr)
        return RedirectResponse(url=_frontend_callback_url(error=error), status_code=302)

    # Validate CSRF state
    if not state or not _pop_state(state):
        return RedirectResponse(url=_frontend_callback_url(error="invalid_state"), status_code=302)

    if not code:
        return RedirectResponse(url=_frontend_callback_url(error="missing_code"), status_code=302)

    callback_url = redirect_uri()

    # Exchange code for tokens
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            token_resp = await client.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": callback_url,
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as e:
            print(f"[auth] token exchange failed: {e}", file=sys.stderr)
            return RedirectResponse(
                url=_frontend_callback_url(error="token_exchange_failed"), status_code=302
            )

    if token_resp.status_code != 200:
        print(f"[auth] token exchange failed: {token_resp.text}", file=sys.stderr)
        return RedirectResponse(
            url=_frontend_callback_url(error="token_exchange_failed"), status_code=302
        )

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        print("[auth] Google did not return an access token", file=sys.stderr)
        return RedirectResponse(
            url=_frontend_callback_url(error="token_exchange_failed"), status_code=302
        )

    # Fetch user profile
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            ui_resp = await client.get(
                _GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.HTTPError as e:
            print(f"[auth] userinfo fetch failed: {e}", file=sys.stderr)
            return RedirectResponse(
                url=_frontend_callback_url(error="userinfo_failed"), status_code=302
            )

    if ui_resp.status_code != 200:
        print(f"[auth] userinfo failed: {ui_resp.text}", file=sys.stderr)
        return RedirectResponse(
            url=_frontend_callback_url(error="userinfo_failed"), status_code=302
        )

    userinfo = ui_resp.json()
    sub = userinfo.get("sub")
    if not sub:
        print("[auth] Google userinfo missing sub", file=sys.stderr)
        return RedirectResponse(
            url=_frontend_callback_url(error="userinfo_failed"), status_code=302
        )

    email = userinfo.get("email") or ""
    name = userinfo.get("name") or email or "User"
    picture = userinfo.get("picture")

    # Upsert user in D1/local store
    try:
        await store.upsert_user(id=sub, email=email, name=name, picture=picture)
    except D1Error as e:
        # Non-fatal: we still issue a JWT so the user can work; profile just won't persist.
        # Log to stderr for visibility.
        print(f"[auth] upsert_user failed: {e}", file=sys.stderr)

    # Issue JWT
    jwt_token = create_token(sub=sub, email=email, name=name)

    # Redirect to frontend with token in query string
    return RedirectResponse(
        url=_frontend_callback_url(token=jwt_token),
        status_code=302,
    )


@router.get("/me", response_model=User)
async def get_me(
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> User:
    """Return the current user profile (requires Bearer JWT)."""
    if not identity.is_authenticated:
        raise HTTPException(status_code=401, detail="Login required (guest has no profile)")
    try:
        user = await store.get_user_by_sub(identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch user: {e}")
    if not user:
        # JWT is valid but user row missing — reconstruct from token claims
        return User(
            id=identity.user_id,
            email=identity.email or "",
            name=identity.name or "",
            picture=None,
        )
    return User(**user)
