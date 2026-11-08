"""Trainee attendance module API.

The module is linked to a timetable workspace for its reference data, but its
permissions are deliberately separate: a trainee viewer/editor does not need
workspace edit access, and a workspace editor with `trainee_role='none'` does
not see the module.

Endpoints (prefix /api/v1/trainees):
  GET    /mine                  accessible trainee modules for the caller
  GET    /share/{short_code}    public: shared summary payload (no login)
  GET    /{timetable_id}        module data + effective role
  PUT    /{timetable_id}        save module data (optimistic version)
  GET    /{timetable_id}/members
  PUT    /{timetable_id}/members (owner only)
  GET    /{timetable_id}/share  owner/editor: existing public summary link
  POST   /{timetable_id}/share  owner/editor: create/update the link
  DELETE /{timetable_id}/share  owner/editor: revoke the link
"""
from __future__ import annotations

import json
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import UserIdentity, get_identity
from config import settings
from d1_service import D1Error
from models import (
    TraineeMembersRequest,
    TraineeShareRequest,
    TraineeShareResult,
    TraineeWorkspaceResponse,
    TraineeWorkspaceSaveRequest,
    TraineeWorkspaceSummary,
)
from permissions import (
    can_edit_trainees,
    resolve_trainee_role,
    team_default_for,
)
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/trainees", tags=["trainees"])

MAX_TRAINEE_DATA_BYTES = 2 * 1024 * 1024
MAX_SHARE_PAYLOAD_BYTES = 2 * 1024 * 1024

_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SHORT_CODE_LENGTH = 6
_SHORT_CODE_MAX_ATTEMPTS = 10


def _generate_short_code() -> str:
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(_SHORT_CODE_LENGTH))


def _build_share_url(short_code: str) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}/view?tr={short_code}"


def _require_login(identity: UserIdentity) -> None:
    if not identity.is_authenticated:
        raise HTTPException(status_code=403, detail="Login required for trainee module")


async def _require_trainee_editor(store: Any, timetable_id: str, identity: UserIdentity) -> tuple[dict, str]:
    """Load the module and require owner/editor rights for share management."""
    _require_login(identity)
    row = await store.get_trainee_workspace(timetable_id)
    if not row:
        raise HTTPException(status_code=404, detail="Trainee module not found")
    role = await _trainee_role(store, row, identity)
    if role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="ต้องมีสิทธิ์แก้ไขโมดูลเพื่อจัดการลิงก์แชร์")
    return row, role


def _count_records(data: dict) -> tuple[int, int]:
    trainees = data.get("trainees") if isinstance(data, dict) else []
    attendance = data.get("attendance") if isinstance(data, dict) else {}
    trainee_count = len(trainees) if isinstance(trainees, list) else 0
    attendance_count = 0
    if isinstance(attendance, dict):
        for day in attendance.values():
            if isinstance(day, dict):
                attendance_count += len(day)
    return trainee_count, attendance_count


async def _trainee_role(store: Any, row: dict, identity: UserIdentity) -> str:
    members = await store.get_trainee_members(row["timetable_id"])
    team_members = await store.get_team_members(row.get("owner_user_id")) if row.get("owner_user_id") else []
    team_default = team_default_for(team_members, row.get("owner_user_id"), identity.email)
    return resolve_trainee_role(
        trainee_row=row,
        trainee_members=members,
        team_default=team_default,
        user_id=identity.user_id,
        email=identity.email,
    )


def _response(row: dict, role: str) -> TraineeWorkspaceResponse:
    return TraineeWorkspaceResponse(
        timetable_id=row["timetable_id"],
        title=row.get("title") or row.get("timetable_title") or "",
        timetable_title=row.get("timetable_title") or row.get("title") or "",
        academic_year=row.get("academic_year"),
        term=row.get("term"),
        owner_user_id=row.get("owner_user_id"),
        access_mode=row.get("access_mode") or "private",
        data=row.get("data") or {},
        version=int(row.get("version") or 0),
        trainee_count=int(row.get("trainee_count") or 0),
        attendance_count=int(row.get("attendance_count") or 0),
        updated_at=row.get("updated_at"),
        my_trainee_role=role,
        can_edit_trainees=can_edit_trainees(role),
        is_owner=role == "owner",
    )


@router.get("/mine", response_model=list[TraineeWorkspaceSummary])
async def list_my_trainee_workspaces(
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    _require_login(identity)
    try:
        rows = await store.list_trainee_workspaces_for_identity(identity.user_id, identity.email)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to list trainee modules: {e}")
    return [
        TraineeWorkspaceSummary(
            timetable_id=r["timetable_id"],
            title=r.get("title") or r.get("timetable_title") or "",
            timetable_title=r.get("timetable_title") or r.get("title") or "",
            academic_year=r.get("academic_year"),
            term=r.get("term"),
            owner_user_id=r.get("owner_user_id"),
            my_trainee_role=r.get("my_trainee_role") or "none",
            trainee_count=int(r.get("trainee_count") or 0),
            attendance_count=int(r.get("attendance_count") or 0),
            updated_at=r.get("updated_at"),
        )
        for r in rows
    ]


@router.get("/share/{short_code}")
async def get_public_trainee_share(
    short_code: str,
    store: Any = Depends(get_timetable_store),
):
    """Public: fetch a shared trainee summary by short code (no login)."""
    try:
        record = await store.get_trainee_share_by_short_code(short_code.strip().upper())
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch trainee share: {e}")
    if not record:
        raise HTTPException(status_code=404, detail="ไม่พบลิงก์แชร์ผลสรุป หรือลิงก์ถูกยกเลิกแล้ว")
    return {
        "id": record["id"],
        "timetable_id": record["timetable_id"],
        "payload": record["payload"],
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
    }


@router.get("/{timetable_id}", response_model=TraineeWorkspaceResponse)
async def get_trainee_workspace(
    timetable_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    _require_login(identity)
    try:
        row = await store.get_trainee_workspace(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to load trainee module: {e}")

    if row:
        role = await _trainee_role(store, row, identity)
        if role == "none":
            raise HTTPException(status_code=404, detail="Trainee module not found or not yours")
        return _response(row, role)

    # No module yet: only someone who can edit the timetable workspace may
    # initialize one (and thereby capture the reference snapshot).
    workspace = await store.get_timetable_by_id(timetable_id, identity.user_id, identity.email)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found or not yours")
    workspace_role = workspace.get("my_workspace_role")
    if workspace_role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="ต้องมีสิทธิ์แก้ไข workspace เพื่อสร้างโมดูลนักศึกษา")
    return TraineeWorkspaceResponse(
        timetable_id=timetable_id,
        title=workspace.get("title") or "",
        timetable_title=workspace.get("title") or "",
        academic_year=workspace.get("academic_year"),
        term=workspace.get("term"),
        owner_user_id=workspace.get("user_id"),
        access_mode="private",
        data={},
        version=0,
        trainee_count=0,
        attendance_count=0,
        my_trainee_role="owner" if workspace_role == "owner" else "editor",
        can_edit_trainees=True,
        is_owner=workspace_role == "owner",
    )


@router.put("/{timetable_id}", response_model=TraineeWorkspaceResponse)
async def save_trainee_workspace(
    timetable_id: str,
    body: TraineeWorkspaceSaveRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    _require_login(identity)
    data_json = json.dumps(body.data, ensure_ascii=False)
    if len(data_json.encode("utf-8")) > MAX_TRAINEE_DATA_BYTES:
        raise HTTPException(status_code=413, detail="ข้อมูลโมดูลนักศึกษาใหญ่เกิน 2 MB")

    try:
        row = await store.get_trainee_workspace(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to load trainee module: {e}")

    if row:
        role = await _trainee_role(store, row, identity)
        if role == "none":
            raise HTTPException(status_code=404, detail="Trainee module not found or not yours")
        if role not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="คุณมีสิทธิ์อ่านโมดูลนี้เท่านั้น")
        owner_user_id = row.get("owner_user_id") or identity.user_id
        access_mode = row.get("access_mode") or "private"
    else:
        workspace = await store.get_timetable_by_id(timetable_id, identity.user_id, identity.email)
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found or not yours")
        if workspace.get("my_workspace_role") not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="ต้องมีสิทธิ์แก้ไข workspace เพื่อสร้างโมดูลนักศึกษา")
        owner_user_id = workspace.get("user_id") or identity.user_id
        access_mode = "private"

    try:
        ok, current = await store.save_trainee_workspace(
            timetable_id=timetable_id,
            owner_user_id=owner_user_id,
            access_mode=access_mode,
            data_json=data_json,
            base_version=body.base_version,
            updated_by=identity.user_id,
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to save trainee module: {e}")

    if not ok:
        if current:
            role = await _trainee_role(store, current, identity)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดข้อมูลล่าสุด",
                    "current": _response(current, role).model_dump(),
                },
            )
        raise HTTPException(status_code=409, detail="ไม่พบเวอร์ชันที่ต้องการบันทึก")

    trainee_count, attendance_count = _count_records(body.data)
    try:
        await store.update_trainee_counts(timetable_id, trainee_count, attendance_count)
        saved = await store.get_trainee_workspace(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to finalize trainee module: {e}")

    if not saved:
        raise HTTPException(status_code=500, detail="บันทึกแล้วแต่ไม่พบข้อมูลที่บันทึก")
    role = await _trainee_role(store, saved, identity)
    return _response(saved, role)


@router.get("/{timetable_id}/members")
async def get_trainee_members(
    timetable_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    _require_login(identity)
    row = await store.get_trainee_workspace(timetable_id)
    if not row:
        raise HTTPException(status_code=404, detail="Trainee module not found")
    role = await _trainee_role(store, row, identity)
    if role not in ("owner", "editor"):
        raise HTTPException(status_code=404, detail="Trainee module not found or not yours")
    members = await store.get_trainee_members(timetable_id)
    return {
        "ok": True,
        "timetable_id": timetable_id,
        "access_mode": row.get("access_mode") or "private",
        "members": members,
        "my_trainee_role": role,
    }


@router.put("/{timetable_id}/members")
async def set_trainee_members(
    timetable_id: str,
    body: TraineeMembersRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    _require_login(identity)
    row = await store.get_trainee_workspace(timetable_id)
    if not row:
        raise HTTPException(status_code=404, detail="Trainee module not found")
    role = await _trainee_role(store, row, identity)
    if role != "owner":
        raise HTTPException(status_code=403, detail="เฉพาะเจ้าของโมดูลเท่านั้นที่จัดการสิทธิ์ได้")

    members = [
        {"email": m.email, "role": m.role}
        for m in body.members
        if m.email and m.email != (identity.email or "").strip().lower()
    ]
    try:
        await store.set_trainee_members(timetable_id, identity.user_id, members)
        if body.access_mode:
            await store.update_trainee_access(timetable_id, identity.user_id, body.access_mode)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to update trainee members: {e}")
    saved = await store.get_trainee_workspace(timetable_id)
    return {
        "ok": True,
        "timetable_id": timetable_id,
        "access_mode": (saved or {}).get("access_mode") or "private",
        "members": await store.get_trainee_members(timetable_id),
    }


# ── Public summary share links (/view?tr=CODE) ─────────────────────────────


@router.get("/{timetable_id}/share")
async def get_trainee_share(
    timetable_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Owner/editor: return the existing share link for this module (if any)."""
    await _require_trainee_editor(store, timetable_id, identity)
    try:
        record = await store.get_trainee_share(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to load trainee share: {e}")
    if not record:
        return {"ok": True, "timetable_id": timetable_id, "share": None}
    return {
        "ok": True,
        "timetable_id": timetable_id,
        "share": {
            "id": record["id"],
            "short_code": record["short_code"],
            "share_url": _build_share_url(record["short_code"]),
            "updated_at": record.get("updated_at"),
        },
    }


@router.post("/{timetable_id}/share", response_model=TraineeShareResult)
async def share_trainee_summary(
    timetable_id: str,
    body: TraineeShareRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Owner/editor: create or update the public summary link (one per module)."""
    row, _ = await _require_trainee_editor(store, timetable_id, identity)
    payload_json = json.dumps(body.payload, ensure_ascii=False)
    if len(payload_json.encode("utf-8")) > MAX_SHARE_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="ข้อมูลผลสรุปใหญ่เกิน 2 MB")

    owner_user_id = row.get("owner_user_id") or identity.user_id
    try:
        existing = await store.get_trainee_share(timetable_id)
        if existing:
            await store.save_trainee_share(
                id=existing["id"],
                short_code=existing["short_code"],
                timetable_id=timetable_id,
                payload_json=payload_json,
                owner_user_id=owner_user_id,
                created_by=identity.user_id,
            )
        else:
            short_code = None
            for _ in range(_SHORT_CODE_MAX_ATTEMPTS):
                candidate = _generate_short_code()
                if not await store.trainee_share_short_code_exists(candidate):
                    short_code = candidate
                    break
            if short_code is None:
                raise HTTPException(status_code=409, detail="Could not allocate a short code")
            await store.save_trainee_share(
                id=str(uuid.uuid4()),
                short_code=short_code,
                timetable_id=timetable_id,
                payload_json=payload_json,
                owner_user_id=owner_user_id,
                created_by=identity.user_id,
            )
        saved = await store.get_trainee_share(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to share trainee summary: {e}")

    if not saved:
        raise HTTPException(status_code=500, detail="บันทึกลิงก์แล้วแต่ไม่พบข้อมูล")
    return TraineeShareResult(
        id=saved["id"],
        short_code=saved["short_code"],
        share_url=_build_share_url(saved["short_code"]),
        timetable_id=timetable_id,
        updated_at=saved.get("updated_at"),
    )


@router.delete("/{timetable_id}/share")
async def revoke_trainee_share(
    timetable_id: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
):
    """Owner/editor: revoke the public summary link."""
    await _require_trainee_editor(store, timetable_id, identity)
    try:
        deleted = await store.delete_trainee_share(timetable_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to revoke trainee share: {e}")
    return {"ok": True, "timetable_id": timetable_id, "deleted": deleted}
