"""Cloudflare D1 REST API client for the `timetables` table.

Used by the timetables API router when `Settings.d1_configured` is True.
When credentials are missing, the router falls back to `timetable_store.LocalTimetableStore`,
which exposes the same async method signatures.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from config import settings
from permissions import (
    normalize_trainee_role,
    normalize_workspace_role,
    resolve_trainee_role,
    resolve_workspace_role,
    team_default_for,
)
from utils import normalize_email


class D1Error(Exception):
    """Raised when the Cloudflare D1 REST API returns an error."""


_D1_QUERY_URL = (
    "https://api.cloudflare.com/client/v4/accounts/{account_id}"
    "/d1/database/{database_id}/query"
)


class D1Client:
    """Async client wrapping the Cloudflare D1 REST `/query` endpoint."""

    def __init__(self, timeout: float = 30.0) -> None:
        self._account_id = settings.CLOUDFLARE_ACCOUNT_ID
        self._database_id = settings.CLOUDFLARE_D1_DATABASE_ID
        self._token = settings.CLOUDFLARE_API_TOKEN
        self._url = _D1_QUERY_URL.format(
            account_id=self._account_id,
            database_id=self._database_id,
        )
        self._timeout = timeout

    async def execute_query(self, sql: str, params: list[Any] | None = None) -> dict:
        """POST a single SQL statement to the D1 REST query endpoint.

        Returns the first result object (`{"results": [...], "meta": {...}}`).
        Raises `D1Error` on HTTP failure, non-success response, or per-statement errors.
        """
        payload = {"sql": sql}
        if params is not None:
            payload["params"] = params

        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._url, json=payload, headers=headers)
        except httpx.HTTPError as e:
            raise D1Error(f"D1 request failed: {e}") from e

        if resp.status_code != 200:
            raise D1Error(f"D1 HTTP {resp.status_code}: {resp.text}")

        try:
            body = resp.json()
        except ValueError as e:
            raise D1Error(f"D1 returned non-JSON response: {e}") from e

        if not body.get("success"):
            errors = body.get("errors") or []
            msg = errors[0].get("message") if errors else "unknown D1 error"
            raise D1Error(f"D1 query unsuccessful: {msg}")

        results = body.get("result") or []
        if not results or not results[0].get("success"):
            err_meta = (results[0].get("error") if results else None) or body.get("errors")
            raise D1Error(f"D1 statement failed: {err_meta}")

        return results[0]

    # ── Helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_record(row: dict) -> dict:
        """Convert a D1 row into a TimetableRecord-shaped dict (parse JSON fields)."""
        def _loads(value: Any) -> Any:
            if value is None:
                return None
            if isinstance(value, (dict, list)):
                return value
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return None

        return {
            "id": row.get("id"),
            "short_code": row.get("short_code"),
            "user_id": row.get("user_id"),
            "title": row.get("title"),
            "academic_year": row.get("academic_year"),
            "term": row.get("term"),
            "config": _loads(row.get("config_json")),
            "result": _loads(row.get("result_json")),
            "workspace": _loads(row.get("workspace_json")),
            "manager_emails": _loads(row.get("manager_emails")) or [],
            "access_mode": row.get("access_mode") or "team",
            "owner_email": row.get("owner_email"),
            "owner_name": row.get("owner_name"),
            "is_public": bool(row.get("is_public")),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    @staticmethod
    def _row_to_user(row: dict) -> dict:
        return {
            "id": row.get("id"),
            "email": row.get("email"),
            "name": row.get("name"),
            "picture": row.get("picture"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    # ── User methods ───────────────────────────────────────────────────────

    async def upsert_user(self, *, id: str, email: str, name: str, picture: str | None = None) -> None:
        await self.execute_query(
            """
            INSERT INTO users (id, email, name, picture, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                email    = excluded.email,
                name     = excluded.name,
                picture  = excluded.picture,
                updated_at = datetime('now')
            """,
            [id, email, name, picture],
        )

    async def get_user_by_sub(self, sub: str) -> dict | None:
        result = await self.execute_query(
            "SELECT * FROM users WHERE id = ? LIMIT 1",
            [sub],
        )
        rows = result.get("results") or []
        return self._row_to_user(rows[0]) if rows else None

    # ── Domain methods (mirror LocalTimetableStore) ────────────────────────

    async def short_code_exists(self, short_code: str) -> bool:
        result = await self.execute_query(
            "SELECT 1 AS hit FROM timetables WHERE short_code = ? LIMIT 1",
            [short_code],
        )
        return bool(result.get("results"))

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
        """Insert a new timetable or update on `id` conflict (upsert).

        Uses ON CONFLICT(id) DO UPDATE rather than INSERT OR REPLACE so a
        UNIQUE collision on `short_code` would surface as an error instead of
        silently deleting a different row.
        """
        await self.execute_query(
            """
            INSERT INTO timetables
                (id, short_code, user_id, title, academic_year, term,
                 config_json, result_json, workspace_json, is_public,
                 manager_emails, access_mode, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                short_code     = excluded.short_code,
                user_id        = excluded.user_id,
                title          = excluded.title,
                academic_year  = excluded.academic_year,
                term           = excluded.term,
                config_json    = excluded.config_json,
                result_json    = excluded.result_json,
                workspace_json = excluded.workspace_json,
                is_public      = excluded.is_public,
                manager_emails = excluded.manager_emails,
                access_mode    = excluded.access_mode,
                updated_at     = datetime('now')
            """,
            [id, short_code, user_id, title, academic_year, term,
             config_json, result_json, workspace_json, is_public,
             json.dumps(manager_emails or [], ensure_ascii=False), access_mode],
        )

    async def get_timetable_by_short_code(self, short_code: str) -> dict | None:
        result = await self.execute_query(
            """
            SELECT * FROM timetables
            WHERE short_code = ? AND is_public = 1
            LIMIT 1
            """,
            [short_code],
        )
        rows = result.get("results") or []
        if not rows:
            return None
        return self._row_to_record(rows[0])

    async def _attach_workspace_roles(self, record: dict, user_id: str, email: str | None) -> dict:
        """Attach effective workspace/trainee roles to a TimetableRecord dict."""
        members = await self.get_workspace_members(record["id"])
        team_members = await self.get_team_members(record.get("user_id")) if record.get("user_id") else []
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

    async def get_user_schedules(self, user_id: str, email: str | None = None) -> list[dict]:
        """List timetables owned by the user OR shared with them."""
        email = normalize_email(email)
        if email:
            try:
                result = await self.execute_query(
                    """
                    SELECT t.*, u.email AS owner_email, u.name AS owner_name
                    FROM timetables t
                    LEFT JOIN users u ON u.id = t.user_id
                    WHERE t.user_id = ?
                       OR EXISTS (SELECT 1 FROM json_each(COALESCE(t.manager_emails,'[]'))
                                  WHERE lower(json_each.value) = ?)
                       OR EXISTS (SELECT 1 FROM workspace_members wm
                                  WHERE wm.timetable_id = t.id AND lower(wm.email) = ?)
                       OR (COALESCE(t.access_mode,'team') = 'team'
                           AND t.user_id IN (SELECT owner_user_id FROM team_members
                                             WHERE member_email = ?))
                    ORDER BY t.created_at DESC
                    """,
                    [user_id, email, email, email],
                )
            except D1Error as e:
                if "workspace_members" not in str(e):
                    raise
                result = await self.execute_query(
                    """
                    SELECT t.*, u.email AS owner_email, u.name AS owner_name
                    FROM timetables t
                    LEFT JOIN users u ON u.id = t.user_id
                    WHERE t.user_id = ?
                       OR EXISTS (SELECT 1 FROM json_each(COALESCE(t.manager_emails,'[]'))
                                  WHERE lower(json_each.value) = ?)
                       OR (COALESCE(t.access_mode,'team') = 'team'
                           AND t.user_id IN (SELECT owner_user_id FROM team_members
                                             WHERE member_email = ?))
                    ORDER BY t.created_at DESC
                    """,
                    [user_id, email, email],
                )
        else:
            result = await self.execute_query(
                """
                SELECT t.*, u.email AS owner_email, u.name AS owner_name
                FROM timetables t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE t.user_id = ?
                ORDER BY t.created_at DESC
                """,
                [user_id],
            )
        records = [self._row_to_record(r) for r in (result.get("results") or [])]
        return [await self._attach_workspace_roles(r, user_id, email) for r in records]

    async def claim_timetable(self, short_code: str, user_id: str) -> bool:
        """Link a guest-created timetable to the authenticated user.

        Only claims rows that currently have no owner (user_id IS NULL or '').
        Returns True if a row was updated.
        """
        result = await self.execute_query(
            """
            UPDATE timetables
            SET user_id = ?, updated_at = datetime('now')
            WHERE short_code = ?
              AND (user_id IS NULL OR user_id = '')
            """,
            [user_id, short_code],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    # ── Workspace methods (private records, owner-scoped) ──────────────────

    async def get_timetable_by_id(self, id: str, user_id: str, email: str | None = None) -> dict | None:
        """Fetch a private workspace by id — caller must be owner, an explicit
        member, a team member of the owner, or a legacy manager by email."""
        email = normalize_email(email)
        try:
            result = await self.execute_query(
                """
                SELECT t.*, u.email AS owner_email, u.name AS owner_name
                FROM timetables t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                  AND (t.user_id = ?
                       OR EXISTS (SELECT 1 FROM json_each(COALESCE(t.manager_emails,'[]'))
                                  WHERE lower(json_each.value) = ?)
                       OR EXISTS (SELECT 1 FROM workspace_members wm
                                  WHERE wm.timetable_id = t.id AND lower(wm.email) = ?)
                       OR (COALESCE(t.access_mode,'team') = 'team'
                           AND t.user_id IN (SELECT owner_user_id FROM team_members
                                             WHERE member_email = ?)))
                LIMIT 1
                """,
                [id, user_id, email, email, email],
            )
        except D1Error as e:
            if "workspace_members" not in str(e):
                raise
            result = await self.execute_query(
                """
                SELECT t.*, u.email AS owner_email, u.name AS owner_name
                FROM timetables t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                  AND (t.user_id = ?
                       OR EXISTS (SELECT 1 FROM json_each(COALESCE(t.manager_emails,'[]'))
                                  WHERE lower(json_each.value) = ?)
                       OR (COALESCE(t.access_mode,'team') = 'team'
                           AND t.user_id IN (SELECT owner_user_id FROM team_members
                                             WHERE member_email = ?)))
                LIMIT 1
                """,
                [id, user_id, email, email],
            )
        rows = result.get("results") or []
        if not rows:
            return None
        return await self._attach_workspace_roles(self._row_to_record(rows[0]), user_id, email)

    async def delete_timetable(self, id: str, user_id: str) -> bool:
        """Delete a timetable owned by user_id. Returns True if a row was removed."""
        result = await self.execute_query(
            "DELETE FROM timetables WHERE id = ? AND user_id = ?",
            [id, user_id],
        )
        meta = result.get("meta") or {}
        deleted = int(meta.get("changes", 0)) > 0
        if deleted:
            await self.delete_trainee_workspace(id)
        return deleted

    async def update_manager_emails(self, id: str, owner_user_id: str, emails: list[str]) -> bool:
        """Replace manager_emails — owner only (caller must own the record)."""
        emails = [normalize_email(e) for e in (emails or []) if normalize_email(e)]
        result = await self.execute_query(
            "UPDATE timetables SET manager_emails = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            [json.dumps(emails, ensure_ascii=False), id, owner_user_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def update_workspace_access(self, id: str, owner_user_id: str, mode: str) -> bool:
        """Set access_mode ('team' | 'private') — owner only."""
        result = await self.execute_query(
            "UPDATE timetables SET access_mode = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            [mode, id, owner_user_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    # ── Team members (owner adds an email once → all their workspaces shared) ──

    async def get_team_members(self, owner_user_id: str) -> list[dict]:
        """Members of the given owner's team, joined with `users` for profile data."""
        try:
            result = await self.execute_query(
                """
                SELECT tm.owner_user_id, tm.member_email AS email, tm.added_at,
                       u.id AS user_id, u.name, u.picture,
                       COALESCE(tm.default_workspace_role, 'editor') AS default_workspace_role,
                       COALESCE(tm.default_trainee_role, 'none') AS default_trainee_role
                FROM team_members tm
                LEFT JOIN users u ON lower(u.email) = tm.member_email
                WHERE tm.owner_user_id = ?
                ORDER BY tm.added_at ASC, tm.member_email ASC
                """,
                [owner_user_id],
            )
        except D1Error as e:
            if "default_workspace_role" not in str(e):
                raise
            result = await self.execute_query(
                """
                SELECT tm.member_email AS email, tm.added_at, u.id AS user_id, u.name, u.picture
                FROM team_members tm
                LEFT JOIN users u ON lower(u.email) = tm.member_email
                WHERE tm.owner_user_id = ?
                ORDER BY tm.added_at ASC, tm.member_email ASC
                """,
                [owner_user_id],
            )
        return [
            {
                "owner_user_id": r.get("owner_user_id") or owner_user_id,
                "email": r.get("email"),
                "name": r.get("name"),
                "picture": r.get("picture"),
                "status": "active" if r.get("user_id") else "pending",
                "added_at": r.get("added_at"),
                "default_workspace_role": r.get("default_workspace_role") or "editor",
                "default_trainee_role": r.get("default_trainee_role") or "none",
            }
            for r in (result.get("results") or [])
        ]

    async def get_team_memberships(self, email: str) -> list[dict]:
        """Teams the given email has been added to (read-only summaries)."""
        email = normalize_email(email)
        if not email:
            return []
        result = await self.execute_query(
            """
            SELECT tm.owner_user_id AS owner_id, u.email AS owner_email, u.name AS owner_name
            FROM team_members tm
            LEFT JOIN users u ON u.id = tm.owner_user_id
            WHERE tm.member_email = ?
            ORDER BY tm.added_at ASC
            """,
            [email],
        )
        return [
            {
                "owner_id": r.get("owner_id"),
                "owner_email": r.get("owner_email") or "",
                "owner_name": r.get("owner_name") or "",
            }
            for r in (result.get("results") or [])
        ]

    async def add_team_member(
        self,
        owner_user_id: str,
        email: str,
        default_workspace_role: str = "editor",
        default_trainee_role: str = "none",
    ) -> bool:
        """Add an email to the owner's team. Returns True when a new row was inserted."""
        email = normalize_email(email)
        try:
            result = await self.execute_query(
                "INSERT OR IGNORE INTO team_members "
                "(owner_user_id, member_email, added_at, default_workspace_role, default_trainee_role) "
                "VALUES (?, ?, datetime('now'), ?, ?)",
                [owner_user_id, email, default_workspace_role, default_trainee_role],
            )
        except D1Error as e:
            if "default_workspace_role" not in str(e):
                raise
            result = await self.execute_query(
                "INSERT OR IGNORE INTO team_members (owner_user_id, member_email, added_at) "
                "VALUES (?, ?, datetime('now'))",
                [owner_user_id, email],
            )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def update_team_member_roles(
        self,
        owner_user_id: str,
        email: str,
        default_workspace_role: str,
        default_trainee_role: str,
    ) -> bool:
        result = await self.execute_query(
            """
            UPDATE team_members
            SET default_workspace_role = ?, default_trainee_role = ?
            WHERE owner_user_id = ? AND lower(member_email) = ?
            """,
            [default_workspace_role, default_trainee_role, owner_user_id, normalize_email(email)],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def remove_team_member(self, owner_user_id: str, email: str) -> bool:
        result = await self.execute_query(
            "DELETE FROM team_members WHERE owner_user_id = ? AND member_email = ?",
            [owner_user_id, normalize_email(email)],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def merge_guest_workspaces(self, guest_device_id: str, user_id: str) -> int:
        """Reassign all guest-created records to the authenticated user.

        Returns the number of rows updated.
        """
        result = await self.execute_query(
            """
            UPDATE timetables
            SET user_id = ?, updated_at = datetime('now')
            WHERE user_id = ?
            """,
            [user_id, guest_device_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0))

    # ── Workspace members (per-workspace role overrides) ───────────────────

    async def get_workspace_members(self, timetable_id: str) -> list[dict]:
        try:
            result = await self.execute_query(
                "SELECT email, workspace_role, trainee_role FROM workspace_members "
                "WHERE timetable_id = ? ORDER BY email ASC",
                [timetable_id],
            )
        except D1Error as e:
            if "workspace_members" not in str(e):
                raise
            return []
        return [
            {
                "email": normalize_email(r.get("email")),
                "workspace_role": normalize_workspace_role(r.get("workspace_role"), "viewer"),
                "trainee_role": normalize_trainee_role(r.get("trainee_role"), "none"),
            }
            for r in (result.get("results") or [])
        ]

    async def set_workspace_members(self, timetable_id: str, owner_user_id: str, members: list[dict]) -> bool:
        """Replace explicit workspace members — owner only."""
        owner = await self.execute_query(
            "SELECT 1 AS ok FROM timetables WHERE id = ? AND user_id = ? LIMIT 1",
            [timetable_id, owner_user_id],
        )
        if not owner.get("results"):
            return False
        await self.execute_query("DELETE FROM workspace_members WHERE timetable_id = ?", [timetable_id])
        for member in members or []:
            email = normalize_email(member.get("email"))
            if not email:
                continue
            await self.execute_query(
                "INSERT INTO workspace_members "
                "(timetable_id, email, workspace_role, trainee_role, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))",
                [
                    timetable_id,
                    email,
                    normalize_workspace_role(member.get("workspace_role"), "viewer"),
                    normalize_trainee_role(member.get("trainee_role"), "none"),
                ],
            )
        return True

    # ── Trainee module (separate ACL) ──────────────────────────────────────

    @staticmethod
    def _row_to_trainee_workspace(row: dict) -> dict:
        def _loads(value: Any) -> Any:
            if value is None:
                return None
            if isinstance(value, (dict, list)):
                return value
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return None

        return {
            "timetable_id": row.get("timetable_id"),
            "title": row.get("title") or row.get("timetable_title") or "",
            "timetable_title": row.get("timetable_title") or row.get("title") or "",
            "academic_year": row.get("academic_year"),
            "term": row.get("term"),
            "owner_user_id": row.get("owner_user_id"),
            "access_mode": row.get("access_mode") or "private",
            "data": _loads(row.get("data_json")) or {},
            "version": int(row.get("version") or 0),
            "trainee_count": int(row.get("trainee_count") or 0),
            "attendance_count": int(row.get("attendance_count") or 0),
            "updated_at": row.get("updated_at"),
            "my_trainee_role": row.get("my_trainee_role") or "none",
        }

    async def get_trainee_members(self, timetable_id: str) -> list[dict]:
        try:
            result = await self.execute_query(
                "SELECT email, role FROM trainee_members WHERE timetable_id = ? ORDER BY email ASC",
                [timetable_id],
            )
        except D1Error as e:
            if "trainee_members" not in str(e):
                raise
            return []
        return [
            {"email": normalize_email(r.get("email")), "role": normalize_trainee_role(r.get("role"), "viewer")}
            for r in (result.get("results") or [])
        ]

    async def set_trainee_members(self, timetable_id: str, owner_user_id: str, members: list[dict]) -> bool:
        owner = await self.execute_query(
            "SELECT 1 AS ok FROM trainee_workspaces WHERE timetable_id = ? AND owner_user_id = ? LIMIT 1",
            [timetable_id, owner_user_id],
        )
        if not owner.get("results"):
            return False
        await self.execute_query("DELETE FROM trainee_members WHERE timetable_id = ?", [timetable_id])
        for member in members or []:
            email = normalize_email(member.get("email"))
            if not email:
                continue
            await self.execute_query(
                "INSERT INTO trainee_members (timetable_id, email, role, created_at, updated_at) "
                "VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                [timetable_id, email, normalize_trainee_role(member.get("role"), "viewer")],
            )
        return True

    async def get_trainee_workspace(self, timetable_id: str) -> dict | None:
        try:
            result = await self.execute_query(
                """
                SELECT tw.*, t.title AS timetable_title, t.academic_year, t.term
                FROM trainee_workspaces tw
                LEFT JOIN timetables t ON t.id = tw.timetable_id
                WHERE tw.timetable_id = ? LIMIT 1
                """,
                [timetable_id],
            )
        except D1Error as e:
            if "trainee_workspaces" not in str(e):
                raise
            return None
        rows = result.get("results") or []
        return self._row_to_trainee_workspace(rows[0]) if rows else None

    async def list_trainee_workspaces_for_identity(self, user_id: str, email: str | None) -> list[dict]:
        email = normalize_email(email)
        try:
            result = await self.execute_query(
                """
                SELECT tw.*, t.title AS timetable_title, t.academic_year, t.term,
                       CASE
                         WHEN tw.owner_user_id = ? THEN 'owner'
                         WHEN EXISTS (SELECT 1 FROM trainee_members tm
                                      WHERE tm.timetable_id = tw.timetable_id AND lower(tm.email) = ?)
                           THEN (SELECT tm.role FROM trainee_members tm
                                 WHERE tm.timetable_id = tw.timetable_id AND lower(tm.email) = ? LIMIT 1)
                         WHEN tw.access_mode = 'team'
                              AND EXISTS (SELECT 1 FROM team_members tmem
                                          WHERE tmem.owner_user_id = tw.owner_user_id
                                            AND lower(tmem.member_email) = ?)
                           THEN COALESCE((SELECT tmem.default_trainee_role FROM team_members tmem
                                          WHERE tmem.owner_user_id = tw.owner_user_id
                                            AND lower(tmem.member_email) = ? LIMIT 1), 'none')
                         ELSE 'none'
                       END AS my_trainee_role
                FROM trainee_workspaces tw
                LEFT JOIN timetables t ON t.id = tw.timetable_id
                WHERE tw.owner_user_id = ?
                   OR EXISTS (SELECT 1 FROM trainee_members tm
                              WHERE tm.timetable_id = tw.timetable_id AND lower(tm.email) = ?)
                   OR (tw.access_mode = 'team'
                       AND EXISTS (SELECT 1 FROM team_members tmem
                                   WHERE tmem.owner_user_id = tw.owner_user_id
                                     AND lower(tmem.member_email) = ?))
                ORDER BY tw.updated_at DESC
                """,
                [user_id, email, email, email, email, user_id, email, email],
            )
        except D1Error as e:
            if "trainee_workspaces" not in str(e) and "trainee_members" not in str(e):
                raise
            return []
        out = []
        for row in result.get("results") or []:
            record = self._row_to_trainee_workspace(row)
            if record.get("my_trainee_role") in ("owner", "viewer", "editor"):
                out.append(record)
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
        """Upsert trainee data. Returns (ok, current_row) where current_row is set on conflict."""
        current = await self.get_trainee_workspace(timetable_id)
        if current is None:
            if base_version not in (0, None):
                return False, None
            await self.execute_query(
                """
                INSERT INTO trainee_workspaces
                    (timetable_id, owner_user_id, access_mode, data_json, version,
                     trainee_count, attendance_count, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, 0, 0, ?, datetime('now'), datetime('now'))
                """,
                [timetable_id, owner_user_id, access_mode or "private", data_json, updated_by],
            )
            return True, await self.get_trainee_workspace(timetable_id)

        if int(current.get("version") or 0) != int(base_version or 0):
            return False, current

        await self.execute_query(
            """
            UPDATE trainee_workspaces
            SET data_json = ?, access_mode = ?, version = version + 1,
                updated_by = ?, updated_at = datetime('now')
            WHERE timetable_id = ? AND version = ?
            """,
            [data_json, access_mode or current.get("access_mode") or "private", updated_by, timetable_id, base_version],
        )
        return True, await self.get_trainee_workspace(timetable_id)

    async def update_trainee_counts(self, timetable_id: str, trainee_count: int, attendance_count: int) -> None:
        await self.execute_query(
            "UPDATE trainee_workspaces SET trainee_count = ?, attendance_count = ? WHERE timetable_id = ?",
            [trainee_count, attendance_count, timetable_id],
        )

    async def update_trainee_access(self, timetable_id: str, owner_user_id: str, access_mode: str) -> bool:
        result = await self.execute_query(
            "UPDATE trainee_workspaces SET access_mode = ?, updated_at = datetime('now') "
            "WHERE timetable_id = ? AND owner_user_id = ?",
            [access_mode, timetable_id, owner_user_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def delete_trainee_workspace(self, timetable_id: str) -> None:
        for table in ("trainee_members", "trainee_workspaces"):
            try:
                await self.execute_query(f"DELETE FROM {table} WHERE timetable_id = ?", [timetable_id])
            except D1Error as e:
                if "no such table" not in str(e).lower():
                    raise

    # ── Substitute share links (daily substitute documents) ────────────────

    async def substitute_short_code_exists(self, short_code: str) -> bool:
        result = await self.execute_query(
            "SELECT 1 AS hit FROM substitute_shares WHERE short_code = ? LIMIT 1",
            [short_code],
        )
        return bool(result.get("results"))

    async def save_substitute_share(
        self,
        *,
        id: str,
        short_code: str,
        date: str,
        payload_json: str,
        user_id: str | None,
    ) -> None:
        await self.execute_query(
            """
            INSERT INTO substitute_shares
                (id, short_code, date, payload_json, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                date         = excluded.date,
                payload_json = excluded.payload_json,
                user_id      = excluded.user_id,
                updated_at   = datetime('now')
            """,
            [id, short_code, date, payload_json, user_id],
        )

    async def find_substitute_share_by_owner_date(self, user_id: str | None, date: str) -> dict | None:
        if not user_id:
            return None
        result = await self.execute_query(
            "SELECT * FROM substitute_shares WHERE user_id = ? AND date = ? LIMIT 1",
            [user_id, date],
        )
        rows = result.get("results") or []
        return self._row_to_substitute_share(rows[0]) if rows else None

    async def get_substitute_share_by_short_code(self, short_code: str) -> dict | None:
        result = await self.execute_query(
            "SELECT * FROM substitute_shares WHERE short_code = ? LIMIT 1",
            [short_code],
        )
        rows = result.get("results") or []
        return self._row_to_substitute_share(rows[0]) if rows else None

    async def get_substitute_share_by_id(self, record_id: str) -> dict | None:
        result = await self.execute_query(
            "SELECT * FROM substitute_shares WHERE id = ? LIMIT 1",
            [record_id],
        )
        rows = result.get("results") or []
        return self._row_to_substitute_share(rows[0]) if rows else None

    async def delete_substitute_share(self, record_id: str, user_id: str) -> bool:
        result = await self.execute_query(
            "DELETE FROM substitute_shares WHERE id = ? AND user_id = ?",
            [record_id, user_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    @staticmethod
    def _row_to_substitute_share(row: dict) -> dict:
        def _loads(value: Any) -> Any:
            if value is None:
                return None
            if isinstance(value, (dict, list)):
                return value
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return None

        return {
            "id": row.get("id"),
            "short_code": row.get("short_code"),
            "date": row.get("date"),
            "payload": _loads(row.get("payload_json")),
            "user_id": row.get("user_id"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    # ── Dev inspector (read-only metadata; never returns config/result/workspace) ──

    async def dev_overview(self) -> dict:
        """Counts + date range for the dev DB inspector (metadata only)."""
        sql = """
        SELECT
          (SELECT COUNT(*) FROM users) AS users_total,
          (SELECT COUNT(*) FROM timetables) AS timetables_total,
          (SELECT COUNT(*) FROM timetables WHERE is_public = 1) AS public_total,
          (SELECT COUNT(*) FROM timetables WHERE is_public = 0) AS private_total,
          (SELECT COUNT(*) FROM timetables WHERE length(COALESCE(result_json,'')) > 2) AS with_result_total,
          (SELECT COUNT(*) FROM timetables WHERE length(COALESCE(workspace_json,'')) > 2) AS with_workspace_total,
          (SELECT MIN(created_at) FROM timetables) AS first_created_at,
          (SELECT MAX(updated_at) FROM timetables) AS last_updated_at
        """
        result = await self.execute_query(sql)
        row = (result.get("results") or [{}])[0]
        return {
            "users_total": int(row.get("users_total") or 0),
            "timetables_total": int(row.get("timetables_total") or 0),
            "public_total": int(row.get("public_total") or 0),
            "private_total": int(row.get("private_total") or 0),
            "with_result_total": int(row.get("with_result_total") or 0),
            "with_workspace_total": int(row.get("with_workspace_total") or 0),
            "first_created_at": row.get("first_created_at"),
            "last_updated_at": row.get("last_updated_at"),
        }

    async def dev_list_users(
        self, q: str = "", limit: int = 100, offset: int = 0, sort: str = "timetables",
    ) -> list[dict]:
        """Users + how many timetables each owns (metadata only)."""
        order = "timetables_total DESC, u.updated_at DESC" if sort == "timetables" else "u.created_at DESC"
        like = f"%{q.lower()}%"
        sql = f"""
        SELECT u.id, u.email, u.name, u.picture, u.created_at, u.updated_at,
               (SELECT COUNT(*) FROM timetables t WHERE t.user_id = u.id) AS timetables_total,
               (SELECT MAX(t.updated_at) FROM timetables t WHERE t.user_id = u.id) AS last_timetable_at
        FROM users u
        WHERE (? = '' OR lower(u.email) LIKE ? OR lower(u.name) LIKE ? OR u.id LIKE ?)
        ORDER BY {order}
        LIMIT ? OFFSET ?
        """
        result = await self.execute_query(sql, [q, like, like, f"%{q}%", limit, offset])
        out = []
        for r in result.get("results") or []:
            out.append({
                "id": r.get("id"),
                "email": r.get("email") or "",
                "name": r.get("name") or "",
                "picture_present": bool(r.get("picture")),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
                "timetables_total": int(r.get("timetables_total") or 0),
                "last_timetable_at": r.get("last_timetable_at"),
            })
        return out

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
        """Timetable metadata (title/owner/size/flags) — no JSON payload columns."""
        where = ["1 = 1"]
        params: list[Any] = []
        if q:
            like = f"%{q.lower()}%"
            where.append("(lower(t.title) LIKE ? OR lower(t.short_code) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ?)")
            params.extend([like, like, like])
        if user_id:
            where.append("t.user_id = ?")
            params.append(user_id)
        if visibility == "public":
            where.append("t.is_public = 1")
        elif visibility == "private":
            where.append("t.is_public = 0")
        if has_result == "yes":
            where.append("length(COALESCE(t.result_json,'')) > 2")
        elif has_result == "no":
            where.append("length(COALESCE(t.result_json,'')) <= 2")

        order = {
            "created": "t.created_at DESC",
            "title": "t.title COLLATE NOCASE ASC",
        }.get(sort, "t.updated_at DESC")

        base_cols = """
               t.id, t.short_code, t.title, t.academic_year, t.term, t.user_id,
               u.email AS owner_email, u.name AS owner_name,
               t.is_public,
               CASE WHEN length(COALESCE(t.result_json,'')) > 2 THEN 1 ELSE 0 END AS has_result,
               CASE WHEN length(COALESCE(t.workspace_json,'')) > 2 THEN 1 ELSE 0 END AS has_workspace,
               length(COALESCE(t.workspace_json,'')) AS workspace_bytes,
               length(COALESCE(t.result_json,'')) AS result_bytes,
               t.created_at, t.updated_at
        """
        # manager_emails may not exist before migration 003 — fall back gracefully.
        try:
            sql = f"""
            SELECT {base_cols}, t.manager_emails
            FROM timetables t LEFT JOIN users u ON u.id = t.user_id
            WHERE {' AND '.join(where)}
            ORDER BY {order}
            LIMIT ? OFFSET ?
            """
            result = await self.execute_query(sql, [*params, limit, offset])
            rows = result.get("results") or []
        except D1Error as e:
            if "manager_emails" not in str(e):
                raise
            sql = f"""
            SELECT {base_cols}
            FROM timetables t LEFT JOIN users u ON u.id = t.user_id
            WHERE {' AND '.join(where)}
            ORDER BY {order}
            LIMIT ? OFFSET ?
            """
            result = await self.execute_query(sql, [*params, limit, offset])
            rows = result.get("results") or []

        out = []
        for r in rows:
            managers = self._row_to_record({"manager_emails": r.get("manager_emails")}).get("manager_emails") or []
            out.append({
                "id": r.get("id"),
                "short_code": r.get("short_code"),
                "title": r.get("title") or "",
                "academic_year": r.get("academic_year"),
                "term": r.get("term"),
                "owner_user_id": r.get("user_id"),
                "owner_email": r.get("owner_email") or "",
                "owner_name": r.get("owner_name") or "",
                "is_public": bool(r.get("is_public")),
                "has_result": bool(r.get("has_result")),
                "has_workspace": bool(r.get("has_workspace")),
                "workspace_bytes": int(r.get("workspace_bytes") or 0),
                "result_bytes": int(r.get("result_bytes") or 0),
                "manager_emails": managers if isinstance(managers, list) else [],
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            })
        return out

    async def dev_get_timetable(self, record_id: str) -> dict | None:
        # Filtered query by id keeps the same metadata shape as dev_list_timetables.
        where = "t.id = ?"
        base_cols = """
               t.id, t.short_code, t.title, t.academic_year, t.term, t.user_id,
               u.email AS owner_email, u.name AS owner_name, t.is_public,
               CASE WHEN length(COALESCE(t.result_json,'')) > 2 THEN 1 ELSE 0 END AS has_result,
               CASE WHEN length(COALESCE(t.workspace_json,'')) > 2 THEN 1 ELSE 0 END AS has_workspace,
               length(COALESCE(t.workspace_json,'')) AS workspace_bytes,
               length(COALESCE(t.result_json,'')) AS result_bytes,
               t.created_at, t.updated_at
        """
        try:
            result = await self.execute_query(
                f"""SELECT {base_cols}, t.manager_emails
                FROM timetables t LEFT JOIN users u ON u.id = t.user_id
                WHERE {where} LIMIT 1""",
                [record_id],
            )
        except D1Error as e:
            if "manager_emails" not in str(e):
                raise
            result = await self.execute_query(
                f"""SELECT {base_cols}
                FROM timetables t LEFT JOIN users u ON u.id = t.user_id
                WHERE {where} LIMIT 1""",
                [record_id],
            )
        rows = result.get("results") or []
        if not rows:
            return None
        r = rows[0]
        managers = self._row_to_record({"manager_emails": r.get("manager_emails")}).get("manager_emails") or []
        return {
            "id": r.get("id"),
            "short_code": r.get("short_code"),
            "title": r.get("title") or "",
            "academic_year": r.get("academic_year"),
            "term": r.get("term"),
            "owner_user_id": r.get("user_id"),
            "owner_email": r.get("owner_email") or "",
            "owner_name": r.get("owner_name") or "",
            "is_public": bool(r.get("is_public")),
            "has_result": bool(r.get("has_result")),
            "has_workspace": bool(r.get("has_workspace")),
            "workspace_bytes": int(r.get("workspace_bytes") or 0),
            "result_bytes": int(r.get("result_bytes") or 0),
            "manager_emails": managers if isinstance(managers, list) else [],
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
        }
