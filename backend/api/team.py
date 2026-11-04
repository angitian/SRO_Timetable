"""FastAPI router for team-level sharing (ผู้ใช้หลายคนใช้ระบบร่วมกัน).

Endpoints (all under /api/v1/team):
  GET    /team                  → the caller's own team + teams they belong to
  POST   /team/members          → add an email to the caller's team (owner only)
  DELETE /team/members/{email}  → remove an email from the caller's team

Membership is stored by email so the owner can invite someone before that
person has ever logged in. When the invitee signs in with Google using that
email, every workspace owned by the team owner is shared with them
(`timetables.access_mode = 'team'`), so they can continue from the existing
data immediately.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import UserIdentity, get_identity
from d1_service import D1Error
from models import (
    AddTeamMemberRequest,
    TeamInfo,
    TeamMember,
    TeamMembership,
    UpdateTeamMemberRolesRequest,
)
from timetable_store import get_timetable_store
from utils import normalize_email

router = APIRouter(prefix="/api/v1/team", tags=["team"])


def _require_login(identity: UserIdentity) -> None:
    if not identity.is_authenticated:
        raise HTTPException(status_code=403, detail="Login required for team management")


async def _team_payload(identity: UserIdentity, store: Any) -> TeamInfo:
    me = await store.get_user_by_sub(identity.user_id) or {}
    members = await store.get_team_members(identity.user_id)
    memberships = await store.get_team_memberships(identity.email or "")
    return TeamInfo(
        owner_id=identity.user_id,
        owner_email=me.get("email") or identity.email or "",
        owner_name=me.get("name") or identity.name or "",
        members=[TeamMember(**m) for m in members],
        memberships=[TeamMembership(**m) for m in memberships],
    )


@router.get("", response_model=TeamInfo)
async def get_team(
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> TeamInfo:
    """Return the caller's own team and the teams they have been added to."""
    _require_login(identity)
    try:
        return await _team_payload(identity, store)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch team: {e}")


@router.post("/members")
async def add_member(
    body: AddTeamMemberRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> dict[str, Any]:
    """Add an email to the caller's team (idempotent)."""
    _require_login(identity)
    email = normalize_email(body.email)
    if email == normalize_email(identity.email):
        raise HTTPException(status_code=400, detail="ไม่สามารถเพิ่มอีเมลของตัวเองเข้าทีมได้")
    try:
        added = await store.add_team_member(
            identity.user_id,
            email,
            default_workspace_role=body.default_workspace_role,
            default_trainee_role=body.default_trainee_role,
        )
        members = await store.get_team_members(identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to add team member: {e}")
    return {"ok": True, "added": added, "email": email, "members": members}


@router.put("/members/{email}")
async def update_member_roles(
    email: str,
    body: UpdateTeamMemberRolesRequest,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> dict[str, Any]:
    """Update a team member's default workspace/trainee roles (team owner only)."""
    _require_login(identity)
    target = normalize_email(email)
    try:
        updated = await store.update_team_member_roles(
            identity.user_id,
            target,
            body.default_workspace_role,
            body.default_trainee_role,
        )
        members = await store.get_team_members(identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to update team member: {e}")
    if not updated:
        raise HTTPException(status_code=404, detail="Member not found in your team")
    return {"ok": True, "email": target, "members": members}


@router.delete("/members/{email}")
async def remove_member(
    email: str,
    identity: UserIdentity = Depends(get_identity),
    store: Any = Depends(get_timetable_store),
) -> dict[str, Any]:
    """Remove an email from the caller's team. Workspaces already saved keep
    their own `manager_emails` grants — only team-level access is revoked."""
    _require_login(identity)
    try:
        removed = await store.remove_team_member(identity.user_id, email)
        members = await store.get_team_members(identity.user_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to remove team member: {e}")
    if not removed:
        raise HTTPException(status_code=404, detail="Member not found in your team")
    return {"ok": True, "removed": True, "email": normalize_email(email), "members": members}
