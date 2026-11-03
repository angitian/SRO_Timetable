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
                 manager_emails, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
                updated_at     = datetime('now')
            """,
            [id, short_code, user_id, title, academic_year, term,
             config_json, result_json, workspace_json, is_public,
             json.dumps(manager_emails or [], ensure_ascii=False)],
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

    async def get_user_schedules(self, user_id: str, email: str | None = None) -> list[dict]:
        """List timetables owned by the user OR shared with them (manager_emails)."""
        if email:
            result = await self.execute_query(
                """
                SELECT * FROM timetables
                WHERE user_id = ?
                   OR EXISTS (SELECT 1 FROM json_each(COALESCE(manager_emails,'[]'))
                              WHERE json_each.value = ?)
                ORDER BY created_at DESC
                """,
                [user_id, email],
            )
        else:
            result = await self.execute_query(
                """
                SELECT * FROM timetables
                WHERE user_id = ?
                ORDER BY created_at DESC
                """,
                [user_id],
            )
        return [self._row_to_record(r) for r in (result.get("results") or [])]

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
        """Fetch a private workspace by id — caller must be owner OR a manager (email match)."""
        result = await self.execute_query(
            """
            SELECT * FROM timetables
            WHERE id = ?
              AND (user_id = ? OR EXISTS (SELECT 1 FROM json_each(COALESCE(manager_emails,'[]'))
                                          WHERE json_each.value = ?))
            LIMIT 1
            """,
            [id, user_id, email or ""],
        )
        rows = result.get("results") or []
        return self._row_to_record(rows[0]) if rows else None

    async def delete_timetable(self, id: str, user_id: str) -> bool:
        """Delete a timetable owned by user_id. Returns True if a row was removed."""
        result = await self.execute_query(
            "DELETE FROM timetables WHERE id = ? AND user_id = ?",
            [id, user_id],
        )
        meta = result.get("meta") or {}
        return int(meta.get("changes", 0)) > 0

    async def update_manager_emails(self, id: str, owner_user_id: str, emails: list[str]) -> bool:
        """Replace manager_emails — owner only (caller must own the record)."""
        result = await self.execute_query(
            "UPDATE timetables SET manager_emails = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            [json.dumps(emails or [], ensure_ascii=False), id, owner_user_id],
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
