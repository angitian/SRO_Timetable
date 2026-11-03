"""Dev-only DB inspector API — read-only metadata, local-only.

Safety model (deliberately simple — this is a developer tool, not a feature):
  1. `settings.DEV_DB_INSPECTOR` must be true (set `DEV_DB_INSPECTOR=false` on prod).
  2. The request must originate from loopback (127.0.0.1 / ::1 / localhost).

When disabled the routes answer 404 (existence is not advertised); remote callers
get 403. No endpoint returns config_json / result_json / workspace_json — only
metadata (counts, titles, owners, sizes, flags).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from config import settings
from d1_service import D1Error
from timetable_store import get_timetable_store

router = APIRouter(prefix="/api/v1/dev/db", tags=["dev-db"])

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def require_local_dev(request: Request) -> None:
    """Dependency: allow only local (loopback) requests while the flag is on."""
    if not settings.DEV_DB_INSPECTOR:
        raise HTTPException(status_code=404, detail="Not found")
    host = (request.client.host if request.client else "") or ""
    if host not in _LOOPBACK_HOSTS:
        raise HTTPException(status_code=403, detail="Dev DB inspector is local-only")


@router.get("/overview", dependencies=[Depends(require_local_dev)])
async def dev_overview(store: Any = Depends(get_timetable_store)) -> dict:
    try:
        return await store.dev_overview()
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to read DB: {e}")


@router.get("/users", dependencies=[Depends(require_local_dev)])
async def dev_users(
    q: str = Query("", max_length=120),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = Query("timetables", pattern="^(timetables|created)$"),
    store: Any = Depends(get_timetable_store),
) -> list[dict]:
    try:
        return await store.dev_list_users(q=q, limit=limit, offset=offset, sort=sort)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to read users: {e}")


@router.get("/timetables", dependencies=[Depends(require_local_dev)])
async def dev_timetables(
    q: str = Query("", max_length=120),
    user_id: str = Query("", max_length=120),
    visibility: str = Query("all", pattern="^(all|public|private)$"),
    has_result: str = Query("any", pattern="^(any|yes|no)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = Query("updated", pattern="^(updated|created|title)$"),
    store: Any = Depends(get_timetable_store),
) -> list[dict]:
    try:
        return await store.dev_list_timetables(
            q=q, user_id=user_id, visibility=visibility,
            has_result=has_result, limit=limit, offset=offset, sort=sort,
        )
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to read timetables: {e}")


@router.get("/timetables/{record_id}", dependencies=[Depends(require_local_dev)])
async def dev_timetable(record_id: str, store: Any = Depends(get_timetable_store)) -> dict:
    try:
        record = await store.dev_get_timetable(record_id)
    except D1Error as e:
        raise HTTPException(status_code=502, detail=f"Failed to read timetable: {e}")
    if not record:
        raise HTTPException(status_code=404, detail="Timetable not found")
    return record
