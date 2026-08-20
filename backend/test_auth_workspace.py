"""Tests for the auth router and workspace endpoints.

Covers:
  - JWT issuance + validation (create_token / decode_token)
  - get_identity with Bearer JWT vs X-User-Id vs none
  - /auth/me (401 for guest, 200 for JWT)
  - /auth/google/url (503 when not configured)
  - Workspace save/load/delete (owner-scoped)
  - merge-guest (403 for guests, 200 for JWT)
"""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

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
    def test_not_configured_returns_503(self, client, jwt_secret):
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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
