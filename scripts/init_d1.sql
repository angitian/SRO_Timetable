-- SRO Timetable — Cloudflare D1 schema
--
-- Apply with the Wrangler CLI:
--   npx wrangler d1 execute <DATABASE_NAME> --remote --file scripts/init_d1.sql
-- or, for a local/dev D1 instance:
--   npx wrangler d1 execute <DATABASE_NAME> --local --file scripts/init_d1.sql
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS timetables (
    id TEXT PRIMARY KEY,
    short_code TEXT UNIQUE NOT NULL,
    user_id TEXT,
    title TEXT NOT NULL,
    academic_year INTEGER NOT NULL,
    term INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    result_json TEXT,
    workspace_json TEXT,
    manager_emails TEXT NOT NULL DEFAULT '[]',
    access_mode TEXT NOT NULL DEFAULT 'team',
    is_public INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    picture TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timetables_short_code ON timetables(short_code);
CREATE INDEX IF NOT EXISTS idx_timetables_user_id ON timetables(user_id);

-- Daily substitute share links (/view?sub=<short_code>)
CREATE TABLE IF NOT EXISTS substitute_shares (
    id TEXT PRIMARY KEY,
    short_code TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_substitute_shares_short_code ON substitute_shares(short_code);
CREATE INDEX IF NOT EXISTS idx_substitute_shares_user_date ON substitute_shares(user_id, date);

-- Team-level sharing (owner adds an email once → all their workspaces are shared)
CREATE TABLE IF NOT EXISTS team_members (
    owner_user_id TEXT NOT NULL,
    member_email  TEXT NOT NULL,
    added_at      TEXT DEFAULT (datetime('now')),
    default_workspace_role TEXT NOT NULL DEFAULT 'editor',
    default_trainee_role   TEXT NOT NULL DEFAULT 'none',
    PRIMARY KEY (owner_user_id, member_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(member_email);

-- Per-workspace role overrides (owner still comes from timetables.user_id)
CREATE TABLE IF NOT EXISTS workspace_members (
    timetable_id   TEXT NOT NULL,
    email          TEXT NOT NULL,
    workspace_role TEXT NOT NULL DEFAULT 'editor'
        CHECK (workspace_role IN ('editor', 'viewer')),
    trainee_role   TEXT NOT NULL DEFAULT 'none'
        CHECK (trainee_role IN ('none', 'viewer', 'editor')),
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (timetable_id, email)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_email ON workspace_members(email);

-- Trainee attendance module (permissions separate from workspace)
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
