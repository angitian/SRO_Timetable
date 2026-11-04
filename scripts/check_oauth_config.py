#!/usr/bin/env python
"""Check that the local Google OAuth config matches what Google Cloud Console has registered.

The most common local-login failure is `Error 400: redirect_uri_mismatch`, which
happens when `BACKEND_BASE_URL` (backend/.env) builds a redirect URI that was
never added to the OAuth client's "Authorized redirect URIs" — e.g. the backend
runs on port 8001 while only http://localhost:8000/... is registered.

Usage (from the repo root):
    python scripts/check_oauth_config.py

Exit codes: 0 = OK, 1 = mismatch/error, 2 = auth not configured.
"""
from __future__ import annotations

import base64
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))
# config.Settings reads env_file=".env" relative to the CWD, which is backend/
# when the server is started normally — mirror that here.
os.chdir(BACKEND_DIR)

from config import settings  # noqa: E402  (path must be set up first)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _mask(value: str) -> str:
    if not value:
        return "(not set)"
    if len(value) <= 12:
        return value[:2] + "***"
    return f"{value[:8]}...{value[-6:]}"


def _redirect_uri() -> str:
    return f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/v1/auth/google/callback"


def _decode_auth_error(final_url: str) -> str:
    """Pull the human-readable reason out of Google's `?authError=<base64>` page."""
    query = urllib.parse.urlparse(final_url).query
    encoded = urllib.parse.parse_qs(query).get("authError", [""])[0]
    if not encoded:
        return ""
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded)
    except (ValueError, TypeError):
        return ""
    return " ".join(part.decode("ascii", "ignore") for part in raw.split(b"\x00") if part)


def _probe_google(redirect_uri: str) -> tuple[bool, str]:
    """Ask Google's consent endpoint whether it accepts this redirect URI.

    Google answers a bad redirect URI with a 302 to
    `/signin/oauth/error?authError=<base64 reason>` — so the final URL is the
    signal, not the page body (which is a JS app shell).
    """
    query = urllib.parse.urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": "config-check",
        }
    )
    request = urllib.request.Request(
        f"{GOOGLE_AUTH_URL}?{query}",
        headers={"User-Agent": "sro-timetable-oauth-check"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            final_url = response.url
            response.read(2048)
    except urllib.error.URLError as exc:
        return False, f"cannot reach Google: {exc}"

    if "/oauth/error" in final_url or "redirect_uri_mismatch" in final_url:
        reason = _decode_auth_error(final_url) or "redirect_uri_mismatch"
        if "redirect_uri_mismatch" in reason:
            return False, "MISMATCH - this URI is not in the client's Authorized redirect URIs"
        if "invalid_client" in reason:
            return False, "INVALID CLIENT - GOOGLE_CLIENT_ID is wrong or the client was deleted"
        return False, f"Google rejected the request: {reason[:160]}"
    return True, "OK - Google accepts this redirect URI"


def main() -> int:
    redirect_uri = _redirect_uri()

    print("Google OAuth config (local)")
    print("  google_configured :", settings.google_configured)
    print("  client_id         :", _mask(settings.GOOGLE_CLIENT_ID))
    print("  client_secret     :", "set" if settings.GOOGLE_CLIENT_SECRET else "(not set)")
    print("  jwt_secret        :", "set" if settings.JWT_SECRET else "(not set)")
    print("  BACKEND_BASE_URL  :", settings.BACKEND_BASE_URL)
    print("  FRONTEND_BASE_URL :", settings.FRONTEND_BASE_URL)
    print("  redirect_uri      :", redirect_uri)

    if not settings.google_configured:
        print()
        print("FAIL: auth is disabled. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET")
        print("      and JWT_SECRET in backend/.env (see backend/.env.example).")
        return 2

    ok, message = _probe_google(redirect_uri)
    print()
    print(("PASS: " if ok else "FAIL: ") + message)
    if not ok:
        print()
        print("Fix: add this exact URI to Google Cloud Console")
        print("     -> APIs & Services -> Credentials -> your OAuth 2.0 Client ID")
        print(f"     -> Authorized redirect URIs: {redirect_uri}")
        print("   ...or change BACKEND_BASE_URL so it matches an already-registered URI")
        print("     (locally: http://localhost:8000 + run the backend on port 8000).")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
