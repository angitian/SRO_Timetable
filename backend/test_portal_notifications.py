"""Portal notification + reminder + webhook tests."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx
import pytest

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from portal_service import post_webhook, sign_payload
from test_portal_api import (  # noqa: F401 — fixtures/helpers reused on purpose
    CODE,
    OWNER_ID,
    TT_ID,
    _auth,
    _create_event,
    _create_task,
    _setup,
    _upload,
    portal,
)


def _set_webhook(client, url: str = "https://hook.example/portal") -> None:
    res = client.put(
        f"/api/v1/portal/{CODE}/admin/config",
        json={"webhook_url": url},
        headers=_auth(),
    )
    assert res.status_code == 200, res.text


def test_creating_task_notifies_only_targeted_teachers(portal):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    res = client.post(
        f"/api/v1/portal/{CODE}/admin/tasks",
        json={
            "title": "ส่งแผนคณิต",
            "due_datetime": "2026-11-20 16:30",
            "target_type": "custom",
            "audience": [{"member_kind": "dept", "member_id": "คณิตศาสตร์"}],
            "slots": [{"title": "แผนการสอน"}],
        },
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["notified"] == 1  # only T1

    rows = asyncio.run(pstore.list_notifications(TT_ID, "T1"))
    assert rows[0]["kind"] == "task_new"
    assert "ส่งแผนคณิต" in rows[0]["title"]
    assert asyncio.run(pstore.list_notifications(TT_ID, "T2")) == []


def test_notifications_list_and_mark_read(portal):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    _create_task(client)

    inbox = client.get(f"/api/v1/portal/{CODE}/notifications", params={"teacher_id": "T1"})
    body = inbox.json()
    assert body["unread"] == 1
    notification_id = body["notifications"][0]["id"]

    read = client.post(
        f"/api/v1/portal/{CODE}/notifications/{notification_id}/read",
        params={"teacher_id": "T1"},
    )
    assert read.json()["ok"] is True
    assert client.get(
        f"/api/v1/portal/{CODE}/notifications", params={"teacher_id": "T1"}
    ).json()["unread"] == 0

    client.post(f"/api/v1/portal/{CODE}/notifications/read-all", params={"teacher_id": "T1"})
    assert asyncio.run(pstore.list_notifications(TT_ID, "T1"))[0]["read_at"] is not None


def test_submission_creates_receipt_notification(portal):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])

    inbox = client.get(
        f"/api/v1/portal/{CODE}/notifications", params={"teacher_id": "T1"}
    ).json()
    kinds = [n["kind"] for n in inbox["notifications"]]
    assert "receipt" in kinds
    receipt = next(n for n in inbox["notifications"] if n["kind"] == "receipt")
    assert receipt["task_id"] == task["task"]["id"]
    assert "แผนการสอน" in receipt["title"]


def test_remind_only_targets_teachers_who_have_not_finished(portal, monkeypatch):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    task = _create_task(client)
    # T1 completes both slots, T2/T3 do nothing
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][1]["id"],
            filename="note.pdf")

    sent: list[dict] = []

    async def fake_post(url, payload, **kwargs):
        sent.append(payload)
        return True, "HTTP 200"

    monkeypatch.setattr("api.portal.post_webhook", fake_post)
    _set_webhook(client)

    res = client.post(
        f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/remind",
        json={"send_webhook": True},
        headers=_auth(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["incomplete"] == 2
    assert body["notified"] == 2
    assert "ครูนภา" not in body["message"] or "ยังไม่ได้ส่งครบ 2 คน" in body["message"]
    assert sent and sent[0]["type"] == "reminder"
    assert {r["teacher_id"] for r in sent[0]["recipients"]} == {"T2", "T3"}

    reminders = [
        n for n in asyncio.run(pstore.list_notifications(TT_ID, "T2"))
        if n["kind"] == "reminder"
    ]
    assert len(reminders) == 1


def test_remind_copy_only_sends_nothing(portal, monkeypatch):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)

    async def fake_post(url, payload, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("webhook must not be called in copy_only mode")

    monkeypatch.setattr("api.portal.post_webhook", fake_post)
    _set_webhook(client)

    res = client.post(
        f"/api/v1/portal/{CODE}/admin/tasks/{task['task']['id']}/remind",
        json={"copy_only": True},
        headers=_auth(),
    )
    body = res.json()
    assert body["notified"] == 0
    assert body["incomplete"] == 3
    assert "ยังไม่ได้ส่งครบ 3 คน" in body["message"]


def test_submission_triggers_webhook(portal, monkeypatch):
    client = portal["client"]
    _setup(client)
    task = _create_task(client)

    sent: list[dict] = []

    async def fake_post(url, payload, **kwargs):
        sent.append(payload)
        return True, "HTTP 200"

    monkeypatch.setattr("api.portal.post_webhook", fake_post)
    _set_webhook(client)
    _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])

    assert sent and sent[0]["type"] == "submission"
    assert "plan.pdf" in sent[0]["message"]


def test_webhook_failure_is_recorded_not_raised(portal, monkeypatch):
    client, pstore = portal["client"], portal["pstore"]
    _setup(client)
    task = _create_task(client)

    async def failing_post(url, payload, **kwargs):
        return False, "HTTP 500: boom"

    monkeypatch.setattr("api.portal.post_webhook", failing_post)
    _set_webhook(client)
    res = _upload(client, task_id=task["task"]["id"], slot_id=task["slots"][0]["id"])
    assert res.status_code == 200

    config = asyncio.run(pstore.get_config(TT_ID))
    assert config["webhook_last_status"].startswith("error")


# ── webhook helper ─────────────────────────────────────────────────────────

def test_sign_payload_is_hmac_sha256():
    signature = sign_payload(b'{"a":1}', "secret")
    assert len(signature) == 64
    assert signature != sign_payload(b'{"a":1}', "other")
    assert sign_payload(b"x", None) is None


def test_post_webhook_retries_once_then_reports_failure():
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, text="nope")

    ok, status = asyncio.run(post_webhook(
        "https://hook.example/x", {"a": 1},
        secret="s", transport=httpx.MockTransport(handler),
    ))
    assert ok is False
    assert len(calls) == 2
    assert "500" in status


def test_post_webhook_success_has_signature_header():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.headers))
        return httpx.Response(200)

    ok, _ = asyncio.run(post_webhook(
        "https://hook.example/x", {"a": 1},
        secret="s", transport=httpx.MockTransport(handler),
    ))
    assert ok is True
    assert seen["x-portal-signature"].startswith("sha256=")
