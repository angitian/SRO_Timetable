"""Tests for substitute share links (/api/v1/substitutes).

Covers: create → short_code + share_url, reuse the same code for the same
(owner, date), public fetch, 404 for unknown codes, date validation, payload
size cap, and owner-only delete.
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


def _payload(date="2026-11-03"):
    return {
        "v": 1,
        "date": date,
        "note": "ทดสอบ",
        "schoolName": "โรงเรียนทดสอบ",
        "academicYear": 2569,
        "term": 1,
        "absences": [{"teacherId": "T1", "reason": "ลาป่วย", "periodRange": "all"}],
        "assignments": [{
            "period": 2, "class_id": "C1", "subject_id": "S1",
            "original_teacher_id": "T1", "substitute_teacher_id": "T2", "role": "main",
        }],
        "daySlots": [{"class_id": "C1", "period": 2, "subject_id": "S1", "teacher_id": "T1", "co_teacher_id": None}],
        "classes": [{"id": "C1", "name": "ม.1/1"}],
        "teachers": [{"id": "T1", "name": "ครูหนึ่ง"}, {"id": "T2", "name": "ครูสอง"}],
        "subjects": [{"id": "S1", "name": "คณิตศาสตร์"}],
        "periods": [{"period_no": 2, "start_time": "09:30", "end_time": "10:20", "type": "STUDY"}],
    }


def _headers(user="guest-device-1"):
    return {"X-User-Id": user}


# ── Create / reuse ─────────────────────────────────────────────────────────

def test_share_creates_short_link(client):
    res = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["short_code"]) == 6
    assert body["share_url"].endswith(f"/view?sub={body['short_code']}")
    assert body["date"] == "2026-11-03"


def test_share_same_owner_and_date_reuses_code(client):
    first = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers(),
    ).json()
    second = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": {**_payload(), "note": "แก้ไข"}},
        headers=_headers(),
    ).json()
    assert first["short_code"] == second["short_code"]
    assert first["id"] == second["id"]

    fetched = client.get(f"/api/v1/substitutes/t/{second['short_code']}").json()
    assert fetched["payload"]["note"] == "แก้ไข"


def test_different_owner_gets_different_code(client):
    a = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers("device-a"),
    ).json()
    b = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers("device-b"),
    ).json()
    assert a["short_code"] != b["short_code"]


# ── Public fetch ───────────────────────────────────────────────────────────

def test_public_fetch_by_code(client):
    created = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers(),
    ).json()
    res = client.get(f"/api/v1/substitutes/t/{created['short_code']}")
    assert res.status_code == 200
    body = res.json()
    assert body["date"] == "2026-11-03"
    assert body["payload"]["classes"][0]["name"] == "ม.1/1"


def test_unknown_code_returns_404(client):
    assert client.get("/api/v1/substitutes/t/ZZZZZZ").status_code == 404


# ── Validation ─────────────────────────────────────────────────────────────

def test_invalid_date_returns_422(client):
    res = client.post(
        "/api/v1/substitutes/share",
        json={"date": "03-11-2026", "payload": _payload()},
        headers=_headers(),
    )
    assert res.status_code == 422


def test_payload_too_large_returns_413(client):
    big = _payload()
    big["note"] = "x" * (2 * 1024 * 1024 + 100)
    res = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": big},
        headers=_headers(),
    )
    assert res.status_code == 413


# ── Delete (owner only) ────────────────────────────────────────────────────

def test_delete_owner_only(client):
    created = client.post(
        "/api/v1/substitutes/share",
        json={"date": "2026-11-03", "payload": _payload()},
        headers=_headers("owner-device"),
    ).json()

    other = client.delete(
        f"/api/v1/substitutes/share/{created['id']}",
        headers=_headers("someone-else"),
    )
    assert other.status_code == 404

    ok = client.delete(
        f"/api/v1/substitutes/share/{created['id']}",
        headers=_headers("owner-device"),
    )
    assert ok.status_code == 200
    assert client.get(f"/api/v1/substitutes/t/{created['short_code']}").status_code == 404
