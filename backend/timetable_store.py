"""Local JSON-file fallback for the timetables store.

Used when Cloudflare D1 credentials are not configured so the timetables API
still works in local development. Exposes the same async method signatures as
`d1_service.D1Client`, so the API router is storage-agnostic.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent / "data"
TIMETABLES_FILE = DATA_DIR / "timetables.json"
USERS_FILE = DATA_DIR / "users.json"

# Module-level lock so concurrent async writers don't clobber each other.
_write_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_all_sync() -> list[dict]:
    _ensure_data_dir()
    if not TIMETABLES_FILE.exists():
        return []
    try:
        return json.loads(TIMETABLES_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # Corrupted store — start fresh rather than crashing the service.
        return []


def _save_all_sync(rows: list[dict]) -> None:
    _ensure_data_dir()
    tmp = TIMETABLES_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(TIMETABLES_FILE)


def _row_to_record(row: dict) -> dict:
    """Normalize a stored row into a TimetableRecord-shaped dict."""
    return {
        "id": row.get("id"),
        "short_code": row.get("short_code"),
        "user_id": row.get("user_id"),
        "title": row.get("title"),
        "academic_year": row.get("academic_year"),
        "term": row.get("term"),
        "config": row.get("config_json"),
        "result": row.get("result_json"),
        "workspace": row.get("workspace_json"),
        "is_public": bool(row.get("is_public", 1)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _row_to_user(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "email": row.get("email"),
        "name": row.get("name"),
        "picture": row.get("picture"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


class LocalTimetableStore:
    """Async JSON-file store mirroring `D1Client`'s public methods."""

    def __init__(self, path: Path | str | None = None) -> None:
        self._path = Path(path) if path else TIMETABLES_FILE

    async def _load_all(self) -> list[dict]:
        # File I/O is fast; offload to a thread to stay truly async-friendly.
        return await asyncio.to_thread(_load_all_sync) if self._path == TIMETABLES_FILE else (
            await asyncio.to_thread(self._load_all_custom)
        )

    def _load_all_custom(self) -> list[dict]:
        if not self._path.exists():
            return []
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

    async def _save_all(self, rows: list[dict]) -> None:
        async with _write_lock:
            await asyncio.to_thread(self._save_all_custom, rows)

    def _save_all_custom(self, rows: list[dict]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._path)

    # ── Domain methods (mirror D1Client) ───────────────────────────────────

    async def short_code_exists(self, short_code: str) -> bool:
        rows = await self._load_all()
        return any(r.get("short_code") == short_code for r in rows)

    async def save_timetable(
        self,
        *,
        id: str,
        short_code: str,
        user_id: str | None,
        title: str,
        academic_year: int,
        term: int,
        config_json: str,
        result_json: str,
        is_public: int = 1,
        workspace_json: str | None = None,
    ) -> None:
        rows = await self._load_all()
        now = _now_iso()
        record = {
            "id": id,
            "short_code": short_code,
            "user_id": user_id,
            "title": title,
            "academic_year": academic_year,
            "term": term,
            # Store config/result as parsed dicts (not raw JSON strings) so
            # the local store round-trips structured data without re-parsing.
            "config_json": _safe_loads(config_json),
            "result_json": _safe_loads(result_json),
            "workspace_json": _safe_loads(workspace_json),
            "is_public": is_public,
            "created_at": now,
            "updated_at": now,
        }
        for i, r in enumerate(rows):
            if r.get("id") == id:
                record["created_at"] = r.get("created_at", now)
                rows[i] = record
                break
        else:
            rows.append(record)
        await self._save_all(rows)

    async def get_timetable_by_short_code(self, short_code: str) -> dict | None:
        rows = await self._load_all()
        for r in rows:
            if r.get("short_code") == short_code and bool(r.get("is_public", 1)):
                return _row_to_record(r)
        return None

    async def get_user_schedules(self, user_id: str) -> list[dict]:
        rows = await self._load_all()
        owned = [r for r in rows if r.get("user_id") == user_id]
        owned.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return [_row_to_record(r) for r in owned]

    async def claim_timetable(self, short_code: str, user_id: str) -> bool:
        rows = await self._load_all()
        changed = False
        for r in rows:
            if r.get("short_code") == short_code and not (r.get("user_id") or ""):
                r["user_id"] = user_id
                r["updated_at"] = _now_iso()
                changed = True
        if changed:
            await self._save_all(rows)
        return changed

    # ── User methods ───────────────────────────────────────────────────────

    async def _load_users(self) -> list[dict]:
        def _load() -> list[dict]:
            p = USERS_FILE
            if not p.exists():
                return []
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return []
        return await asyncio.to_thread(_load)

    async def _save_users(self, users: list[dict]) -> None:
        async with _write_lock:
            def _save() -> None:
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                tmp = USERS_FILE.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(USERS_FILE)
            await asyncio.to_thread(_save)

    async def upsert_user(self, *, id: str, email: str, name: str, picture: str | None = None) -> None:
        users = await self._load_users()
        now = _now_iso()
        record = {"id": id, "email": email, "name": name, "picture": picture,
                  "created_at": now, "updated_at": now}
        for i, u in enumerate(users):
            if u.get("id") == id:
                record["created_at"] = u.get("created_at", now)
                users[i] = record
                break
        else:
            users.append(record)
        await self._save_users(users)

    async def get_user_by_sub(self, sub: str) -> dict | None:
        users = await self._load_users()
        for u in users:
            if u.get("id") == sub:
                return _row_to_user(u)
        return None

    # ── Workspace methods (private records, owner-scoped) ──────────────────

    async def get_timetable_by_id(self, id: str, user_id: str) -> dict | None:
        rows = await self._load_all()
        for r in rows:
            if r.get("id") == id and r.get("user_id") == user_id:
                return _row_to_record(r)
        return None

    async def delete_timetable(self, id: str, user_id: str) -> bool:
        rows = await self._load_all()
        before = len(rows)
        rows = [r for r in rows if not (r.get("id") == id and r.get("user_id") == user_id)]
        if len(rows) != before:
            await self._save_all(rows)
            return True
        return False

    async def merge_guest_workspaces(self, guest_device_id: str, user_id: str) -> int:
        rows = await self._load_all()
        changed = 0
        for r in rows:
            if r.get("user_id") == guest_device_id:
                r["user_id"] = user_id
                r["updated_at"] = _now_iso()
                changed += 1
        if changed:
            await self._save_all(rows)
        return changed


def _safe_loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def get_timetable_store() -> Any:
    """Factory: return a D1Client when configured, else LocalTimetableStore.

    Returns a fresh instance each call so async clients aren't shared across
    requests (D1Client is stateless beyond its config).
    """
    from config import settings
    if settings.d1_configured:
        from d1_service import D1Client
        return D1Client()
    return LocalTimetableStore()
