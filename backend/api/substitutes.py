"""Share links for daily substitute documents (/view?sub=<short_code>).

One row per (owner, date): re-sharing the same date reuses the existing short
code, so repeated "สร้างลิงก์" clicks don't create duplicate rows.

Payload is the raw data needed by the viewer (absences / assignments / day slots
/ lookups) — never pre-rendered HTML. Size is capped to keep D1 rows small.
"""
from __future__ import annotations

import json
import re
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import UserIdentity, get_identity, get_optional_identity
from config import settings
from d1_service import D1Error
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/substitutes", tags=["substitutes"])

# Same unambiguous alphabet as timetable short codes.
_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SHORT_CODE_LENGTH = 6
_SHORT_CODE_MAX_ATTEMPTS = 10

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024  # 2 MB


def _generate_short_code() -> str:
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(_SHORT_CODE_LENGTH))


def _build_share_url(short_code: str) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}/view?sub={short_code}"


class SubstituteShareRequest(BaseModel):
    date: str = Field(min_length=10, max_length=10, description="YYYY-MM-DD")
    payload: dict = Field(description="Raw substitute data for the viewer (no HTML)")


class SubstituteShareResult(BaseModel):
    id: str
    short_code: str
    share_url: str
    date: str
    updated_at: str | None = None


@router.post("/share", response_model=SubstituteShareResult)
async def share_substitute(
    body: SubstituteShareRequest,
    identity: UserIdentity | None = Depends(get_optional_identity),
    store: Any = Depends(get_timetable_store),
):
    """Create or update the share link for one day's substitute documents."""
    if not _DATE_RE.match(body.date):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    payload_json = json.dumps(body.payload, ensure_ascii=False)
    if len(payload_json.encode("utf-8")) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="payload too large (max 2 MB)")

    user_id = identity.user_id if identity else None

    try:
        existing = await store.find_substitute_share_by_owner_date(user_id, body.date)
        if existing:
            await store.save_substitute_share(
                id=existing["id"],
                short_code=existing["short_code"],
                date=body.date,
                payload_json=payload_json,
                user_id=user_id,
            )
            saved = await store.get_substitute_share_by_id(existing["id"])
            return SubstituteShareResult(
                id=existing["id"],
                short_code=existing["short_code"],
                share_url=_build_share_url(existing["short_code"]),
                date=body.date,
                updated_at=(saved or {}).get("updated_at"),
            )

        short_code = None
        for _ in range(_SHORT_CODE_MAX_ATTEMPTS):
            candidate = _generate_short_code()
            if not await store.substitute_short_code_exists(candidate):
                short_code = candidate
                break
        if short_code is None:
            raise HTTPException(status_code=409, detail="Could not allocate a short code")

        record_id = str(uuid.uuid4())
        await store.save_substitute_share(
            id=record_id,
            short_code=short_code,
            date=body.date,
            payload_json=payload_json,
            user_id=user_id,
        )
        saved = await store.get_substitute_share_by_id(record_id)
        return SubstituteShareResult(
            id=record_id,
            short_code=short_code,
            share_url=_build_share_url(short_code),
            date=body.date,
            updated_at=(saved or {}).get("updated_at"),
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to share substitute schedule: {e}")


@router.get("/t/{short_code}")
async def get_substitute_share(
    short_code: str,
    store: Any = Depends(get_timetable_store),
) -> dict:
    """Public: fetch a shared substitute document set by short code."""
    try:
        record = await store.get_substitute_share_by_short_code(short_code.strip().upper())
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch substitute share: {e}")
    if not record:
        raise HTTPException(status_code=404, detail="ไม่พบลิงก์สอนแทน หรือลิงก์ถูกยกเลิกแล้ว")
    return {
        "id": record["id"],
        "date": record["date"],
        "payload": record["payload"],
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
    }


@router.delete("/share/{record_id}")
async def delete_substitute_share(
    record_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Owner-only: revoke a substitute share link."""
    try:
        deleted = await store.delete_substitute_share(record_id, identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to delete share: {e}")
    if not deleted:
        raise HTTPException(status_code=404, detail="ไม่พบลิงก์ หรือคุณไม่ใช่เจ้าของ")
    return {"ok": True, "id": record_id}
