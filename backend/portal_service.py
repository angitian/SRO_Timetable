"""Portal business logic (no HTTP, no storage I/O).

Rules kept here so they are unit-testable:
  - PIN hashing + lockout
  - on-time / late status
  - audience resolution (all / dept / teacher / class)
  - per-task progress and the tracking matrix (teachers × slots)
  - department inference from the timetable's lesson blocks
  - calendar flattening, notifications and the outgoing webhook
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import bcrypt
import httpx

from config import settings

PIN_MAX_FAILS = 5
PIN_LOCK_MINUTES = 15
PIN_LENGTH = 4


# ── Time ───────────────────────────────────────────────────────────────────

def portal_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.PORTAL_TZ or "Asia/Bangkok")
    except Exception:
        return ZoneInfo("Asia/Bangkok")


def now_local() -> datetime:
    return datetime.now(portal_tz())


def now_iso() -> str:
    return now_local().isoformat(timespec="seconds")


def parse_due(value: str | None) -> datetime | None:
    """Parse `YYYY-MM-DD HH:MM` / ISO into an aware datetime in the portal TZ."""
    raw = (value or "").strip()
    if not raw:
        return None
    raw = raw.replace("T", " ")
    for fmt, size in (
        ("%Y-%m-%d %H:%M:%S", 19),
        ("%Y-%m-%d %H:%M", 16),
        ("%Y-%m-%d", 10),
    ):
        try:
            parsed = datetime.strptime(raw[:size], fmt)
        except ValueError:
            continue
        return parsed.replace(tzinfo=portal_tz())
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=portal_tz())
    return parsed


def format_thai_datetime(value: Any) -> str:
    """'2026-11-20 16:30' → '20/11/2569 16:30' (พ.ศ.) — for notification text."""
    if isinstance(value, datetime):
        moment = value
    else:
        moment = parse_due(str(value) if value else None)
    if not moment:
        return ""
    return f"{moment.day}/{moment.month}/{moment.year + 543} {moment.hour:02d}:{moment.minute:02d}"


def submission_status(due: str | None, at: datetime | None = None) -> str:
    """'late' when the upload happens after the due datetime, else 'submitted'."""
    deadline = parse_due(due)
    moment = at or now_local()
    if deadline and moment > deadline:
        return "late"
    return "submitted"


def is_due_passed(due_datetime: str | None, at: datetime | None = None) -> bool:
    deadline = parse_due(due_datetime)
    return bool(deadline and (at or now_local()) > deadline)


def days_until(value: str | None, at: datetime | None = None) -> int | None:
    deadline = parse_due(value)
    if not deadline:
        return None
    return (deadline.date() - (at or now_local()).date()).days


# ── PIN ────────────────────────────────────────────────────────────────────

def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_pin(pin: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    try:
        return bcrypt.checkpw((pin or "").encode("utf-8"), pin_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def normalize_pin(pin: str | None) -> str:
    return re.sub(r"\D", "", pin or "")[:PIN_LENGTH]


def is_valid_pin(pin: str | None) -> bool:
    return bool(re.fullmatch(rf"\d{{{PIN_LENGTH}}}", normalize_pin(pin)))


def default_pin_from_phone(phone: str | None) -> str:
    """Default PIN = last 4 digits of the phone number, else '0000'."""
    digits = re.sub(r"\D", "", phone or "")
    return digits[-4:] if len(digits) >= 4 else "0000"


def pin_lock_until(teacher: dict) -> datetime | None:
    return parse_due(teacher.get("pin_locked_until"))


def is_pin_locked(teacher: dict, at: datetime | None = None) -> bool:
    until = pin_lock_until(teacher)
    return bool(until and (at or now_local()) < until)


def register_pin_failure(teacher: dict, at: datetime | None = None) -> dict:
    """Return the fields to persist after a wrong PIN (lockout on the 5th try)."""
    moment = at or now_local()
    fails = int(teacher.get("pin_fail_count") or 0) + 1
    fields: dict[str, Any] = {"pin_fail_count": fails}
    if fails >= PIN_MAX_FAILS:
        fields["pin_locked_until"] = (
            moment + timedelta(minutes=PIN_LOCK_MINUTES)
        ).isoformat(timespec="seconds")
        fields["pin_fail_count"] = 0
    return fields


# ── Teacher helpers ────────────────────────────────────────────────────────

def teacher_display_name(teacher: dict) -> str:
    prefix = (teacher.get("prefix") or "").strip()
    name = (teacher.get("full_name") or "").strip() or teacher.get("teacher_id") or ""
    return f"{prefix}{name}" if prefix and not name.startswith(prefix) else name


def public_teacher(teacher: dict) -> dict:
    """Teacher payload safe for the unauthenticated portal (no PIN/phone)."""
    return {
        "teacher_id": teacher.get("teacher_id"),
        "prefix": teacher.get("prefix") or "",
        "full_name": teacher.get("full_name") or "",
        "display_name": teacher_display_name(teacher),
        "dept": teacher.get("dept") or "",
        "has_pin": bool(teacher.get("pin_hash")),
        "is_active": bool(teacher.get("is_active", True)),
    }


def teachers_from_workspace(workspace: dict | None, *, include_trainees: bool = False) -> list[dict]:
    """Extract `[{teacher_id, full_name, dept, sort_order}]` from a workspace payload.

    `dept` is inferred from the subjects each teacher teaches (Thai schools name
    their departments after subjects) so the registry is usable right away; the
    admin can always overwrite it.
    """
    fixture = (workspace or {}).get("fixtureData") or {}
    inferred = infer_depts_from_lessons(fixture)
    out: list[dict] = []
    for idx, teacher in enumerate(fixture.get("teachers") or []):
        teacher_id = str(teacher.get("id") or "").strip()
        if not teacher_id:
            continue
        teacher_type = (teacher.get("teacher_type") or "regular").strip().lower()
        if teacher_type == "trainee" and not include_trainees:
            continue
        out.append({
            "teacher_id": teacher_id,
            "full_name": (teacher.get("name") or "").strip() or teacher_id,
            "dept": inferred.get(teacher_id, ""),
            "sort_order": idx,
        })
    return out


def infer_depts_from_lessons(fixture: dict | None) -> dict[str, str]:
    """teacher_id → most-taught subject name (best-effort department guess)."""
    fixture = fixture or {}
    subjects = {
        str(s.get("id")): (s.get("name") or "").strip()
        for s in fixture.get("subjects") or []
    }
    counts: dict[str, Counter] = defaultdict(Counter)
    for block in fixture.get("lesson_blocks") or []:
        teacher_id = str(block.get("teacher_id") or "")
        subject_name = subjects.get(str(block.get("subject_id") or ""))
        if teacher_id and subject_name:
            counts[teacher_id][subject_name] += 1
    return {
        teacher_id: counter.most_common(1)[0][0]
        for teacher_id, counter in counts.items()
        if counter
    }


# ── Audience (ผู้เข้าร่วม / ผู้ต้องส่ง) ─────────────────────────────────────

def normalize_audience(members: list[dict] | None) -> list[dict]:
    """Keep only well-formed, de-duplicated audience rows."""
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for member in members or []:
        kind = str(member.get("member_kind") or "").strip()
        value = str(member.get("member_id") or "").strip()
        if kind not in ("teacher", "class", "dept") or not value:
            continue
        if (kind, value) in seen:
            continue
        seen.add((kind, value))
        out.append({"member_kind": kind, "member_id": value})
    return out


def resolve_audience(
    *,
    target_type: str,
    audience: list[dict] | None,
    teachers: list[dict],
) -> dict:
    """Resolve an activity's audience to concrete teachers (+ dept/class labels)."""
    active = [t for t in teachers if t.get("is_active", True)]
    members = normalize_audience(audience)

    if (target_type or "all") == "all" or not members:
        return {
            "is_all": True,
            "teachers": active,
            "teacher_ids": {t["teacher_id"] for t in active},
            "depts": [],
            "classes": [],
            "members": [],
        }

    teacher_ids: set[str] = set()
    depts: list[str] = []
    classes: list[str] = []
    for member in members:
        kind, value = member["member_kind"], member["member_id"]
        if kind == "teacher":
            teacher_ids.add(value)
        elif kind == "dept":
            depts.append(value)
            teacher_ids.update(
                t["teacher_id"] for t in active if (t.get("dept") or "") == value
            )
        elif kind == "class":
            classes.append(value)

    by_id = {t["teacher_id"]: t for t in active}
    resolved = [by_id[tid] for tid in sorted(teacher_ids) if tid in by_id]
    return {
        "is_all": False,
        "teachers": resolved,
        "teacher_ids": set(by_id) & teacher_ids,
        "depts": depts,
        "classes": classes,
        "members": members,
    }


def teacher_in_audience(teacher_id: str | None, resolved: dict) -> bool:
    if not teacher_id:
        return False
    return teacher_id in (resolved.get("teacher_ids") or set())


def audience_labels(resolved: dict, class_names: dict[str, str] | None = None) -> dict:
    """Display payload for an activity's audience."""
    if resolved.get("is_all"):
        return {"is_all": True, "depts": [], "classes": [], "teachers": [], "summary": "ทุกคน"}
    class_names = class_names or {}
    teachers = [
        {"teacher_id": t.get("teacher_id"), "display_name": teacher_display_name(t)}
        for t in resolved.get("teachers") or []
    ]
    classes = [
        {"class_id": cid, "name": class_names.get(cid, cid)}
        for cid in resolved.get("classes") or []
    ]
    parts = []
    if resolved.get("depts"):
        parts.append("กลุ่มสาระ " + ", ".join(resolved["depts"]))
    if classes:
        parts.append("ห้อง " + ", ".join(c["name"] for c in classes))
    if teachers:
        parts.append(f"ครู {len(teachers)} คน")
    return {
        "is_all": False,
        "depts": resolved.get("depts") or [],
        "classes": classes,
        "teachers": teachers,
        "summary": " · ".join(parts) or "ยังไม่ระบุ",
    }


# ── Public payloads ────────────────────────────────────────────────────────

def public_event(event: dict, at: datetime | None = None) -> dict:
    return {
        "id": event.get("id"),
        "title": event.get("title"),
        "description": event.get("description") or "",
        "event_date": event.get("event_date"),
        "end_date": event.get("end_date"),
        "start_time": event.get("start_time"),
        "end_time": event.get("end_time"),
        "all_day": bool(event.get("all_day", True)),
        "location": event.get("location") or "",
        "target_type": event.get("target_type") or "all",
        "is_published": bool(event.get("is_published", True)),
    }


def public_task(task: dict, at: datetime | None = None) -> dict:
    moment = at or now_local()
    return {
        "id": task.get("id"),
        "title": task.get("title"),
        "description": task.get("description") or "",
        "open_at": task.get("open_at"),
        "due_datetime": task.get("due_datetime"),
        "allow_late": bool(task.get("allow_late", True)),
        "is_published": bool(task.get("is_published", True)),
        "target_type": task.get("target_type") or "all",
        "due_passed": is_due_passed(task.get("due_datetime"), moment),
        "days_until_due": days_until(task.get("due_datetime"), moment),
    }


def public_slot(slot: dict) -> dict:
    return {
        "id": slot.get("id"),
        "title": slot.get("title"),
        "description": slot.get("description") or "",
        "is_required": bool(slot.get("is_required", True)),
        "allowed_ext": slot.get("allowed_ext"),
        "max_mb": slot.get("max_mb"),
        "sort_order": slot.get("sort_order"),
    }


def public_submission(submission: dict) -> dict:
    return {
        "id": submission.get("id"),
        "task_id": submission.get("task_id"),
        "slot_id": submission.get("slot_id"),
        "teacher_id": submission.get("teacher_id"),
        "file_name": submission.get("file_name"),
        "file_size_bytes": submission.get("file_size_bytes"),
        "submitted_at": submission.get("submitted_at"),
        "status": submission.get("status"),
        "revision": submission.get("revision"),
        "web_view_url": submission.get("web_view_url"),
    }


# ── Task progress ──────────────────────────────────────────────────────────

def slot_statuses(
    slots: list[dict],
    submissions: list[dict],
    teacher_id: str | None,
) -> dict[str, dict]:
    """slot_id → {status, submitted_at, file_name, ...} for one teacher."""
    by_slot = {
        s.get("slot_id"): s
        for s in submissions
        if s.get("teacher_id") == teacher_id
    }
    out: dict[str, dict] = {}
    for slot in slots:
        submission = by_slot.get(slot.get("id"))
        out[slot["id"]] = (
            {
                "status": submission.get("status") or "submitted",
                "submitted_at": submission.get("submitted_at"),
                "file_name": submission.get("file_name"),
                "file_size_bytes": submission.get("file_size_bytes"),
                "web_view_url": submission.get("web_view_url"),
                "submission_id": submission.get("id"),
                "revision": submission.get("revision"),
            }
            if submission
            else {
                "status": "missing",
                "submitted_at": None,
                "file_name": None,
                "file_size_bytes": None,
                "web_view_url": None,
                "submission_id": None,
                "revision": None,
            }
        )
    return out


def task_progress(
    *,
    task: dict,
    slots: list[dict],
    submissions: list[dict],
    teacher_id: str | None,
) -> dict:
    """Overall progress for one teacher on one task."""
    statuses = slot_statuses(slots, submissions, teacher_id)
    required = [s for s in slots if s.get("is_required", True)]
    done_required = [
        s for s in required if statuses.get(s["id"], {}).get("status") in ("submitted", "late")
    ]
    done_all = [
        s for s in slots if statuses.get(s["id"], {}).get("status") in ("submitted", "late")
    ]
    any_late = any(v.get("status") == "late" for v in statuses.values())
    if not slots:
        status = "missing"
    elif len(done_required) == len(required):
        status = "complete"
    elif done_all:
        status = "partial"
    else:
        status = "missing"
    return {
        "status": status,
        "late": any_late,
        "required_total": len(required),
        "required_done": len(done_required),
        "total": len(slots),
        "done": len(done_all),
        "percent": round(len(done_all) / len(slots) * 100) if slots else 0,
        "slots": statuses,
    }


def build_task_matrix(
    *,
    task: dict,
    slots: list[dict],
    teachers: list[dict],
    submissions: list[dict],
    audience: dict,
    at: datetime | None = None,
    include_all: bool = False,
) -> dict:
    """Teachers × slots matrix for one submission task."""
    moment = at or now_local()
    targeted = {t["teacher_id"] for t in audience.get("teachers") or []}
    by_teacher: dict[str, list[dict]] = defaultdict(list)
    for submission in submissions:
        if submission.get("task_id") != task.get("id"):
            continue
        by_teacher[submission.get("teacher_id")].append(submission)

    rows: list[dict] = []
    for teacher in teachers:
        if not teacher.get("is_active", True):
            continue
        teacher_id = teacher["teacher_id"]
        in_target = audience.get("is_all") or teacher_id in targeted
        if not in_target and not include_all:
            continue
        progress = task_progress(
            task=task,
            slots=slots,
            submissions=by_teacher.get(teacher_id, []),
            teacher_id=teacher_id,
        )
        rows.append({
            "teacher_id": teacher_id,
            "prefix": teacher.get("prefix") or "",
            "full_name": teacher.get("full_name") or "",
            "display_name": teacher_display_name(teacher),
            "dept": teacher.get("dept") or "",
            "status": progress["status"] if in_target else "not_targeted",
            "late": progress["late"],
            "done": progress["done"],
            "total": progress["total"],
            "percent": progress["percent"],
            "last_submitted_at": max(
                (s.get("submitted_at") or "" for s in by_teacher.get(teacher_id, [])),
                default=None,
            ),
            "slots": progress["slots"],
        })

    counts = {"complete": 0, "partial": 0, "missing": 0}
    for row in rows:
        if row["status"] in counts:
            counts[row["status"]] += 1
    total = sum(counts.values())
    return {
        "task": public_task(task, moment),
        "slots": [public_slot(s) for s in slots],
        "summary": {
            "total": total,
            "complete": counts["complete"],
            "partial": counts["partial"],
            "missing": counts["missing"],
            "percent": round(counts["complete"] / total * 100) if total else 0,
        },
        "rows": rows,
    }


def incomplete_rows(matrix: dict) -> list[dict]:
    return [row for row in matrix.get("rows") or [] if row.get("status") in ("partial", "missing")]


# ── Calendar ───────────────────────────────────────────────────────────────

def calendar_items(
    *,
    events: list[dict],
    tasks: list[dict],
    event_audiences: dict[str, dict],
    task_audiences: dict[str, dict],
    task_progress_by_id: dict[str, dict],
    teacher_id: str | None,
) -> list[dict]:
    """Flatten events + task deadlines into one calendar feed."""
    items: list[dict] = []
    for event in events:
        resolved = event_audiences.get(event["id"]) or {}
        items.append({
            "kind": "event",
            "id": event["id"],
            "title": event.get("title"),
            "date": event.get("event_date"),
            "end_date": event.get("end_date"),
            "start_time": event.get("start_time"),
            "end_time": event.get("end_time"),
            "all_day": bool(event.get("all_day", True)),
            "location": event.get("location") or "",
            "i_attend": teacher_in_audience(teacher_id, resolved),
        })
    for task in tasks:
        resolved = task_audiences.get(task["id"]) or {}
        progress = task_progress_by_id.get(task["id"]) or {}
        items.append({
            "kind": "task",
            "id": task["id"],
            "title": task.get("title"),
            "date": (task.get("due_datetime") or "")[:10],
            "end_date": None,
            "start_time": (task.get("due_datetime") or "")[11:16] or None,
            "end_time": None,
            "all_day": False,
            "location": "",
            "i_attend": teacher_in_audience(teacher_id, resolved),
            "status": progress.get("status"),
            "done": progress.get("done"),
            "total": progress.get("total"),
        })
    items.sort(key=lambda item: (item.get("date") or "", item.get("start_time") or ""))
    return items


# ── Substitutions (read-only view over existing data) ──────────────────────

def _period_labels(periods: list[dict] | None) -> dict[str, str]:
    labels: dict[str, str] = {}
    study_no = 0
    for period in periods or []:
        key = str(period.get("period_no") if period.get("period_no") is not None else period.get("period_num"))
        kind = (period.get("type") or period.get("period_type") or "STUDY").upper()
        start = (period.get("start_time") or "")[:5]
        end = (period.get("end_time") or "")[:5]
        if kind in ("LUNCH",):
            labels[key] = "พักเที่ยง"
        elif kind in ("BREAK",):
            labels[key] = "พัก"
        else:
            study_no += 1
            window = f" ({start} - {end})" if start and end else ""
            labels[key] = f"คาบ {study_no}{window}"
    return labels


def build_substitution_view(
    *,
    date: str,
    daily: dict | None,
    workspace: dict | None,
    periods: list[dict] | None = None,
) -> dict:
    """Flatten one day's substitute assignments for the mobile portal."""
    fixture = (workspace or {}).get("fixtureData") or {}
    teachers = fixture.get("teachers") or []
    classes = fixture.get("classes") or []
    subjects = fixture.get("subjects") or []

    if not periods:
        blocks = fixture.get("schedule_blocks") or []
        periods = (blocks[0].get("periods") if blocks else None) or []

    labels = _period_labels(periods)
    daily = daily or {}
    assignments = daily.get("assignments") or []
    absences = daily.get("absences") or [
        {"teacherId": tid, "reason": "", "periodRange": "all"}
        for tid in (daily.get("absentTeacherIds") or [])
    ]

    teacher_names = {str(t.get("id")): str(t.get("name") or "") for t in teachers}
    class_names = {str(c.get("id")): str(c.get("name") or "") for c in classes}
    subject_names = {str(s.get("id")): str(s.get("name") or "") for s in subjects}

    rows = []
    for item in assignments:
        substitute_id = item.get("substitute_teacher_id") or item.get("substitute_trainee_id")
        kind = "trainee" if item.get("substitute_trainee_id") else "teacher"
        original_id = str(item.get("original_teacher_id") or "")
        period_key = str(item.get("period"))
        rows.append({
            "id": item.get("id"),
            "period": item.get("period"),
            "period_label": labels.get(period_key, f"คาบ {period_key}"),
            "class_id": item.get("class_id"),
            "class_name": class_names.get(str(item.get("class_id")), str(item.get("class_id") or "")),
            "subject_name": subject_names.get(str(item.get("subject_id")), str(item.get("subject_id") or "")),
            "absent_teacher_id": original_id,
            "absent_teacher_name": teacher_names.get(original_id, original_id),
            "substitute_id": substitute_id,
            "substitute_name": (
                item.get("substitute_name")
                or teacher_names.get(str(substitute_id or ""), "")
                or str(substitute_id or "")
            ),
            "substitute_kind": kind,
            "reason": item.get("reason") or "",
            "note": item.get("note") or "",
        })
    rows.sort(key=lambda r: (float(r.get("period") or 0), r.get("class_name") or ""))

    absence_rows = []
    for absence in absences:
        teacher_id = str(absence.get("teacherId") or absence.get("teacher_id") or "")
        absence_rows.append({
            "teacher_id": teacher_id,
            "teacher_name": teacher_names.get(teacher_id, teacher_id),
            "reason": absence.get("reason") or "",
            "period_range": absence.get("periodRange") or absence.get("period_range") or "all",
        })

    return {
        "date": date,
        "note": daily.get("note") or "",
        "has_data": bool(rows or absence_rows),
        "absences": absence_rows,
        "rows": rows,
    }


# ── Notifications ──────────────────────────────────────────────────────────

def notification_row(
    *,
    timetable_id: str,
    teacher_id: str | None,
    kind: str,
    title: str,
    body: str = "",
    event_id: str | None = None,
    task_id: str | None = None,
    link: str | None = None,
    created_by: str | None = None,
) -> dict:
    from portal_store import new_id

    return {
        "id": new_id("ntf_"),
        "timetable_id": timetable_id,
        "teacher_id": teacher_id,
        "event_id": event_id,
        "task_id": task_id,
        "kind": kind,
        "title": title,
        "body": body,
        "link": link,
        "created_by": created_by,
        "created_at": now_iso(),
    }


def task_created_notifications(
    *,
    timetable_id: str,
    task: dict,
    audience: dict,
    portal_url: str,
    created_by: str | None = None,
) -> list[dict]:
    due = format_thai_datetime(task.get("due_datetime"))
    return [
        notification_row(
            timetable_id=timetable_id,
            teacher_id=teacher.get("teacher_id"),
            kind="task_new",
            title=f"งานใหม่: {task.get('title')}",
            body=f"กำหนดส่ง {due}" if due else "มีงานใหม่ให้ส่งไฟล์",
            task_id=task.get("id"),
            link=f"{portal_url}&tab=tasks&task={task.get('id')}",
            created_by=created_by,
        )
        for teacher in audience.get("teachers") or []
    ]


def event_created_notifications(
    *,
    timetable_id: str,
    event: dict,
    audience: dict,
    portal_url: str,
    created_by: str | None = None,
) -> list[dict]:
    when = format_thai_datetime(event.get("event_date")) or event.get("event_date") or ""
    return [
        notification_row(
            timetable_id=timetable_id,
            teacher_id=teacher.get("teacher_id"),
            kind="event_new",
            title=f"กิจกรรมใหม่: {event.get('title')}",
            body=f"{when}{' · ' + event['location'] if event.get('location') else ''}".strip(),
            event_id=event.get("id"),
            link=f"{portal_url}&tab=calendar&event={event.get('id')}",
            created_by=created_by,
        )
        for teacher in audience.get("teachers") or []
    ]


def reminder_message(*, task: dict, rows: list[dict], portal_url: str) -> str:
    names = ", ".join(
        (row.get("display_name") or row.get("full_name") or row.get("teacher_id") or "")
        for row in rows[:10]
    )
    more = f" และอีก {len(rows) - 10} คน" if len(rows) > 10 else ""
    due = format_thai_datetime(task.get("due_datetime")) or task.get("due_datetime") or "-"
    return (
        f"แจ้งเตือนงาน: {task.get('title')}\n"
        f"กำหนดส่ง: {due}\n"
        f"ยังไม่ได้ส่งครบ {len(rows)} คน: {names}{more}\n"
        f"ส่งไฟล์ได้ที่: {portal_url}&tab=tasks"
    )


def reminder_notifications(
    *, timetable_id: str, task: dict, rows: list[dict], portal_url: str,
    created_by: str | None = None,
) -> list[dict]:
    due = format_thai_datetime(task.get("due_datetime")) or task.get("due_datetime") or ""
    return [
        notification_row(
            timetable_id=timetable_id,
            teacher_id=row.get("teacher_id"),
            kind="reminder",
            title=f"ยังไม่ได้ส่งครบ: {task.get('title')}",
            body=f"กำหนดส่ง {due} — ส่งแล้ว {row.get('done')}/{row.get('total')} กล่อง",
            task_id=task.get("id"),
            link=f"{portal_url}&tab=tasks&task={task.get('id')}",
            created_by=created_by,
        )
        for row in rows
    ]


# ── Webhook ────────────────────────────────────────────────────────────────

def sign_payload(body: bytes, secret: str | None) -> str | None:
    if not secret:
        return None
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def post_webhook(
    url: str,
    payload: dict,
    *,
    secret: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 10.0,
) -> tuple[bool, str]:
    """POST the payload as JSON. One retry; returns (ok, status_message)."""
    if not url:
        return False, "ยังไม่ได้ตั้ง webhook"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    signature = sign_payload(body, secret or settings.PORTAL_WEBHOOK_SECRET)
    if signature:
        headers["X-Portal-Signature"] = f"sha256={signature}"

    last_error = ""
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(
                timeout=timeout, transport=transport
            ) as client:
                resp = await client.post(url, content=body, headers=headers)
            if 200 <= resp.status_code < 300:
                return True, f"HTTP {resp.status_code}"
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as e:  # network error
            last_error = str(e)[:200]
        if attempt == 0:
            continue
    return False, last_error


def webhook_payload(
    *,
    kind: str,
    short_code: str,
    workspace_title: str,
    task: dict | None,
    event: dict | None,
    portal_url: str,
    message: str,
    recipients: list[dict] | None = None,
) -> dict:
    return {
        "source": "sro-portal",
        "type": kind,
        "sent_at": now_iso(),
        "workspace": {"short_code": short_code, "title": workspace_title},
        "task": (
            {
                "id": task.get("id"),
                "title": task.get("title"),
                "due_datetime": task.get("due_datetime"),
            }
            if task
            else None
        ),
        "event": (
            {
                "id": event.get("id"),
                "title": event.get("title"),
                "event_date": event.get("event_date"),
            }
            if event
            else None
        ),
        "message": message,
        "portal_url": portal_url,
        "recipients": [
            {
                "teacher_id": r.get("teacher_id"),
                "name": r.get("display_name") or r.get("full_name") or "",
                "dept": r.get("dept") or "",
            }
            for r in (recipients or [])
        ],
    }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
