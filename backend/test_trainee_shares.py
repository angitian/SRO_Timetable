"""Tests for trainee summary share links (/api/v1/trainees/.../share).

Covers: create → short_code + share_url, reuse the same code per module,
public fetch without login, 404 for unknown codes, login/role enforcement,
payload size cap, revoke, and cleanup when the workspace is deleted.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

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
def jwt_secret(monkeypatch):
    monkeypatch.setattr("auth.settings.JWT_SECRET", "test-secret-key-for-tests")
    monkeypatch.setattr("auth.settings.JWT_ALGORITHM", "HS256")
    monkeypatch.setattr("auth.settings.JWT_EXPIRE_DAYS", 30)
    yield


def _token(user_id="owner-1", email="owner@example.com", name="Owner"):
    from auth import create_token
    return create_token(sub=user_id, email=email, name=name)


def _headers(user_id="owner-1", email="owner@example.com", name="Owner"):
    return {"Authorization": f"Bearer {_token(user_id, email, name)}"}


def _workspace_payload(title="Trainee Share Test"):
    return {
        "title": title,
        "academic_year": 2569,
        "term": 2,
        "workspace": {
            "fixtureData": {"teachers": [{"id": "T1", "name": "ครูสมชาย"}], "classes": []},
            "result": None,
            "userPlacements": {},
        },
    }


def _create_workspace(client, headers=None):
    resp = client.post(
        "/api/v1/timetables/save-workspace",
        json=_workspace_payload(),
        headers=headers or _headers(),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _module_data():
    return {
        "schemaVersion": 1,
        "reference": {"teachers": [{"id": "T1", "name": "ครูสมชาย"}], "academicYear": 2569, "term": 2},
        "trainees": [{"id": "tr1", "name": "นางสาวทดสอบ"}],
        "attendance": {"2026-11-02": {"tr1": {"status": "present", "time": "08:00"}}},
    }


def _create_module(client, headers=None):
    ws_id = _create_workspace(client, headers)
    saved = client.put(
        f"/api/v1/trainees/{ws_id}",
        json={"data": _module_data(), "base_version": 0},
        headers=headers or _headers(),
    )
    assert saved.status_code == 200, saved.text
    return ws_id


def _share_payload(name="นางสาวทดสอบ"):
    return {
        "v": 1,
        "timetableId": "ignored-by-test",
        "title": "โมดูลทดสอบ",
        "reference": {"academicYear": 2569, "term": 2},
        "trainees": [{"id": "tr1", "name": name, "studentCode": "6501"}],
        "attendance": {"2026-11-02": {"tr1": {"status": "present", "time": "08:00"}}},
        "settings": {"schoolName": "โรงเรียนทดสอบ", "termLabel": "ภาคเรียนที่ 2/2569"},
        "defaultType": "month",
        "dateKey": "2026-11-02",
    }


# ── Create / reuse ─────────────────────────────────────────────────────────

def test_share_creates_short_link(client, jwt_secret):
    ws_id = _create_module(client)
    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["short_code"]) == 6
    assert body["share_url"].endswith(f"/view?tr={body['short_code']}")
    assert body["timetable_id"] == ws_id


def test_share_same_module_reuses_code_and_updates_payload(client, jwt_secret):
    ws_id = _create_module(client)
    first = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    ).json()
    second = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload("ชื่อใหม่")},
        headers=_headers(),
    ).json()

    assert first["short_code"] == second["short_code"]
    assert first["id"] == second["id"]

    fetched = client.get(f"/api/v1/trainees/share/{second['short_code']}")
    assert fetched.status_code == 200
    assert fetched.json()["payload"]["trainees"][0]["name"] == "ชื่อใหม่"


def test_get_share_returns_existing_link(client, jwt_secret):
    ws_id = _create_module(client)
    empty = client.get(f"/api/v1/trainees/{ws_id}/share", headers=_headers())
    assert empty.status_code == 200, empty.text
    assert empty.json()["share"] is None

    created = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    ).json()
    existing = client.get(f"/api/v1/trainees/{ws_id}/share", headers=_headers())
    assert existing.status_code == 200
    assert existing.json()["share"]["short_code"] == created["short_code"]


# ── Public fetch ───────────────────────────────────────────────────────────

def test_public_fetch_by_code_needs_no_login(client, jwt_secret):
    ws_id = _create_module(client)
    created = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    ).json()
    res = client.get(f"/api/v1/trainees/share/{created['short_code']}")
    assert res.status_code == 200
    body = res.json()
    assert body["timetable_id"] == ws_id
    assert body["payload"]["trainees"][0]["studentCode"] == "6501"
    assert body["payload"]["settings"]["schoolName"] == "โรงเรียนทดสอบ"


def test_unknown_code_returns_404(client):
    assert client.get("/api/v1/trainees/share/ZZZZZZ").status_code == 404


# ── Auth / roles ───────────────────────────────────────────────────────────

def test_guest_cannot_share(client, jwt_secret):
    ws_id = _create_module(client)
    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers={"X-User-Id": "guest-device-1"},
    )
    assert res.status_code == 403


def test_no_identity_cannot_share(client, jwt_secret):
    ws_id = _create_module(client)
    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
    )
    assert res.status_code == 401


def test_viewer_cannot_share(client, jwt_secret):
    ws_id = _create_module(client)
    owner_headers = _headers()
    viewer_headers = _headers("viewer-1", "viewer@example.com", "Viewer")
    added = client.put(
        f"/api/v1/trainees/{ws_id}/members",
        json={"members": [{"email": "viewer@example.com", "role": "viewer"}]},
        headers=owner_headers,
    )
    assert added.status_code == 200, added.text

    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=viewer_headers,
    )
    assert res.status_code == 403


def test_editor_can_share(client, jwt_secret):
    ws_id = _create_module(client)
    owner_headers = _headers()
    editor_headers = _headers("editor-1", "editor@example.com", "Editor")
    added = client.put(
        f"/api/v1/trainees/{ws_id}/members",
        json={"members": [{"email": "editor@example.com", "role": "editor"}]},
        headers=owner_headers,
    )
    assert added.status_code == 200, added.text

    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=editor_headers,
    )
    assert res.status_code == 200, res.text


def test_non_member_cannot_share(client, jwt_secret):
    ws_id = _create_module(client)
    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers("stranger-1", "stranger@example.com", "Stranger"),
    )
    assert res.status_code == 403


# ── Validation ─────────────────────────────────────────────────────────────

def test_payload_too_large_returns_413(client, jwt_secret):
    ws_id = _create_module(client)
    big = _share_payload()
    big["note"] = "x" * (2 * 1024 * 1024 + 100)
    res = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": big},
        headers=_headers(),
    )
    assert res.status_code == 413


# ── Revoke / cleanup ───────────────────────────────────────────────────────

def test_revoke_makes_public_link_404(client, jwt_secret):
    ws_id = _create_module(client)
    created = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    ).json()

    deleted = client.delete(f"/api/v1/trainees/{ws_id}/share", headers=_headers())
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True
    assert client.get(f"/api/v1/trainees/share/{created['short_code']}").status_code == 404


def test_deleting_workspace_removes_share(client, jwt_secret):
    ws_id = _create_module(client)
    created = client.post(
        f"/api/v1/trainees/{ws_id}/share",
        json={"payload": _share_payload()},
        headers=_headers(),
    ).json()

    assert client.delete(f"/api/v1/timetables/workspace/{ws_id}", headers=_headers()).status_code == 200
    assert client.get(f"/api/v1/trainees/share/{created['short_code']}").status_code == 404
