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

from permissions import (
    normalize_trainee_role,
    normalize_workspace_role,
    resolve_trainee_role,
    resolve_workspace_role,
    team_default_for,
)
from utils import normalize_email

DATA_DIR = Path(__file__).parent / "data"
TIMETABLES_FILE = DATA_DIR / "timetables.json"
USERS_FILE = DATA_DIR / "users.json"
TEAM_MEMBERS_FILE = DATA_DIR / "team_members.json"
SUBSTITUTE_SHARES_FILE = DATA_DIR / "substitute_shares.json"
WORKSPACE_MEMBERS_FILE = DATA_DIR / "workspace_members.json"
TRAINEE_WORKSPACES_FILE = DATA_DIR / "trainee_workspaces.json"
TRAINEE_MEMBERS_FILE = DATA_DIR / "trainee_members.json"

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
        "access_mode": row.get("access_mode") or "team",
        "owner_email": row.get("owner_email"),
        "owner_name": row.get("owner_name"),
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


def _row_to_trainee_workspace(row: dict) -> dict:
    data = row.get("data_json")
    if isinstance(data, str):
        data = _safe_loads(data)
    return {
        "timetable_id": row.get("timetable_id"),
        "title": row.get("title") or row.get("timetable_title") or "",
        "timetable_title": row.get("timetable_title") or row.get("title") or "",
        "academic_year": row.get("academic_year"),
        "term": row.get("term"),
        "owner_user_id": row.get("owner_user_id"),
        "access_mode": row.get("access_mode") or "private",
        "data": data or {},
        "version": int(row.get("version") or 0),
        "trainee_count": int(row.get("trainee_count") or 0),
        "attendance_count": int(row.get("attendance_count") or 0),
        "updated_at": row.get("updated_at"),
        "my_trainee_role": row.get("my_trainee_role") or "none",
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

    def _aux_path(self, filename: str) -> Path:
        return (
            DATA_DIR / filename
            if self._path == TIMETABLES_FILE
            else self._path.with_name(filename)
        )

    async def _load_json_list(self, filename: str) -> list[dict]:
        def _load() -> list[dict]:
            p = self._aux_path(filename)
            if not p.exists():
                return []
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return []
        return await asyncio.to_thread(_load)

    async def _save_json_list(self, filename: str, rows: list[dict]) -> None:
        async with _write_lock:
            def _save() -> None:
                p = self._aux_path(filename)
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(p)
            await asyncio.to_thread(_save)

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
        access_mode: str = "team",
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
            "access_mode": access_mode or "team",
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

    async def _team_owner_ids_for_email(self, email: str | None) -> set[str]:
        """Owner ids whose team includes this email (lowercased match)."""
        email = normalize_email(email)
        if not email:
            return set()
        rows = await self._load_team_members()
        return {
            r.get("owner_user_id") for r in rows
            if normalize_email(r.get("member_email")) == email
        }

    @staticmethod
    def _can_access(
        r: dict,
        user_id: str,
        email: str,
        team_owner_ids: set[str],
        workspace_members: list[dict] | None = None,
    ) -> bool:
        if r.get("user_id") == user_id:
            return True
        if email and email in {normalize_email(m) for m in (r.get("manager_emails") or [])}:
            return True
        if email and any(
            m.get("timetable_id") == r.get("id") and normalize_email(m.get("email")) == email
            for m in (workspace_members or [])
        ):
            return True
        return (r.get("access_mode") or "team") == "team" and r.get("user_id") in team_owner_ids

    async def _attach_workspace_roles(
        self,
        record: dict,
        user_id: str,
        email: str | None,
        workspace_members: list[dict] | None = None,
    ) -> dict:
        members = workspace_members if workspace_members is not None else [
            m for m in await self._load_workspace_members()
            if m.get("timetable_id") == record.get("id")
        ]
        team_members = await self._load_team_members()
        team_default = team_default_for(team_members, record.get("user_id"), email)
        record["my_workspace_role"] = resolve_workspace_role(
            record=record,
            members=members,
            team_default=team_default,
            user_id=user_id,
            email=email,
            access_mode=record.get("access_mode"),
        )
        explicit = next(
            (m for m in members if normalize_email(m.get("email")) == normalize_email(email)),
            None,
        )
        if record.get("user_id") and record.get("user_id") == user_id:
            record["my_trainee_role"] = "owner"
        elif explicit:
            record["my_trainee_role"] = normalize_trainee_role(explicit.get("trainee_role"), "none")
        elif team_default:
            record["my_trainee_role"] = normalize_trainee_role(team_default.get("default_trainee_role"), "none")
        else:
            record["my_trainee_role"] = "none"
        return record

    async def _with_owner_info(self, rows: list[dict], users: list[dict]) -> list[dict]:
        by_id = {u.get("id"): u for u in users}
        out = []
        for r in rows:
            owner = by_id.get(r.get("user_id")) or {}
            out.append(_row_to_record({
                **r,
                "owner_email": owner.get("email"),
                "owner_name": owner.get("name"),
            }))
        return out

    async def get_user_schedules(self, user_id: str, email: str | None = None) -> list[dict]:
        """List timetables owned by the caller OR shared with them (team or manager)."""
        email = normalize_email(email)
        rows = await self._load_all()
        team_owner_ids = await self._team_owner_ids_for_email(email)
        workspace_members = await self._load_workspace_members()
        accessible = [
            r for r in rows
            if self._can_access(r, user_id, email, team_owner_ids, workspace_members)
        ]
        accessible.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        records = await self._with_owner_info(accessible, await self._load_users())
        return [await self._attach_workspace_roles(r, user_id, email, workspace_members) for r in records]

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
        email = normalize_email(email)
        rows = await self._load_all()
        team_owner_ids = await self._team_owner_ids_for_email(email)
        workspace_members = await self._load_workspace_members()
        for r in rows:
            if r.get("id") == id and self._can_access(r, user_id, email, team_owner_ids, workspace_members):
                record = (await self._with_owner_info([r], await self._load_users()))[0]
                return await self._attach_workspace_roles(record, user_id, email, workspace_members)
        return None

    async def delete_timetable(self, id: str, user_id: str) -> bool:
        rows = await self._load_all()
        before = len(rows)
        rows = [r for r in rows if not (r.get("id") == id and r.get("user_id") == user_id)]
        if len(rows) != before:
            await self._save_all(rows)
            await self.delete_trainee_workspace(id)
            return True
        return False

    async def update_manager_emails(self, id: str, owner_user_id: str, emails: list[str]) -> bool:
        """Replace manager_emails — owner only (caller must own the record)."""
        rows = await self._load_all()
        normalized = [normalize_email(e) for e in (emails or []) if normalize_email(e)]
        for r in rows:
            if r.get("id") == id and r.get("user_id") == owner_user_id:
                r["manager_emails"] = normalized
                r["updated_at"] = _now_iso()
                await self._save_all(rows)
                return True
        return False

    async def update_workspace_access(self, id: str, owner_user_id: str, mode: str) -> bool:
        """Set access_mode ('team' | 'private') — owner only."""
        rows = await self._load_all()
        for r in rows:
            if r.get("id") == id and r.get("user_id") == owner_user_id:
                r["access_mode"] = mode
                r["updated_at"] = _now_iso()
                await self._save_all(rows)
                return True
        return False

    # ── Workspace members (per-workspace role overrides) ───────────────────

    async def _load_workspace_members(self) -> list[dict]:
        rows = await self._load_json_list("workspace_members.json")
        out = []
        for r in rows:
            out.append({
                "timetable_id": r.get("timetable_id"),
                "email": normalize_email(r.get("email")),
                "workspace_role": normalize_workspace_role(r.get("workspace_role"), "viewer"),
                "trainee_role": normalize_trainee_role(r.get("trainee_role"), "none"),
            })
        return out

    async def _save_workspace_members(self, rows: list[dict]) -> None:
        await self._save_json_list("workspace_members.json", rows)

    async def get_workspace_members(self, timetable_id: str) -> list[dict]:
        return [
            m for m in await self._load_workspace_members()
            if m.get("timetable_id") == timetable_id
        ]

    async def set_workspace_members(self, timetable_id: str, owner_user_id: str, members: list[dict]) -> bool:
        rows = await self._load_all()
        if not any(r.get("id") == timetable_id and r.get("user_id") == owner_user_id for r in rows):
            return False
        all_members = await self._load_workspace_members()
        all_members = [m for m in all_members if m.get("timetable_id") != timetable_id]
        for member in members or []:
            email = normalize_email(member.get("email"))
            if not email:
                continue
            all_members.append({
                "timetable_id": timetable_id,
                "email": email,
                "workspace_role": normalize_workspace_role(member.get("workspace_role"), "viewer"),
                "trainee_role": normalize_trainee_role(member.get("trainee_role"), "none"),
            })
        await self._save_workspace_members(all_members)
        return True

    # ── Team members (owner adds an email once → all their workspaces shared) ──

    @property
    def _team_members_path(self) -> Path:
        return (
            TEAM_MEMBERS_FILE
            if self._path == TIMETABLES_FILE
            else self._path.with_name("team_members.json")
        )

    async def _load_team_members(self) -> list[dict]:
        def _load() -> list[dict]:
            p = self._team_members_path
            if not p.exists():
                return []
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return []
        return await asyncio.to_thread(_load)

    async def _save_team_members(self, rows: list[dict]) -> None:
        async with _write_lock:
            def _save() -> None:
                p = self._team_members_path
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(p)
            await asyncio.to_thread(_save)

    async def get_team_members(self, owner_user_id: str) -> list[dict]:
        rows = await self._load_team_members()
        users = await self._load_users()
        by_email = {
            normalize_email(u.get("email")): u for u in users if u.get("email")
        }
        out = []
        for r in rows:
            if r.get("owner_user_id") != owner_user_id:
                continue
            email = normalize_email(r.get("member_email"))
            user = by_email.get(email)
            out.append({
                "owner_user_id": r.get("owner_user_id"),
                "email": email,
                "name": (user or {}).get("name"),
                "picture": (user or {}).get("picture"),
                "status": "active" if user else "pending",
                "added_at": r.get("added_at"),
                "default_workspace_role": normalize_workspace_role(r.get("default_workspace_role"), "editor"),
                "default_trainee_role": normalize_trainee_role(r.get("default_trainee_role"), "none"),
            })
        out.sort(key=lambda x: (x.get("added_at") or "", x["email"]))
        return out

    async def get_team_memberships(self, email: str) -> list[dict]:
        email = normalize_email(email)
        if not email:
            return []
        rows = await self._load_team_members()
        users = {u.get("id"): u for u in await self._load_users()}
        out = []
        for r in rows:
            if normalize_email(r.get("member_email")) != email:
                continue
            owner = users.get(r.get("owner_user_id")) or {}
            out.append({
                "owner_id": r.get("owner_user_id"),
                "owner_email": owner.get("email") or "",
                "owner_name": owner.get("name") or "",
            })
        return out

    async def add_team_member(
        self,
        owner_user_id: str,
        email: str,
        default_workspace_role: str = "editor",
        default_trainee_role: str = "none",
    ) -> bool:
        email = normalize_email(email)
        rows = await self._load_team_members()
        if any(r.get("owner_user_id") == owner_user_id
               and normalize_email(r.get("member_email")) == email for r in rows):
            return False
        rows.append({
            "owner_user_id": owner_user_id,
            "member_email": email,
            "added_at": _now_iso(),
            "default_workspace_role": normalize_workspace_role(default_workspace_role, "editor"),
            "default_trainee_role": normalize_trainee_role(default_trainee_role, "none"),
        })
        await self._save_team_members(rows)
        return True

    async def update_team_member_roles(
        self,
        owner_user_id: str,
        email: str,
        default_workspace_role: str,
        default_trainee_role: str,
    ) -> bool:
        email = normalize_email(email)
        rows = await self._load_team_members()
        changed = False
        for r in rows:
            if r.get("owner_user_id") == owner_user_id and normalize_email(r.get("member_email")) == email:
                r["default_workspace_role"] = normalize_workspace_role(default_workspace_role, "editor")
                r["default_trainee_role"] = normalize_trainee_role(default_trainee_role, "none")
                changed = True
        if changed:
            await self._save_team_members(rows)
        return changed

    async def remove_team_member(self, owner_user_id: str, email: str) -> bool:
        email = normalize_email(email)
        rows = await self._load_team_members()
        kept = [
            r for r in rows
            if not (r.get("owner_user_id") == owner_user_id
                    and normalize_email(r.get("member_email")) == email)
        ]
        if len(kept) == len(rows):
            return False
        await self._save_team_members(kept)
        return True

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

    # ── Trainee module (separate ACL) ──────────────────────────────────────

    async def _load_trainee_members(self) -> list[dict]:
        rows = await self._load_json_list("trainee_members.json")
        return [
            {
                "timetable_id": r.get("timetable_id"),
                "email": normalize_email(r.get("email")),
                "role": normalize_trainee_role(r.get("role"), "viewer"),
            }
            for r in rows
        ]

    async def _save_trainee_members(self, rows: list[dict]) -> None:
        await self._save_json_list("trainee_members.json", rows)

    async def get_trainee_members(self, timetable_id: str) -> list[dict]:
        return [
            {"email": m["email"], "role": m["role"]}
            for m in await self._load_trainee_members()
            if m.get("timetable_id") == timetable_id
        ]

    async def set_trainee_members(self, timetable_id: str, owner_user_id: str, members: list[dict]) -> bool:
        rows = await self._load_trainee_workspaces()
        if not any(r.get("timetable_id") == timetable_id and r.get("owner_user_id") == owner_user_id for r in rows):
            return False
        all_members = await self._load_trainee_members()
        all_members = [m for m in all_members if m.get("timetable_id") != timetable_id]
        for member in members or []:
            email = normalize_email(member.get("email"))
            if not email:
                continue
            all_members.append({
                "timetable_id": timetable_id,
                "email": email,
                "role": normalize_trainee_role(member.get("role"), "viewer"),
            })
        await self._save_trainee_members(all_members)
        return True

    async def _load_trainee_workspaces(self) -> list[dict]:
        return await self._load_json_list("trainee_workspaces.json")

    async def _save_trainee_workspaces(self, rows: list[dict]) -> None:
        await self._save_json_list("trainee_workspaces.json", rows)

    async def get_trainee_workspace(self, timetable_id: str) -> dict | None:
        rows = await self._load_trainee_workspaces()
        timetable = next((r for r in await self._load_all() if r.get("id") == timetable_id), {})
        for r in rows:
            if r.get("timetable_id") == timetable_id:
                return _row_to_trainee_workspace({
                    **r,
                    "timetable_title": timetable.get("title") or "",
                    "academic_year": timetable.get("academic_year"),
                    "term": timetable.get("term"),
                })
        return None

    async def list_trainee_workspaces_for_identity(self, user_id: str, email: str | None) -> list[dict]:
        email = normalize_email(email)
        rows = await self._load_trainee_workspaces()
        all_trainee_members = await self._load_trainee_members()
        team_rows = await self._load_team_members()
        timetables = {r.get("id"): r for r in await self._load_all()}
        out = []
        for row in rows:
            timetable_id = row.get("timetable_id")
            owner_id = row.get("owner_user_id")
            explicit = next(
                (m for m in all_trainee_members
                 if m.get("timetable_id") == timetable_id and normalize_email(m.get("email")) == email),
                None,
            )
            team_default = team_default_for(team_rows, owner_id, email)
            record = _row_to_trainee_workspace({
                **row,
                "timetable_title": (timetables.get(timetable_id) or {}).get("title") or "",
                "academic_year": (timetables.get(timetable_id) or {}).get("academic_year"),
                "term": (timetables.get(timetable_id) or {}).get("term"),
            })
            record["my_trainee_role"] = resolve_trainee_role(
                trainee_row=row,
                trainee_members=all_trainee_members,
                team_default=team_default,
                user_id=user_id,
                email=email,
            )
            if record["my_trainee_role"] in ("owner", "viewer", "editor"):
                out.append(record)
        out.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
        return out

    async def save_trainee_workspace(
        self,
        *,
        timetable_id: str,
        owner_user_id: str,
        access_mode: str,
        data_json: str,
        base_version: int,
        updated_by: str | None = None,
    ) -> tuple[bool, dict | None]:
        rows = await self._load_trainee_workspaces()
        now = _now_iso()
        for i, row in enumerate(rows):
            if row.get("timetable_id") != timetable_id:
                continue
            if int(row.get("version") or 0) != int(base_version or 0):
                return False, _row_to_trainee_workspace(row)
            updated = {
                **row,
                "data_json": _safe_loads(data_json),
                "access_mode": access_mode or row.get("access_mode") or "private",
                "version": int(row.get("version") or 0) + 1,
                "updated_by": updated_by,
                "updated_at": now,
            }
            rows[i] = updated
            await self._save_trainee_workspaces(rows)
            return True, _row_to_trainee_workspace(updated)
        if base_version not in (0, None):
            return False, None
        record = {
            "timetable_id": timetable_id,
            "owner_user_id": owner_user_id,
            "access_mode": access_mode or "private",
            "data_json": _safe_loads(data_json),
            "version": 1,
            "trainee_count": 0,
            "attendance_count": 0,
            "updated_by": updated_by,
            "created_at": now,
            "updated_at": now,
        }
        rows.append(record)
        await self._save_trainee_workspaces(rows)
        return True, _row_to_trainee_workspace(record)

    async def update_trainee_counts(self, timetable_id: str, trainee_count: int, attendance_count: int) -> None:
        rows = await self._load_trainee_workspaces()
        for row in rows:
            if row.get("timetable_id") == timetable_id:
                row["trainee_count"] = int(trainee_count)
                row["attendance_count"] = int(attendance_count)
                await self._save_trainee_workspaces(rows)
                return

    async def update_trainee_access(self, timetable_id: str, owner_user_id: str, access_mode: str) -> bool:
        rows = await self._load_trainee_workspaces()
        for row in rows:
            if row.get("timetable_id") == timetable_id and row.get("owner_user_id") == owner_user_id:
                row["access_mode"] = access_mode
                row["updated_at"] = _now_iso()
                await self._save_trainee_workspaces(rows)
                return True
        return False

    async def delete_trainee_workspace(self, timetable_id: str) -> None:
        rows = await self._load_trainee_workspaces()
        kept = [r for r in rows if r.get("timetable_id") != timetable_id]
        if len(kept) != len(rows):
            await self._save_trainee_workspaces(kept)
        members = await self._load_trainee_members()
        kept_members = [m for m in members if m.get("timetable_id") != timetable_id]
        if len(kept_members) != len(members):
            await self._save_trainee_members(kept_members)

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
