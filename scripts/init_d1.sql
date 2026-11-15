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
    timetable_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_substitute_shares_short_code ON substitute_shares(short_code);
CREATE INDEX IF NOT EXISTS idx_substitute_shares_user_date ON substitute_shares(user_id, date);
CREATE INDEX IF NOT EXISTS idx_substitute_shares_tt_date ON substitute_shares(timetable_id, date);

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

-- ── Portal module v2 (กิจกรรมโรงเรียน + งานส่งไฟล์) ──────────────────────
-- ผูกกับ workspace เดิมผ่าน timetables.short_code
-- ไม่มีตาราง substitutions — อ่านจาก workspace_json.dailySchedules
-- และ fallback ไป substitute_shares

-- ── 1. กิจกรรมโรงเรียน (ไม่เกี่ยวกับการส่งไฟล์) ────────────────────────────
CREATE TABLE IF NOT EXISTS portal_events (
    id           TEXT PRIMARY KEY,
    timetable_id TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    event_date   TEXT NOT NULL,
    end_date     TEXT,
    start_time   TEXT,
    end_time     TEXT,
    all_day      INTEGER NOT NULL DEFAULT 1,
    location     TEXT,
    target_type  TEXT NOT NULL DEFAULT 'all'
        CHECK (target_type IN ('all', 'custom')),
    is_published INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_events_tt_date ON portal_events(timetable_id, event_date);

-- ── 2. งานส่งไฟล์ ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_tasks (
    id              TEXT PRIMARY KEY,
    timetable_id    TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    open_at         TEXT,
    due_datetime    TEXT NOT NULL,
    allow_late      INTEGER NOT NULL DEFAULT 1,
    is_published    INTEGER NOT NULL DEFAULT 1,
    target_type     TEXT NOT NULL DEFAULT 'all'
        CHECK (target_type IN ('all', 'custom')),
    drive_folder_id TEXT,
    created_by      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_tasks_tt_due ON portal_tasks(timetable_id, due_datetime);

-- ── 3. กล่องรับไฟล์ของแต่ละงาน ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_task_slots (
    id           TEXT PRIMARY KEY,
    timetable_id TEXT NOT NULL,
    task_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    is_required  INTEGER NOT NULL DEFAULT 1,
    allowed_ext  TEXT NOT NULL DEFAULT '.pdf,.docx,.xlsx,.zip',
    max_mb       INTEGER NOT NULL DEFAULT 25,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_portal_slots_task ON portal_task_slots(task_id, sort_order);

-- ── 4. ผู้เข้าร่วม / ผู้ต้องส่ง (ใช้ร่วม event + task) ─────────────────────
CREATE TABLE IF NOT EXISTS portal_audience (
    kind        TEXT NOT NULL CHECK (kind IN ('event', 'task')),
    activity_id TEXT NOT NULL,
    member_kind TEXT NOT NULL CHECK (member_kind IN ('teacher', 'class', 'dept')),
    member_id   TEXT NOT NULL,
    PRIMARY KEY (kind, activity_id, member_kind, member_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_audience_member
    ON portal_audience(member_kind, member_id);

-- ── 5. การส่งไฟล์ (1 กล่อง : 1 ครู) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_submissions (
    id              TEXT PRIMARY KEY,
    timetable_id    TEXT NOT NULL,
    task_id         TEXT NOT NULL,
    slot_id         TEXT NOT NULL,
    teacher_id      TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    storage_backend TEXT NOT NULL DEFAULT 'local',
    storage_key     TEXT NOT NULL,
    web_view_url    TEXT,
    file_size_bytes INTEGER,
    mime_type       TEXT,
    checksum        TEXT,
    submitted_at    TEXT,
    due_at          TEXT,
    status          TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'late')),
    note            TEXT NOT NULL DEFAULT '',
    revision        INTEGER NOT NULL DEFAULT 1,
    UNIQUE(slot_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_submissions_task
    ON portal_submissions(timetable_id, task_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_teacher
    ON portal_submissions(timetable_id, teacher_id);

CREATE TABLE IF NOT EXISTS portal_submission_history (
    id              TEXT PRIMARY KEY,
    submission_id   TEXT NOT NULL,
    timetable_id    TEXT NOT NULL,
    task_id         TEXT NOT NULL,
    slot_id         TEXT NOT NULL,
    teacher_id      TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key     TEXT NOT NULL,
    file_size_bytes INTEGER,
    submitted_at    TEXT,
    status          TEXT NOT NULL,
    revision        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_sub_history
    ON portal_submission_history(task_id, teacher_id);

-- ── 6. แจ้งเตือน ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_notifications (
    id           TEXT PRIMARY KEY,
    timetable_id TEXT NOT NULL,
    teacher_id   TEXT,
    event_id     TEXT,
    task_id      TEXT,
    kind         TEXT NOT NULL DEFAULT 'info'
        CHECK (kind IN ('info', 'event_new', 'task_new', 'task_due',
                        'reminder', 'receipt', 'announcement')),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    link         TEXT,
    created_by   TEXT,
    created_at   TEXT,
    read_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_notif_tt_teacher
    ON portal_notifications(timetable_id, teacher_id, created_at);
