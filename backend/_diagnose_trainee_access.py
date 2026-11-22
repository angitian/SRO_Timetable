"""Read-only diagnostic: does <email> have trainee-module access to <timetable_id>, and why/why not?

Usage:
    cd backend
    python _diagnose_trainee_access.py <timetable_id> <member_email> [--owner-user-id <id>]

Run it where the production store is reachable — i.e. with the same
CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN env
vars the backend uses (Render shell, or a local shell that sources .env).
Without those vars it reads the local JSON store (backend/data/).

It prints every grant source for the module and the role each one resolves to:
  - timetables row (owner, access_mode)
  - workspace_members rows (workspace_role + trainee_role)
  - trainee_workspaces row (module owner + access_mode)
  - trainee_members rows
  - team_members rows of the owner
  - the role the caller gets from each source + the final resolved role
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from config import settings
from permissions import resolve_trainee_role, team_default_for
from timetable_store import get_timetable_store
from utils import normalize_email

_PROBE_USER_ID = "__diagnose_no_such_user__"


def _fmt_member(m: dict, key_email: str = "email") -> str:
    role_bits = ", ".join(
        f"{k}={m[k]}" for k in ("workspace_role", "trainee_role", "role", "default_workspace_role", "default_trainee_role")
        if m.get(k) is not None
    )
    return f"    - {m.get(key_email) or m.get('member_email') or '?'} ({role_bits or 'no roles'})"


async def diagnose(timetable_id: str, email: str, owner_hint: str | None) -> int:
    backend = "Cloudflare D1 (remote)" if settings.d1_configured else "local JSON store (backend/data)"
    print(f"store backend : {backend}")
    print(f"timetable_id  : {timetable_id}")
    print(f"checking email: {email or '(none)'}")
    print()

    store = get_timetable_store()

    # ── The module row itself ────────────────────────────────────────────────
    trainee_row = await store.get_trainee_workspace(timetable_id)
    if trainee_row:
        print("trainee_workspaces:")
        print(f"    owner_user_id={trainee_row.get('owner_user_id')}  "
              f"access_mode={trainee_row.get('access_mode')}  "
              f"version={trainee_row.get('version')}  "
              f"trainees={trainee_row.get('trainee_count')}  "
              f"attendance={trainee_row.get('attendance_count')}")
    else:
        print("trainee_workspaces: NO ROW — the module was never saved to the cloud")

    owner_id = owner_hint or (trainee_row or {}).get("owner_user_id")

    # ── Workspace record as the MEMBER would see it ──────────────────────────
    member_view = await store.get_timetable_by_id(timetable_id, _PROBE_USER_ID, email)
    owner_view = (
        await store.get_timetable_by_id(timetable_id, owner_id, None)
        if owner_id else None
    )
    ws = owner_view or member_view
    if ws:
        print("\ntimetables:")
        print(f"    owner={ws.get('user_id')} ({ws.get('owner_email') or 'no owner_email'})  "
              f"title={ws.get('title')!r}  access_mode={ws.get('access_mode')}")
    else:
        print("\ntimetables: not accessible via store (pass --owner-user-id if you know the owner)")

    print("\nworkspace_members:")
    ws_members = await store.get_workspace_members(timetable_id)
    if ws_members:
        for m in ws_members:
            mark = "  <-- this user" if normalize_email(m.get("email")) == email else ""
            print(_fmt_member(m) + mark)
    else:
        print("    (none)")

    print("\ntrainee_members:")
    t_members = await store.get_trainee_members(timetable_id)
    if t_members:
        for m in t_members:
            mark = "  <-- this user" if normalize_email(m.get("email")) == email else ""
            print(_fmt_member(m) + mark)
    else:
        print("    (none)")

    print("\nteam_members (of module owner):")
    team = await store.get_team_members(owner_id) if owner_id else []
    if team:
        for m in team:
            mark = "  <-- this user" if normalize_email(m.get("email")) == email else ""
            print(_fmt_member(m, "email") + mark)
    else:
        print("    (none or unknown owner)")

    # ── Resolution ───────────────────────────────────────────────────────────
    print("\n== role resolution " + "=" * 40)
    owner_email = (ws or {}).get("owner_email") or ""
    if normalize_email(owner_email) == email and email:
        print("this email IS the workspace owner → trainee role = 'owner' (always allowed)")
        return 0
    if member_view:
        print(f"member's view of workspace : my_workspace_role={member_view.get('my_workspace_role')}  "
              f"my_trainee_role={member_view.get('my_trainee_role')}")
    else:
        print("member's view of workspace : NO ACCESS to the workspace record")

    if trainee_row:
        team_default = team_default_for(team, trainee_row.get("owner_user_id"), email)
        role = resolve_trainee_role(
            trainee_row=trainee_row,
            trainee_members=t_members,
            workspace_members=ws_members,
            team_default=team_default,
            user_id=_PROBE_USER_ID,
            email=email,
        )
        print(f"final trainee module role  : {role}")
        if role == "none":
            print("\nDIAGNOSIS: the API will answer 404 'Trainee module not found or not yours'.")
            print("Fix one of: add the email to the module ACL (สิทธิ์โมดูล),")
            print("set trainee_role in the workspace members dialog, or share the")
            print("module with the team (สิทธิ์โมดูล → ทีมของเจ้าของโมดูล).")
        else:
            print(f"\nDIAGNOSIS: access should work (role={role}). If the member still")
            print("gets 404, check that they logged in with THIS exact email and")
            print("that the deployed backend includes the workspace_members fix.")
    else:
        print("final trainee module role  : n/a — module row does not exist yet")
        eff = (member_view or {}).get("my_trainee_role") or "none"
        can_create = eff in ("owner", "editor")
        print(f"member could initialize it : {can_create} (effective workspace trainee role: {eff})")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnose trainee-module access for one email (read-only).",
    )
    parser.add_argument("timetable_id", help="workspace/timetable id the module belongs to")
    parser.add_argument("email", help="email of the user being checked")
    parser.add_argument("--owner-user-id", default=None,
                        help="owner user_id (only needed when no module row exists)")
    args = parser.parse_args()
    return asyncio.run(diagnose(args.timetable_id.strip(), normalize_email(args.email), args.owner_user_id))


if __name__ == "__main__":
    sys.exit(main())
