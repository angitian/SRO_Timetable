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
SUBSTITUTE_SHARES_FILE = DATA_DIR / "substitute_shares.json"

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
        "manager_emails": row.get("manager_emails") or [],
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


def _row_to_substitute_share(row: dict) -> dict:
    """Normalize a stored substitute-share row (payload parsed)."""
    payload = row.get("payload_json")
    if isinstance(payload, str):
        payload = _safe_loads(payload)
    return {
        "id": row.get("id"),
        "short_code": row.get("short_code"),
        "date": row.get("date"),
        "payload": payload,
        "user_id": row.get("user_id"),
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
        manager_emails: list[str] | None = None,
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
            "manager_emails": list(manager_emails or []),
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

    async def get_user_schedules(self, user_id: str, email: str | None = None) -> list[dict]:
        rows = await self._load_all()
        owned = [r for r in rows
                 if r.get("user_id") == user_id
                 or (email and email in (r.get("manager_emails") or []))]
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

    @property
    def _users_path(self) -> Path:
        """Users file lives beside the store file when a custom path is used
        (tests/temp stores stay isolated from the real data directory)."""
        return USERS_FILE if self._path == TIMETABLES_FILE else self._path.with_name("users.json")

    async def _load_users(self) -> list[dict]:
        def _load() -> list[dict]:
            p = self._users_path
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
                p = self._users_path
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(p)
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

    async def get_timetable_by_id(self, id: str, user_id: str, email: str | None = None) -> dict | None:
        rows = await self._load_all()
        for r in rows:
            if r.get("id") != id:
                continue
            if r.get("user_id") == user_id or (email and email in (r.get("manager_emails") or [])):
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

    async def update_manager_emails(self, id: str, owner_user_id: str, emails: list[str]) -> bool:
        """Replace manager_emails — owner only (caller must own the record)."""
        rows = await self._load_all()
        for r in rows:
            if r.get("id") == id and r.get("user_id") == owner_user_id:
                r["manager_emails"] = list(emails or [])
                r["updated_at"] = _now_iso()
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

    # ── Substitute share links (daily substitute documents) ────────────────

    @property
    def _substitute_shares_path(self) -> Path:
        return (
            SUBSTITUTE_SHARES_FILE
            if self._path == TIMETABLES_FILE
            else self._path.with_name("substitute_shares.json")
        )

    async def _load_substitute_shares(self) -> list[dict]:
        def _load() -> list[dict]:
            p = self._substitute_shares_path
            if not p.exists():
                return []
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return []
        return await asyncio.to_thread(_load)

    async def _save_substitute_shares(self, rows: list[dict]) -> None:
        async with _write_lock:
            def _save() -> None:
                p = self._substitute_shares_path
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(p)
            await asyncio.to_thread(_save)

    async def substitute_short_code_exists(self, short_code: str) -> bool:
        rows = await self._load_substitute_shares()
        return any(r.get("short_code") == short_code for r in rows)

    async def save_substitute_share(
        self,
        *,
        id: str,
        short_code: str,
        date: str,
        payload_json: str,
        user_id: str | None,
    ) -> None:
        rows = await self._load_substitute_shares()
        now = _now_iso()
        record = {
            "id": id,
            "short_code": short_code,
            "date": date,
            "payload_json": _safe_loads(payload_json),
            "user_id": user_id,
            "created_at": now,
            "updated_at": now,
        }
        for i, r in enumerate(rows):
            if r.get("id") == id:
                record["created_at"] = r.get("created_at", now)
                record["short_code"] = r.get("short_code") or short_code
                rows[i] = record
                break
        else:
            rows.append(record)
        await self._save_substitute_shares(rows)

    async def find_substitute_share_by_owner_date(self, user_id: str | None, date: str) -> dict | None:
        if not user_id:
            return None
        rows = await self._load_substitute_shares()
        for r in rows:
            if r.get("user_id") == user_id and r.get("date") == date:
                return _row_to_substitute_share(r)
        return None

    async def get_substitute_share_by_short_code(self, short_code: str) -> dict | None:
        rows = await self._load_substitute_shares()
        for r in rows:
            if r.get("short_code") == short_code:
                return _row_to_substitute_share(r)
        return None

    async def get_substitute_share_by_id(self, record_id: str) -> dict | None:
        rows = await self._load_substitute_shares()
        for r in rows:
            if r.get("id") == record_id:
                return _row_to_substitute_share(r)
        return None

    async def delete_substitute_share(self, record_id: str, user_id: str) -> bool:
        rows = await self._load_substitute_shares()
        kept = [r for r in rows if not (r.get("id") == record_id and r.get("user_id") == user_id)]
        if len(kept) == len(rows):
            return False
        await self._save_substitute_shares(kept)
        return True

    # ── Dev inspector (read-only metadata; never returns config/result/workspace) ──

    @staticmethod
    def _dev_has_payload(value: Any) -> bool:
        if not value:
            return False
        if isinstance(value, (dict, list)):
            return len(value) > 0
        return True

    async def dev_overview(self) -> dict:
        rows = await self._load_all()
        users = await self._load_users()
        created = [r.get("created_at") for r in rows if r.get("created_at")]
        updated = [r.get("updated_at") for r in rows if r.get("updated_at")]
        return {
            "users_total": len(users),
            "timetables_total": len(rows),
            "public_total": sum(1 for r in rows if r.get("is_public", 1)),
            "private_total": sum(1 for r in rows if not r.get("is_public", 1)),
            "with_result_total": sum(1 for r in rows if self._dev_has_payload(r.get("result_json"))),
            "with_workspace_total": sum(1 for r in rows if self._dev_has_payload(r.get("workspace_json"))),
            "first_created_at": min(created) if created else None,
            "last_updated_at": max(updated) if updated else None,
        }

    async def dev_list_users(
        self, q: str = "", limit: int = 100, offset: int = 0, sort: str = "timetables",
    ) -> list[dict]:
        rows = await self._load_all()
        users = await self._load_users()
        ql = (q or "").lower()
        counts: dict[str, int] = {}
        last_at: dict[str, str] = {}
        for r in rows:
            uid = r.get("user_id")
            if not uid:
                continue
            counts[uid] = counts.get(uid, 0) + 1
            ts = r.get("updated_at") or ""
            if ts > (last_at.get(uid) or ""):
                last_at[uid] = ts
        out = []
        for u in users:
            email = (u.get("email") or "")
            name = (u.get("name") or "")
            uid = (u.get("id") or "")
            if ql and ql not in email.lower() and ql not in name.lower() and ql not in uid.lower():
                continue
            out.append({
                "id": u.get("id"),
                "email": email,
                "name": name,
                "picture_present": bool(u.get("picture")),
                "created_at": u.get("created_at"),
                "updated_at": u.get("updated_at"),
                "timetables_total": counts.get(uid, 0),
                "last_timetable_at": last_at.get(uid),
            })
        if sort == "timetables":
            out.sort(key=lambda x: (-x["timetables_total"], x.get("updated_at") or ""))
        else:
            out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return out[offset: offset + limit]

    async def dev_list_timetables(
        self,
        q: str = "",
        user_id: str = "",
        visibility: str = "all",
        has_result: str = "any",
        limit: int = 100,
        offset: int = 0,
        sort: str = "updated",
    ) -> list[dict]:
        rows = await self._load_all()
        users = {u.get("id"): u for u in await self._load_users()}
        ql = (q or "").lower()
        out = []
        for r in rows:
            owner = users.get(r.get("user_id")) or {}
            title = r.get("title") or ""
            code = r.get("short_code") or ""
            email = owner.get("email") or ""
            if ql and ql not in title.lower() and ql not in code.lower() and ql not in email.lower():
                continue
            if user_id and r.get("user_id") != user_id:
                continue
            is_public = bool(r.get("is_public", 1))
            if visibility == "public" and not is_public:
                continue
            if visibility == "private" and is_public:
                continue
            has_res = self._dev_has_payload(r.get("result_json"))
            if has_result == "yes" and not has_res:
                continue
            if has_result == "no" and has_res:
                continue
            ws = r.get("workspace_json")
            res = r.get("result_json")
            managers = r.get("manager_emails") or []
            out.append({
                "id": r.get("id"),
                "short_code": code,
                "title": title,
                "academic_year": r.get("academic_year"),
                "term": r.get("term"),
                "owner_user_id": r.get("user_id"),
                "owner_email": email,
                "owner_name": owner.get("name") or "",
                "is_public": is_public,
                "has_result": has_res,
                "has_workspace": self._dev_has_payload(ws),
                "workspace_bytes": len(json.dumps(ws, ensure_ascii=False)) if ws is not None else 0,
                "result_bytes": len(json.dumps(res, ensure_ascii=False)) if res is not None else 0,
                "manager_emails": managers if isinstance(managers, list) else [],
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            })
        if sort == "created":
            out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        elif sort == "title":
            out.sort(key=lambda x: (x.get("title") or "").lower())
        else:
            out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return out[offset: offset + limit]

    async def dev_get_timetable(self, record_id: str) -> dict | None:
        rows = await self.dev_list_timetables(limit=10000)
        for r in rows:
            if r.get("id") == record_id:
                return r
        return None


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
