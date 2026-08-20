"""Tests for the timetables API router (generate-and-save, /t/{code}, my-schedules, claim).

Uses FastAPI's TestClient (backed by httpx) against the real main.app, with the
timetable store dependency overridden to use a temp-file LocalTimetableStore so
tests are hermetic and don't touch Cloudflare D1 or the real data directory.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

# Ensure the backend directory is on sys.path when running from repo root.
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
    """Override the get_timetable_store dependency with a temp-file store."""
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
def fixture_config():
    """Load the small fixture and return it as a dict (TimetableRequest shape)."""
    data = json.loads((BACKEND_DIR / "fixtures" / "school_small.json").read_text(encoding="utf-8"))
    return data


def _make_generate_payload(fixture_config, title="Test School", academic_year=2569, term=1):
    return {
        "title": title,
        "academic_year": academic_year,
        "term": term,
        "config": fixture_config,
        "is_public": True,
    }


# ── Tests ──────────────────────────────────────────────────────────────────


class TestGenerateAndSave:
    def test_success_returns_short_code_and_share_url(self, client, fixture_config):
        resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "id" in body
        assert "short_code" in body
        assert len(body["short_code"]) == 6
        assert "share_url" in body
        assert "/view?code=" in body["share_url"]
        assert body["title"] == "Test School"
        assert body["academic_year"] == 2569
        assert body["term"] == 1

    def test_short_code_is_uppercase_alphanumeric(self, client, fixture_config):
        resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = resp.json()["short_code"]
        # Unambiguous alphabet (no 0/O/1/I/L)
        valid = set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        assert set(code) <= valid

    def test_missing_teachers_returns_400(self, client):
        payload = _make_generate_payload({"teachers": [], "rooms": [], "subjects": [],
                                          "classes": [], "lesson_blocks": []})
        resp = client.post("/api/v1/timetables/generate-and-save", json=payload)
        assert resp.status_code == 400

    def test_missing_lesson_blocks_returns_400(self, client):
        payload = _make_generate_payload({"teachers": [{"id": "T1", "name": "T"}],
                                          "rooms": [], "subjects": [],
                                          "classes": [{"id": "C1", "name": "C", "grade_level": 1}],
                                          "lesson_blocks": []})
        resp = client.post("/api/v1/timetables/generate-and-save", json=payload)
        assert resp.status_code == 400


class TestGetByShortCode:
    def test_fetch_existing(self, client, fixture_config):
        # Save first
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]

        # Fetch
        resp = client.get(f"/api/v1/timetables/t/{code}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["short_code"] == code
        assert body["title"] == "Test School"
        assert body["config"] is not None
        assert body["result"] is not None
        assert "slots" in body["result"]

    def test_not_found_returns_404(self, client):
        resp = client.get("/api/v1/timetables/t/NOCODE")
        assert resp.status_code == 404

    def test_lowercase_code_normalized(self, client, fixture_config):
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]
        # Send lowercase — should still resolve
        resp = client.get(f"/api/v1/timetables/t/{code.lower()}")
        assert resp.status_code == 200


class TestMySchedules:
    def test_without_header_returns_401(self, client):
        resp = client.get("/api/v1/timetables/my-schedules")
        assert resp.status_code == 401

    def test_with_header_returns_list(self, client, fixture_config):
        resp = client.get(
            "/api/v1/timetables/my-schedules",
            headers={"X-User-Id": "user-123"},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_only_owned_schedules(self, client, fixture_config, temp_store):
        # Save a timetable (guest — no owner)
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]

        # Claim it for user-123
        client.post(
            "/api/v1/timetables/claim",
            json={"short_code": code},
            headers={"X-User-Id": "user-123"},
        )

        # user-123 should see it
        resp = client.get(
            "/api/v1/timetables/my-schedules",
            headers={"X-User-Id": "user-123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["short_code"] == code
        assert body[0]["user_id"] == "user-123"

        # user-456 should see nothing
        resp2 = client.get(
            "/api/v1/timetables/my-schedules",
            headers={"X-User-Id": "user-456"},
        )
        assert resp2.json() == []


class TestClaim:
    def test_without_header_returns_401(self, client, fixture_config):
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]
        resp = client.post("/api/v1/timetables/claim", json={"short_code": code})
        assert resp.status_code == 401

    def test_claim_guest_timetable(self, client, fixture_config):
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]

        resp = client.post(
            "/api/v1/timetables/claim",
            json={"short_code": code},
            headers={"X-User-Id": "user-abc"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == "user-abc"
        assert body["short_code"] == code

    def test_claim_already_claimed_returns_404(self, client, fixture_config):
        save_resp = client.post(
            "/api/v1/timetables/generate-and-save",
            json=_make_generate_payload(fixture_config),
        )
        code = save_resp.json()["short_code"]

        # First claim succeeds
        client.post(
            "/api/v1/timetables/claim",
            json={"short_code": code},
            headers={"X-User-Id": "user-1"},
        )
        # Second claim by different user fails
        resp = client.post(
            "/api/v1/timetables/claim",
            json={"short_code": code},
            headers={"X-User-Id": "user-2"},
        )
        assert resp.status_code == 404

    def test_claim_nonexistent_returns_404(self, client):
        resp = client.post(
            "/api/v1/timetables/claim",
            json={"short_code": "NOCODE"},
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 404


class TestD1ClientMocked:
    """Unit test D1Client.execute_query using httpx MockTransport."""

    def test_execute_query_success(self, monkeypatch):
        import httpx
        from d1_service import D1Client

        # Mock the D1 settings
        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_ACCOUNT_ID", "acct123")
        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_D1_DATABASE_ID", "db456")
        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_API_TOKEN", "token789")

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/client/v4/accounts/acct123/d1/database/db456/query"
            assert request.headers["Authorization"] == "Bearer token789"
            body = json.loads(request.content)
            assert body["sql"] == "SELECT 1"
            return httpx.Response(200, json={
                "success": True,
                "result": [{"success": True, "results": [{"hit": 1}], "meta": {"changes": 0}}],
            })

        transport = httpx.MockTransport(handler)
        client = D1Client()
        # Patch the AsyncClient to use our mock transport
        original_init = httpx.AsyncClient.__init__

        def patched_init(self, *args, **kwargs):
            kwargs["transport"] = transport
            original_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

        import asyncio
        result = asyncio.run(client.execute_query("SELECT 1"))
        assert result["results"] == [{"hit": 1}]

    def test_execute_query_api_error_raises(self, monkeypatch):
        import httpx
        from d1_service import D1Client, D1Error

        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_ACCOUNT_ID", "acct")
        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_D1_DATABASE_ID", "db")
        monkeypatch.setattr("d1_service.settings.CLOUDFLARE_API_TOKEN", "tok")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "success": False,
                "errors": [{"message": "bad request"}],
            })

        transport = httpx.MockTransport(handler)
        client = D1Client()
        original_init = httpx.AsyncClient.__init__

        def patched_init(self, *args, **kwargs):
            kwargs["transport"] = transport
            original_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

        import asyncio
        with pytest.raises(D1Error, match="bad request"):
            asyncio.run(client.execute_query("SELECT 1"))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
