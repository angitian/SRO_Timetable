"""Minimal Google Drive v3 client (upload / download / folders).

Why not `google-api-python-client`: the backend already depends on `httpx`, and
the portal only needs five calls. Keeping it hand-rolled avoids a large
dependency and lets tests inject an `httpx.MockTransport`.

Auth modes
----------
1. **OAuth refresh token** (recommended for a school Workspace)
   The OAuth client must be *Internal* user type — an *External* client in
   "Testing" status gets a refresh token that expires after 7 days.
2. **Service account**
   Service accounts created after 2025-04-15 have no storage quota, so they can
   only upload into a Shared Drive (`supportsAllDrives=true`). Uploading into a
   personal My Drive folder fails with `storageQuotaExceeded`.

Uploads use `uploadType=resumable` (not `multipart`, which is capped at ~5 MB)
and send the file metadata in the initiation request so the file never defaults
to the service account's My Drive.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_BASE = "https://www.googleapis.com/drive/v3"
UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
_JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"


class DriveError(Exception):
    """Raised when Google Drive rejects a request."""


@dataclass
class DriveFile:
    id: str
    name: str
    web_view_url: str | None = None
    size: int | None = None


def parse_drive_folder_link(url: str) -> dict[str, str | None]:
    """Extract `{folder_id, drive_id}` from a Google Drive folder/share link.

    Accepts:
      https://drive.google.com/drive/folders/<FOLDER_ID>?usp=sharing
      https://drive.google.com/drive/u/1/folders/<FOLDER_ID>
      https://drive.google.com/open?id=<FOLDER_ID>
      https://drive.google.com/drive/<DRIVE_ID>          (Shared Drive root)

    Raises ValueError for links that are not folders (e.g. a file link).
    """
    raw = (url or "").strip()
    if not raw:
        raise ValueError("ลิงก์โฟลเดอร์ว่าง")
    if "/file/d/" in raw:
        raise ValueError("ลิงก์นี้เป็นไฟล์ ไม่ใช่โฟลเดอร์")

    parts = [p for p in raw.split("?")[0].rstrip("/").split("/") if p]
    if "folders" in parts:
        idx = parts.index("folders")
        if idx + 1 < len(parts):
            folder_id = parts[idx + 1]
            return {"folder_id": folder_id, "drive_id": None}
    if "open" in parts:
        from urllib.parse import parse_qs, urlparse

        qs = parse_qs(urlparse(raw).query)
        ids = qs.get("id") or []
        if ids:
            return {"folder_id": ids[0], "drive_id": None}
    if "drive" in parts:
        idx = parts.index("drive")
        tail = [p for p in parts[idx + 1:] if p not in ("u",)]
        # /drive/u/1/folders/<id> already handled above; here tail is the drive id
        if tail and not tail[0].isdigit():
            return {"folder_id": tail[0], "drive_id": tail[0]}
    raise ValueError("ไม่พบรหัสโฟลเดอร์ในลิงก์ (ตัวอย่าง: .../drive/folders/<ID>)")


class DriveClient:
    """Async Drive client with a lazily refreshed access token."""

    def __init__(
        self,
        *,
        refresh_token: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        service_account: dict | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._refresh_token = refresh_token
        self._client_id = client_id
        self._client_secret = client_secret
        self._service_account = service_account
        self._transport = transport
        self._timeout = timeout
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    # ── auth ────────────────────────────────────────────────────────────

    @property
    def configured(self) -> bool:
        if self._service_account:
            return True
        return bool(self._refresh_token and self._client_id and self._client_secret)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout, connect=10.0),
            transport=self._transport,
        )

    async def _fetch_token(self) -> tuple[str, float]:
        async with self._http() as client:
            if self._service_account:
                import jwt as pyjwt

                sa = self._service_account
                now = int(time.time())
                claims = {
                    "iss": sa.get("client_email"),
                    "scope": DRIVE_SCOPE,
                    "aud": TOKEN_URL,
                    "iat": now,
                    "exp": now + 3600,
                }
                try:
                    assertion = pyjwt.encode(
                        claims, sa["private_key"], algorithm="RS256"
                    )
                except Exception as e:  # missing cryptography / bad key
                    raise DriveError(f"สร้าง JWT ของ service account ไม่ได้: {e}") from e
                data = {"grant_type": _JWT_GRANT, "assertion": assertion}
            else:
                data = {
                    "grant_type": "refresh_token",
                    "client_id": self._client_id or "",
                    "client_secret": self._client_secret or "",
                    "refresh_token": self._refresh_token or "",
                }
            resp = await client.post(TOKEN_URL, data=data)
        if resp.status_code != 200:
            body = resp.text[:300]
            if "invalid_grant" in body:
                raise DriveError(
                    "Drive token ใช้ไม่ได้ (invalid_grant) — การเชื่อมต่อหมดอายุ "
                    "กรุณากดเชื่อม Drive ใหม่ในหน้าตั้งค่า"
                )
            raise DriveError(f"ขอ Drive access token ไม่สำเร็จ (HTTP {resp.status_code}): {body}")
        payload = resp.json()
        token = payload.get("access_token")
        if not token:
            raise DriveError("Drive ไม่ส่ง access_token กลับมา")
        expires_in = float(payload.get("expires_in") or 3600)
        return token, time.time() + max(expires_in - 60, 30)

    async def access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at:
            return self._token
        token, expires_at = await self._fetch_token()
        self._token = token
        self._token_expires_at = expires_at
        return token

    async def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {await self.access_token()}"}

    @staticmethod
    def _error_message(resp: httpx.Response) -> str:
        try:
            body = resp.json()
            return str((body.get("error") or {}).get("message") or body)[:300]
        except Exception:
            return resp.text[:300]

    # ── files / folders ─────────────────────────────────────────────────

    async def get_file(self, file_id: str, fields: str = "id,name,mimeType,webViewLink") -> dict:
        async with self._http() as client:
            resp = await client.get(
                f"{API_BASE}/files/{file_id}",
                params={"fields": fields, "supportsAllDrives": "true"},
                headers=await self._headers(),
            )
        if resp.status_code == 404:
            raise DriveError("ไม่พบโฟลเดอร์/ไฟล์นี้ หรือบัญชีที่เชื่อมไม่มีสิทธิ์เข้าถึง")
        if resp.status_code != 200:
            raise DriveError(
                f"อ่านข้อมูล Drive ไม่สำเร็จ (HTTP {resp.status_code}): {self._error_message(resp)}"
            )
        return resp.json()

    async def ensure_folder(
        self,
        name: str,
        parent_id: str,
        drive_id: str | None = None,
        *,
        create: bool = True,
    ) -> str:
        """Return the id of `name` under `parent_id`, creating it when missing."""
        safe_name = name.replace("\\", "\\\\").replace("'", "\\'")
        query = (
            f"name = '{safe_name}' "
            f"and mimeType = 'application/vnd.google-apps.folder' "
            f"and '{parent_id}' in parents and trashed = false"
        )
        params: dict[str, Any] = {
            "q": query,
            "fields": "files(id,name)",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if drive_id:
            params["corpora"] = "drive"
            params["driveId"] = drive_id
        async with self._http() as client:
            resp = await client.get(
                f"{API_BASE}/files", params=params, headers=await self._headers()
            )
        if resp.status_code != 200:
            raise DriveError(
                f"ค้นหาโฟลเดอร์ใน Drive ไม่สำเร็จ (HTTP {resp.status_code}): {self._error_message(resp)}"
            )
        found = (resp.json().get("files") or [])
        if found:
            return found[0]["id"]
        if not create:
            raise DriveError("ไม่พบโฟลเดอร์ปลายทางใน Drive")

        meta: dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        async with self._http() as client:
            resp = await client.post(
                f"{API_BASE}/files",
                params={"fields": "id", "supportsAllDrives": "true"},
                json=meta,
                headers=await self._headers(),
            )
        if resp.status_code not in (200, 201):
            raise DriveError(
                f"สร้างโฟลเดอร์ใน Drive ไม่สำเร็จ (HTTP {resp.status_code}): {self._error_message(resp)}"
            )
        return resp.json()["id"]

    async def upload(
        self,
        *,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
        drive_id: str | None = None,
    ) -> DriveFile:
        """Resumable upload (metadata + bytes) into `parent_id`."""
        meta = {"name": filename, "parents": [parent_id]}
        params: dict[str, Any] = {
            "uploadType": "resumable",
            "supportsAllDrives": "true",
            "fields": "id,name,webViewLink,size",
        }
        if drive_id:
            params["driveId"] = drive_id

        async with self._http() as client:
            init = await client.post(
                f"{UPLOAD_BASE}/files",
                params=params,
                headers={
                    **(await self._headers()),
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mime_type,
                    "X-Upload-Content-Length": str(len(content)),
                },
                content=json.dumps(meta).encode("utf-8"),
            )
            if init.status_code not in (200, 201):
                raise DriveError(
                    f"เริ่มอัปโหลดขึ้น Drive ไม่สำเร็จ (HTTP {init.status_code}): "
                    f"{self._error_message(init)}"
                )
            session_url = init.headers.get("Location")
            if not session_url:
                raise DriveError("Drive ไม่ส่ง resumable session URL กลับมา")

            put = await client.put(
                session_url,
                headers={
                    "Content-Type": mime_type,
                    "Content-Length": str(len(content)),
                },
                content=content,
            )
        if put.status_code not in (200, 201):
            raise DriveError(
                f"อัปโหลดไฟล์ขึ้น Drive ไม่สำเร็จ (HTTP {put.status_code}): {self._error_message(put)}"
            )
        data = put.json()
        size = data.get("size")
        return DriveFile(
            id=data.get("id") or "",
            name=data.get("name") or filename,
            web_view_url=data.get("webViewLink"),
            size=int(size) if size is not None else len(content),
        )

    async def download(self, file_id: str) -> bytes:
        async with self._http() as client:
            resp = await client.get(
                f"{API_BASE}/files/{file_id}",
                params={"alt": "media", "supportsAllDrives": "true"},
                headers=await self._headers(),
            )
        if resp.status_code != 200:
            raise DriveError(
                f"ดาวน์โหลดไฟล์จาก Drive ไม่สำเร็จ (HTTP {resp.status_code}): {self._error_message(resp)}"
            )
        return resp.content

    async def delete(self, file_id: str) -> bool:
        async with self._http() as client:
            resp = await client.delete(
                f"{API_BASE}/files/{file_id}",
                params={"supportsAllDrives": "true"},
                headers=await self._headers(),
            )
        # 404 = already gone — treat as success (idempotent cleanup).
        return resp.status_code in (200, 204, 404)


def service_account_from_value(value: str) -> dict | None:
    """Load a service-account JSON from a path or an inline JSON string."""
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.startswith("{"):
        return json.loads(raw)
    from pathlib import Path

    path = Path(raw)
    if not path.is_file():
        raise DriveError(f"ไม่พบไฟล์ service account: {raw}")
    return json.loads(path.read_text(encoding="utf-8"))
