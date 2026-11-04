"""Tests for workspace roles and the separate trainee attendance module."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from main import app
from timetable_store import LocalTimetableStore, get_timetable_store


@pytest.fixture()
def temp_store(tmp_path):
    store = LocalTimetableStore(path=tmp_path / "timetables.json")

    def _override():
        return store

    app.dependency_overrides[get_timetable_store] = _override
    yield store
    app.dependency_overrides.clear()


@pytest.fixture()
def client(temp_store):
    return TestClient(app)


@pytest.fixture()
def jwt_secret(monkeypatch):
    monkeypatch.setattr("auth.settings.JWT_SECRET", "test-secret-key-for-tests")
    monkeypatch.setattr("auth.settings.JWT_ALGORITHM", "HS256")
    monkeypatch.setattr("auth.settings.JWT_EXPIRE_DAYS", 30)
    yield


def _token(user_id="owner-1", email="owner@example.com", name="Owner"):
    from auth import create_token
    return create_token(sub=user_id, email=email, name=name)


def _headers(user_id="owner-1", email="owner@example.com", name="Owner"):
    return {"Authorization": f"Bearer {_token(user_id, email, name)}"}


def _workspace_payload(title="Trainee Test"):
    return {
        "title": title,
        "academic_year": 2569,
        "term": 2,
        "workspace": {
            "fixtureData": {"teachers": [{"id": "T1", "name": "ครูสมชาย"}], "classes": []},
            "result": None,
            "userPlacements": {},
        },
    }


def _create_workspace(client, headers=None):
    resp = client.post(
        "/api/v1/timetables/save-workspace",
        json=_workspace_payload(),
        headers=headers or _headers(),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _empty_data():
    return {
        "schemaVersion": 1,
        "reference": {"teachers": [{"id": "T1", "name": "ครูสมชาย"}]},
        "trainees": [],
        "attendance": {},
    }


class TestTraineeModule:
    def test_owner_can_create_read_and_update(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        headers = _headers()

        empty = client.get(f"/api/v1/trainees/{ws_id}", headers=headers)
        assert empty.status_code == 200, empty.text
        assert empty.json()["version"] == 0
        assert empty.json()["can_edit_trainees"] is True

        data = _empty_data()
        data["trainees"] = [{"id": "tr1", "name": "นางสาวทดสอบ"}]
        saved = client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": data, "base_version": 0},
            headers=headers,
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["version"] == 1
        assert saved.json()["trainee_count"] == 1

        loaded = client.get(f"/api/v1/trainees/{ws_id}", headers=headers)
        assert loaded.status_code == 200
        assert loaded.json()["data"]["trainees"][0]["name"] == "นางสาวทดสอบ"

    def test_version_conflict_returns_409(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        headers = _headers()
        payload = {"data": _empty_data(), "base_version": 0}
        assert client.put(f"/api/v1/trainees/{ws_id}", json=payload, headers=headers).status_code == 200
        conflict = client.put(f"/api/v1/trainees/{ws_id}", json=payload, headers=headers)
        assert conflict.status_code == 409
        assert "current" in conflict.json()["detail"]

    def test_trainee_manager_without_workspace_access_can_open_and_edit(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        owner_headers = _headers()
        manager_headers = _headers("manager-1", "manager@example.com", "Manager")

        # Owner creates the module and shares it with the manager.
        assert client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=owner_headers,
        ).status_code == 200
        share = client.put(
            f"/api/v1/trainees/{ws_id}/members",
            json={"members": [{"email": "manager@example.com", "role": "editor"}]},
            headers=owner_headers,
        )
        assert share.status_code == 200, share.text

        # The manager has no workspace access (no workspace member row).
        loaded = client.get(f"/api/v1/trainees/{ws_id}", headers=manager_headers)
        assert loaded.status_code == 200, loaded.text
        assert loaded.json()["my_trainee_role"] == "editor"
        assert loaded.json()["can_edit_trainees"] is True

        updated = client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 1},
            headers=manager_headers,
        )
        assert updated.status_code == 200, updated.text

    def test_workspace_editor_without_trainee_role_cannot_open(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        owner_headers = _headers()
        editor_headers = _headers("editor-1", "editor@example.com", "Editor")

        add_editor = client.put(
            f"/api/v1/timetables/workspace/{ws_id}/members",
            json={"members": [{"email": "editor@example.com", "workspace_role": "editor", "trainee_role": "none"}]},
            headers=owner_headers,
        )
        assert add_editor.status_code == 200, add_editor.text

        # Create the module after the editor exists; editor still has trainee none.
        assert client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=owner_headers,
        ).status_code == 200

        denied = client.get(f"/api/v1/trainees/{ws_id}", headers=editor_headers)
        assert denied.status_code == 404

    def test_only_owner_can_change_trainee_members(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        owner_headers = _headers()
        editor_headers = _headers("editor-1", "editor@example.com", "Editor")
        client.put(
            f"/api/v1/timetables/workspace/{ws_id}/members",
            json={"members": [{"email": "editor@example.com", "workspace_role": "editor", "trainee_role": "editor"}]},
            headers=owner_headers,
        )
        client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=owner_headers,
        )
        denied = client.put(
            f"/api/v1/trainees/{ws_id}/members",
            json={"members": []},
            headers=editor_headers,
        )
        assert denied.status_code == 403

    def test_workspace_viewer_cannot_save_workspace(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        owner_headers = _headers()
        viewer_headers = _headers("viewer-1", "viewer@example.com", "Viewer")
        added = client.put(
            f"/api/v1/timetables/workspace/{ws_id}/members",
            json={"members": [{"email": "viewer@example.com", "workspace_role": "viewer", "trainee_role": "none"}]},
            headers=owner_headers,
        )
        assert added.status_code == 200, added.text

        loaded = client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=viewer_headers)
        assert loaded.status_code == 200, loaded.text
        assert loaded.json()["my_workspace_role"] == "viewer"

        denied = client.post(
            "/api/v1/timetables/save-workspace",
            json={**_workspace_payload(), "id": ws_id},
            headers=viewer_headers,
        )
        assert denied.status_code == 403

    def test_delete_workspace_removes_trainee_module(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        headers = _headers()
        client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=headers,
        )
        assert client.delete(f"/api/v1/timetables/workspace/{ws_id}", headers=headers).status_code == 200
        assert client.get(f"/api/v1/trainees/{ws_id}", headers=headers).status_code == 404

    def test_list_mine_includes_owner_and_shared_modules(self, client, jwt_secret):
        ws_id = _create_workspace(client)
        owner_headers = _headers()
        manager_headers = _headers("manager-1", "manager@example.com", "Manager")
        client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=owner_headers,
        )
        client.put(
            f"/api/v1/trainees/{ws_id}/members",
            json={"members": [{"email": "manager@example.com", "role": "viewer"}]},
            headers=owner_headers,
        )
        owner_list = client.get("/api/v1/trainees/mine", headers=owner_headers)
        assert owner_list.status_code == 200, owner_list.text
        assert len(owner_list.json()) == 1
        manager_list = client.get("/api/v1/trainees/mine", headers=manager_headers)
        assert manager_list.status_code == 200, manager_list.text
        assert len(manager_list.json()) == 1
        assert manager_list.json()[0]["my_trainee_role"] == "viewer"


class TestTeamRoles:
    def test_team_defaults_apply_to_workspace_and_trainee(self, client, jwt_secret):
        owner_headers = _headers()
        member_headers = _headers("member-1", "member@example.com", "Member")
        added = client.post(
            "/api/v1/team/members",
            json={
                "email": "member@example.com",
                "default_workspace_role": "viewer",
                "default_trainee_role": "editor",
            },
            headers=owner_headers,
        )
        assert added.status_code == 200, added.text
        ws_id = _create_workspace(client)

        workspace = client.get(f"/api/v1/timetables/workspace/{ws_id}", headers=member_headers)
        assert workspace.status_code == 200, workspace.text
        assert workspace.json()["my_workspace_role"] == "viewer"

        # Module access mode starts private; the owner opts into team sharing.
        created = client.put(
            f"/api/v1/trainees/{ws_id}",
            json={"data": _empty_data(), "base_version": 0},
            headers=owner_headers,
        )
        assert created.status_code == 200, created.text
        shared = client.put(
            f"/api/v1/trainees/{ws_id}/members",
            json={"members": [], "access_mode": "team"},
            headers=owner_headers,
        )
        assert shared.status_code == 200, shared.text

        module = client.get(f"/api/v1/trainees/{ws_id}", headers=member_headers)
        assert module.status_code == 200, module.text
        assert module.json()["my_trainee_role"] == "editor"

    def test_team_member_default_roles_roundtrip(self, client, jwt_secret):
        headers = _headers()
        resp = client.post(
            "/api/v1/team/members",
            json={
                "email": "teacher@example.com",
                "default_workspace_role": "viewer",
                "default_trainee_role": "editor",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        member = next(m for m in resp.json()["members"] if m["email"] == "teacher@example.com")
        assert member["default_workspace_role"] == "viewer"
        assert member["default_trainee_role"] == "editor"

        updated = client.put(
            "/api/v1/team/members/teacher@example.com",
            json={"default_workspace_role": "editor", "default_trainee_role": "viewer"},
            headers=headers,
        )
        assert updated.status_code == 200, updated.text
        member = next(m for m in updated.json()["members"] if m["email"] == "teacher@example.com")
        assert member["default_workspace_role"] == "editor"
        assert member["default_trainee_role"] == "viewer"
