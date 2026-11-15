"""Storage layer for the portal module (กิจกรรมโรงเรียน + งานส่งไฟล์).

Mirrors the pattern used by `timetable_store.py`:
  - `D1PortalStore`  → Cloudflare D1 (production)
  - `LocalPortalStore` → JSON files under `backend/data/portal/` (offline dev / tests)

Schema (migration 010):
  portal_events          กิจกรรมโรงเรียน (ครู / กลุ่มสาระ / ห้องเรียน)
  portal_tasks           งานส่งไฟล์
  portal_task_slots      กล่องรับไฟล์ของแต่ละงาน
  portal_audience        ผู้เข้าร่วม/ผู้ต้องส่ง (ใช้ร่วม event + task)
  portal_submissions     1 กล่อง : 1 ครู
  portal_teachers/config/settings/notifications
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings

DATA_DIR = Path(__file__).parent / "data"
PORTAL_DIR = DATA_DIR / "portal"

_write_lock = asyncio.Lock()

EVENT_FIELDS = [
    "id", "timetable_id", "title", "description", "event_date", "end_date",
    "start_time", "end_time", "all_day", "location", "target_type",
    "is_published", "created_by",
]
TASK_FIELDS = [
    "id", "timetable_id", "title", "description", "open_at", "due_datetime",
    "allow_late", "is_published", "target_type", "drive_folder_id", "created_by",
]
SLOT_FIELDS = [
    "id", "timetable_id", "task_id", "title", "description", "is_required",
    "allowed_ext", "max_mb", "sort_order",
]
SUBMISSION_FIELDS = [
    "id", "timetable_id", "task_id", "slot_id", "teacher_id", "file_name",
    "storage_backend", "storage_key", "web_view_url", "file_size_bytes",
    "mime_type", "checksum", "submitted_at", "due_at", "status", "note",
    "revision",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def _chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


class PortalStoreError(Exception):
    """Raised when the underlying store rejects a query."""


# ── D1 backend ─────────────────────────────────────────────────────────────

class D1PortalStore:
    """Cloudflare D1 implementation. Reuses `d1_service.D1Client`."""

    def __init__(self, client: Any = None) -> None:
        if client is not None:
            self._client = client
        else:
            from d1_service import D1Client
            self._client = D1Client()

    async def _q(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        try:
            result = await self._client.execute_query(sql, params)
        except Exception as e:  # D1Error and transport errors
            raise PortalStoreError(str(e)) from e
        return result.get("results") or []

    async def _exec(self, sql: str, params: list[Any] | None = None) -> int:
        try:
            result = await self._client.execute_query(sql, params)
        except Exception as e:
            raise PortalStoreError(str(e)) from e
        return int((result.get("meta") or {}).get("changes", 0))

    # ── config ──────────────────────────────────────────────────────────

    async def get_config(self, timetable_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_config WHERE timetable_id = ? LIMIT 1",
            [timetable_id],
        )
        return _normalize_config(rows[0]) if rows else None

    async def upsert_config(self, timetable_id: str, fields: dict) -> dict:
        current = await self.get_config(timetable_id) or {"timetable_id": timetable_id}
        merged = {**current, **fields}
        merged["timetable_id"] = timetable_id
        await self._exec(
            """
            INSERT INTO portal_config
                (timetable_id, school_name, is_published, drive_folder_id,
                 drive_folder_url, drive_drive_id, webhook_url,
                 webhook_last_status, webhook_last_at, late_policy,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(timetable_id) DO UPDATE SET
                school_name         = excluded.school_name,
                is_published        = excluded.is_published,
                drive_folder_id     = excluded.drive_folder_id,
                drive_folder_url    = excluded.drive_folder_url,
                drive_drive_id      = excluded.drive_drive_id,
                webhook_url         = excluded.webhook_url,
                webhook_last_status = excluded.webhook_last_status,
                webhook_last_at     = excluded.webhook_last_at,
                late_policy         = excluded.late_policy,
                updated_at          = datetime('now')
            """,
            [
                timetable_id,
                merged.get("school_name") or "",
                int(bool(merged.get("is_published"))),
                merged.get("drive_folder_id"),
                merged.get("drive_folder_url"),
                merged.get("drive_drive_id"),
                merged.get("webhook_url"),
                merged.get("webhook_last_status"),
                merged.get("webhook_last_at"),
                merged.get("late_policy") or "allow",
            ],
        )
        return await self.get_config(timetable_id) or merged

    # ── global settings ─────────────────────────────────────────────────

    async def get_setting(self, key: str) -> str | None:
        rows = await self._q(
            "SELECT value FROM portal_settings WHERE key = ? LIMIT 1", [key]
        )
        return rows[0].get("value") if rows else None

    async def set_setting(self, key: str, value: str | None) -> None:
        if value is None:
            await self.delete_setting(key)
            return
        await self._exec(
            """
            INSERT INTO portal_settings (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                           updated_at = datetime('now')
            """,
            [key, value],
        )

    async def delete_setting(self, key: str) -> None:
        await self._exec("DELETE FROM portal_settings WHERE key = ?", [key])

    # ── teachers ────────────────────────────────────────────────────────

    async def list_teachers(self, timetable_id: str, active_only: bool = True) -> list[dict]:
        sql = "SELECT * FROM portal_teachers WHERE timetable_id = ?"
        if active_only:
            sql += " AND is_active = 1"
        sql += " ORDER BY sort_order ASC, teacher_id ASC"
        return [_normalize_teacher(r) for r in await self._q(sql, [timetable_id])]

    async def get_teacher(self, timetable_id: str, teacher_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_teachers WHERE timetable_id = ? AND teacher_id = ? LIMIT 1",
            [timetable_id, teacher_id],
        )
        return _normalize_teacher(rows[0]) if rows else None

    async def upsert_teachers(self, timetable_id: str, teachers: list[dict]) -> int:
        """Insert new teachers / refresh names. Never overwrites dept/phone/PIN."""
        if not teachers:
            return 0
        changed = 0
        for group in _chunks(teachers, 10):
            placeholders = ", ".join(["(?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL, 1, ?)"] * len(group))
            params: list[Any] = []
            for idx, t in enumerate(group):
                params.extend([
                    timetable_id,
                    str(t["teacher_id"]),
                    t.get("prefix") or "",
                    t.get("full_name") or "",
                    t.get("dept") or "",
                    t.get("pin_hash"),
                    int(t.get("sort_order", idx)),
                ])
            changed += await self._exec(
                f"""
                INSERT INTO portal_teachers
                    (timetable_id, teacher_id, prefix, full_name, dept, phone,
                     pin_hash, pin_set_at, pin_fail_count, pin_locked_until,
                     is_active, sort_order)
                VALUES {placeholders}
                ON CONFLICT(timetable_id, teacher_id) DO UPDATE SET
                    full_name  = excluded.full_name,
                    dept       = CASE WHEN portal_teachers.dept = ''
                                      THEN excluded.dept ELSE portal_teachers.dept END,
                    sort_order = excluded.sort_order,
                    is_active  = 1,
                    updated_at = datetime('now')
                """,
                params,
            )
        return changed

    async def deactivate_missing(self, timetable_id: str, keep_ids: list[str]) -> int:
        if not keep_ids:
            return await self._exec(
                "UPDATE portal_teachers SET is_active = 0 WHERE timetable_id = ?",
                [timetable_id],
            )
        marks = ", ".join(["?"] * len(keep_ids))
        return await self._exec(
            f"""UPDATE portal_teachers SET is_active = 0
                WHERE timetable_id = ? AND teacher_id NOT IN ({marks})""",
            [timetable_id, *keep_ids],
        )

    async def update_teacher(self, timetable_id: str, teacher_id: str, fields: dict) -> bool:
        allowed = {
            k: v for k, v in fields.items()
            if k in ("prefix", "full_name", "dept", "phone", "pin_hash",
                     "pin_set_at", "pin_fail_count", "pin_locked_until",
                     "is_active", "sort_order")
        }
        if not allowed:
            return False
        sets = ", ".join([f"{k} = ?" for k in allowed])
        params = [*allowed.values(), timetable_id, teacher_id]
        return await self._exec(
            f"UPDATE portal_teachers SET {sets}, updated_at = datetime('now') "
            f"WHERE timetable_id = ? AND teacher_id = ?",
            params,
        ) > 0

    # ── audience ────────────────────────────────────────────────────────

    async def get_audience(self, kind: str, activity_id: str) -> list[dict]:
        rows = await self._q(
            """SELECT member_kind, member_id FROM portal_audience
               WHERE kind = ? AND activity_id = ?""",
            [kind, activity_id],
        )
        return [
            {"member_kind": r.get("member_kind"), "member_id": r.get("member_id")}
            for r in rows
        ]

    async def list_audience_bulk(self, kind: str, activity_ids: list[str]) -> dict[str, list[dict]]:
        """activity_id → audience rows, for a whole page of activities (1 query per 50)."""
        out: dict[str, list[dict]] = {aid: [] for aid in activity_ids}
        ids = [str(a) for a in activity_ids if a]
        for group in _chunks(ids, 50):
            marks = ", ".join(["?"] * len(group))
            rows = await self._q(
                f"""SELECT activity_id, member_kind, member_id FROM portal_audience
                    WHERE kind = ? AND activity_id IN ({marks})""",
                [kind, *group],
            )
            for row in rows:
                out.setdefault(row.get("activity_id"), []).append({
                    "member_kind": row.get("member_kind"),
                    "member_id": row.get("member_id"),
                })
        return out

    async def set_audience(self, kind: str, activity_id: str, members: list[dict]) -> int:
        await self._exec(
            "DELETE FROM portal_audience WHERE kind = ? AND activity_id = ?",
            [kind, activity_id],
        )
        if not members:
            return 0
        unique = {
            (str(m.get("member_kind")), str(m.get("member_id")))
            for m in members
            if m.get("member_kind") and m.get("member_id")
        }
        if not unique:
            return 0
        rows = [
            {"kind": kind, "activity_id": activity_id,
             "member_kind": k, "member_id": mid}
            for k, mid in sorted(unique)
        ]
        changed = 0
        for group in _chunks(rows, 20):  # 4 params/row → 20 rows = 80 params
            placeholders = ", ".join(["(?, ?, ?, ?)"] * len(group))
            params: list[Any] = []
            for r in group:
                params.extend([r["kind"], r["activity_id"], r["member_kind"], r["member_id"]])
            changed += await self._exec(
                f"""INSERT INTO portal_audience
                    (kind, activity_id, member_kind, member_id)
                    VALUES {placeholders}""",
                params,
            )
        return changed

    # ── events (กิจกรรมโรงเรียน) ────────────────────────────────────────

    async def list_events(
        self,
        timetable_id: str,
        from_date: str | None = None,
        to_date: str | None = None,
        published_only: bool = True,
    ) -> list[dict]:
        sql = "SELECT * FROM portal_events WHERE timetable_id = ?"
        params: list[Any] = [timetable_id]
        if from_date:
            sql += " AND COALESCE(end_date, event_date) >= ?"
            params.append(from_date)
        if to_date:
            sql += " AND event_date <= ?"
            params.append(to_date)
        if published_only:
            sql += " AND is_published = 1"
        sql += " ORDER BY event_date ASC, COALESCE(start_time, '') ASC"
        return [_normalize_event(r) for r in await self._q(sql, params)]

    async def get_event(self, timetable_id: str, event_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_events WHERE timetable_id = ? AND id = ? LIMIT 1",
            [timetable_id, event_id],
        )
        return _normalize_event(rows[0]) if rows else None

    async def create_event(self, timetable_id: str, data: dict) -> dict:
        event_id = data.get("id") or new_id("evt_")
        await self._exec(
            """
            INSERT INTO portal_events
                (id, timetable_id, title, description, event_date, end_date,
                 start_time, end_time, all_day, location, target_type,
                 is_published, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            [
                event_id, timetable_id, data["title"], data.get("description") or "",
                data["event_date"], data.get("end_date"),
                data.get("start_time"), data.get("end_time"),
                1 if data.get("all_day", True) else 0, data.get("location"),
                data.get("target_type") or "all",
                1 if data.get("is_published", True) else 0,
                data.get("created_by"),
            ],
        )
        return await self.get_event(timetable_id, event_id) or {"id": event_id}

    async def update_event(self, timetable_id: str, event_id: str, fields: dict) -> bool:
        allowed = {
            k: v for k, v in fields.items()
            if k in ("title", "description", "event_date", "end_date", "start_time",
                     "end_time", "all_day", "location", "target_type", "is_published")
        }
        if not allowed:
            return False
        for key in ("all_day", "is_published"):
            if key in allowed:
                allowed[key] = 1 if allowed[key] else 0
        sets = ", ".join([f"{k} = ?" for k in allowed])
        params = [*allowed.values(), timetable_id, event_id]
        return await self._exec(
            f"UPDATE portal_events SET {sets}, updated_at = datetime('now') "
            f"WHERE timetable_id = ? AND id = ?",
            params,
        ) > 0

    async def delete_event(self, timetable_id: str, event_id: str) -> bool:
        await self._exec(
            "DELETE FROM portal_audience WHERE kind = 'event' AND activity_id = ?",
            [event_id],
        )
        return await self._exec(
            "DELETE FROM portal_events WHERE timetable_id = ? AND id = ?",
            [timetable_id, event_id],
        ) > 0

    # ── tasks (งานส่งไฟล์) ──────────────────────────────────────────────

    async def list_tasks(
        self, timetable_id: str, published_only: bool = True
    ) -> list[dict]:
        sql = "SELECT * FROM portal_tasks WHERE timetable_id = ?"
        if published_only:
            sql += " AND is_published = 1"
        sql += " ORDER BY due_datetime ASC"
        return [_normalize_task(r) for r in await self._q(sql, [timetable_id])]

    async def get_task(self, timetable_id: str, task_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_tasks WHERE timetable_id = ? AND id = ? LIMIT 1",
            [timetable_id, task_id],
        )
        return _normalize_task(rows[0]) if rows else None

    async def create_task(self, timetable_id: str, data: dict) -> dict:
        task_id = data.get("id") or new_id("task_")
        await self._exec(
            """
            INSERT INTO portal_tasks
                (id, timetable_id, title, description, open_at, due_datetime,
                 allow_late, is_published, target_type, drive_folder_id,
                 created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            [
                task_id, timetable_id, data["title"], data.get("description") or "",
                data.get("open_at"), data["due_datetime"],
                1 if data.get("allow_late", True) else 0,
                1 if data.get("is_published", True) else 0,
                data.get("target_type") or "all",
                data.get("drive_folder_id"), data.get("created_by"),
            ],
        )
        return await self.get_task(timetable_id, task_id) or {"id": task_id}

    async def update_task(self, timetable_id: str, task_id: str, fields: dict) -> bool:
        allowed = {
            k: v for k, v in fields.items()
            if k in ("title", "description", "open_at", "due_datetime", "allow_late",
                     "is_published", "target_type", "drive_folder_id")
        }
        if not allowed:
            return False
        for key in ("allow_late", "is_published"):
            if key in allowed:
                allowed[key] = 1 if allowed[key] else 0
        sets = ", ".join([f"{k} = ?" for k in allowed])
        params = [*allowed.values(), timetable_id, task_id]
        return await self._exec(
            f"UPDATE portal_tasks SET {sets}, updated_at = datetime('now') "
            f"WHERE timetable_id = ? AND id = ?",
            params,
        ) > 0

    async def delete_task(self, timetable_id: str, task_id: str) -> bool:
        await self._exec(
            "DELETE FROM portal_task_slots WHERE task_id = ?", [task_id]
        )
        await self._exec(
            "DELETE FROM portal_audience WHERE kind = 'task' AND activity_id = ?", [task_id]
        )
        await self._exec(
            "DELETE FROM portal_submissions WHERE timetable_id = ? AND task_id = ?",
            [timetable_id, task_id],
        )
        return await self._exec(
            "DELETE FROM portal_tasks WHERE timetable_id = ? AND id = ?",
            [timetable_id, task_id],
        ) > 0

    # ── slots (กล่องรับไฟล์) ────────────────────────────────────────────

    async def list_slots(self, timetable_id: str, task_id: str | None = None) -> list[dict]:
        sql = "SELECT * FROM portal_task_slots WHERE timetable_id = ?"
        params: list[Any] = [timetable_id]
        if task_id:
            sql += " AND task_id = ?"
            params.append(task_id)
        sql += " ORDER BY sort_order ASC"
        return [_normalize_slot(r) for r in await self._q(sql, params)]

    async def get_slot(self, timetable_id: str, slot_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_task_slots WHERE timetable_id = ? AND id = ? LIMIT 1",
            [timetable_id, slot_id],
        )
        return _normalize_slot(rows[0]) if rows else None

    async def set_slots(self, timetable_id: str, task_id: str, slots: list[dict]) -> list[dict]:
        """Replace a task's slots. Removed slots take their submissions with them."""
        existing = {s["id"]: s for s in await self.list_slots(timetable_id, task_id)}
        keep_ids = {s["id"] for s in slots if s.get("id")}

        for slot_id in set(existing) - keep_ids:
            await self._exec("DELETE FROM portal_submissions WHERE slot_id = ?", [slot_id])
            await self._exec("DELETE FROM portal_task_slots WHERE id = ?", [slot_id])

        for idx, slot in enumerate(slots):
            slot_id = slot.get("id") or new_id("slot_")
            values = [
                slot_id, timetable_id, task_id, slot.get("title") or "ไฟล์",
                slot.get("description") or "",
                1 if slot.get("is_required", True) else 0,
                slot.get("allowed_ext") or settings.PORTAL_ALLOWED_EXT,
                int(slot.get("max_mb") or settings.PORTAL_MAX_UPLOAD_MB),
                int(slot["sort_order"]) if slot.get("sort_order") is not None else idx,
            ]
            if slot_id in existing:
                await self._exec(
                    """UPDATE portal_task_slots
                       SET title = ?, description = ?, is_required = ?,
                           allowed_ext = ?, max_mb = ?, sort_order = ?
                       WHERE id = ?""",
                    [values[3], values[4], values[5], values[6], values[7], values[8], slot_id],
                )
            else:
                await self._exec(
                    """INSERT INTO portal_task_slots
                       (id, timetable_id, task_id, title, description, is_required,
                        allowed_ext, max_mb, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    values,
                )
        return await self.list_slots(timetable_id, task_id)

    # ── submissions ─────────────────────────────────────────────────────

    async def list_submissions(
        self,
        timetable_id: str,
        task_id: str | None = None,
        teacher_id: str | None = None,
        slot_id: str | None = None,
    ) -> list[dict]:
        sql = "SELECT * FROM portal_submissions WHERE timetable_id = ?"
        params: list[Any] = [timetable_id]
        if task_id:
            sql += " AND task_id = ?"
            params.append(task_id)
        if teacher_id:
            sql += " AND teacher_id = ?"
            params.append(teacher_id)
        if slot_id:
            sql += " AND slot_id = ?"
            params.append(slot_id)
        sql += " ORDER BY submitted_at DESC"
        return [_normalize_submission(r) for r in await self._q(sql, params)]

    async def get_submission(self, timetable_id: str, slot_id: str, teacher_id: str) -> dict | None:
        rows = await self._q(
            """SELECT * FROM portal_submissions
               WHERE timetable_id = ? AND slot_id = ? AND teacher_id = ? LIMIT 1""",
            [timetable_id, slot_id, teacher_id],
        )
        return _normalize_submission(rows[0]) if rows else None

    async def get_submission_by_id(self, timetable_id: str, submission_id: str) -> dict | None:
        rows = await self._q(
            "SELECT * FROM portal_submissions WHERE timetable_id = ? AND id = ? LIMIT 1",
            [timetable_id, submission_id],
        )
        return _normalize_submission(rows[0]) if rows else None

    async def save_submission(self, row: dict) -> dict:
        await self._exec(
            """
            INSERT INTO portal_submissions
                (id, timetable_id, task_id, slot_id, teacher_id, file_name,
                 storage_backend, storage_key, web_view_url, file_size_bytes,
                 mime_type, checksum, submitted_at, due_at, status, note, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slot_id, teacher_id) DO UPDATE SET
                id              = excluded.id,
                task_id         = excluded.task_id,
                file_name       = excluded.file_name,
                storage_backend = excluded.storage_backend,
                storage_key     = excluded.storage_key,
                web_view_url    = excluded.web_view_url,
                file_size_bytes = excluded.file_size_bytes,
                mime_type       = excluded.mime_type,
                checksum        = excluded.checksum,
                submitted_at    = excluded.submitted_at,
                due_at          = excluded.due_at,
                status          = excluded.status,
                note            = excluded.note,
                revision        = excluded.revision
            """,
            [row.get(f) for f in SUBMISSION_FIELDS],
        )
        return row

    async def add_history(self, row: dict) -> None:
        await self._exec(
            """
            INSERT INTO portal_submission_history
                (id, submission_id, timetable_id, task_id, slot_id, teacher_id,
                 file_name, storage_backend, storage_key, file_size_bytes,
                 submitted_at, status, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                row.get("id") or new_id("hist_"), row.get("submission_id"),
                row.get("timetable_id"), row.get("task_id"), row.get("slot_id"),
                row.get("teacher_id"), row.get("file_name"),
                row.get("storage_backend"), row.get("storage_key"),
                row.get("file_size_bytes"), row.get("submitted_at"),
                row.get("status"), row.get("revision") or 1,
            ],
        )

    async def list_history(
        self, timetable_id: str, task_id: str, teacher_id: str | None = None
    ) -> list[dict]:
        sql = """SELECT * FROM portal_submission_history
                 WHERE timetable_id = ? AND task_id = ?"""
        params: list[Any] = [timetable_id, task_id]
        if teacher_id:
            sql += " AND teacher_id = ?"
            params.append(teacher_id)
        sql += " ORDER BY submitted_at DESC"
        return await self._q(sql, params)

    # ── notifications ───────────────────────────────────────────────────

    async def list_notifications(
        self, timetable_id: str, teacher_id: str | None, limit: int = 60
    ) -> list[dict]:
        sql = """SELECT * FROM portal_notifications
                 WHERE timetable_id = ? AND (teacher_id IS NULL OR teacher_id = ?)
                 ORDER BY created_at DESC LIMIT ?"""
        return await self._q(sql, [timetable_id, teacher_id, limit])

    async def add_notifications(self, rows: list[dict]) -> int:
        if not rows:
            return 0
        changed = 0
        for group in _chunks(rows, 8):  # 11 params/row → 8 rows = 88 params
            placeholders = ", ".join(["(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"] * len(group))
            params: list[Any] = []
            for r in group:
                params.extend([
                    r.get("id") or new_id("ntf_"), r.get("timetable_id"),
                    r.get("teacher_id"), r.get("event_id"), r.get("task_id"),
                    r.get("kind") or "info", r.get("title") or "",
                    r.get("body") or "", r.get("link"), r.get("created_by"),
                    r.get("created_at") or _now_iso(),
                ])
            changed += await self._exec(
                f"""
                INSERT INTO portal_notifications
                    (id, timetable_id, teacher_id, event_id, task_id, kind,
                     title, body, link, created_by, created_at)
                VALUES {placeholders}
                """,
                params,
            )
        return changed

    async def mark_notification_read(
        self, timetable_id: str, teacher_id: str, notification_id: str
    ) -> bool:
        return await self._exec(
            """UPDATE portal_notifications SET read_at = ?
               WHERE id = ? AND timetable_id = ?
                 AND (teacher_id IS NULL OR teacher_id = ?)""",
            [_now_iso(), notification_id, timetable_id, teacher_id],
        ) > 0

    async def mark_all_notifications_read(self, timetable_id: str, teacher_id: str) -> int:
        return await self._exec(
            """UPDATE portal_notifications SET read_at = ?
               WHERE timetable_id = ? AND read_at IS NULL
                 AND (teacher_id IS NULL OR teacher_id = ?)""",
            [_now_iso(), timetable_id, teacher_id],
        )

    async def delete_notifications(
        self, timetable_id: str, *, event_id: str | None = None, task_id: str | None = None
    ) -> int:
        if task_id:
            return await self._exec(
                "DELETE FROM portal_notifications WHERE timetable_id = ? AND task_id = ?",
                [timetable_id, task_id],
            )
        if event_id:
            return await self._exec(
                "DELETE FROM portal_notifications WHERE timetable_id = ? AND event_id = ?",
                [timetable_id, event_id],
            )
        return 0

    # ── substitute payload lookup ───────────────────────────────────────

    async def find_substitute_payload(
        self, timetable_id: str, owner_user_id: str | None, date: str
    ) -> dict | None:
        try:
            rows = await self._q(
                """SELECT payload_json FROM substitute_shares
                   WHERE timetable_id = ? AND date = ? LIMIT 1""",
                [timetable_id, date],
            )
        except PortalStoreError:
            rows = []
        if not rows:
            try:
                rows = await self._q(
                    """SELECT payload_json FROM substitute_shares
                       WHERE date = ? AND (? IS NULL OR user_id = ?)
                       ORDER BY updated_at DESC LIMIT 5""",
                    [date, owner_user_id, owner_user_id],
                )
            except PortalStoreError:
                rows = []
        for row in rows:
            raw = row.get("payload_json")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else raw
            except (json.JSONDecodeError, TypeError):
                continue
            if payload:
                return payload
        return None


# ── Local JSON backend ─────────────────────────────────────────────────────

class LocalPortalStore:
    """JSON-file implementation for offline dev and tests."""

    def __init__(self, data_dir: Path | str | None = None) -> None:
        self._dir = Path(data_dir) if data_dir else PORTAL_DIR

    def _path(self, name: str) -> Path:
        return self._dir / f"{name}.json"

    async def _load(self, name: str) -> list[dict]:
        def _read() -> list[dict]:
            p = self._path(name)
            if not p.exists():
                return []
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return []
            return data if isinstance(data, list) else []
        return await asyncio.to_thread(_read)

    async def _save(self, name: str, rows: list[dict]) -> None:
        async with _write_lock:
            def _write() -> None:
                self._dir.mkdir(parents=True, exist_ok=True)
                p = self._path(name)
                tmp = p.with_suffix(".json.tmp")
                tmp.write_text(
                    json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8"
                )
                tmp.replace(p)
            await asyncio.to_thread(_write)

    # ── config / settings ───────────────────────────────────────────────

    async def get_config(self, timetable_id: str) -> dict | None:
        for row in await self._load("config"):
            if row.get("timetable_id") == timetable_id:
                return _normalize_config(row)
        return None

    async def upsert_config(self, timetable_id: str, fields: dict) -> dict:
        rows = await self._load("config")
        current = next(
            (r for r in rows if r.get("timetable_id") == timetable_id),
            {"timetable_id": timetable_id},
        )
        merged = {**current, **fields, "timetable_id": timetable_id}
        merged.setdefault("school_name", "")
        merged.setdefault("is_published", 0)
        merged.setdefault("late_policy", "allow")
        rows = [r for r in rows if r.get("timetable_id") != timetable_id]
        rows.append(merged)
        await self._save("config", rows)
        return _normalize_config(merged)

    async def get_setting(self, key: str) -> str | None:
        for row in await self._load("settings"):
            if row.get("key") == key:
                return row.get("value")
        return None

    async def set_setting(self, key: str, value: str | None) -> None:
        rows = [r for r in await self._load("settings") if r.get("key") != key]
        if value is not None:
            rows.append({"key": key, "value": value, "updated_at": _now_iso()})
        await self._save("settings", rows)

    async def delete_setting(self, key: str) -> None:
        await self.set_setting(key, None)

    # ── teachers ────────────────────────────────────────────────────────

    async def list_teachers(self, timetable_id: str, active_only: bool = True) -> list[dict]:
        rows = [
            _normalize_teacher(r) for r in await self._load("teachers")
            if r.get("timetable_id") == timetable_id
            and (not active_only or r.get("is_active", 1))
        ]
        rows.sort(key=lambda r: (r.get("sort_order") or 0, r.get("teacher_id") or ""))
        return rows

    async def get_teacher(self, timetable_id: str, teacher_id: str) -> dict | None:
        for row in await self._load("teachers"):
            if row.get("timetable_id") == timetable_id and row.get("teacher_id") == teacher_id:
                return _normalize_teacher(row)
        return None

    async def upsert_teachers(self, timetable_id: str, teachers: list[dict]) -> int:
        rows = await self._load("teachers")
        index = {(r.get("timetable_id"), r.get("teacher_id")): r for r in rows}
        changed = 0
        for idx, t in enumerate(teachers):
            key = (timetable_id, str(t["teacher_id"]))
            existing = index.get(key)
            if existing:
                existing["full_name"] = t.get("full_name") or existing.get("full_name") or ""
                if not existing.get("dept") and t.get("dept"):
                    existing["dept"] = t["dept"]
                existing["sort_order"] = t.get("sort_order", idx)
                existing["is_active"] = 1
                existing["updated_at"] = _now_iso()
            else:
                row = {
                    "timetable_id": timetable_id,
                    "teacher_id": str(t["teacher_id"]),
                    "prefix": t.get("prefix") or "",
                    "full_name": t.get("full_name") or "",
                    "dept": t.get("dept") or "",
                    "phone": None,
                    "pin_hash": t.get("pin_hash"),
                    "pin_set_at": None,
                    "pin_fail_count": 0,
                    "pin_locked_until": None,
                    "is_active": 1,
                    "sort_order": t.get("sort_order", idx),
                    "created_at": _now_iso(),
                    "updated_at": _now_iso(),
                }
                rows.append(row)
                index[key] = row
            changed += 1
        await self._save("teachers", rows)
        return changed

    async def deactivate_missing(self, timetable_id: str, keep_ids: list[str]) -> int:
        keep = {str(k) for k in keep_ids}
        rows = await self._load("teachers")
        changed = 0
        for r in rows:
            if r.get("timetable_id") != timetable_id:
                continue
            active = str(r.get("teacher_id")) in keep
            if bool(r.get("is_active", 1)) != active:
                r["is_active"] = 1 if active else 0
                r["updated_at"] = _now_iso()
                changed += 1
        await self._save("teachers", rows)
        return changed

    async def update_teacher(self, timetable_id: str, teacher_id: str, fields: dict) -> bool:
        rows = await self._load("teachers")
        hit = False
        for r in rows:
            if r.get("timetable_id") == timetable_id and r.get("teacher_id") == teacher_id:
                r.update(fields)
                r["updated_at"] = _now_iso()
                hit = True
                break
        if hit:
            await self._save("teachers", rows)
        return hit

    # ── audience ────────────────────────────────────────────────────────

    async def get_audience(self, kind: str, activity_id: str) -> list[dict]:
        rows = await self._load("audience")
        return [
            {"member_kind": r.get("member_kind"), "member_id": r.get("member_id")}
            for r in rows
            if r.get("kind") == kind and r.get("activity_id") == activity_id
        ]

    async def list_audience_bulk(self, kind: str, activity_ids: list[str]) -> dict[str, list[dict]]:
        wanted = {str(a) for a in activity_ids if a}
        out: dict[str, list[dict]] = {aid: [] for aid in wanted}
        for r in await self._load("audience"):
            if r.get("kind") != kind or str(r.get("activity_id")) not in wanted:
                continue
            out.setdefault(str(r.get("activity_id")), []).append({
                "member_kind": r.get("member_kind"),
                "member_id": r.get("member_id"),
            })
        return out

    async def set_audience(self, kind: str, activity_id: str, members: list[dict]) -> int:
        rows = [
            r for r in await self._load("audience")
            if not (r.get("kind") == kind and r.get("activity_id") == activity_id)
        ]
        seen = set()
        for m in members or []:
            mk, mid = m.get("member_kind"), m.get("member_id")
            if not mk or not mid or (mk, mid) in seen:
                continue
            seen.add((mk, mid))
            rows.append({
                "kind": kind, "activity_id": activity_id,
                "member_kind": mk, "member_id": mid,
            })
        await self._save("audience", rows)
        return len(seen)

    # ── events ──────────────────────────────────────────────────────────

    async def list_events(
        self,
        timetable_id: str,
        from_date: str | None = None,
        to_date: str | None = None,
        published_only: bool = True,
    ) -> list[dict]:
        rows = []
        for r in await self._load("events"):
            if r.get("timetable_id") != timetable_id:
                continue
            if published_only and not r.get("is_published", 1):
                continue
            last_day = r.get("end_date") or r.get("event_date") or ""
            if from_date and last_day < from_date:
                continue
            if to_date and (r.get("event_date") or "") > to_date:
                continue
            rows.append(_normalize_event(r))
        rows.sort(key=lambda r: (r.get("event_date") or "", r.get("start_time") or ""))
        return rows

    async def get_event(self, timetable_id: str, event_id: str) -> dict | None:
        for r in await self._load("events"):
            if r.get("timetable_id") == timetable_id and r.get("id") == event_id:
                return _normalize_event(r)
        return None

    async def create_event(self, timetable_id: str, data: dict) -> dict:
        rows = await self._load("events")
        row = {
            "id": data.get("id") or new_id("evt_"),
            "timetable_id": timetable_id,
            "title": data["title"],
            "description": data.get("description") or "",
            "event_date": data["event_date"],
            "end_date": data.get("end_date"),
            "start_time": data.get("start_time"),
            "end_time": data.get("end_time"),
            "all_day": 1 if data.get("all_day", True) else 0,
            "location": data.get("location"),
            "target_type": data.get("target_type") or "all",
            "is_published": 1 if data.get("is_published", True) else 0,
            "created_by": data.get("created_by"),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        rows.append(row)
        await self._save("events", rows)
        return _normalize_event(row)

    async def update_event(self, timetable_id: str, event_id: str, fields: dict) -> bool:
        rows = await self._load("events")
        hit = False
        for r in rows:
            if r.get("timetable_id") == timetable_id and r.get("id") == event_id:
                for key, value in fields.items():
                    if key in EVENT_FIELDS and key not in ("id", "timetable_id"):
                        if key in ("all_day", "is_published"):
                            value = 1 if value else 0
                        r[key] = value
                r["updated_at"] = _now_iso()
                hit = True
                break
        if hit:
            await self._save("events", rows)
        return hit

    async def delete_event(self, timetable_id: str, event_id: str) -> bool:
        rows = await self._load("events")
        kept = [
            r for r in rows
            if not (r.get("timetable_id") == timetable_id and r.get("id") == event_id)
        ]
        if len(kept) == len(rows):
            return False
        await self._save("events", kept)
        await self.set_audience("event", event_id, [])
        return True

    # ── tasks ───────────────────────────────────────────────────────────

    async def list_tasks(self, timetable_id: str, published_only: bool = True) -> list[dict]:
        rows = [
            _normalize_task(r) for r in await self._load("tasks")
            if r.get("timetable_id") == timetable_id
            and (not published_only or r.get("is_published", 1))
        ]
        rows.sort(key=lambda r: r.get("due_datetime") or "")
        return rows

    async def get_task(self, timetable_id: str, task_id: str) -> dict | None:
        for r in await self._load("tasks"):
            if r.get("timetable_id") == timetable_id and r.get("id") == task_id:
                return _normalize_task(r)
        return None

    async def create_task(self, timetable_id: str, data: dict) -> dict:
        rows = await self._load("tasks")
        row = {
            "id": data.get("id") or new_id("task_"),
            "timetable_id": timetable_id,
            "title": data["title"],
            "description": data.get("description") or "",
            "open_at": data.get("open_at"),
            "due_datetime": data["due_datetime"],
            "allow_late": 1 if data.get("allow_late", True) else 0,
            "is_published": 1 if data.get("is_published", True) else 0,
            "target_type": data.get("target_type") or "all",
            "drive_folder_id": data.get("drive_folder_id"),
            "created_by": data.get("created_by"),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        rows.append(row)
        await self._save("tasks", rows)
        return _normalize_task(row)

    async def update_task(self, timetable_id: str, task_id: str, fields: dict) -> bool:
        rows = await self._load("tasks")
        hit = False
        for r in rows:
            if r.get("timetable_id") == timetable_id and r.get("id") == task_id:
                for key, value in fields.items():
                    if key in TASK_FIELDS and key not in ("id", "timetable_id"):
                        if key in ("allow_late", "is_published"):
                            value = 1 if value else 0
                        r[key] = value
                r["updated_at"] = _now_iso()
                hit = True
                break
        if hit:
            await self._save("tasks", rows)
        return hit

    async def delete_task(self, timetable_id: str, task_id: str) -> bool:
        rows = await self._load("tasks")
        kept = [
            r for r in rows
            if not (r.get("timetable_id") == timetable_id and r.get("id") == task_id)
        ]
        if len(kept) == len(rows):
            return False
        await self._save("tasks", kept)
        slots = [s for s in await self._load("slots") if s.get("task_id") != task_id]
        await self._save("slots", slots)
        submissions = [
            s for s in await self._load("submissions") if s.get("task_id") != task_id
        ]
        await self._save("submissions", submissions)
        await self.set_audience("task", task_id, [])
        return True

    # ── slots ───────────────────────────────────────────────────────────

    async def list_slots(self, timetable_id: str, task_id: str | None = None) -> list[dict]:
        rows = [
            _normalize_slot(r) for r in await self._load("slots")
            if r.get("timetable_id") == timetable_id
            and (not task_id or r.get("task_id") == task_id)
        ]
        rows.sort(key=lambda r: (r.get("sort_order") or 0, r.get("title") or ""))
        return rows

    async def get_slot(self, timetable_id: str, slot_id: str) -> dict | None:
        for r in await self._load("slots"):
            if r.get("timetable_id") == timetable_id and r.get("id") == slot_id:
                return _normalize_slot(r)
        return None

    async def set_slots(self, timetable_id: str, task_id: str, slots: list[dict]) -> list[dict]:
        all_slots = await self._load("slots")
        existing = {
            s["id"]: s for s in all_slots
            if s.get("timetable_id") == timetable_id and s.get("task_id") == task_id
        }
        keep_ids = {s["id"] for s in slots if s.get("id")}

        removed = set(existing) - keep_ids
        if removed:
            all_slots = [s for s in all_slots if s.get("id") not in removed]
            submissions = [
                s for s in await self._load("submissions") if s.get("slot_id") not in removed
            ]
            await self._save("submissions", submissions)

        for idx, slot in enumerate(slots):
            slot_id = slot.get("id") or new_id("slot_")
            payload = {
                "id": slot_id,
                "timetable_id": timetable_id,
                "task_id": task_id,
                "title": slot.get("title") or "ไฟล์",
                "description": slot.get("description") or "",
                "is_required": 1 if slot.get("is_required", True) else 0,
                "allowed_ext": slot.get("allowed_ext") or settings.PORTAL_ALLOWED_EXT,
                "max_mb": int(slot.get("max_mb") or settings.PORTAL_MAX_UPLOAD_MB),
                "sort_order": int(slot["sort_order"]) if slot.get("sort_order") is not None else idx,
            }
            if slot_id in existing:
                for r in all_slots:
                    if r.get("id") == slot_id:
                        r.update(payload)
                        break
            else:
                all_slots.append(payload)
        await self._save("slots", all_slots)
        return await self.list_slots(timetable_id, task_id)

    # ── submissions ─────────────────────────────────────────────────────

    async def list_submissions(
        self,
        timetable_id: str,
        task_id: str | None = None,
        teacher_id: str | None = None,
        slot_id: str | None = None,
    ) -> list[dict]:
        rows = [
            _normalize_submission(r) for r in await self._load("submissions")
            if r.get("timetable_id") == timetable_id
            and (not task_id or r.get("task_id") == task_id)
            and (not teacher_id or r.get("teacher_id") == teacher_id)
            and (not slot_id or r.get("slot_id") == slot_id)
        ]
        rows.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)
        return rows

    async def get_submission(self, timetable_id: str, slot_id: str, teacher_id: str) -> dict | None:
        for r in await self._load("submissions"):
            if (r.get("timetable_id") == timetable_id
                    and r.get("slot_id") == slot_id
                    and r.get("teacher_id") == teacher_id):
                return _normalize_submission(r)
        return None

    async def get_submission_by_id(self, timetable_id: str, submission_id: str) -> dict | None:
        for r in await self._load("submissions"):
            if r.get("timetable_id") == timetable_id and r.get("id") == submission_id:
                return _normalize_submission(r)
        return None

    async def save_submission(self, row: dict) -> dict:
        rows = await self._load("submissions")
        rows = [
            r for r in rows
            if not (r.get("slot_id") == row.get("slot_id")
                    and r.get("teacher_id") == row.get("teacher_id"))
        ]
        rows.append({k: row.get(k) for k in SUBMISSION_FIELDS})
        await self._save("submissions", rows)
        return row

    async def add_history(self, row: dict) -> None:
        rows = await self._load("submission_history")
        rows.append({
            "id": row.get("id") or new_id("hist_"),
            "submission_id": row.get("submission_id"),
            "timetable_id": row.get("timetable_id"),
            "task_id": row.get("task_id"),
            "slot_id": row.get("slot_id"),
            "teacher_id": row.get("teacher_id"),
            "file_name": row.get("file_name"),
            "storage_backend": row.get("storage_backend"),
            "storage_key": row.get("storage_key"),
            "file_size_bytes": row.get("file_size_bytes"),
            "submitted_at": row.get("submitted_at"),
            "status": row.get("status"),
            "revision": row.get("revision") or 1,
        })
        await self._save("submission_history", rows)

    async def list_history(
        self, timetable_id: str, task_id: str, teacher_id: str | None = None
    ) -> list[dict]:
        rows = [
            r for r in await self._load("submission_history")
            if r.get("timetable_id") == timetable_id and r.get("task_id") == task_id
            and (not teacher_id or r.get("teacher_id") == teacher_id)
        ]
        rows.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)
        return rows

    # ── notifications ───────────────────────────────────────────────────

    async def list_notifications(
        self, timetable_id: str, teacher_id: str | None, limit: int = 60
    ) -> list[dict]:
        rows = [
            r for r in await self._load("notifications")
            if r.get("timetable_id") == timetable_id
            and (r.get("teacher_id") in (None, teacher_id))
        ]
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return rows[:limit]

    async def add_notifications(self, rows: list[dict]) -> int:
        store = await self._load("notifications")
        for r in rows:
            store.append({
                "id": r.get("id") or new_id("ntf_"),
                "timetable_id": r.get("timetable_id"),
                "teacher_id": r.get("teacher_id"),
                "event_id": r.get("event_id"),
                "task_id": r.get("task_id"),
                "kind": r.get("kind") or "info",
                "title": r.get("title") or "",
                "body": r.get("body") or "",
                "link": r.get("link"),
                "created_by": r.get("created_by"),
                "created_at": r.get("created_at") or _now_iso(),
                "read_at": None,
            })
        await self._save("notifications", store)
        return len(rows)

    async def mark_notification_read(
        self, timetable_id: str, teacher_id: str, notification_id: str
    ) -> bool:
        rows = await self._load("notifications")
        hit = False
        for r in rows:
            if (r.get("id") == notification_id
                    and r.get("timetable_id") == timetable_id
                    and r.get("teacher_id") in (None, teacher_id)):
                r["read_at"] = _now_iso()
                hit = True
        if hit:
            await self._save("notifications", rows)
        return hit

    async def mark_all_notifications_read(self, timetable_id: str, teacher_id: str) -> int:
        rows = await self._load("notifications")
        changed = 0
        for r in rows:
            if (r.get("timetable_id") == timetable_id
                    and r.get("teacher_id") in (None, teacher_id)
                    and not r.get("read_at")):
                r["read_at"] = _now_iso()
                changed += 1
        if changed:
            await self._save("notifications", rows)
        return changed

    async def delete_notifications(
        self, timetable_id: str, *, event_id: str | None = None, task_id: str | None = None
    ) -> int:
        rows = await self._load("notifications")
        def _match(r: dict) -> bool:
            if r.get("timetable_id") != timetable_id:
                return False
            if task_id:
                return r.get("task_id") == task_id
            if event_id:
                return r.get("event_id") == event_id
            return False
        kept = [r for r in rows if not _match(r)]
        removed = len(rows) - len(kept)
        if removed:
            await self._save("notifications", kept)
        return removed

    # ── substitute payload lookup ───────────────────────────────────────

    async def find_substitute_payload(
        self, timetable_id: str, owner_user_id: str | None, date: str
    ) -> dict | None:
        path = DATA_DIR / "substitute_shares.json"
        if not path.exists():
            return None
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        candidates = [
            r for r in rows
            if r.get("timetable_id") == timetable_id and r.get("date") == date
        ] or [
            r for r in rows
            if r.get("date") == date
            and (owner_user_id is None or r.get("user_id") == owner_user_id)
        ]
        candidates.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
        for row in candidates:
            payload = row.get("payload_json")
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError:
                    continue
            if payload:
                return payload
        return None


# ── Normalizers ────────────────────────────────────────────────────────────

def _normalize_config(row: dict) -> dict:
    return {
        "timetable_id": row.get("timetable_id"),
        "school_name": row.get("school_name") or "",
        "is_published": bool(row.get("is_published")),
        "drive_folder_id": row.get("drive_folder_id"),
        "drive_folder_url": row.get("drive_folder_url"),
        "drive_drive_id": row.get("drive_drive_id"),
        "webhook_url": row.get("webhook_url"),
        "webhook_last_status": row.get("webhook_last_status"),
        "webhook_last_at": row.get("webhook_last_at"),
        "late_policy": row.get("late_policy") or "allow",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_teacher(row: dict) -> dict:
    return {
        "timetable_id": row.get("timetable_id"),
        "teacher_id": row.get("teacher_id"),
        "prefix": row.get("prefix") or "",
        "full_name": row.get("full_name") or "",
        "dept": row.get("dept") or "",
        "phone": row.get("phone"),
        "pin_hash": row.get("pin_hash"),
        "pin_set_at": row.get("pin_set_at"),
        "pin_fail_count": int(row.get("pin_fail_count") or 0),
        "pin_locked_until": row.get("pin_locked_until"),
        "is_active": bool(row.get("is_active", 1)),
        "sort_order": int(row.get("sort_order") or 0),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_event(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "timetable_id": row.get("timetable_id"),
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "event_date": row.get("event_date"),
        "end_date": row.get("end_date"),
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
        "all_day": bool(row.get("all_day", 1)),
        "location": row.get("location"),
        "target_type": row.get("target_type") or "all",
        "is_published": bool(row.get("is_published", 1)),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_task(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "timetable_id": row.get("timetable_id"),
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "open_at": row.get("open_at"),
        "due_datetime": row.get("due_datetime"),
        "allow_late": bool(row.get("allow_late", 1)),
        "is_published": bool(row.get("is_published", 1)),
        "target_type": row.get("target_type") or "all",
        "drive_folder_id": row.get("drive_folder_id"),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_slot(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "timetable_id": row.get("timetable_id"),
        "task_id": row.get("task_id"),
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "is_required": bool(row.get("is_required", 1)),
        "allowed_ext": row.get("allowed_ext") or settings.PORTAL_ALLOWED_EXT,
        "max_mb": int(row.get("max_mb") or settings.PORTAL_MAX_UPLOAD_MB),
        "sort_order": int(row.get("sort_order") or 0),
    }


def _normalize_submission(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "timetable_id": row.get("timetable_id"),
        "task_id": row.get("task_id"),
        "slot_id": row.get("slot_id"),
        "teacher_id": row.get("teacher_id"),
        "file_name": row.get("file_name"),
        "storage_backend": row.get("storage_backend") or "local",
        "storage_key": row.get("storage_key"),
        "web_view_url": row.get("web_view_url"),
        "file_size_bytes": row.get("file_size_bytes"),
        "mime_type": row.get("mime_type"),
        "checksum": row.get("checksum"),
        "submitted_at": row.get("submitted_at"),
        "due_at": row.get("due_at"),
        "status": row.get("status") or "submitted",
        "note": row.get("note") or "",
        "revision": int(row.get("revision") or 1),
    }


# ── Factory ────────────────────────────────────────────────────────────────

def get_portal_store() -> Any:
    """Return a D1-backed store when configured, else the local JSON store."""
    if settings.d1_configured:
        return D1PortalStore()
    return LocalPortalStore()
