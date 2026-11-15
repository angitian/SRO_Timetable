"""Application settings loaded from environment / .env file.

Cloudflare D1 credentials are optional — when all three are set, the
timetables API uses the D1 REST API; otherwise it falls back to a local
JSON-file store so development keeps working offline.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Cloudflare D1 (REST API)
    CLOUDFLARE_ACCOUNT_ID: str = ""
    CLOUDFLARE_D1_DATABASE_ID: str = ""
    CLOUDFLARE_API_TOKEN: str = ""

    # Frontend origin used to build shareable short-link URLs
    # (e.g. https://sro-timetable.example.workers.dev)
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    # Backend origin (used to build the Google OAuth redirect URI)
    BACKEND_BASE_URL: str = "http://localhost:8000"

    # Google OAuth (Web client) — when both are set, /auth/* endpoints are enabled.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # JWT signing secret for SRO-issued access tokens (HS256).
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 30

    # Dev DB inspector (หน้า /dev/db + /api/v1/dev/db/*) — local-only tool.
    # Set DEV_DB_INSPECTOR=false on production deployments.
    DEV_DB_INSPECTOR: bool = True

    # ── Portal (แจ้งเตือน + ส่งงาน) ────────────────────────────────────────
    # '' = auto: ใช้ 'drive' เมื่อตั้งค่า Drive ครบ, ไม่งั้น fallback 'local'
    PORTAL_STORAGE: str = ""
    PORTAL_UPLOAD_DIR: str = ""  # default: backend/data/uploads
    PORTAL_TZ: str = "Asia/Bangkok"
    PORTAL_MAX_UPLOAD_MB: int = 25
    PORTAL_ALLOWED_EXT: str = ".pdf,.docx,.xlsx,.zip"
    PORTAL_WEBHOOK_SECRET: str = ""

    # Google Drive — OAuth refresh token (แนะนำ: OAuth client user type = Internal)
    # ถ้าไม่ตั้ง CLIENT_ID/SECRET จะใช้ GOOGLE_CLIENT_ID/SECRET ของ login แทน
    GOOGLE_DRIVE_CLIENT_ID: str = ""
    GOOGLE_DRIVE_CLIENT_SECRET: str = ""
    GOOGLE_DRIVE_REFRESH_TOKEN: str = ""
    # หรือ service account (ต้องอัปโหลดเข้า Shared Drive เท่านั้น)
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""  # path ของไฟล์ JSON หรือตัว JSON เอง

    @property
    def d1_configured(self) -> bool:
        """True when all three Cloudflare credentials are provided."""
        return bool(
            self.CLOUDFLARE_ACCOUNT_ID
            and self.CLOUDFLARE_D1_DATABASE_ID
            and self.CLOUDFLARE_API_TOKEN
        )

    @property
    def google_configured(self) -> bool:
        """True when Google OAuth client credentials + JWT secret are set."""
        return bool(
            self.GOOGLE_CLIENT_ID
            and self.GOOGLE_CLIENT_SECRET
            and self.JWT_SECRET
        )

    # ── Portal helpers ─────────────────────────────────────────────────────

    @property
    def portal_drive_client_id(self) -> str:
        return self.GOOGLE_DRIVE_CLIENT_ID or self.GOOGLE_CLIENT_ID

    @property
    def portal_drive_client_secret(self) -> str:
        return self.GOOGLE_DRIVE_CLIENT_SECRET or self.GOOGLE_CLIENT_SECRET

    @property
    def portal_drive_configured(self) -> bool:
        """True when Drive upload is possible (refresh token or service account)."""
        return bool(
            self.GOOGLE_DRIVE_REFRESH_TOKEN or self.GOOGLE_SERVICE_ACCOUNT_JSON
        )

    @property
    def portal_storage(self) -> str:
        """Effective storage backend: 'drive' | 'local'."""
        mode = (self.PORTAL_STORAGE or "").strip().lower()
        if mode in ("local", "drive"):
            return mode
        return "drive" if self.portal_drive_configured else "local"

    @property
    def portal_upload_dir(self) -> str:
        return self.PORTAL_UPLOAD_DIR or ""

    @property
    def portal_allowed_ext(self) -> list[str]:
        return [
            e.strip().lower()
            for e in (self.PORTAL_ALLOWED_EXT or "").split(",")
            if e.strip()
        ]


settings = Settings()
