"""Portal API — กิจกรรมโรงเรียน + งานส่งไฟล์ (ผูกกับ workspace ผ่าน short_code).

Public endpoints (no auth, gated by `portal_config.is_published`):
    GET  /{code}                        bootstrap (school + teachers + classes + today)
    GET  /{code}/calendar               กิจกรรม + กำหนดส่งงาน (ทั้งโรงเรียน)
    GET  /{code}/events/{event_id}      รายละเอียดกิจกรรม + ผู้เข้าร่วม
    GET  /{code}/tasks?teacher_id=      งานของครู + กล่อง + สถานะ
    POST /{code}/submissions            อัปโหลดไฟล์เข้าทีละกล่อง (multipart + PIN)
    GET  /{code}/submissions?teacher_id= ไฟล์ที่ส่งแล้ว
    GET  /{code}/substitutions?date=    ตารางสอนแทนของวัน
    GET  /{code}/notifications…         กล่องแจ้งเตือน

Admin endpoints (Google JWT + workspace role owner/editor):
    events CRUD, tasks CRUD (slots + audience), matrix, xlsx/zip export,
    remind, teachers (auto-sync + infer depts + PIN), config, Drive.
"""
from __future__ import annotations

import io
import os
import secrets
import tempfile
import zipfile
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from auth import UserIdentity, get_identity
from config import settings
from drive_client import DriveError, parse_drive_folder_link
from permissions import resolve_workspace_role, team_default_for
from portal_service import (
    audience_labels,
    build_substitution_view,
    build_task_matrix,
    calendar_items,
    default_pin_from_phone,
    event_created_notifications,
    format_thai_datetime,
    hash_pin,
    incomplete_rows,
    infer_depts_from_lessons,
    is_due_passed,
    is_pin_locked,
    is_valid_pin,
    normalize_audience,
    normalize_pin,
    now_local,
    notification_row,
    post_webhook,
    public_event,
    public_slot,
    public_submission,
    public_task,
    public_teacher,
    register_pin_failure,
    reminder_message,
    reminder_notifications,
    resolve_audience,
    submission_status,
    task_created_notifications,
    task_progress,
    teacher_display_name,
    teacher_in_audience,
    teachers_from_workspace,
    verify_pin,
    webhook_payload,
)
from portal_store import get_portal_store
from storage import (
    StorageError,
    build_display_name,
    checksum,
    get_storage,
    guess_mime,
    sanitize_filename,
    storage_warning,
)
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/portal", tags=["portal"])

MAX_ZIP_BYTES = 500 * 1024 * 1024
DEFAULT_WINDOW_DAYS = 60

# OAuth state for the Drive connect flow (single instance, like auth.py).
_DRIVE_STATES: dict[str, str] = {}


# ── Helpers ────────────────────────────────────────────────────────────────

def _portal_url(code: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/portal?w={code}"


def _admin_url(code: str, **params: str) -> str:
    base = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/admin?w={code}"
    return f"{base}&{urlencode(params)}" if params else base


def _drive_redirect_uri() -> str:
    return f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/v1/portal/drive/callback"


async def _load_workspace(store: Any, code: str, *, include_private: bool = True) -> dict:
    record = await store.get_workspace_by_short_code(code, include_private=include_private)
    if not record:
        raise HTTPException(status_code=404, detail="ไม่พบลิงก์พอร์ทัลนี้")
    return record


async def _load_public(code: str, store: Any, pstore: Any) -> tuple[dict, dict]:
    record = await _load_workspace(store, code)
    config = await pstore.get_config(record["id"]) or {
        "timetable_id": record["id"],
        "is_published": False,
        "school_name": "",
        "late_policy": "allow",
        "drive_folder_id": None,
        "drive_drive_id": None,
        "drive_folder_url": None,
        "webhook_url": None,
    }
    if not config.get("is_published"):
        raise HTTPException(
            status_code=404,
            detail="พอร์ทัลนี้ยังไม่เปิดใช้งาน — ให้ฝ่ายวิชาการกด 'เผยแพร่พอร์ทัล' ก่อน",
        )
    return record, config


async def _resolve_role(store: Any, record: dict, identity: UserIdentity) -> str | None:
    members = await store.get_workspace_members(record["id"])
    team = await store.get_team_members(record.get("user_id")) if record.get("user_id") else []
    team_default = team_default_for(team, record.get("user_id"), identity.email)
    return resolve_workspace_role(
        record=record,
        members=members,
        team_default=team_default,
        user_id=identity.user_id,
        email=identity.email,
        access_mode=record.get("access_mode"),
    )


async def require_portal_admin(
    code: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> dict:
    """Dependency: caller must be owner/editor of the workspace behind `code`."""
    record = await _load_workspace(store, code)
    if not identity.is_authenticated:
        raise HTTPException(status_code=403, detail="ต้องเข้าสู่ระบบด้วย Google ก่อนจัดการพอร์ทัล")
    if not record.get("user_id"):
        raise HTTPException(
            status_code=403,
            detail="workspace นี้ยังไม่มีเจ้าของ — กรุณาบันทึก workspace ด้วยบัญชี Google ก่อน",
        )
    role = await _resolve_role(store, record, identity)
    if role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์จัดการพอร์ทัลของ workspace นี้")
    return record


def _workspace_fixture(record: dict) -> dict:
    return ((record.get("workspace") or {}).get("fixtureData") or {})


def _workspace_periods(record: dict) -> list[dict]:
    blocks = _workspace_fixture(record).get("schedule_blocks") or []
    return (blocks[0].get("periods") if blocks else []) or []


def _workspace_classes(record: dict) -> list[dict]:
    return [
        {"class_id": str(c.get("id")), "name": str(c.get("name") or c.get("id"))}
        for c in (_workspace_fixture(record).get("classes") or [])
    ]


async def _daily_schedule(workspace: dict | None, pstore: Any, record: dict, date: str) -> dict | None:
    daily = ((workspace or {}).get("dailySchedules") or {}).get(date)
    if daily:
        return daily
    return await pstore.find_substitute_payload(record["id"], record.get("user_id"), date)


def _read_upload(upload: UploadFile, max_bytes: int) -> bytes:
    """Blocking read with a hard size cap (raises 413)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = upload.file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"ไฟล์ใหญ่เกินกำหนด (สูงสุด {max_bytes // 1024 // 1024} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _validate_file(filename: str, content: bytes, allowed_ext: str | None = None) -> str:
    allowed = [
        e.strip().lower()
        for e in (allowed_ext or settings.PORTAL_ALLOWED_EXT).split(",")
        if e.strip()
    ]
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"ชนิดไฟล์ไม่รองรับสำหรับกล่องนี้ (อนุญาต: {', '.join(allowed)})",
        )
    if not content:
        raise HTTPException(status_code=400, detail="ไฟล์ว่าง")
    if ext == ".pdf" and not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="ไฟล์ .pdf ไม่ถูกต้อง")
    if ext in (".docx", ".xlsx", ".zip") and not content.startswith(b"PK"):
        raise HTTPException(status_code=400, detail=f"ไฟล์ {ext} ไม่ถูกต้อง")
    return ext


async def _save_audience(
    pstore: Any, kind: str, activity_id: str, target_type: str, audience: list[dict]
) -> None:
    if (target_type or "all") == "all":
        await pstore.set_audience(kind, activity_id, [])
        return
    await pstore.set_audience(kind, activity_id, normalize_audience(audience))


async def _audience_for(
    pstore: Any, kind: str, activity: dict, teachers: list[dict]
) -> dict:
    rows = await pstore.get_audience(kind, activity["id"])
    return resolve_audience(
        target_type=activity.get("target_type") or "all",
        audience=rows,
        teachers=teachers,
    )


async def _sync_teachers(record: dict, pstore: Any, include_trainees: bool = False) -> dict:
    rows = teachers_from_workspace(record.get("workspace"), include_trainees=include_trainees)
    if not rows:
        return {"upserted": 0, "deactivated": 0, "total": 0, "empty": True}
    upserted = await pstore.upsert_teachers(record["id"], rows)
    deactivated = await pstore.deactivate_missing(record["id"], [r["teacher_id"] for r in rows])
    total = len(await pstore.list_teachers(record["id"], active_only=False))
    return {"upserted": upserted, "deactivated": deactivated, "total": total, "empty": False}


# ── Request bodies ─────────────────────────────────────────────────────────

class AudienceMember(BaseModel):
    member_kind: str = Field(description="teacher | class | dept")
    member_id: str


class EventPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    event_date: str = Field(min_length=10, max_length=10, description="YYYY-MM-DD")
    end_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    all_day: bool = True
    location: str | None = None
    target_type: str = "all"
    audience: list[AudienceMember] = Field(default_factory=list)
    is_published: bool = True


class SlotPayload(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    is_required: bool = True
    allowed_ext: str | None = None
    max_mb: int | None = None
    sort_order: int | None = None


class TaskPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    open_at: str | None = None
    due_datetime: str = Field(min_length=10, description="YYYY-MM-DD HH:MM")
    allow_late: bool = True
    is_published: bool = True
    target_type: str = "all"
    audience: list[AudienceMember] = Field(default_factory=list)
    slots: list[SlotPayload] = Field(default_factory=list)


class TeacherPayload(BaseModel):
    prefix: str | None = None
    full_name: str | None = None
    dept: str | None = None
    phone: str | None = None
    is_active: bool | None = None
    pin: str | None = None


class PinPayload(BaseModel):
    pin: str | None = None


class ConfigPayload(BaseModel):
    school_name: str | None = None
    is_published: bool | None = None
    drive_folder_url: str | None = None
    webhook_url: str | None = None
    late_policy: str | None = None


class RemindPayload(BaseModel):
    send_webhook: bool = True
    copy_only: bool = False


# ── Public: bootstrap / calendar ───────────────────────────────────────────

@router.get("/{code}")
async def portal_bootstrap(
    code: str,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, config = await _load_public(code, store, pstore)
    teachers = await pstore.list_teachers(record["id"])
    moment = now_local()
    return {
        "workspace": {
            "short_code": record.get("short_code"),
            "title": record.get("title"),
            "school_name": config.get("school_name") or record.get("title") or "",
        },
        "today": moment.date().isoformat(),
        "server_time": moment.isoformat(timespec="seconds"),
        "late_policy": config.get("late_policy") or "allow",
        "teachers": [public_teacher(t) for t in teachers],
        "classes": _workspace_classes(record),
        "depts": sorted({(t.get("dept") or "").strip() for t in teachers if (t.get("dept") or "").strip()}),
    }


@router.get("/{code}/calendar")
async def portal_calendar(
    code: str,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    teacher_id: str | None = None,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    timetable_id = record["id"]
    moment = now_local()
    start = from_date or moment.date().replace(day=1).isoformat()
    end = to_date or (moment + timedelta(days=DEFAULT_WINDOW_DAYS)).date().isoformat()

    events = await pstore.list_events(timetable_id, from_date=start, to_date=end)
    tasks = await pstore.list_tasks(timetable_id)
    teachers = await pstore.list_teachers(timetable_id)
    all_slots = await pstore.list_slots(timetable_id)
    submissions = await pstore.list_submissions(timetable_id, teacher_id=teacher_id) if teacher_id else []

    event_aud = await pstore.list_audience_bulk("event", [e["id"] for e in events])
    task_aud = await pstore.list_audience_bulk("task", [t["id"] for t in tasks])

    resolved_events = {
        eid: resolve_audience(
            target_type=next((e["target_type"] for e in events if e["id"] == eid), "all"),
            audience=rows,
            teachers=teachers,
        )
        for eid, rows in event_aud.items()
    }
    resolved_tasks = {
        tid: resolve_audience(
            target_type=next((t["target_type"] for t in tasks if t["id"] == tid), "all"),
            audience=rows,
            teachers=teachers,
        )
        for tid, rows in task_aud.items()
    }
    slots_by_task: dict[str, list[dict]] = {}
    for slot in all_slots:
        slots_by_task.setdefault(slot["task_id"], []).append(slot)
    progress_by_task = {
        t["id"]: task_progress(
            task=t,
            slots=slots_by_task.get(t["id"], []),
            submissions=[s for s in submissions if s.get("task_id") == t["id"]],
            teacher_id=teacher_id,
        )
        for t in tasks
    }

    items = calendar_items(
        events=events,
        tasks=tasks,
        event_audiences=resolved_events,
        task_audiences=resolved_tasks,
        task_progress_by_id=progress_by_task,
        teacher_id=teacher_id,
    )
    items = [i for i in items if start <= (i.get("date") or "") <= end]
    return {
        "from": start,
        "to": end,
        "today": moment.date().isoformat(),
        "items": items,
    }


@router.get("/{code}/events/{event_id}")
async def portal_event_detail(
    code: str,
    event_id: str,
    teacher_id: str | None = None,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    event = await pstore.get_event(record["id"], event_id)
    if not event or not event.get("is_published", True):
        raise HTTPException(status_code=404, detail="ไม่พบกิจกรรมนี้")

    teachers = await pstore.list_teachers(record["id"])
    resolved = await _audience_for(pstore, "event", event, teachers)
    class_names = {c["class_id"]: c["name"] for c in _workspace_classes(record)}
    return {
        "event": public_event(event),
        "audience": audience_labels(resolved, class_names),
        "i_attend": teacher_in_audience(teacher_id, resolved),
    }


@router.get("/{code}/tasks")
async def portal_tasks(
    code: str,
    teacher_id: str | None = None,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    timetable_id = record["id"]
    moment = now_local()

    tasks = await pstore.list_tasks(timetable_id)
    teachers = await pstore.list_teachers(timetable_id)
    all_slots = await pstore.list_slots(timetable_id)
    submissions = await pstore.list_submissions(timetable_id, teacher_id=teacher_id) if teacher_id else []
    aud = await pstore.list_audience_bulk("task", [t["id"] for t in tasks])

    slots_by_task: dict[str, list[dict]] = {}
    for slot in all_slots:
        slots_by_task.setdefault(slot["task_id"], []).append(slot)

    items = []
    for task in tasks:
        resolved = resolve_audience(
            target_type=task.get("target_type") or "all",
            audience=aud.get(task["id"]) or [],
            teachers=teachers,
        )
        item = public_task(task, moment)
        item["slots"] = [public_slot(s) for s in slots_by_task.get(task["id"], [])]
        if teacher_id:
            if not teacher_in_audience(teacher_id, resolved):
                continue
            progress = task_progress(
                task=task,
                slots=slots_by_task.get(task["id"], []),
                submissions=submissions,
                teacher_id=teacher_id,
            )
            item["progress"] = progress
        items.append(item)
    return {"tasks": items}


@router.get("/{code}/submissions")
async def portal_my_submissions(
    code: str,
    teacher_id: str,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    rows = await pstore.list_submissions(record["id"], teacher_id=teacher_id)
    tasks = {t["id"]: t for t in await pstore.list_tasks(record["id"])}
    slots = {s["id"]: s for s in await pstore.list_slots(record["id"])}
    return {
        "submissions": [
            {
                **public_submission(s),
                "task_title": (tasks.get(s.get("task_id")) or {}).get("title"),
                "slot_title": (slots.get(s.get("slot_id")) or {}).get("title"),
            }
            for s in rows
        ]
    }


@router.get("/{code}/substitutions")
async def portal_substitutions(
    code: str,
    date: str | None = None,
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    day = date or now_local().date().isoformat()
    if len(day) != 10:
        raise HTTPException(status_code=422, detail="date ต้องเป็น YYYY-MM-DD")

    workspace = record.get("workspace") or {}
    daily = await _daily_schedule(workspace, pstore, record, day)
    view = build_substitution_view(
        date=day,
        daily=daily,
        workspace=workspace,
        periods=(daily or {}).get("periods") or _workspace_periods(record),
    )
    return view


# ── Public: upload ─────────────────────────────────────────────────────────

@router.post("/{code}/submissions")
async def portal_submit(
    code: str,
    teacher_id: str = Form(...),
    task_id: str = Form(...),
    slot_id: str = Form(...),
    pin: str = Form(...),
    note: str = Form(default=""),
    file: UploadFile = File(...),
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, config = await _load_public(code, store, pstore)
    timetable_id = record["id"]
    moment = now_local()

    teacher = await pstore.get_teacher(timetable_id, teacher_id)
    if not teacher or not teacher.get("is_active", True):
        raise HTTPException(status_code=404, detail="ไม่พบครูคนนี้ในพอร์ทัล")

    if is_pin_locked(teacher, moment):
        raise HTTPException(
            status_code=429,
            detail="กรอก PIN ผิดหลายครั้ง — กรุณาลองใหม่ภายหลังหรือติดต่อฝ่ายวิชาการ",
        )
    if not teacher.get("pin_hash"):
        raise HTTPException(
            status_code=409,
            detail="ยังไม่ได้ตั้ง PIN — กรุณาติดต่อฝ่ายวิชาการเพื่อตั้ง PIN",
        )
    if not verify_pin(normalize_pin(pin), teacher["pin_hash"]):
        await pstore.update_teacher(timetable_id, teacher_id, register_pin_failure(teacher, moment))
        raise HTTPException(status_code=401, detail="PIN ไม่ถูกต้อง")
    if teacher.get("pin_fail_count"):
        await pstore.update_teacher(
            timetable_id, teacher_id, {"pin_fail_count": 0, "pin_locked_until": None}
        )

    task = await pstore.get_task(timetable_id, task_id)
    if not task or not task.get("is_published", True):
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")

    slot = await pstore.get_slot(timetable_id, slot_id)
    if not slot or slot.get("task_id") != task_id:
        raise HTTPException(status_code=404, detail="ไม่พบกล่องรับไฟล์นี้")

    teachers = await pstore.list_teachers(timetable_id)
    resolved = await _audience_for(pstore, "task", task, teachers)
    if not teacher_in_audience(teacher_id, resolved):
        raise HTTPException(status_code=403, detail="งานนี้ไม่เปิดรับสำหรับคุณ")

    late = is_due_passed(task.get("due_datetime"), moment)
    if late and (not task.get("allow_late", True) or config.get("late_policy") == "block"):
        raise HTTPException(status_code=403, detail="เลยกำหนดส่งแล้ว — ปิดรับไฟล์สำหรับงานนี้")

    max_mb = int(slot.get("max_mb") or settings.PORTAL_MAX_UPLOAD_MB)
    filename = Path(file.filename or "file").name
    content = _read_upload(file, max(1, max_mb) * 1024 * 1024)
    _validate_file(filename, content, slot.get("allowed_ext"))

    display_name = build_display_name(
        teacher_id=teacher_id,
        full_name=teacher.get("full_name") or teacher_id,
        filename=f"{slot.get('title') or 'ไฟล์'}_{filename}",
    )
    subfolder = f"{(task.get('due_datetime') or '')[:10]}_{task.get('title')}"

    refresh_token = await pstore.get_setting("drive_refresh_token")
    storage = get_storage(refresh_token=refresh_token)
    try:
        stored = await storage.save(
            namespace=code,
            subfolder=subfolder,
            filename=display_name,
            content=content,
            mime_type=guess_mime(filename),
            folder_id=config.get("drive_folder_id"),
            drive_id=config.get("drive_drive_id"),
        )
    except StorageError as e:
        raise HTTPException(status_code=502, detail=f"เก็บไฟล์ไม่สำเร็จ: {e}")

    previous = await pstore.get_submission(timetable_id, slot_id, teacher_id)
    if previous:
        await pstore.add_history({
            **previous,
            "submission_id": previous.get("id"),
            "submitted_at": previous.get("submitted_at"),
        })
        if previous.get("storage_backend") == stored.backend:
            try:
                await storage.delete(previous["storage_key"])
            except Exception:
                pass

    status = submission_status(task.get("due_datetime"), moment)
    row = {
        "id": (previous or {}).get("id") or f"sub_{secrets.token_hex(8)}",
        "timetable_id": timetable_id,
        "task_id": task_id,
        "slot_id": slot_id,
        "teacher_id": teacher_id,
        "file_name": filename,
        "storage_backend": stored.backend,
        "storage_key": stored.key,
        "web_view_url": stored.web_view_url,
        "file_size_bytes": stored.size,
        "mime_type": stored.mime_type,
        "checksum": checksum(content),
        "submitted_at": moment.isoformat(timespec="seconds"),
        "due_at": task.get("due_datetime"),
        "status": status,
        "note": (note or "").strip()[:500],
        "revision": int((previous or {}).get("revision") or 0) + 1,
    }
    await pstore.save_submission(row)

    await pstore.add_notifications([
        notification_row(
            timetable_id=timetable_id,
            teacher_id=teacher_id,
            kind="receipt",
            title=f"ส่งไฟล์สำเร็จ: {slot.get('title')}",
            body=(
                f"{filename} • {status == 'late' and 'ส่งช้า' or 'ส่งตรงเวลา'} • "
                f"{format_thai_datetime(moment)}"
            ),
            task_id=task_id,
            link=f"{_portal_url(code)}&tab=tasks&task={task_id}",
        )
    ])

    webhook_url = config.get("webhook_url")
    if webhook_url:
        payload = webhook_payload(
            kind="submission",
            short_code=code,
            workspace_title=record.get("title") or "",
            task=task,
            event=None,
            portal_url=_portal_url(code),
            message=(
                f"{teacher.get('full_name') or teacher_id} ส่ง {slot.get('title')} "
                f"({filename}, {status}) สำหรับงาน {task.get('title')}"
            ),
            recipients=[{"teacher_id": teacher_id, "full_name": teacher.get("full_name"),
                         "dept": teacher.get("dept")}],
        )
        ok, status_text = await post_webhook(webhook_url, payload)
        await pstore.upsert_config(timetable_id, {
            "webhook_last_status": ("ok " if ok else "error ") + status_text,
            "webhook_last_at": moment.isoformat(timespec="seconds"),
        })

    progress = task_progress(
        task=task,
        slots=await pstore.list_slots(timetable_id, task_id),
        submissions=await pstore.list_submissions(timetable_id, task_id=task_id, teacher_id=teacher_id),
        teacher_id=teacher_id,
    )

    return {
        "ok": True,
        "status": status,
        "receipt": {
            "submitted_at": row["submitted_at"],
            "file_name": filename,
            "file_size_bytes": stored.size,
            "revision": row["revision"],
            "storage": stored.backend,
            "web_view_url": stored.web_view_url,
            "slot_title": slot.get("title"),
        },
        "submission": public_submission(row),
        "progress": progress,
    }


# ── Public: notifications ──────────────────────────────────────────────────

@router.get("/{code}/notifications")
async def portal_notifications(
    code: str,
    teacher_id: str,
    limit: int = Query(default=60, ge=1, le=200),
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    rows = await pstore.list_notifications(record["id"], teacher_id, limit)
    unread = sum(1 for r in rows if not r.get("read_at"))
    return {"notifications": rows, "unread": unread}


@router.post("/{code}/notifications/{notification_id}/read")
async def portal_notification_read(
    code: str,
    notification_id: str,
    teacher_id: str = Query(...),
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    ok = await pstore.mark_notification_read(record["id"], teacher_id, notification_id)
    return {"ok": ok}


@router.post("/{code}/notifications/read-all")
async def portal_notifications_read_all(
    code: str,
    teacher_id: str = Query(...),
    store: Any = Depends(get_timetable_store),
    pstore: Any = Depends(get_portal_store),
):
    record, _ = await _load_public(code, store, pstore)
    changed = await pstore.mark_all_notifications_read(record["id"], teacher_id)
    return {"ok": True, "changed": changed}


# ── Admin: school events ───────────────────────────────────────────────────

@router.get("/{code}/admin/events")
async def admin_list_events(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    events = await pstore.list_events(record["id"], published_only=False)
    teachers = await pstore.list_teachers(record["id"])
    aud = await pstore.list_audience_bulk("event", [e["id"] for e in events])
    class_names = {c["class_id"]: c["name"] for c in _workspace_classes(record)}
    out = []
    for event in events:
        resolved = resolve_audience(
            target_type=event.get("target_type") or "all",
            audience=aud.get(event["id"]) or [],
            teachers=teachers,
        )
        out.append({
            **event,
            "audience": audience_labels(resolved, class_names),
            "audience_members": resolved.get("members") or [],
        })
    return {"events": out}


@router.post("/{code}/admin/events")
async def admin_create_event(
    code: str,
    body: EventPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
    identity: UserIdentity = Depends(get_identity),
):
    if body.target_type not in ("all", "custom"):
        raise HTTPException(status_code=422, detail="target_type ต้องเป็น 'all' หรือ 'custom'")
    event = await pstore.create_event(record["id"], {
        **body.model_dump(exclude={"audience"}),
        "created_by": identity.user_id,
    })
    await _save_audience(
        pstore, "event", event["id"], body.target_type,
        [m.model_dump() for m in body.audience],
    )

    notified = 0
    if event.get("is_published", True):
        teachers = await pstore.list_teachers(record["id"])
        resolved = await _audience_for(pstore, "event", event, teachers)
        notified = await pstore.add_notifications(
            event_created_notifications(
                timetable_id=record["id"],
                event=event,
                audience=resolved,
                portal_url=_portal_url(code),
                created_by=identity.user_id,
            )
        )
    return {"event": event, "notified": notified}


@router.put("/{code}/admin/events/{event_id}")
async def admin_update_event(
    code: str,
    event_id: str,
    body: EventPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    existing = await pstore.get_event(record["id"], event_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ไม่พบกิจกรรมนี้")
    await pstore.update_event(record["id"], event_id, body.model_dump(exclude={"audience"}))
    await _save_audience(
        pstore, "event", event_id, body.target_type,
        [m.model_dump() for m in body.audience],
    )
    return {"event": await pstore.get_event(record["id"], event_id)}


@router.delete("/{code}/admin/events/{event_id}")
async def admin_delete_event(
    code: str,
    event_id: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    ok = await pstore.delete_event(record["id"], event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบกิจกรรมนี้")
    await pstore.delete_notifications(record["id"], event_id=event_id)
    return {"ok": True}


# ── Admin: submission tasks ────────────────────────────────────────────────

@router.get("/{code}/admin/tasks")
async def admin_list_tasks(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    tasks = await pstore.list_tasks(record["id"], published_only=False)
    teachers = await pstore.list_teachers(record["id"], active_only=False)
    all_slots = await pstore.list_slots(record["id"])
    submissions = await pstore.list_submissions(record["id"])
    aud = await pstore.list_audience_bulk("task", [t["id"] for t in tasks])
    class_names = {c["class_id"]: c["name"] for c in _workspace_classes(record)}

    slots_by_task: dict[str, list[dict]] = {}
    for slot in all_slots:
        slots_by_task.setdefault(slot["task_id"], []).append(slot)

    out = []
    for task in tasks:
        resolved = resolve_audience(
            target_type=task.get("target_type") or "all",
            audience=aud.get(task["id"]) or [],
            teachers=teachers,
        )
        matrix = build_task_matrix(
            task=task,
            slots=slots_by_task.get(task["id"], []),
            teachers=teachers,
            submissions=[s for s in submissions if s.get("task_id") == task["id"]],
            audience=resolved,
        )
        out.append({
            **task,
            "slots": [public_slot(s) for s in slots_by_task.get(task["id"], [])],
            "audience": audience_labels(resolved, class_names),
            "audience_members": resolved.get("members") or [],
            "summary": matrix["summary"],
        })
    return {"tasks": out}


@router.post("/{code}/admin/tasks")
async def admin_create_task(
    code: str,
    body: TaskPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
    identity: UserIdentity = Depends(get_identity),
):
    if not body.slots:
        raise HTTPException(status_code=422, detail="ต้องมีอย่างน้อย 1 กล่องรับไฟล์")
    task = await pstore.create_task(record["id"], {
        **body.model_dump(exclude={"audience", "slots"}),
        "created_by": identity.user_id,
    })
    slots = await pstore.set_slots(record["id"], task["id"], [s.model_dump() for s in body.slots])
    await _save_audience(
        pstore, "task", task["id"], body.target_type,
        [m.model_dump() for m in body.audience],
    )

    notified = 0
    if task.get("is_published", True):
        teachers = await pstore.list_teachers(record["id"])
        resolved = await _audience_for(pstore, "task", task, teachers)
        notified = await pstore.add_notifications(
            task_created_notifications(
                timetable_id=record["id"],
                task=task,
                audience=resolved,
                portal_url=_portal_url(code),
                created_by=identity.user_id,
            )
        )
    return {"task": task, "slots": slots, "notified": notified}


@router.put("/{code}/admin/tasks/{task_id}")
async def admin_update_task(
    code: str,
    task_id: str,
    body: TaskPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    existing = await pstore.get_task(record["id"], task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    if not body.slots:
        raise HTTPException(status_code=422, detail="ต้องมีอย่างน้อย 1 กล่องรับไฟล์")
    await pstore.update_task(record["id"], task_id, body.model_dump(exclude={"audience", "slots"}))
    slots = await pstore.set_slots(record["id"], task_id, [s.model_dump() for s in body.slots])
    await _save_audience(
        pstore, "task", task_id, body.target_type,
        [m.model_dump() for m in body.audience],
    )
    return {"task": await pstore.get_task(record["id"], task_id), "slots": slots}


@router.delete("/{code}/admin/tasks/{task_id}")
async def admin_delete_task(
    code: str,
    task_id: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    ok = await pstore.delete_task(record["id"], task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    await pstore.delete_notifications(record["id"], task_id=task_id)
    return {"ok": True}


async def _task_matrix(code: str, task_id: str, record: dict, pstore: Any, include_all: bool = False) -> dict:
    task = await pstore.get_task(record["id"], task_id)
    if not task:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    teachers = await pstore.list_teachers(record["id"], active_only=False)
    slots = await pstore.list_slots(record["id"], task_id)
    submissions = await pstore.list_submissions(record["id"], task_id=task_id)
    resolved = await _audience_for(pstore, "task", task, teachers)
    return build_task_matrix(
        task=task,
        slots=slots,
        teachers=teachers,
        submissions=submissions,
        audience=resolved,
        include_all=include_all,
    )


@router.get("/{code}/admin/tasks/{task_id}/matrix")
async def admin_task_matrix(
    code: str,
    task_id: str,
    include_all: bool = False,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    return await _task_matrix(code, task_id, record, pstore, include_all)


@router.get("/{code}/admin/tasks/{task_id}/export.xlsx")
async def admin_task_export(
    code: str,
    task_id: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    matrix = await _task_matrix(code, task_id, record, pstore)
    task = matrix["task"]
    slots = matrix["slots"]

    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "ติดตามการส่งงาน"
    header = ["รหัสครู", "ชื่อ-สกุล", "กลุ่มสาระ", "สถานะรวม", "ส่งแล้ว"]
    for slot in slots:
        header.append(slot["title"])
    ws.append(header)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    status_label = {"complete": "ครบ", "partial": "ไม่ครบ", "missing": "ยังไม่ส่ง",
                    "not_targeted": "ไม่เกี่ยวข้อง"}
    slot_label = {"submitted": "ส่งแล้ว", "late": "ส่งช้า", "missing": "ค้างส่ง"}
    for row in matrix["rows"]:
        line = [
            row["teacher_id"],
            row["display_name"],
            row.get("dept") or "",
            status_label.get(row["status"], row["status"]),
            f"{row.get('done')}/{row.get('total')}",
        ]
        for slot in slots:
            state = (row.get("slots") or {}).get(slot["id"]) or {}
            label = slot_label.get(state.get("status"), state.get("status") or "-")
            if state.get("submitted_at"):
                label += f" ({format_thai_datetime(state['submitted_at'])})"
            line.append(label)
        ws.append(line)

    for idx, width in enumerate([12, 28, 22, 14, 10] + [30] * len(slots), start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"task_{(task.get('due_datetime') or '')[:10]}_{task.get('id')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{code}/admin/tasks/{task_id}/download-zip")
async def admin_task_zip(
    code: str,
    task_id: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    task = await pstore.get_task(record["id"], task_id)
    if not task:
        raise HTTPException(status_code=404, detail="ไม่พบงานนี้")
    submissions = await pstore.list_submissions(record["id"], task_id=task_id)
    if not submissions:
        raise HTTPException(status_code=404, detail="ยังไม่มีไฟล์ที่ส่งสำหรับงานนี้")

    teachers = {t["teacher_id"]: t for t in await pstore.list_teachers(record["id"], active_only=False)}
    slots = {s["id"]: s for s in await pstore.list_slots(record["id"], task_id)}
    refresh_token = await pstore.get_setting("drive_refresh_token")
    storage = get_storage(refresh_token=refresh_token)

    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    total = 0
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as bundle:
            for submission in submissions:
                try:
                    content = await storage.read(submission["storage_key"])
                except StorageError:
                    continue
                total += len(content)
                if total > MAX_ZIP_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="ไฟล์รวมใหญ่เกิน 500 MB — กรุณาดาวน์โหลดทีละไฟล์หรือเปิดใน Drive",
                    )
                teacher = teachers.get(submission["teacher_id"]) or {}
                person = sanitize_filename(
                    f"{submission['teacher_id']}_{teacher.get('full_name') or ''}".strip("_")
                ) or submission["teacher_id"]
                slot_title = (slots.get(submission["slot_id"]) or {}).get("title") or "ไฟล์"
                bundle.writestr(f"{person}/{slot_title}/{submission['file_name']}", content)
        tmp.close()
    except Exception:
        tmp.close()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise

    filename = f"task_{(task.get('due_datetime') or '')[:10]}_{task.get('id')}.zip"

    def _cleanup() -> None:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    return StreamingResponse(
        open(tmp.name, "rb"),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        background=BackgroundTask(_cleanup),
    )


@router.get("/{code}/admin/submissions/{submission_id}/file")
async def admin_download_file(
    code: str,
    submission_id: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    submission = await pstore.get_submission_by_id(record["id"], submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์นี้")
    if submission.get("storage_backend") == "drive" and submission.get("web_view_url"):
        return RedirectResponse(submission["web_view_url"])

    refresh_token = await pstore.get_setting("drive_refresh_token")
    storage = get_storage(refresh_token=refresh_token)
    try:
        content = await storage.read(submission["storage_key"])
    except StorageError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(
        io.BytesIO(content),
        media_type=submission.get("mime_type") or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{submission.get("file_name")}"'
        },
    )


@router.post("/{code}/admin/tasks/{task_id}/remind")
async def admin_task_remind(
    code: str,
    task_id: str,
    body: RemindPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
    identity: UserIdentity = Depends(get_identity),
):
    matrix = await _task_matrix(code, task_id, record, pstore)
    task = matrix["task"]
    rows = incomplete_rows(matrix)
    portal_url = _portal_url(code)
    message = reminder_message(task=task, rows=rows, portal_url=portal_url) if rows else "ทุกคนส่งครบแล้ว 🎉"

    created = 0
    if rows and not body.copy_only:
        created = await pstore.add_notifications(
            reminder_notifications(
                timetable_id=record["id"],
                task=task,
                rows=rows,
                portal_url=portal_url,
                created_by=identity.user_id,
            )
        )

    webhook_result = None
    if body.send_webhook and not body.copy_only and rows:
        config = await pstore.get_config(record["id"]) or {}
        url = config.get("webhook_url")
        if url:
            payload = webhook_payload(
                kind="reminder",
                short_code=code,
                workspace_title=record.get("title") or "",
                task=task,
                event=None,
                portal_url=portal_url,
                message=message,
                recipients=rows,
            )
            ok, status_text = await post_webhook(url, payload)
            webhook_result = {"ok": ok, "status": status_text}
            await pstore.upsert_config(record["id"], {
                "webhook_last_status": ("ok " if ok else "error ") + status_text,
                "webhook_last_at": now_local().isoformat(timespec="seconds"),
            })

    return {
        "notified": created,
        "incomplete": len(rows),
        "message": message,
        "portal_url": f"{portal_url}&tab=tasks&task={task_id}",
        "webhook": webhook_result,
    }


# ── Admin: teachers ────────────────────────────────────────────────────────

def _teacher_admin_view(teacher: dict) -> dict:
    return {
        "teacher_id": teacher.get("teacher_id"),
        "prefix": teacher.get("prefix") or "",
        "full_name": teacher.get("full_name") or "",
        "display_name": teacher_display_name(teacher),
        "dept": teacher.get("dept") or "",
        "phone": teacher.get("phone"),
        "has_pin": bool(teacher.get("pin_hash")),
        "is_active": bool(teacher.get("is_active", True)),
        "pin_locked": is_pin_locked(teacher),
    }


@router.get("/{code}/admin/teachers")
async def admin_list_teachers(
    code: str,
    auto_sync: bool = True,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    teachers = await pstore.list_teachers(record["id"], active_only=False)
    synced_now = False
    if not teachers and auto_sync:
        result = await _sync_teachers(record, pstore)
        synced_now = not result.get("empty", False)
        teachers = await pstore.list_teachers(record["id"], active_only=False)
    workspace_teachers = len(teachers_from_workspace(record.get("workspace")))
    return {
        "teachers": [_teacher_admin_view(t) for t in teachers],
        "synced_now": synced_now,
        "needs_sync": not teachers,
        "workspace_teacher_count": workspace_teachers,
    }


@router.post("/{code}/admin/teachers/sync")
async def admin_sync_teachers(
    code: str,
    include_trainees: bool = False,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    result = await _sync_teachers(record, pstore, include_trainees=include_trainees)
    if result.get("empty"):
        raise HTTPException(
            status_code=422,
            detail="ไม่พบรายชื่อครูใน workspace นี้ — เปิด workspace แล้วบันทึกขึ้นคลาวด์ก่อน",
        )
    return result


@router.post("/{code}/admin/teachers/infer-depts")
async def admin_infer_depts(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    inferred = infer_depts_from_lessons(_workspace_fixture(record))
    teachers = await pstore.list_teachers(record["id"], active_only=False)
    updated = 0
    for teacher in teachers:
        if (teacher.get("dept") or "").strip():
            continue
        guess = inferred.get(teacher["teacher_id"])
        if not guess:
            continue
        await pstore.update_teacher(record["id"], teacher["teacher_id"], {"dept": guess})
        updated += 1
    return {"updated": updated, "total": len(teachers)}


@router.put("/{code}/admin/teachers/{teacher_id}")
async def admin_update_teacher(
    code: str,
    teacher_id: str,
    body: TeacherPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    teacher = await pstore.get_teacher(record["id"], teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="ไม่พบครูคนนี้")

    fields: dict[str, Any] = {}
    for key in ("prefix", "full_name", "dept", "phone", "is_active"):
        value = getattr(body, key)
        if value is not None:
            fields[key] = value

    if body.pin is not None:
        if body.pin == "":
            fields["pin_hash"] = None
            fields["pin_set_at"] = None
        elif is_valid_pin(body.pin):
            fields["pin_hash"] = hash_pin(normalize_pin(body.pin))
            fields["pin_set_at"] = now_local().isoformat(timespec="seconds")
            fields["pin_fail_count"] = 0
            fields["pin_locked_until"] = None
        else:
            raise HTTPException(status_code=422, detail="PIN ต้องเป็นตัวเลข 4 หลัก")
    elif body.phone is not None and not teacher.get("pin_hash"):
        fields["pin_hash"] = hash_pin(default_pin_from_phone(body.phone))
        fields["pin_set_at"] = now_local().isoformat(timespec="seconds")

    await pstore.update_teacher(record["id"], teacher_id, fields)
    return {"ok": True, "teacher_id": teacher_id}


@router.post("/{code}/admin/teachers/{teacher_id}/pin")
async def admin_reset_pin(
    code: str,
    teacher_id: str,
    body: PinPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    teacher = await pstore.get_teacher(record["id"], teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="ไม่พบครูคนนี้")
    pin = normalize_pin(body.pin) if body.pin else default_pin_from_phone(teacher.get("phone"))
    if not is_valid_pin(pin):
        raise HTTPException(status_code=422, detail="PIN ต้องเป็นตัวเลข 4 หลัก")
    await pstore.update_teacher(record["id"], teacher_id, {
        "pin_hash": hash_pin(pin),
        "pin_set_at": now_local().isoformat(timespec="seconds"),
        "pin_fail_count": 0,
        "pin_locked_until": None,
    })
    return {"ok": True, "pin_source": "custom" if body.pin else "last4_phone"}


# ── Admin: config + Drive ──────────────────────────────────────────────────

@router.get("/{code}/admin/config")
async def admin_get_config(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    config = await pstore.get_config(record["id"]) or {}
    return {
        "config": config,
        "classes": _workspace_classes(record),
        "portal_url": _portal_url(code),
        "storage_backend": settings.portal_storage,
        "storage_warning": storage_warning(),
        "drive_configured": settings.portal_drive_configured
        or bool(await pstore.get_setting("drive_refresh_token")),
    }


@router.put("/{code}/admin/config")
async def admin_update_config(
    code: str,
    body: ConfigPayload,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    fields: dict[str, Any] = {}
    if body.school_name is not None:
        fields["school_name"] = body.school_name.strip()[:120]
    if body.is_published is not None:
        fields["is_published"] = 1 if body.is_published else 0
    if body.webhook_url is not None:
        fields["webhook_url"] = body.webhook_url.strip() or None
    if body.late_policy is not None:
        if body.late_policy not in ("allow", "block"):
            raise HTTPException(status_code=422, detail="late_policy ต้องเป็น 'allow' หรือ 'block'")
        fields["late_policy"] = body.late_policy

    if body.drive_folder_url is not None:
        raw = body.drive_folder_url.strip()
        if not raw:
            fields.update({
                "drive_folder_id": None,
                "drive_folder_url": None,
                "drive_drive_id": None,
            })
        else:
            try:
                parsed = parse_drive_folder_link(raw)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            refresh_token = await pstore.get_setting("drive_refresh_token")
            storage = get_storage(refresh_token=refresh_token)
            if storage.backend == "drive":
                try:
                    await storage.client.get_file(parsed["folder_id"], fields="id,name,mimeType")
                except DriveError as e:
                    raise HTTPException(status_code=422, detail=str(e))
            fields.update({
                "drive_folder_id": parsed["folder_id"],
                "drive_folder_url": raw,
                "drive_drive_id": parsed.get("drive_id"),
            })

    config = await pstore.upsert_config(record["id"], fields)
    return {"config": config}


@router.get("/{code}/admin/drive/status")
async def admin_drive_status(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    config = await pstore.get_config(record["id"]) or {}
    token = await pstore.get_setting("drive_refresh_token")
    connected = bool(token or settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    detail = None
    if connected:
        storage = get_storage(refresh_token=token)
        if storage.backend == "drive":
            try:
                info = await storage.client.get_file("root", fields="id,name")
                detail = info.get("name")
            except DriveError as e:
                detail = str(e)
    return {
        "connected": connected,
        "storage_backend": settings.portal_storage,
        "folder_id": config.get("drive_folder_id"),
        "folder_url": config.get("drive_folder_url"),
        "detail": detail,
        "warning": storage_warning(),
    }


@router.post("/{code}/admin/drive/connect")
async def admin_drive_connect(
    code: str,
    record: dict = Depends(require_portal_admin),
):
    client_id = settings.portal_drive_client_id
    if not client_id or not settings.portal_drive_client_secret:
        raise HTTPException(
            status_code=503,
            detail="ยังไม่ได้ตั้ง GOOGLE_DRIVE_CLIENT_ID / SECRET ใน environment",
        )
    state = f"{code}:{secrets.token_urlsafe(12)}"
    _DRIVE_STATES[state] = code
    params = {
        "client_id": client_id,
        "redirect_uri": _drive_redirect_uri(),
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive",
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params),
        "redirect_uri": _drive_redirect_uri(),
    }


@router.get("/drive/callback")
async def drive_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    pstore: Any = Depends(get_portal_store),
):
    """Google redirects here after the admin grants Drive access."""
    short_code = _DRIVE_STATES.pop(state or "", None)
    if error:
        return RedirectResponse(_admin_url(short_code or "", drive="error", reason=error))
    if not short_code or not code:
        return RedirectResponse(_admin_url("", drive="error", reason="invalid_state"))

    data = {
        "code": code,
        "client_id": settings.portal_drive_client_id,
        "client_secret": settings.portal_drive_client_secret,
        "redirect_uri": _drive_redirect_uri(),
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post("https://oauth2.googleapis.com/token", data=data)
    except httpx.HTTPError as e:
        return RedirectResponse(_admin_url(short_code, drive="error", reason=str(e)[:80]))

    if resp.status_code != 200:
        return RedirectResponse(
            _admin_url(short_code, drive="error", reason=f"http_{resp.status_code}")
        )
    payload = resp.json()
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        return RedirectResponse(
            _admin_url(short_code, drive="error", reason="no_refresh_token")
        )
    await pstore.set_setting("drive_refresh_token", refresh_token)
    await pstore.set_setting("drive_connected_at", now_local().isoformat(timespec="seconds"))
    return RedirectResponse(_admin_url(short_code, drive="connected"))


@router.post("/{code}/admin/drive/disconnect")
async def admin_drive_disconnect(
    code: str,
    record: dict = Depends(require_portal_admin),
    pstore: Any = Depends(get_portal_store),
):
    await pstore.delete_setting("drive_refresh_token")
    return {"ok": True}
