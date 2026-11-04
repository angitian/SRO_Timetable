"""Role resolution helpers for workspace and trainee-module access.

The rules are intentionally small and deterministic so the D1 store, the
local JSON store, and the API routers all agree:

  explicit workspace member > team default > legacy manager_emails
  trainee member > team default > none

Workspace owners are always `owner`; trainee module owners are always
`owner` in the trainee namespace.
"""
from __future__ import annotations

from typing import Any

from utils import normalize_email

WORKSPACE_ROLES = {"owner", "editor", "viewer"}
TRAINEE_ROLES = {"owner", "none", "viewer", "editor"}


def normalize_workspace_role(value: str | None, default: str = "viewer") -> str:
    value = (value or "").strip().lower()
    return value if value in WORKSPACE_ROLES else default


def normalize_trainee_role(value: str | None, default: str = "none") -> str:
    value = (value or "").strip().lower()
    return value if value in TRAINEE_ROLES else default


def _member_role(members: list[dict] | None, email: str | None) -> dict | None:
    email = normalize_email(email)
    if not email:
        return None
    for member in members or []:
        if normalize_email(member.get("email")) == email:
            return member
    return None


def resolve_workspace_role(
    *,
    record: dict,
    members: list[dict] | None,
    team_default: dict | None,
    user_id: str | None,
    email: str | None,
    access_mode: str | None = None,
) -> str | None:
    """Return owner/editor/viewer, or None when the caller has no access."""
    owner_id = record.get("user_id")
    if owner_id and user_id and owner_id == user_id:
        return "owner"

    explicit = _member_role(members, email)
    if explicit:
        return normalize_workspace_role(explicit.get("workspace_role"), "viewer")

    # Legacy manager_emails behaved like editors.
    email_norm = normalize_email(email)
    if email_norm and email_norm in {
        normalize_email(e) for e in (record.get("manager_emails") or [])
    }:
        return "editor"

    mode = (access_mode or record.get("access_mode") or "team").strip().lower()
    if mode == "team" and team_default:
        role = normalize_workspace_role(team_default.get("default_workspace_role"), "editor")
        if role in ("editor", "viewer"):
            return role

    # Guest/local workspace: no owner means unrestricted on the device.
    if not owner_id and not record.get("manager_emails"):
        return "owner"
    return None


def resolve_trainee_role(
    *,
    trainee_row: dict,
    trainee_members: list[dict] | None,
    team_default: dict | None,
    user_id: str | None,
    email: str | None,
) -> str:
    """Return owner/none/viewer/editor for the trainee module."""
    owner_id = trainee_row.get("owner_user_id")
    if owner_id and user_id and owner_id == user_id:
        return "owner"

    explicit = _member_role(trainee_members, email)
    if explicit:
        return normalize_trainee_role(explicit.get("role"), "none")

    mode = (trainee_row.get("access_mode") or "private").strip().lower()
    if mode == "team" and team_default:
        role = normalize_trainee_role(team_default.get("default_trainee_role"), "none")
        if role in ("viewer", "editor"):
            return role
    return "none"


def team_default_for(team_members: list[dict] | None, owner_id: str | None, email: str | None) -> dict | None:
    """Find the team_members row that grants `email` access to `owner_id`."""
    owner_id = owner_id or ""
    email = normalize_email(email)
    if not owner_id or not email:
        return None
    for row in team_members or []:
        member_email = row.get("member_email") or row.get("email")
        if row.get("owner_user_id") == owner_id and normalize_email(member_email) == email:
            return row
    return None


def can_edit_workspace(role: str | None) -> bool:
    return role in ("owner", "editor")


def can_view_workspace(role: str | None) -> bool:
    return role in ("owner", "editor", "viewer")


def can_edit_trainees(role: str | None) -> bool:
    return role in ("owner", "editor")
