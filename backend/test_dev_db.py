"""Tests for the dev-only DB inspector (local-only, read-only metadata).

Covers: flag gate (404), loopback guard (403), overview counts, user stats/search,
timetable filters, metadata-only payloads (no config/result/workspace), and that
search input is parameterized (no SQL injection errors).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import app
from timetable_store import LocalTimetableStore, get_timetable_store


@pytest.fixture()
def temp_store(tmp_path):
    store = LocalTimetableStore(path=tmp_path / "timetables.json")

    def _override():
        return store

    app.dependency_overrides[get_timetable_store] = _override
    yield store
    app.dependency_overrides.clear()


@pytest.fixture()
def client(temp_store):
    return TestClient(app)


@pytest.fixture()
def seeded(temp_store):
    """Two users; user A has a public timetable with result, user B a private workspace-only row."""
    import asyncio

    async def _seed():
        await temp_store.upsert_user(id="sub-a", email="a@school.ac.th", name="ครูเอ")
        await temp_store.upsert_user(id="sub-b", email="b@school.ac.th", name="ครูบี")
        await temp_store.save_timetable(
            id="rec-1", short_code="AAA111", user_id="sub-a",
            title="ตาราง ม.1", academic_year=2569, term=1,
            config_json=json.dumps({"classes": [{"id": "C1", "name": "ม.1/1"}]}),
            result_json=json.dumps({"slots": [{"day": 1, "period": 1}]}),
            workspace_json=None, is_public=1,
        )
        await temp_store.save_timetable(
            id="rec-2", short_code="BBB222", user_id="sub-b",
            title="ร่าง ม.2", academic_year=2569, term=1,
            config_json=json.dumps({}),
            result_json=json.dumps({}),
            workspace_json=json.dumps({"fixtureData": {"classes": []}}),
            is_public=0,
        )

    asyncio.run(_seed())
    return temp_store


# ── Gates ──────────────────────────────────────────────────────────────────

def test_flag_off_returns_404(client, monkeypatch):
    monkeypatch.setattr(settings, "DEV_DB_INSPECTOR", False)
    assert client.get("/api/v1/dev/db/overview").status_code == 404
    assert client.get("/dev/db").status_code == 404


def test_non_loopback_returns_403(temp_store, monkeypatch):
    monkeypatch.setattr(settings, "DEV_DB_INSPECTOR", True)
    remote = TestClient(app, client=("10.1.2.3", 50000))
    assert remote.get("/api/v1/dev/db/overview").status_code == 403
    assert remote.get("/dev/db").status_code == 403


def test_page_served_locally(client, monkeypatch):
    monkeypatch.setattr(settings, "DEV_DB_INSPECTOR", True)
    res = client.get("/dev/db")
    assert res.status_code == 200
    assert "DB Inspector" in res.text


# ── Overview ───────────────────────────────────────────────────────────────

def test_overview_counts(client, seeded):
    res = client.get("/api/v1/dev/db/overview")
    assert res.status_code == 200
    body = res.json()
    assert body["users_total"] == 2
    assert body["timetables_total"] == 2
    assert body["public_total"] == 1
    assert body["private_total"] == 1
    assert body["with_result_total"] == 1
    assert body["with_workspace_total"] == 1
    assert body["first_created_at"]


# ── Users ──────────────────────────────────────────────────────────────────

def test_users_counts_and_search(client, seeded):
    body = client.get("/api/v1/dev/db/users").json()
    assert len(body) == 2
    by_email = {u["email"]: u for u in body}
    assert by_email["a@school.ac.th"]["timetables_total"] == 1
    assert by_email["b@school.ac.th"]["timetables_total"] == 1
    assert "picture" not in by_email["a@school.ac.th"]

    found = client.get("/api/v1/dev/db/users", params={"q": "ครูบี"}).json()
    assert len(found) == 1
    assert found[0]["email"] == "b@school.ac.th"


# ── Timetables ─────────────────────────────────────────────────────────────

def test_timetables_filters_and_metadata_only(client, seeded):
    all_rows = client.get("/api/v1/dev/db/timetables").json()
    assert len(all_rows) == 2
    for row in all_rows:
        assert "config" not in row and "result" not in row and "workspace" not in row
        assert set(row) >= {"id", "short_code", "title", "owner_email", "is_public", "has_result"}

    public_only = client.get("/api/v1/dev/db/timetables", params={"visibility": "public"}).json()
    assert [r["id"] for r in public_only] == ["rec-1"]

    with_result = client.get("/api/v1/dev/db/timetables", params={"has_result": "yes"}).json()
    assert [r["id"] for r in with_result] == ["rec-1"]

    no_result = client.get("/api/v1/dev/db/timetables", params={"has_result": "no"}).json()
    assert [r["id"] for r in no_result] == ["rec-2"]

    searched = client.get("/api/v1/dev/db/timetables", params={"q": "bbb222"}).json()
    assert [r["id"] for r in searched] == ["rec-2"]

    one = client.get("/api/v1/dev/db/timetables/rec-1")
    assert one.status_code == 200
    assert one.json()["title"] == "ตาราง ม.1"
    assert client.get("/api/v1/dev/db/timetables/nope").status_code == 404


def test_search_input_is_parameterized(client, seeded):
    """Quotes/SQL fragments in the query must not break the query or leak rows."""
    for q in ["' OR 1=1 --", "'; DROP TABLE timetables; --", "%"]:
        res = client.get("/api/v1/dev/db/timetables", params={"q": q})
        assert res.status_code == 200
    # Data intact after the injection attempts.
    assert len(client.get("/api/v1/dev/db/timetables").json()) == 2
