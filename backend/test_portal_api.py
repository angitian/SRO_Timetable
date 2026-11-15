"""End-to-end API tests for the portal module (activities + submission tasks)."""
from __future__ import annotations

import asyncio
import io
import json
import sys
import zipfile
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from auth import create_token
from config import settings
from main import app
from portal_service import now_local
from portal_store import LocalPortalStore, get_portal_store
from timetable_store import LocalTimetableStore, get_timetable_store

OWNER_ID = "google-owner-1"
OWNER_EMAIL = "owner@school.ac.th"
OTHER_ID = "google-other-2"
CODE = "ABC123"
TT_ID = "tt-portal-1"


def _iso(hours_from_now: int) -> str:
    moment = now_local() + timedelta(hours=hours_from_now)
    return moment.strftime("%Y-%m-%d %H:%M")


WORKSPACE = {
    "fixtureData": {
        "teachers": [
            {"id": "T1", "name": "สมชาย ใจดี"},
            {"id": "T2", "name": "นภา รักสอน"},
            {"id": "T3", "name": "มาลี แสงทอง"},
            {"id": "T9", "name": "นศ.ฝึกสอน", "teacher_type": "trainee"},
        ],
        "classes": [{"id": "C1", "name": "ม.2/1"}, {"id": "C2", "name": "ม.2/2"}],
        "subjects": [{"id": "S1", "name": "คณิตศาสตร์"}, {"id": "S2", "name": "ภาษาไทย"}],
        "lesson_blocks": [
            {"teacher_id": "T1", "subject_id": "S1", "class_id": "C1", "periods_per_week": 4},
            {"teacher_id": "T2", "subject_id": "S2", "class_id": "C2", "periods_per_week": 4},
        ],
        "schedule_blocks": [{
            "periods": [
                {"period_no": 1, "type": "STUDY", "start_time": "08:30", "end_time": "09:20"},
                {"period_no": 2, "type": "STUDY", "start_time": "09:20", "end_time": "10:10"},
            ]
        }],
    },
    "dailySchedules": {
        "2026-11-16": {
            "date": "2026-11-16",
            "absences": [{"teacherId": "T1", "reason": "ลาป่วย", "periodRange": "all"}],
            "assignments": [{
                "id": "A1", "day": 1, "period": 1, "class_id": "C1", "subject_id": "S1",
                "original_teacher_id": "T1", "substitute_teacher_id": "T2",
            }],
            "note": "",
        }
    },
}


@pytest.fixture()
def portal(tmp_path, monkeypatch):
    store = LocalTimetableStore(path=tmp_path / "timetables.json")
    pstore = LocalPortalStore(tmp_path / "portal")
    uploads = tmp_path / "uploads"

    monkeypatch.setattr(settings, "JWT_SECRET", "test-secret-0123456789abcdef0123456789abcdef")
    monkeypatch.setattr(settings, "PORTAL_STORAGE", "local")
    monkeypatch.setattr(settings, "PORTAL_UPLOAD_DIR", str(uploads))
    monkeypatch.setattr(settings, "PORTAL_MAX_UPLOAD_MB", 1)

    asyncio.run(store.save_timetable(
        id=TT_ID, short_code=CODE, user_id=OWNER_ID, title="โรงเรียนทดสอบ",
        academic_year=2569, term=1, config_json="{}", result_json="{}",
        workspace_json=json.dumps(WORKSPACE, ensure_ascii=False), is_public=1,
    ))
    asyncio.run(pstore.upsert_config(TT_ID, {"is_published": 1, "school_name": "โรงเรียนทดสอบ"}))

    app.dependency_overrides[get_timetable_store] = lambda: store
    app.dependency_overrides[get_portal_store] = lambda: pstore
    client = TestClient(app)
    yield {"client": client, "store": store, "pstore": pstore, "uploads": uploads}
    app.dependency_overrides.clear()


def _auth(user_id: str = OWNER_ID, email: str = OWNER_EMAIL) -> dict:
    return {"Authorization": f"Bearer {create_token(user_id, email, 'Owner')}"}


def _setup(client: TestClient) -> None:
    """Open the teacher tab once (auto-sync) and give T1 a phone → default PIN 5678."""
    res = client.get(f"/api/v1/portal/{CODE}/admin/teachers", headers=_auth())
    assert res.status_code == 200, res.text
    res = client.put(
        f"/api/v1/portal/{CODE}/admin/teachers/T1",
        json={"phone": "081-234-5678"},
        headers=_auth(),
    )
    assert res.status_code == 200, res.text


def _create_event(client: TestClient, **overrides) -> dict:
    payload = {
        "title": "ประชุมครู",
        "event_date": now_local().date().isoformat(),
        "start_time": "15:30",
        "end_time": "16:30",
        "all_day": False,
        "location": "ห้องประชุม 1",
        **overrides,
    }
    res = client.post(f"/api/v1/portal/{CODE}/admin/events", json=payload, headers=_auth())
    assert res.status_code == 200, res.text
    return res.json()["event"]


def _create_task(client: TestClient, *, hours: int = 24, allow_late: bool = True,
                 target_type: str = "all", audience: list[dict] | None = None,
                 slots: list[dict] | None = None, title: str = "ส่งแผนการสอน") -> dict:
    payload = {
        "title": title,
        "due_datetime": _iso(hours),
        "allow_late": allow_late,
        "target_type": target_type,
        "audience": audience or [],
        "slots": slots or [
            {"title": "แผนการสอน", "is_required": True},
            {"title": "บันทึกหลังสอน", "is_required": True},
        ],
    }
    res = client.post(f"/api/v1/portal/{CODE}/admin/tasks", json=payload, headers=_auth())
    assert res.status_code == 200, res.text
    return res.json()


def _upload(client: TestClient, *, task_id: str, slot_id: str, teacher_id: str = "T1",
            pin: str = "5678", filename: str = "plan.pdf", content: bytes = b"%PDF-1.4 test"):
    return client.post(
        f"/api/v1/portal/{CODE}/submissions",
        data={"teacher_id": teacher_id, "task_id": task_id, "slot_id": slot_id, "pin": pin},
        files={"file": (filename, content, "application/pdf")},
    )


# ── Bootstrap ──────────────────────────────────────────────────────────────

def test_bootstrap_hidden_until_published(portal):
    client, pstore = portal["client"], portal["pstore"]
    asyncio.run(pstore.upsert_config(TT_ID, {"is_published": 0}))
    res = client.get(f"/api/v1/portal/{CODE}")
    assert res.status_code == 404
    assert "ยังไม่เปิดใช้งาน" in res.json()["detail"]


def test_bootstrap_has_teachers_classes_without_secrets(portal):
    client = portal["client"]
    _setup(client)
    body = client.get(f"/api/v1/portal/{CODE}").json()
    assert [t["teacher_id"] for t in body["teachers"]] == ["T1", "T2", "T3"]  # trainee excluded
    assert body["classes"] == [
        {"class_id": "C1", "name": "ม.2/1"},
        {"class_id": "C2", "name": "ม.2/2"},
    ]
    assert "pin_hash" not in body["teachers"][0]
    assert "phone" not in body["teachers"][0]
    assert body["workspace"]["school_name"] == "โรงเรียนทดสอบ"


# ── Teachers: auto-sync + infer depts ──────────────────────────────────────

def test_teacher_registry_auto_syncs_and_infers_dept(portal):
    client = portal["client"]
    res = client.get(f"/api/v1/portal/{CODE}/admin/teachers", headers=_auth())
    assert res.status_code == 200
    body = res.json()
    assert body["synced_now"] is True
    assert len(body["teachers"]) == 3
    depts = {t["teacher_id"]: t["dept"] for t in body["teachers"]}
    assert depts["T1"] == "คณิตศาสตร์"
    assert depts["T2"] == "ภาษาไทย"

    # Second read must not re-sync
    again = client.get(f"/api/v1/portal/{CODE}/admin/teachers", headers=_auth()).json()
    assert again["synced_now"] is False


def test_infer_depts_fills_only_empty_departments(portal):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    asyncio.run(pstore.update_teacher(TT_ID, "T1", {"dept": ""}))
    res = client.post(f"/api/v1/portal/{CODE}/admin/teachers/infer-depts", headers=_auth())
    assert res.status_code == 200
    assert res.json()["updated"] == 1
    teacher = asyncio.run(pstore.get_teacher(TT_ID, "T1"))
    assert teacher["dept"] == "คณิตศาสตร์"
    # T2 already had a dept → untouched
    assert asyncio.run(pstore.get_teacher(TT_ID, "T2"))["dept"] == "ภาษาไทย"


# ── School events ──────────────────────────────────────────────────────────

def test_create_event_with_audience_and_read_detail(portal):
    client = portal["client"]
    _setup(client)
    event = _create_event(
        client,
        target_type="custom",
        audience=[
            {"member_kind": "dept", "member_id": "คณิตศาสตร์"},
            {"member_kind": "teacher", "member_id": "T2"},
            {"member_kind": "class", "member_id": "C1"},
        ],
    )

    detail = client.get(
        f"/api/v1/portal/{CODE}/events/{event['id']}", params={"teacher_id": "T1"}
    )
    assert detail.status_code == 200
    body = detail.json()
    assert body["event"]["location"] == "ห้องประชุม 1"
    assert body["i_attend"] is True
    assert body["audience"]["classes"][0]["name"] == "ม.2/1"
    assert {t["teacher_id"] for t in body["audience"]["teachers"]} == {"T1", "T2"}

    outsider = client.get(
        f"/api/v1/portal/{CODE}/events/{event['id']}", params={"teacher_id": "T3"}
    ).json()
    assert outsider["i_attend"] is False


def test_event_creation_notifies_audience(portal):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    res = client.post(
        f"/api/v1/portal/{CODE}/admin/events",
        json={
            "title": "อบรม",
            "event_date": now_local().date().isoformat(),
            "target_type": "custom",
            "audience": [{"member_kind": "dept", "member_id": "ภาษาไทย"}],
        },
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["notified"] == 1  # only T2
    inbox = asyncio.run(pstore.list_notifications(TT_ID, "T2"))
    assert inbox[0]["kind"] == "event_new"


# ── Submission tasks ───────────────────────────────────────────────────────

def test_create_task_with_slots(portal):
    client = portal["client"]
    _setup(client)
    body = _create_task(client)
    assert [s["title"] for s in body["slots"]] == ["แผนการสอน", "บันทึกหลังสอน"]
    assert body["notified"] == 3

    tasks = client.get(f"/api/v1/portal/{CODE}/tasks", params={"teacher_id": "T1"}).json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["progress"]["status"] == "missing"
    assert len(tasks[0]["slots"]) == 2


def test_task_requires_at_least_one_slot(portal):
    client = portal["client"]
    _setup(client)
    res = client.post(
        f"/api/v1/portal/{CODE}/admin/tasks",
        json={"title": "ว่าง", "due_datetime": _iso(24), "slots": []},
        headers=_auth(),
    )
    assert res.status_code == 422


def test_calendar_merges_events_and_task_deadlines(portal):
    client = portal["client"]
    _setup(client)
    _create_event(client)
    _create_task(client)

    res = client.get(f"/api/v1/portal/{CODE}/calendar", params={"teacher_id": "T1"})
    assert res.status_code == 200
    kinds = [i["kind"] for i in res.json()["items"]]
    assert kinds == ["event", "task"]
    task_item = next(i for i in res.json()["items"] if i["kind"] == "task")
    assert task_item["status"] == "missing"
    assert task_item["i_attend"] is True


# ── Upload per slot ────────────────────────────────────────────────────────

def test_upload_into_one_slot(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    slot = task["slots"][0]

    res = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "submitted"
    assert body["receipt"]["slot_title"] == "แผนการสอน"
    assert body["progress"]["status"] == "partial"
    assert body["progress"]["done"] == 1

    # Second slot completes the task
    second = _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][1]["id"],
                     filename="note.pdf")
    assert second.json()["progress"]["status"] == "complete"


def test_upload_requires_pin_and_locks_after_five_failures(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    slot = task["slots"][0]

    bad = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"], pin="0000")
    assert bad.status_code == 401

    for _ in range(4):
        _upload(client, task_id=task["task"]["id"], slot_id=slot["id"], pin="9999")
    locked = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"], pin="5678")
    assert locked.status_code == 429


def test_teacher_without_pin_gets_409(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    res = _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"],
                  teacher_id="T2", pin="1234")
    assert res.status_code == 409


def test_upload_rejects_slot_from_another_task(portal):
    client = portal["client"]
    _setup(client)
    task_a = _create_task(client, title="งาน A")
    task_b = _create_task(client, title="งาน B")
    res = _upload(client, task_id=task_a["task"]["id"], slot_id=task_b["slots"][0]["id"])
    assert res.status_code == 404


def test_upload_blocked_when_not_in_audience(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(
        client, target_type="custom",
        audience=[{"member_kind": "dept", "member_id": "ภาษาไทย"}],
    )
    res = _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"],
                  teacher_id="T1")
    assert res.status_code == 403


def test_late_upload_marked_late_and_blocked_when_disallowed(portal):
    client = portal["client"]
    _setup(client)
    late_task = _create_task(client, hours=-3, title="สาย")
    res = _upload(client, task_id=late_task["task"]["id"], slot_id=late_task["slots"][0]["id"])
    assert res.status_code == 200
    assert res.json()["status"] == "late"

    blocked = _create_task(client, hours=-3, allow_late=False, title="ปิดรับ")
    res2 = _upload(client, task_id=blocked["task"]["id"], slot_id=blocked["slots"][0]["id"])
    assert res2.status_code == 403
    assert "เลยกำหนด" in res2.json()["detail"]


def test_upload_validates_extension_and_size(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    slot = task["slots"][0]

    bad_ext = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"],
                      filename="virus.exe", content=b"MZ")
    assert bad_ext.status_code == 415

    huge = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"],
                   content=b"%PDF" + b"0" * (1024 * 1024 + 10))
    assert huge.status_code == 413


def test_slot_extension_whitelist_is_enforced(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client, slots=[
        {"title": "เฉพาะ PDF", "is_required": True, "allowed_ext": ".pdf"},
    ])
    res = _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"],
                  filename="plan.docx", content=b"PK\x03\x04docx")
    assert res.status_code == 415


def test_resubmission_bumps_revision_and_keeps_history(portal):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    task = _create_task(client)
    slot = task["slots"][0]

    _upload(client, task_id=task["task"]["id"], slot_id=slot["id"])
    second = _upload(client, task_id=task["task"]["id"], slot_id=slot["id"],
                     filename="plan_v2.pdf", content=b"%PDF-1.4 v2")
    assert second.json()["receipt"]["revision"] == 2

    history = asyncio.run(pstore.list_history(TT_ID, task["task"]["id"], "T1"))
    assert len(history) == 1
    assert history[0]["file_name"] == "plan.pdf"


def test_my_submissions_lists_task_and_slot_titles(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])

    res = client.get(f"/api/v1/portal/{CODE}/submissions", params={"teacher_id": "T1"})
    rows = res.json()["submissions"]
    assert len(rows) == 1
    assert rows[0]["task_title"] == "ส่งแผนการสอน"
    assert rows[0]["slot_title"] == "แผนการสอน"
    assert "storage_key" not in rows[0]


# ── Admin matrix / exports ─────────────────────────────────────────────────

def test_admin_endpoints_require_owner_or_editor(portal):
    client = portal["client"]
    task = _create_task(client)
    url = f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/matrix"

    assert client.get(url).status_code == 401
    assert client.get(url, headers=_auth(OTHER_ID, "x@y.z")).status_code == 403


def test_matrix_reports_partial_and_missing(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])

    res = client.get(
        f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/matrix", headers=_auth()
    )
    assert res.status_code == 200
    body = res.json()
    assert body["summary"] == {
        "total": 3, "complete": 0, "partial": 1, "missing": 2, "percent": 0,
    }
    rows = {r["teacher_id"]: r for r in body["rows"]}
    assert rows["T1"]["status"] == "partial"
    assert rows["T1"]["slots"][task["slots"][0]["id"]]["status"] == "submitted"
    assert rows["T2"]["status"] == "missing"
    assert [s["title"] for s in body["slots"]] == ["แผนการสอน", "บันทึกหลังสอน"]


def test_export_xlsx_and_zip_include_slots(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])

    xlsx = client.get(
        f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/export.xlsx", headers=_auth()
    )
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"
    assert "spreadsheetml" in xlsx.headers["content-type"]

    bundle = client.get(
        f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/download-zip", headers=_auth()
    )
    assert bundle.status_code == 200
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        names = archive.namelist()
    assert len(names) == 1
    assert names[0].startswith("T1_สมชาย ใจดี/แผนการสอน/")
    assert names[0].endswith("plan.pdf")


def test_download_single_file(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    submission = _upload(
        client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"]
    ).json()["submission"]

    res = client.get(
        f"/api/v1/portal/{CODE}/admin/submissions/{submission['id']}/file", headers=_auth()
    )
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF")


def test_admin_config_publish_toggle(portal):
    client, pstore = portal["client"], portal["pstore"]
    res = client.put(
        f"/api/v1/portal/{CODE}/admin/config",
        json={"is_published": False, "school_name": "รร.ใหม่"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["config"]["is_published"] is False
    assert client.get(f"/api/v1/portal/{CODE}").status_code == 404
    assert asyncio.run(pstore.get_config(TT_ID))["school_name"] == "รร.ใหม่"


def test_substitutions_read_from_workspace(portal):
    res = portal["client"].get(
        f"/api/v1/portal/{CODE}/substitutions", params={"date": "2026-11-16"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["rows"][0]["substitute_name"] == "นภา รักสอน"


def test_admin_can_reset_pin_to_phone_last_four(portal):
    client = portal["client"]
    _setup(client)
    res = client.post(
        f"/api/v1/portal/{CODE}/admin/teachers/T1/pin", json={}, headers=_auth()
    )
    assert res.status_code == 200
    assert res.json()["pin_source"] == "last4_phone"

    task = _create_task(client)
    assert _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"],
                   pin="5678").status_code == 200


def test_custom_pin_must_be_four_digits(portal):
    client = portal["client"]
    _setup(client)
    res = client.post(
        f"/api/v1/portal/{CODE}/admin/teachers/T1/pin", json={"pin": "12"}, headers=_auth()
    )
    assert res.status_code == 422
