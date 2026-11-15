"""File storage for portal submissions (local disk or Google Drive).

`get_storage()` picks the backend from settings:

  PORTAL_STORAGE=local   → files under backend/data/uploads
  PORTAL_STORAGE=drive   → Google Drive (requires a connected account)
  PORTAL_STORAGE=''      → 'drive' when Drive is configured, else 'local'

Render's filesystem is ephemeral, so `local` is only safe for dev or a
self-hosted/persistent-disk deployment. The API surfaces a warning when a
workspace is published while running on local storage.
"""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path

from config import settings
from drive_client import DriveClient, DriveError, service_account_from_value

DATA_DIR = Path(__file__).parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"

# Characters that break Drive names or filesystem paths.
_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_UNSAFE_PATH = re.compile(r"[^A-Za-z0-9._-]")

MIME_OVERRIDES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}


class StorageError(Exception):
    """Raised when a file cannot be stored or read back."""


@dataclass
class StoredFile:
    backend: str
    key: str
    file_name: str
    size: int
    mime_type: str
    web_view_url: str | None = None


def sanitize_filename(name: str, fallback: str = "file") -> str:
    """Strip path separators / control chars and keep a readable name."""
    base = Path((name or "").replace("\\", "/")).name
    cleaned = _UNSAFE_NAME.sub("_", base).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:180] or fallback


def sanitize_segment(value: str, fallback: str = "item") -> str:
    cleaned = _UNSAFE_PATH.sub("_", (value or "").strip())[:60].strip("._")
    return cleaned or fallback


def guess_mime(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in MIME_OVERRIDES:
        return MIME_OVERRIDES[ext]
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def build_display_name(*, teacher_id: str, full_name: str, filename: str) -> str:
    """`{teacher_id}_{full_name}_{original}` — keeps the dept's folder readable."""
    name = sanitize_filename(filename)
    person = sanitize_filename(f"{teacher_id}_{full_name}", fallback=teacher_id)
    return f"{person}_{name}"[:200]


def checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


# ── Local disk ─────────────────────────────────────────────────────────────

class LocalStorage:
    backend = "local"

    def __init__(self, root: Path | str | None = None) -> None:
        self._root = Path(root) if root else UPLOAD_DIR

    def resolve(self, key: str) -> Path:
        path = (self._root / key).resolve()
        root = self._root.resolve()
        if not str(path).startswith(str(root)):
            raise StorageError("path นอกขอบเขตที่อนุญาต")
        return path

    async def save(
        self,
        *,
        namespace: str,
        subfolder: str,
        filename: str,
        content: bytes,
        mime_type: str,
        folder_id: str | None = None,
        drive_id: str | None = None,
    ) -> StoredFile:
        key = "/".join([
            sanitize_segment(namespace, "workspace"),
            sanitize_segment(subfolder, "event"),
            sanitize_filename(filename),
        ])
        path = self.resolve(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

        await asyncio.to_thread(_write)
        return StoredFile(
            backend=self.backend,
            key=key,
            file_name=filename,
            size=len(content),
            mime_type=mime_type,
            web_view_url=None,
        )

    async def read(self, key: str) -> bytes:
        path = self.resolve(key)
        if not path.is_file():
            raise StorageError("ไม่พบไฟล์ในเครื่อง (อาจหายหลัง redeploy)")
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> bool:
        path = self.resolve(key)
        if not path.is_file():
            return False

        def _unlink() -> None:
            path.unlink(missing_ok=True)

        await asyncio.to_thread(_unlink)
        return True


# ── Google Drive ───────────────────────────────────────────────────────────

class DriveStorage:
    backend = "drive"

    def __init__(self, client: DriveClient) -> None:
        self._client = client

    @property
    def client(self) -> DriveClient:
        """Exposed so the API can verify a folder link without duplicating auth."""
        return self._client

    async def save(
        self,
        *,
        namespace: str,
        subfolder: str,
        filename: str,
        content: bytes,
        mime_type: str,
        folder_id: str | None = None,
        drive_id: str | None = None,
    ) -> StoredFile:
        if not folder_id:
            raise StorageError(
                "ยังไม่ได้ตั้งโฟลเดอร์ปลายทางใน Drive — ไปที่หน้าตั้งค่าพอร์ทัล"
            )
        try:
            target = await self._client.ensure_folder(
                subfolder, folder_id, drive_id, create=True
            )
            uploaded = await self._client.upload(
                filename=filename,
                content=content,
                mime_type=mime_type,
                parent_id=target,
                drive_id=drive_id,
            )
        except DriveError as e:
            raise StorageError(str(e)) from e
        return StoredFile(
            backend=self.backend,
            key=uploaded.id,
            file_name=uploaded.name,
            size=uploaded.size or len(content),
            mime_type=mime_type,
            web_view_url=uploaded.web_view_url,
        )

    async def read(self, key: str) -> bytes:
        try:
            return await self._client.download(key)
        except DriveError as e:
            raise StorageError(str(e)) from e

    async def delete(self, key: str) -> bool:
        try:
            return await self._client.delete(key)
        except DriveError:
            return False


# ── Factory ────────────────────────────────────────────────────────────────

def build_drive_client(
    *,
    refresh_token: str | None = None,
    transport=None,
) -> DriveClient | None:
    """Build a Drive client from settings + an optional stored refresh token."""
    token = (refresh_token or settings.GOOGLE_DRIVE_REFRESH_TOKEN or "").strip()
    service_account = None
    if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        service_account = service_account_from_value(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    if not token and not service_account:
        return None
    return DriveClient(
        refresh_token=token or None,
        client_id=settings.portal_drive_client_id,
        client_secret=settings.portal_drive_client_secret,
        service_account=service_account,
        transport=transport,
    )


def get_storage(refresh_token: str | None = None, *, transport=None):
    """Return the configured storage backend (Drive or local disk)."""
    if settings.portal_storage == "drive":
        client = build_drive_client(refresh_token=refresh_token, transport=transport)
        if client is not None:
            return DriveStorage(client)
    root = Path(settings.portal_upload_dir) if settings.portal_upload_dir else UPLOAD_DIR
    return LocalStorage(root)


def storage_warning() -> str | None:
    """Human-readable warning shown in the admin UI when storage is not durable."""
    if settings.portal_storage == "local":
        return (
            "ไฟล์ถูกเก็บในเครื่องเซิร์ฟเวอร์ (local disk) — บน Render ไฟล์จะหายเมื่อ redeploy "
            "ควรเชื่อม Google Drive ก่อนใช้งานจริง"
        )
    return None
