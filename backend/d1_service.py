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
                 created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
                updated_at     = datetime('now')
            """,
            [id, short_code, user_id, title, academic_year, term,
             config_json, result_json, workspace_json, is_public],
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

    async def get_user_schedules(self, user_id: str) -> list[dict]:
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

    async def get_timetable_by_id(self, id: str, user_id: str) -> dict | None:
        """Fetch a private workspace by id, scoped to the owner."""
        result = await self.execute_query(
            "SELECT * FROM timetables WHERE id = ? AND user_id = ? LIMIT 1",
            [id, user_id],
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
