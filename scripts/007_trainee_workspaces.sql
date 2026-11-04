-- SRO Timetable — trainee attendance module migration (007)
-- Apply: python backend/_run_migration.py scripts/007_trainee_workspaces.sql
--
-- Permissions are separate from workspace access: a trainee member can open
-- the module without workspace edit access. The module stores a reference
-- snapshot of teachers/subjects/classes/rooms so that is possible.

CREATE TABLE IF NOT EXISTS trainee_workspaces (
    timetable_id      TEXT PRIMARY KEY,
    owner_user_id     TEXT NOT NULL,
    access_mode       TEXT NOT NULL DEFAULT 'private',
    data_json         TEXT NOT NULL DEFAULT '{}',
    version           INTEGER NOT NULL DEFAULT 1,
    trainee_count     INTEGER NOT NULL DEFAULT 0,
    attendance_count  INTEGER NOT NULL DEFAULT 0,
    updated_by        TEXT,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trainee_workspaces_owner ON trainee_workspaces(owner_user_id);

CREATE TABLE IF NOT EXISTS trainee_members (
    timetable_id TEXT NOT NULL,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('viewer', 'editor')),
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (timetable_id, email)
);

CREATE INDEX IF NOT EXISTS idx_trainee_members_email ON trainee_members(email);
