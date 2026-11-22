# Project notes

## Frontend (`frontend/`)
- Dev server: `npm run dev` (Vite, port 5173)
- Production build: `npm run build`
- Tests use `node:test` and live next to `package.json`:
  - `node --test test_*.mjs`
  - e.g. `node --test test_trainee_substitute.mjs`
  - portal helpers: `node --test test_portal_utils.mjs`

## Backend (`backend/`)
- Dev server: `python -m uvicorn main:app --host 127.0.0.1 --port 8000`
- Tests: `python -m pytest test_*.py -q`
- Portal tests: `python -m pytest test_portal_service.py test_portal_api.py test_portal_notifications.py -q`
- Migrations: `python _run_migration.py ../scripts/00N_name.sql` (tolerates duplicate column/table)

## Trainee module (ระบบตรวจการลงเวลาปฏิบัติงาน)
- Routes: step 9 `TraineeAttendancePage` (`useTraineeWorkspace` = local cache + cloud sync)
- **Three grant sources** (precedence in `permissions.resolve_trainee_role`):
  `owner > trainee_members (สิทธิ์โมดูล dialog) > workspace_members.trainee_role
  (สิทธิ์การเข้าถึง dialog — 'none' = explicit deny, beats team default) >
  team_members.default_trainee_role (only when trainee_workspaces.access_mode='team')`
- `my_trainee_role` on workspace records (`_attach_workspace_roles`) and on
  `/api/v1/trainees/mine` must agree with the module ACL — keep them in sync.
- Denials log `trainee_acl_denied ...`; `backend/_diagnose_trainee_access.py <tid> <email>`
  prints every grant source (works on D1 or local store).

## Portal module v2 (กิจกรรมโรงเรียน + งานส่งไฟล์)
- Routes: `/portal?w=<short_code>` (ครู, public) and `/admin?w=<short_code>` (owner/editor)
- **Two separate concepts** — do not merge them:
  - `portal_events` = กิจกรรมโรงเรียน (audience: teacher / class / dept)
  - `portal_tasks` + `portal_task_slots` = งานส่งไฟล์ (one upload per slot per teacher)
  - `portal_audience(kind, activity_id, member_kind, member_id)` shared by both
- `portal_submissions` is unique on `(slot_id, teacher_id)` — resubmitting replaces the file
  and appends a row to `portal_submission_history`
- Backend: `portal_store.py` (D1 + local JSON fallback), `portal_service.py` (pure logic:
  audience resolution, task progress, matrix, dept inference), `api/portal.py`,
  `storage.py` + `drive_client.py` (local disk / Google Drive)
- Frontend: `frontend/src/features/portal/` — `PortalPage` (calendar/tasks/subs/inbox),
  `PortalAdminPage` (events/tasks/teachers/settings), `AudiencePicker`, `TaskEditorModal`
- Teachers are projected from `workspace_json.fixtureData.teachers`; `dept` is inferred
  from the most-taught subject and can be edited in the admin registry
- Storage backend: `PORTAL_STORAGE=local|drive` (auto = drive when configured)
- A workspace that only lives in the browser (IndexedDB snapshot) has no `short_code`, so the
  portal cannot sync from it — the UI saves it to the cloud first (`openPortal()` in AppContext,
  decision helper `portalEntryState()` in `portalUtils.js`). `POST /save-workspace` returns
  `short_code` for exactly this reason.
- Migration history: `009_portal.sql` (v1, superseded) → `010_portal_v2.sql` (current)
