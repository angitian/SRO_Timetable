"""FastAPI router for the SRO Timetable sharing feature.

Endpoints:
  POST /api/v1/timetables/generate-and-save
       Solve a TimetableRequest, persist the result (D1 or local fallback),
       and return a 6-char short_code + shareable URL.
  POST /api/v1/timetables/save-result
       Persist a pre-solved / manually-edited timetable WITHOUT re-running
       the solver. The frontend sends the exact slots currently displayed
       so the public viewer matches the printed page 1:1.
  GET  /api/v1/timetables/t/{short_code}
       Public: fetch a stored timetable by short_code (Lead Magnet view).
  GET  /api/v1/timetables/my-schedules
       Protected (X-User-Id header): list the caller's saved timetables.
  POST /api/v1/timetables/claim
       Protected (X-User-Id header): link a guest-created short_code to the
       authenticated user.
"""
from __future__ import annotations

import json
import secrets
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse

from auth import UserIdentity, get_identity, get_optional_identity
from config import settings
from d1_service import D1Error
from models import (
    ClaimTimetableRequest,
    GenerateAndSaveRequest,
    MergeGuestRequest,
    SaveResultRequest,
    TimetableRecord,
    TimetableSaveResult,
    TimetableRequest,
    WorkspaceSaveRequest,
    WorkspaceSaveResult,
)
from solver import TimetableSolver
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/timetables", tags=["timetables"])

# Type alias for the store dependency (D1Client or LocalTimetableStore).
# Using `Any` here keeps the signature simple since both expose the same API.
from typing import Any

# Unambiguous alphabet (no 0/O/1/I/L) for short codes — easy to read/type/QR.
_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SHORT_CODE_LENGTH = 6
_SHORT_CODE_MAX_ATTEMPTS = 10


def _generate_short_code() -> str:
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(_SHORT_CODE_LENGTH))


def _build_share_url(short_code: str) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}/view?code={short_code}"


def _require_user_id(x_user_id: str | None = Header(None, alias="X-User-Id")) -> str:
    """Legacy dependency: extract the caller's user id from the X-User-Id header.

    POC-level auth — the frontend generates a stable device id in localStorage
    and sends it on protected requests. 401 if missing/blank.

    Kept for backward compatibility with /claim (which predates JWT support).
    New endpoints use `get_identity` instead.
    """
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=401, detail="Missing X-User-Id header")
    return x_user_id.strip()


@router.post("/generate-and-save", response_model=TimetableSaveResult)
async def generate_and_save(
    request: GenerateAndSaveRequest,
    identity: UserIdentity | None = Depends(get_optional_identity),
    store: Any = Depends(get_timetable_store),
):
    """Solve the supplied config, persist the result, and return a share link.

    If the caller is authenticated (Bearer JWT) or sends X-User-Id, the timetable
    is owned by them from creation. Anonymous guests get an unowned record that
    can be claimed later via /claim.
    """
    config: TimetableRequest = request.config
    if not config.lesson_blocks:
        raise HTTPException(status_code=400, detail="No lesson blocks provided")
    if not config.teachers:
        raise HTTPException(status_code=400, detail="No teachers provided")
    if not config.classes:
        raise HTTPException(status_code=400, detail="No classes provided")

    solver = TimetableSolver(config)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        # Mirror /generate: return the full TimetableResponse (with diagnostics)
        # so the frontend can surface actionable error messages.
        return JSONResponse(status_code=422, content=result.model_dump())

    config_json = json.dumps(config.model_dump(), ensure_ascii=False)
    result_json = json.dumps(result.model_dump(), ensure_ascii=False)

    # Generate a unique short_code with bounded retries.
    short_code = None
    for _ in range(_SHORT_CODE_MAX_ATTEMPTS):
        candidate = _generate_short_code()
        if not await store.short_code_exists(candidate):
            short_code = candidate
            break
    if short_code is None:
        raise HTTPException(
            status_code=409,
            detail="Could not allocate a unique short code — please retry",
        )

    record_id = str(uuid.uuid4())
    is_public = 1 if request.is_public else 0
    # Authenticated users own the record from creation; guests leave it unowned.
    owner_id = identity.user_id if identity else None

    try:
        await store.save_timetable(
            id=record_id,
            short_code=short_code,
            user_id=owner_id,
            title=request.title,
            academic_year=request.academic_year,
            term=request.term,
            config_json=config_json,
            result_json=result_json,
            is_public=is_public,
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to save timetable: {e}")

    return TimetableSaveResult(
        id=record_id,
        short_code=short_code,
        share_url=_build_share_url(short_code),
        title=request.title,
        academic_year=request.academic_year,
        term=request.term,
    )


@router.post("/save-result", response_model=TimetableSaveResult)
async def save_result(
    request: SaveResultRequest,
    identity: UserIdentity | None = Depends(get_optional_identity),
    store: Any = Depends(get_timetable_store),
):
    """Persist a pre-solved / manually-edited timetable WITHOUT re-running the
    solver.

    The frontend sends the exact slots currently displayed on screen (solver
    slots ∪ manual placements, deduplicated) so the public viewer matches the
    printed page 1:1. This avoids the INFEASIBLE failure mode that arises when
    locking user-edited placements and re-solving.
    """
    config: TimetableRequest = request.config
    if not config.lesson_blocks:
        raise HTTPException(status_code=400, detail="No lesson blocks provided")
    if not config.teachers:
        raise HTTPException(status_code=400, detail="No teachers provided")
    if not config.classes:
        raise HTTPException(status_code=400, detail="No classes provided")
    if not request.result.slots:
        raise HTTPException(status_code=400, detail="No result slots provided")

    config_json = json.dumps(config.model_dump(), ensure_ascii=False)
    result_json = json.dumps(request.result.model_dump(), ensure_ascii=False)

    # Generate a unique short_code with bounded retries.
    short_code = None
    for _ in range(_SHORT_CODE_MAX_ATTEMPTS):
        candidate = _generate_short_code()
        if not await store.short_code_exists(candidate):
            short_code = candidate
            break
    if short_code is None:
        raise HTTPException(
            status_code=409,
            detail="Could not allocate a unique short code — please retry",
        )

    record_id = str(uuid.uuid4())
    is_public = 1 if request.is_public else 0
    owner_id = identity.user_id if identity else None

    try:
        await store.save_timetable(
            id=record_id,
            short_code=short_code,
            user_id=owner_id,
            title=request.title,
            academic_year=request.academic_year,
            term=request.term,
            config_json=config_json,
            result_json=result_json,
            is_public=is_public,
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to save timetable: {e}")

    return TimetableSaveResult(
        id=record_id,
        short_code=short_code,
        share_url=_build_share_url(short_code),
        title=request.title,
        academic_year=request.academic_year,
        term=request.term,
    )


@router.get("/t/{short_code}", response_model=TimetableRecord)
async def get_timetable_by_short_code(
    short_code: str,
    store: Any = Depends(get_timetable_store),
):
    """Public endpoint: fetch a stored timetable by its short code."""
    code = short_code.strip().upper()
    try:
        record = await store.get_timetable_by_short_code(code)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch timetable: {e}")
    if not record:
        raise HTTPException(status_code=404, detail="Timetable not found or not public")
    return TimetableRecord(**record)


@router.get("/my-schedules", response_model=list[TimetableRecord])
async def list_my_schedules(
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Protected: list all timetables owned by the caller (JWT or guest device)."""
    try:
        records = await store.get_user_schedules(identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch schedules: {e}")
    return [TimetableRecord(**r) for r in records]


@router.post("/claim", response_model=TimetableRecord)
async def claim_timetable(
    body: ClaimTimetableRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Protected: link an existing guest-created short_code to the caller."""
    code = body.short_code.strip().upper()
    try:
        claimed = await store.claim_timetable(code, identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to claim timetable: {e}")
    if not claimed:
        raise HTTPException(
            status_code=404,
            detail="Timetable not found, already claimed, or already yours",
        )
    record = await store.get_timetable_by_short_code(code)
    if not record:
        # Claimed but no longer public (or raced) — still report success shape.
        raise HTTPException(status_code=404, detail="Timetable not found after claim")
    return TimetableRecord(**record)


# ── Workspace endpoints (private, owner-scoped, no re-solve) ────────────────


@router.post("/save-workspace", response_model=WorkspaceSaveResult)
async def save_workspace(
    body: WorkspaceSaveRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Save the full workspace (fixtureData + result + userPlacements + ...) without re-solving.

    The record is private (is_public=0) — it won't appear in /t/{short_code}.
    If `id` is provided, the existing record is updated (must be owned by the caller).
    Otherwise a new private record is created with a fresh short_code (unused but
    keeps the schema's NOT NULL UNIQUE constraint satisfied).
    """
    workspace_json = json.dumps(body.workspace, ensure_ascii=False)
    record_id = body.id or str(uuid.uuid4())

    if body.id:
        # Update path: verify ownership first
        existing = await store.get_timetable_by_id(body.id, identity.user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Workspace not found or not yours")
        # Preserve short_code/config/result from the existing record
        short_code = existing["short_code"]
        config_json = json.dumps(existing.get("config") or {}, ensure_ascii=False)
        result_json = json.dumps(existing.get("result") or {}, ensure_ascii=False)
    else:
        # Create path: allocate a fresh short_code (private, so it's just a placeholder)
        short_code = None
        for _ in range(_SHORT_CODE_MAX_ATTEMPTS):
            candidate = _generate_short_code()
            if not await store.short_code_exists(candidate):
                short_code = candidate
                break
        if short_code is None:
            raise HTTPException(status_code=409, detail="Could not allocate a short code")
        # For workspace-only saves, config/result are empty placeholders
        config_json = json.dumps({}, ensure_ascii=False)
        result_json = json.dumps({}, ensure_ascii=False)

    try:
        await store.save_timetable(
            id=record_id,
            short_code=short_code,
            user_id=identity.user_id,
            title=body.title,
            academic_year=body.academic_year,
            term=body.term,
            config_json=config_json,
            result_json=result_json,
            workspace_json=workspace_json,
            is_public=0,  # private workspace
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to save workspace: {e}")

    # Fetch back to get the updated_at timestamp
    saved = await store.get_timetable_by_id(record_id, identity.user_id)
    return WorkspaceSaveResult(
        id=record_id,
        title=body.title,
        updated_at=saved["updated_at"] if saved else None,
    )


@router.get("/workspace/{record_id}", response_model=TimetableRecord)
async def get_workspace(
    record_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Fetch a private workspace by id, scoped to the caller."""
    try:
        record = await store.get_timetable_by_id(record_id, identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch workspace: {e}")
    if not record:
        raise HTTPException(status_code=404, detail="Workspace not found or not yours")
    return TimetableRecord(**record)


@router.delete("/workspace/{record_id}")
async def delete_workspace(
    record_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Delete a private workspace owned by the caller."""
    try:
        deleted = await store.delete_timetable(record_id, identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to delete workspace: {e}")
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found or not yours")
    return {"ok": True, "id": record_id}


@router.post("/merge-guest")
async def merge_guest(
    body: MergeGuestRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Reassign all guest-created records (saved with a device id) to the
    authenticated user. Useful after a user logs in for the first time and
    wants to keep work they saved as a guest on this device.

    Only callable by authenticated users (JWT required — guests can't merge).
    """
    if not identity.is_authenticated:
        raise HTTPException(status_code=403, detail="Login required to merge guest workspaces")
    try:
        count = await store.merge_guest_workspaces(body.device_id, identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to merge: {e}")
    return {"ok": True, "merged": count}
