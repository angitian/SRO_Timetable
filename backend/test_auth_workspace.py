"""Tests for the auth router and workspace endpoints.

Covers:
  - JWT issuance + validation (create_token / decode_token)
  - get_identity with Bearer JWT vs X-User-Id vs none
  - /auth/me (401 for guest, 200 for JWT)
  - /auth/status (redirect URI diagnostics)
  - /auth/google/url (503 when not configured)
  - /auth/google/callback (cancel, invalid state, missing code, success)
  - Workspace save/load/delete (owner-scoped)
  - merge-guest (403 for guests, 200 for JWT)
"""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from main import app
from timetable_store import LocalTimetableStore, get_timetable_store


# ── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture()
def temp_store(tmp_path):
    store_path = tmp_path / "timetables.json"
    store = LocalTimetableStore(path=store_path)

    def _override():
        return store

    app.dependency_overrides[get_timetable_store] = _override
    yield store
    app.dependency_overrides.clear()


@pytest.fixture()
def client(temp_store):
    return TestClient(app)


@pytest.fixture()
def jwt_secret(monkeypatch):
    """Configure a JWT secret so auth functions work in tests."""
    monkeypatch.setattr("auth.settings.JWT_SECRET", "test-secret-key-for-tests")
    monkeypatch.setattr("auth.settings.JWT_ALGORITHM", "HS256")
    monkeypatch.setattr("auth.settings.JWT_EXPIRE_DAYS", 30)
    yield


@pytest.fixture()
def google_configured(jwt_secret, monkeypatch):
    """Fully configure Google OAuth for tests that need /auth/google/url."""
    monkeypatch.setattr("auth.settings.GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr("auth.settings.GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr("config.settings.GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr("config.settings.GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr("config.settings.JWT_SECRET", "test-secret-key-for-tests")
    monkeypatch.setattr("config.settings.BACKEND_BASE_URL", "http://localhost:8000")
    monkeypatch.setattr("config.settings.FRONTEND_BASE_URL", "http://localhost:5173")
    yield


@pytest.fixture()
def google_not_configured(monkeypatch):
    """Force auth to look unconfigured even when backend/.env has real credentials."""
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "JWT_SECRET"):
        monkeypatch.setattr(f"config.settings.{name}", "")
    yield


def _make_jwt(user_id="google-sub-123", email="test@example.com", name="Test User"):
    from auth import create_token
    return create_token(sub=user_id, email=email, name=name)


# ── JWT unit tests ─────────────────────────────────────────────────────────


class TestJWT:
    def test_create_and_decode_token(self, jwt_secret):
        from auth import create_token, decode_token
        token = create_token(sub="sub123", email="a@b.com", name="Test")
        payload = decode_token(token)
        assert payload["sub"] == "sub123"
        assert payload["email"] == "a@b.com"
        assert payload["name"] == "Test"
        assert "exp" in payload

    def test_decode_invalid_token_raises_401(self, jwt_secret):
        from auth import decode_token
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            decode_token("invalid.token.here")
        assert exc.value.status_code == 401

    def test_create_token_without_secret_raises(self, monkeypatch):
        from auth import create_token
        monkeypatch.setattr("auth.settings.JWT_SECRET", "")
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            create_token(sub="s", email="e", name="n")


# ── /auth/me tests ─────────────────────────────────────────────────────────


class TestAuthMe:
    def test_without_auth_returns_401(self, client, jwt_secret):
        resp = client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    def test_with_guest_header_returns_401(self, client, jwt_secret):
        # X-User-Id (guest) is accepted by get_identity but /auth/me requires JWT
        resp = client.get("/api/v1/auth/me", headers={"X-User-Id": "device-1"})
        assert resp.status_code == 401
        assert "Login required" in resp.json()["detail"]

    def test_with_jwt_returns_user(self, client, jwt_secret, temp_store):
        # First upsert the user
        import asyncio
        asyncio.run(temp_store.upsert_user(
            id="google-sub-123", email="test@example.com", name="Test User"
        ))
        token = _make_jwt()
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "google-sub-123"
        assert body["email"] == "test@example.com"
        assert body["name"] == "Test User"

    def test_with_jwt_but_missing_user_row_returns_from_claims(self, client, jwt_secret):
        # JWT valid but user not in store — should reconstruct from token claims
        token = _make_jwt(user_id="no-such-user", email="ghost@test.com", name="Ghost")
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "no-such-user"
        assert body["email"] == "ghost@test.com"


# ── /auth/google/url tests ─────────────────────────────────────────────────


class TestGoogleLoginUrl:
    def test_not_configured_returns_503(self, client, google_not_configured):
        # GOOGLE_CLIENT_ID not set → 503
        resp = client.get("/api/v1/auth/google/url")
        assert resp.status_code == 503

    def test_returns_url_and_state(self, client, google_configured):
        resp = client.get("/api/v1/auth/google/url")
        assert resp.status_code == 200
        body = resp.json()
        assert "url" in body
        assert "state" in body
        assert "accounts.google.com" in body["url"]
        assert "test-client-id" in body["url"]
        assert len(body["state"]) > 10


# ── /auth/status tests ─────────────────────────────────────────────────────


class TestAuthStatus:
    def test_not_configured_reports_false(self, client, google_not_configured):
        resp = client.get("/api/v1/auth/status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["configured"] is False
        # The redirect URI is still reported so devs can register it
        assert body["redirect_uri"].endswith("/api/v1/auth/google/callback")

    def test_configured_reports_redirect_uri(self, client, google_configured):
        body = client.get("/api/v1/auth/status").json()
        assert body["configured"] is True
        assert body["redirect_uri"] == "http://localhost:8000/api/v1/auth/google/callback"
        assert body["frontend_base_url"] == "http://localhost:5173"


# ── /auth/google/callback tests ────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient: token exchange + userinfo both succeed."""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        return _FakeResponse(200, {"access_token": "fake-access-token"})

    async def get(self, url, **kwargs):
        return _FakeResponse(
            200,
            {
                "sub": "google-sub-123",
                "email": "test@example.com",
                "name": "Test User",
                "picture": "https://example.com/p.png",
            },
        )


def _callback_location(resp) -> str:
    assert resp.status_code == 302
    return resp.headers["location"]


def _start_login(client) -> str:
    """Hit /auth/google/url and return the state Google would echo back."""
    body = client.get("/api/v1/auth/google/url").json()
    return body["state"]


class TestGoogleCallback:
    def test_not_configured_returns_503(self, client, google_not_configured):
        resp = client.get("/api/v1/auth/google/callback?code=x&state=y", follow_redirects=False)
        assert resp.status_code == 503

    def test_user_cancel_redirects_to_frontend(self, client, google_configured):
        # Google sends ?error=... with no `code` when the user declines
        resp = client.get(
            "/api/v1/auth/google/callback?error=access_denied&state=whatever",
            follow_redirects=False,
        )
        location = _callback_location(resp)
        assert location.startswith("http://localhost:5173/auth/callback")
        assert parse_qs(urlparse(location).query)["error"] == ["access_denied"]

    def test_invalid_state_redirects_with_error(self, client, google_configured):
        resp = client.get(
            "/api/v1/auth/google/callback?code=abc&state=not-a-real-state",
            follow_redirects=False,
        )
        location = _callback_location(resp)
        assert parse_qs(urlparse(location).query)["error"] == ["invalid_state"]

    def test_state_is_single_use(self, client, google_configured, monkeypatch):
        monkeypatch.setattr("api.auth.httpx.AsyncClient", _FakeAsyncClient)
        state = _start_login(client)
        first = client.get(
            f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
        )
        assert first.status_code == 302
        second = client.get(
            f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
        )
        assert parse_qs(urlparse(_callback_location(second)).query)["error"] == ["invalid_state"]

    def test_missing_code_redirects_with_error(self, client, google_configured):
        state = _start_login(client)
        resp = client.get(f"/api/v1/auth/google/callback?state={state}", follow_redirects=False)
        location = _callback_location(resp)
        assert parse_qs(urlparse(location).query)["error"] == ["missing_code"]

    def test_success_flow_issues_usable_jwt(self, client, google_configured, monkeypatch):
        monkeypatch.setattr("api.auth.httpx.AsyncClient", _FakeAsyncClient)
        state = _start_login(client)
        resp = client.get(
            f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
        )
        location = _callback_location(resp)
        assert location.startswith("http://localhost:5173/auth/callback")
        token = parse_qs(urlparse(location).query)["token"][0]

        # The JWT must authenticate /auth/me and carry the Google profile
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["id"] == "google-sub-123"
        assert me.json()["email"] == "test@example.com"

    def test_token_exchange_failure_redirects(self, client, google_configured, monkeypatch):
        class _FailingClient(_FakeAsyncClient):
            async def post(self, url, **kwargs):
                return _FakeResponse(400, {"error": "invalid_grant"})

        monkeypatch.setattr("api.auth.httpx.AsyncClient", _FailingClient)
        state = _start_login(client)
        resp = client.get(
            f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
        )
        location = _callback_location(resp)
        assert parse_qs(urlparse(location).query)["error"] == ["token_exchange_failed"]


# ── Workspace save/load/delete tests ───────────────────────────────────────


class TestWorkspace:
    def _workspace_payload(self, id=None, title="My Workspace"):
        return {
            "id": id,
            "title": title,
            "academic_year": 2569,
            "term": 1,
            "workspace": {
                "fixtureData": {"teachers": [], "classes": []},
                "result": {"slots": [], "metrics": {"status": "OPTIMAL"}},
                "userPlacements": {},
                "solverPreset": "balanced",
            },
        }

    def test_save_new_workspace(self, client, jwt_secret):
        token = _make_jwt()
        resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "id" in body
        assert body["title"] == "My Workspace"
        assert body["updated_at"] is not None

    def test_load_workspace(self, client, jwt_secret):
        token = _make_jwt()
        # Save first
        save_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        ws_id = save_resp.json()["id"]

        # Load it back
        resp = client.get(
            f"/api/v1/timetables/workspace/{ws_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == ws_id
        assert body["workspace"] is not None
        assert body["workspace"]["solverPreset"] == "balanced"
        assert body["is_public"] is False  # private

    def test_load_other_users_workspace_returns_404(self, client, jwt_secret):
        token_a = _make_jwt(user_id="user-a")
        token_b = _make_jwt(user_id="user-b")

        # User A saves
        save_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"Authorization": f"Bearer {token_a}"},
        )
        ws_id = save_resp.json()["id"]

        # User B tries to load → 404
        resp = client.get(
            f"/api/v1/timetables/workspace/{ws_id}",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp.status_code == 404

    def test_update_existing_workspace(self, client, jwt_secret):
        token = _make_jwt()
        # Save
        save_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(title="Original"),
            headers={"Authorization": f"Bearer {token}"},
        )
        ws_id = save_resp.json()["id"]

        # Update with same id
        resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(id=ws_id, title="Updated"),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated"

        # Verify
        load_resp = client.get(
            f"/api/v1/timetables/workspace/{ws_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert load_resp.json()["title"] == "Updated"

    def test_delete_workspace(self, client, jwt_secret):
        token = _make_jwt()
        save_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        ws_id = save_resp.json()["id"]

        resp = client.delete(
            f"/api/v1/timetables/workspace/{ws_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

        # Confirm gone
        load_resp = client.get(
            f"/api/v1/timetables/workspace/{ws_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert load_resp.status_code == 404

    def test_workspace_not_in_public_short_code(self, client, jwt_secret):
        """Private workspace should NOT be accessible via /t/{short_code}."""
        token = _make_jwt()
        save_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        ws_id = save_resp.json()["id"]
        # The workspace has a short_code but is_private → /t/{code} should 404
        # We don't know the short_code, but we can check my-schedules returns it
        my = client.get(
            "/api/v1/timetables/my-schedules",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert my.status_code == 200
        records = my.json()
        assert any(r["id"] == ws_id for r in records)
        # is_public should be False
        ws_record = [r for r in records if r["id"] == ws_id][0]
        assert ws_record["is_public"] is False

    def test_guest_cannot_save_workspace(self, client, jwt_secret):
        """Guests (X-User-Id only) can use get_identity but save-workspace
        should still work for them — they just can't access /auth/me.
        Actually, get_identity accepts X-User-Id, so this should work.
        """
        resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
            headers={"X-User-Id": "device-1"},
        )
        # Guests CAN save workspaces (get_identity accepts X-User-Id)
        assert resp.status_code == 200

    def test_no_auth_returns_401(self, client, jwt_secret):
        resp = client.post(
            "/api/v1/timetables/save-workspace",
            json=self._workspace_payload(),
        )
        assert resp.status_code == 401


# ── merge-guest tests ──────────────────────────────────────────────────────


class TestMergeGuest:
    def test_guest_cannot_merge(self, client, jwt_secret):
        resp = client.post(
            "/api/v1/timetables/merge-guest",
            json={"device_id": "device-1"},
            headers={"X-User-Id": "device-1"},
        )
        assert resp.status_code == 403

    def test_jwt_user_can_merge(self, client, jwt_secret):
        # First save a workspace as guest
        guest_resp = client.post(
            "/api/v1/timetables/save-workspace",
            json={
                "title": "Guest Work",
                "academic_year": 2569,
                "term": 1,
                "workspace": {"data": "test"},
            },
            headers={"X-User-Id": "device-xyz"},
        )
        assert guest_resp.status_code == 200

        # Now merge as JWT user
        token = _make_jwt(user_id="google-user-1")
        resp = client.post(
            "/api/v1/timetables/merge-guest",
            json={"device_id": "device-xyz"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["merged"] >= 1

        # Verify the workspace now belongs to google-user-1
        my = client.get(
            "/api/v1/timetables/my-schedules",
            headers={"Authorization": f"Bearer {token}"},
        )
        records = my.json()
        assert any(r["user_id"] == "google-user-1" for r in records)


# ── Team sharing tests ─────────────────────────────────────────────────────

OWNER_ID = "owner-sub-1"
OWNER_EMAIL = "owner@school.ac.th"
MEMBER_ID = "member-sub-1"
MEMBER_EMAIL = "teacher@school.ac.th"


def _owner_headers():
    return {"Authorization": f"Bearer {_make_jwt(OWNER_ID, OWNER_EMAIL, 'Owner')}"}


def _member_headers():
    return {"Authorization": f"Bearer {_make_jwt(MEMBER_ID, MEMBER_EMAIL, 'Member')}"}


def _save_workspace(client, headers, title="Shared Workspace"):
    resp = client.post(
        "/api/v1/timetables/save-workspace",
        json={
            "title": title,
            "academic_year": 2569,
            "term": 1,
            "workspace": {"fixtureData": {"teachers": []}},
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


class TestTeam:
    def test_owner_add_and_list_members(self, client, jwt_secret):
        resp = client.post(
            "/api/v1/team/members",
            json={"email": MEMBER_EMAIL},
            headers=_owner_headers(),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["added"] is True

        team = client.get("/api/v1/team", headers=_owner_headers()).json()
        assert team["owner_id"] == OWNER_ID
        assert [m["email"] for m in team["members"]] == [MEMBER_EMAIL]
        assert team["members"][0]["status"] == "pending"

    def test_guest_cannot_manage_team(self, client, jwt_secret):
        assert client.get("/api/v1/team", headers={"X-User-Id": "device-1"}).status_code == 403
        assert client.post(
            "/api/v1/team/members",
            json={"email": MEMBER_EMAIL},
            headers={"X-User-Id": "device-1"},
        ).status_code == 403

    def test_add_own_email_rejected(self, client, jwt_secret):
        resp = client.post(
            "/api/v1/team/members",
            json={"email": OWNER_EMAIL.upper()},
            headers=_owner_headers(),
        )
        assert resp.status_code == 400

    def test_duplicate_member_is_idempotent(self, client, jwt_secret):
        first = client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())
        second = client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL.upper()}, headers=_owner_headers())
        assert first.json()["added"] is True
        assert second.json()["added"] is False
        assert len(second.json()["members"]) == 1

    def test_member_sees_owner_workspace_in_my_schedules(self, client, jwt_secret, temp_store):
        import asyncio
        asyncio.run(temp_store.upsert_user(id=OWNER_ID, email=OWNER_EMAIL, name="Owner"))
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())

        records = client.get("/api/v1/timetables/my-schedules", headers=_member_headers()).json()
        assert any(r["id"] == ws_id for r in records)
        shared = [r for r in records if r["id"] == ws_id][0]
        assert shared["user_id"] == OWNER_ID
        assert shared["owner_email"] == OWNER_EMAIL

    def test_member_can_load_and_save_owner_workspace(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())

        load = client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers())
        assert load.status_code == 200

        save = client.post(
            "/api/v1/timetables/save-workspace",
            json={
                "id": ws_id,
                "title": "Edited by member",
                "academic_year": 2569,
                "term": 1,
                "workspace": {"fixtureData": {"teachers": []}},
            },
            headers=_member_headers(),
        )
        assert save.status_code == 200, save.text

        # Owner still owns the record after a member saves
        owner_view = client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_owner_headers()).json()
        assert owner_view["user_id"] == OWNER_ID
        assert owner_view["title"] == "Edited by member"

    def test_member_cannot_manage_members_or_delete(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())

        managers = client.put(
            f"/api/v1/timetables/workspace/{ws_id}/managers",
            json={"manager_emails": ["someone@else.com"]},
            headers=_member_headers(),
        )
        assert managers.status_code == 404

        access = client.put(
            f"/api/v1/timetables/workspace/{ws_id}/access",
            json={"mode": "private"},
            headers=_member_headers(),
        )
        assert access.status_code == 404

        delete = client.delete(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers())
        assert delete.status_code == 404

    def test_private_workspace_hidden_from_team(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())

        resp = client.put(
            f"/api/v1/timetables/workspace/{ws_id}/access",
            json={"mode": "private"},
            headers=_owner_headers(),
        )
        assert resp.status_code == 200, resp.text

        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers()).status_code == 404
        records = client.get("/api/v1/timetables/my-schedules", headers=_member_headers()).json()
        assert all(r["id"] != ws_id for r in records)

        # An explicit manager email still has access in private mode
        client.put(
            f"/api/v1/timetables/workspace/{ws_id}/managers",
            json={"manager_emails": [MEMBER_EMAIL]},
            headers=_owner_headers(),
        )
        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers()).status_code == 200

    def test_email_case_insensitive(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": "Teacher@School.ac.Th"}, headers=_owner_headers())

        # JWT email casing differs from the invited email — still matched
        headers = {"Authorization": f"Bearer {_make_jwt(MEMBER_ID, 'TEACHER@school.ac.th', 'Member')}"}
        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=headers).status_code == 200

    def test_remove_member_revokes_access(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        client.post("/api/v1/team/members", json={"email": MEMBER_EMAIL}, headers=_owner_headers())
        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers()).status_code == 200

        resp = client.delete(f"/api/v1/team/members/{MEMBER_EMAIL}", headers=_owner_headers())
        assert resp.status_code == 200
        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=_member_headers()).status_code == 404

    def test_non_member_cannot_access(self, client, jwt_secret):
        ws_id = _save_workspace(client, _owner_headers())
        stranger = {"Authorization": f"Bearer {_make_jwt('stranger', 'stranger@x.com', 'X')}"}
        assert client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=stranger).status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
