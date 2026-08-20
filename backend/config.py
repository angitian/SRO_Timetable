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


settings = Settings()
