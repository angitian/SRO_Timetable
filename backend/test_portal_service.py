"""Unit tests for portal logic: PIN, status, audience, matrix, calendar, Drive."""
from __future__ import annotations

import asyncio
import sys
from datetime import timedelta
from pathlib import Path

import httpx
import pytest

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from drive_client import DriveClient, DriveError, parse_drive_folder_link
from portal_service import (
    audience_labels,
    build_substitution_view,
    build_task_matrix,
    calendar_items,
    default_pin_from_phone,
    format_thai_datetime,
    hash_pin,
    infer_depts_from_lessons,
    is_pin_locked,
    now_local,
    parse_due,
    register_pin_failure,
    resolve_audience,
    submission_status,
    task_progress,
    teacher_in_audience,
    teachers_from_workspace,
    verify_pin,
)
from storage import (
    DriveStorage,
    LocalStorage,
    StorageError,
    build_display_name,
    sanitize_filename,
)


# ── Time / status ──────────────────────────────────────────────────────────

def test_parse_due_accepts_datetime_and_date_only():
    assert parse_due("2026-11-20 16:30").hour == 16
    assert parse_due("2026-11-20T16:30:00").minute == 30
    assert parse_due("2026-11-20").hour == 0
    assert parse_due("") is None
    assert parse_due(None) is None


def test_submission_status_is_late_only_after_the_deadline():
    due = "2026-11-20 16:30"
    assert submission_status(due, parse_due("2026-11-20 16:29")) == "submitted"
    assert submission_status(due, parse_due("2026-11-20 16:31")) == "late"
    assert submission_status(None, parse_due("2026-11-20 16:31")) == "submitted"


def test_format_thai_datetime_uses_buddhist_year():
    assert format_thai_datetime("2026-11-20 16:30") == "20/11/2569 16:30"
    assert format_thai_datetime(None) == ""


# ── PIN ────────────────────────────────────────────────────────────────────

def test_pin_hash_roundtrip():
    digest = hash_pin("4821")
    assert digest.startswith("$2b$")
    assert verify_pin("4821", digest)
    assert not verify_pin("4822", digest)
    assert not verify_pin("4821", None)


def test_default_pin_uses_last_four_digits():
    assert default_pin_from_phone("081-234-5678") == "5678"
    assert default_pin_from_phone("") == "0000"
    assert default_pin_from_phone(None) == "0000"
    assert default_pin_from_phone("12") == "0000"


def test_pin_locks_after_five_failures():
    teacher = {"pin_fail_count": 0, "pin_locked_until": None}
    at = now_local()
    for _ in range(4):
        teacher = {**teacher, **register_pin_failure(teacher, at)}
        assert not is_pin_locked(teacher, at)
    teacher = {**teacher, **register_pin_failure(teacher, at)}
    assert is_pin_locked(teacher, at)
    assert not is_pin_locked(teacher, at + timedelta(minutes=20))


# ── Teachers / dept inference ──────────────────────────────────────────────

def _teacher(tid: str, dept: str = "", active: bool = True) -> dict:
    return {
        "teacher_id": tid,
        "full_name": f"ครู{tid}",
        "dept": dept,
        "is_active": active,
        "prefix": "",
    }


WORKSPACE = {
    "fixtureData": {
        "teachers": [
            {"id": "T1", "name": "สมชาย"},
            {"id": "T2", "name": "นภา"},
            {"id": "T3", "name": "นศ.ฝึกสอน", "teacher_type": "trainee"},
        ],
        "subjects": [
            {"id": "S1", "name": "คณิตศาสตร์"},
            {"id": "S2", "name": "ภาษาไทย"},
        ],
        "classes": [{"id": "C1", "name": "ม.2/1"}],
        "lesson_blocks": [
            {"teacher_id": "T1", "subject_id": "S1"},
            {"teacher_id": "T1", "subject_id": "S1"},
            {"teacher_id": "T1", "subject_id": "S2"},
            {"teacher_id": "T2", "subject_id": "S2"},
        ],
        "schedule_blocks": [{
            "periods": [
                {"period_no": 1, "type": "STUDY", "start_time": "08:30", "end_time": "09:20"},
                {"period_no": 2, "type": "LUNCH", "start_time": "09:20", "end_time": "10:10"},
                {"period_no": 3, "type": "STUDY", "start_time": "10:10", "end_time": "11:00"},
            ]
        }],
    }
}


def test_infer_depts_picks_the_most_taught_subject():
    inferred = infer_depts_from_lessons(WORKSPACE["fixtureData"])
    assert inferred["T1"] == "คณิตศาสตร์"   # 2 blocks vs 1
    assert inferred["T2"] == "ภาษาไทย"


def test_teachers_from_workspace_includes_inferred_dept_and_skips_trainees():
    rows = teachers_from_workspace(WORKSPACE)
    assert [r["teacher_id"] for r in rows] == ["T1", "T2"]
    assert rows[0]["dept"] == "คณิตศาสตร์"
    both = teachers_from_workspace(WORKSPACE, include_trainees=True)
    assert [r["teacher_id"] for r in both] == ["T1", "T2", "T3"]


# ── Audience ───────────────────────────────────────────────────────────────

def test_audience_all_covers_every_active_teacher():
    resolved = resolve_audience(
        target_type="all",
        audience=[],
        teachers=[_teacher("T1"), _teacher("T2"), _teacher("T3", active=False)],
    )
    assert resolved["is_all"] is True
    assert resolved["teacher_ids"] == {"T1", "T2"}
    assert teacher_in_audience("T1", resolved)


def test_audience_dept_and_teacher_and_class():
    teachers = [_teacher("T1", "คณิตศาสตร์"), _teacher("T2", "ภาษาไทย"), _teacher("T3", "คณิตศาสตร์")]
    resolved = resolve_audience(
        target_type="custom",
        audience=[
            {"member_kind": "dept", "member_id": "คณิตศาสตร์"},
            {"member_kind": "teacher", "member_id": "T2"},
            {"member_kind": "class", "member_id": "C1"},
        ],
        teachers=teachers,
    )
    assert resolved["teacher_ids"] == {"T1", "T2", "T3"}
    assert resolved["depts"] == ["คณิตศาสตร์"]
    assert resolved["classes"] == ["C1"]

    labels = audience_labels(resolved, {"C1": "ม.2/1"})
    assert labels["classes"][0]["name"] == "ม.2/1"
    assert "คณิตศาสตร์" in labels["summary"]
    assert labels["is_all"] is False


def test_audience_ignores_unknown_teacher_ids():
    resolved = resolve_audience(
        target_type="custom",
        audience=[{"member_kind": "teacher", "member_id": "GHOST"}],
        teachers=[_teacher("T1")],
    )
    assert resolved["teacher_ids"] == set()
    assert resolved["teachers"] == []


# ── Task progress / matrix ─────────────────────────────────────────────────

SLOTS = [
    {"id": "S_A", "title": "แผนการสอน", "is_required": True, "sort_order": 0},
    {"id": "S_B", "title": "บันทึกหลังสอน", "is_required": True, "sort_order": 1},
    {"id": "S_C", "title": "ภาพกิจกรรม", "is_required": False, "sort_order": 2},
]


def _sub(slot_id: str, teacher_id: str = "T1", status: str = "submitted") -> dict:
    return {
        "id": f"sub_{slot_id}_{teacher_id}",
        "task_id": "TK1",
        "slot_id": slot_id,
        "teacher_id": teacher_id,
        "status": status,
        "submitted_at": "2026-11-15T10:00:00+07:00",
        "file_name": f"{slot_id}.pdf",
    }


def test_task_progress_complete_partial_missing():
    task = {"id": "TK1"}
    complete = task_progress(
        task=task, slots=SLOTS,
        submissions=[_sub("S_A"), _sub("S_B")], teacher_id="T1",
    )
    assert complete["status"] == "complete"
    assert complete["done"] == 2 and complete["total"] == 3

    partial = task_progress(
        task=task, slots=SLOTS, submissions=[_sub("S_A")], teacher_id="T1",
    )
    assert partial["status"] == "partial"

    # Optional slot missing does not block "complete"
    optional_only = task_progress(
        task=task, slots=SLOTS, submissions=[_sub("S_A"), _sub("S_B")], teacher_id="T1",
    )
    assert optional_only["status"] == "complete"

    missing = task_progress(task=task, slots=SLOTS, submissions=[], teacher_id="T1")
    assert missing["status"] == "missing"
    assert missing["slots"]["S_A"]["status"] == "missing"


def test_matrix_rows_have_per_slot_status():
    task = {"id": "TK1", "title": "ส่งแผน", "due_datetime": "2026-11-20 16:30"}
    teachers = [_teacher("T1"), _teacher("T2")]
    audience = resolve_audience(target_type="all", audience=[], teachers=teachers)
    matrix = build_task_matrix(
        task=task, slots=SLOTS, teachers=teachers,
        submissions=[_sub("S_A", "T1"), _sub("S_B", "T1", status="late")],
        audience=audience,
    )
    assert matrix["summary"] == {
        "total": 2, "complete": 1, "partial": 0, "missing": 1, "percent": 50,
    }
    rows = {r["teacher_id"]: r for r in matrix["rows"]}
    assert rows["T1"]["status"] == "complete"
    assert rows["T1"]["late"] is True
    assert rows["T1"]["slots"]["S_B"]["status"] == "late"
    assert rows["T2"]["status"] == "missing"


def test_matrix_marks_not_targeted_when_include_all():
    task = {"id": "TK1", "title": "x", "due_datetime": "2026-11-20 16:30"}
    teachers = [_teacher("T1", "ศิลปะ"), _teacher("T2", "ภาษาไทย")]
    audience = resolve_audience(
        target_type="custom",
        audience=[{"member_kind": "dept", "member_id": "ศิลปะ"}],
        teachers=teachers,
    )
    matrix = build_task_matrix(
        task=task, slots=SLOTS, teachers=teachers, submissions=[],
        audience=audience, include_all=True,
    )
    statuses = {r["teacher_id"]: r["status"] for r in matrix["rows"]}
    assert statuses == {"T1": "missing", "T2": "not_targeted"}
    assert matrix["summary"]["total"] == 1


# ── Calendar ───────────────────────────────────────────────────────────────

def test_calendar_items_merge_events_and_task_deadlines():
    events = [{
        "id": "E1", "title": "ประชุมครู", "event_date": "2026-11-16",
        "end_date": None, "start_time": "15:30", "end_time": "16:30",
        "all_day": False, "location": "ห้องประชุม",
    }]
    tasks = [{"id": "TK1", "title": "ส่งแผน", "due_datetime": "2026-11-17 16:30"}]
    items = calendar_items(
        events=events,
        tasks=tasks,
        event_audiences={"E1": resolve_audience(target_type="all", audience=[], teachers=[_teacher("T1")])},
        task_audiences={"TK1": resolve_audience(
            target_type="custom",
            audience=[{"member_kind": "teacher", "member_id": "T1"}],
            teachers=[_teacher("T1")],
        )},
        task_progress_by_id={"TK1": {"status": "partial", "done": 1, "total": 3}},
        teacher_id="T1",
    )
    assert [i["kind"] for i in items] == ["event", "task"]
    assert items[0]["i_attend"] is True
    assert items[1]["date"] == "2026-11-17"
    assert items[1]["status"] == "partial"


# ── Substitutions ──────────────────────────────────────────────────────────

def test_substitution_view_flattens_names_and_periods():
    daily = {
        "absences": [{"teacherId": "T1", "reason": "ลาป่วย", "periodRange": "all"}],
        "assignments": [{
            "id": "A1", "period": 3, "class_id": "C1", "subject_id": "S2",
            "original_teacher_id": "T1", "substitute_teacher_id": "T2",
        }],
        "note": "",
    }
    view = build_substitution_view(date="2026-11-16", daily=daily, workspace=WORKSPACE)
    assert view["has_data"] is True
    assert view["absences"][0]["teacher_name"] == "สมชาย"
    row = view["rows"][0]
    assert row["period_label"] == "คาบ 2 (10:10 - 11:00)"
    assert row["class_name"] == "ม.2/1"
    assert row["subject_name"] == "ภาษาไทย"
    assert row["substitute_name"] == "นภา"


def test_substitution_view_handles_empty_day():
    view = build_substitution_view(date="2026-11-16", daily=None, workspace={"fixtureData": {}})
    assert view["has_data"] is False


# ── Drive client ───────────────────────────────────────────────────────────

def test_parse_drive_folder_link_variants():
    assert parse_drive_folder_link(
        "https://drive.google.com/drive/folders/1AbCdEf?usp=sharing"
    )["folder_id"] == "1AbCdEf"
    assert parse_drive_folder_link(
        "https://drive.google.com/drive/u/2/folders/XYZ"
    )["folder_id"] == "XYZ"
    assert parse_drive_folder_link("https://drive.google.com/open?id=QRS")["folder_id"] == "QRS"
    assert parse_drive_folder_link("https://drive.google.com/drive/0Bdriveid")["drive_id"] == "0Bdriveid"
    with pytest.raises(ValueError):
        parse_drive_folder_link("https://drive.google.com/file/d/FILEID/view")
    with pytest.raises(ValueError):
        parse_drive_folder_link("")


def _drive_transport(calls: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        url = str(request.url)
        if "oauth2.googleapis.com/token" in url:
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        if url.startswith("https://www.googleapis.com/upload/drive/v3/files"):
            return httpx.Response(200, headers={"Location": "https://upload.example/session"})
        if url.startswith("https://upload.example/session"):
            return httpx.Response(200, json={
                "id": "file-1", "name": "T1_x.pdf",
                "webViewLink": "https://drive.google.com/file/d/file-1/view", "size": "4",
            })
        if request.method == "GET" and "/files/" in url and "alt=media" in url:
            return httpx.Response(200, content=b"%PDF")
        if request.method == "GET" and url.endswith("/files/folder-1"):
            return httpx.Response(200, json={"id": "folder-1", "name": "ปลายทาง"})
        if request.method == "GET" and url.endswith("/files"):
            return httpx.Response(200, json={"files": [{"id": "folder-1", "name": "sub"}]})
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404, json={"error": {"message": "not found"}})

    return httpx.MockTransport(handler)


def test_drive_upload_uses_resumable_session():
    calls: list[httpx.Request] = []
    client = DriveClient(
        refresh_token="r", client_id="c", client_secret="s",
        transport=_drive_transport(calls),
    )
    uploaded = asyncio.run(client.upload(
        filename="T1_x.pdf", content=b"%PDF", mime_type="application/pdf",
        parent_id="folder-1",
    ))
    assert uploaded.id == "file-1"
    assert uploaded.web_view_url.endswith("/file-1/view")
    assert any("uploadType=resumable" in str(c.url) for c in calls)
    init = next(c for c in calls if "upload/drive/v3/files" in str(c.url))
    assert b'"parents"' in init.content


def test_drive_invalid_grant_message_is_actionable():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    client = DriveClient(
        refresh_token="r", client_id="c", client_secret="s",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(DriveError) as exc:
        asyncio.run(client.access_token())
    assert "invalid_grant" in str(exc.value)


# ── Storage ────────────────────────────────────────────────────────────────

def test_sanitize_filename_strips_paths_and_control_chars():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("รายงาน: 1/2.pdf") == "2.pdf"
    assert sanitize_filename("รายงาน: 1.pdf") == "รายงาน_ 1.pdf"
    assert sanitize_filename("") == "file"


def test_build_display_name_prefixes_teacher():
    name = build_display_name(teacher_id="T1", full_name="สมชาย", filename="แผน.pdf")
    assert name == "T1_สมชาย_แผน.pdf"


def test_local_storage_roundtrip(tmp_path):
    storage = LocalStorage(tmp_path)

    async def run():
        stored = await storage.save(
            namespace="ABC123", subfolder="2026-11-20_งาน", filename="a.pdf",
            content=b"%PDF-1.4", mime_type="application/pdf",
        )
        assert stored.backend == "local"
        assert await storage.read(stored.key) == b"%PDF-1.4"
        assert await storage.delete(stored.key) is True
        with pytest.raises(StorageError):
            await storage.read(stored.key)

    asyncio.run(run())


def test_local_storage_rejects_path_escape(tmp_path):
    storage = LocalStorage(tmp_path)
    with pytest.raises(StorageError):
        asyncio.run(storage.read("../../secret.txt"))


class _FakeDriveClient:
    def __init__(self) -> None:
        self.uploaded: list[dict] = []

    async def ensure_folder(self, name, parent_id, drive_id=None, *, create=True):
        return "folder-1"

    async def upload(self, **kwargs):
        from drive_client import DriveFile

        self.uploaded.append(kwargs)
        return DriveFile(id="f9", name=kwargs["filename"], web_view_url="https://x", size=3)

    async def download(self, file_id):
        return b"abc"

    async def delete(self, file_id):
        return True


def test_drive_storage_requires_folder():
    storage = DriveStorage(_FakeDriveClient())
    with pytest.raises(StorageError):
        asyncio.run(storage.save(
            namespace="ABC", subfolder="s", filename="a.pdf",
            content=b"%PDF", mime_type="application/pdf", folder_id=None,
        ))


def test_drive_storage_uploads_into_subfolder():
    fake = _FakeDriveClient()
    storage = DriveStorage(fake)
    stored = asyncio.run(storage.save(
        namespace="ABC", subfolder="2026-11-20_งาน", filename="T1_x.pdf",
        content=b"%PDF", mime_type="application/pdf", folder_id="root-1",
    ))
    assert stored.backend == "drive"
    assert fake.uploaded[0]["parent_id"] == "folder-1"
