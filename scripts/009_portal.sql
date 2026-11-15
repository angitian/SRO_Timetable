-- SRO Timetable — portal module migration (009)
-- Apply: python backend/_run_migration.py ../scripts/009_portal.sql
--
-- โมดูลพอร์ทัล (แจ้งเตือน + ส่งงาน) ผูกกับ workspace เดิมผ่าน timetables.short_code
--   portal_config            : ตั้งค่าต่อ workspace (publish / โฟลเดอร์ Drive / webhook)
--   portal_teachers          : projection ของครูใน workspace + dept/phone/PIN
--   portal_events            : ปฏิทินกิจกรรม + งานที่ต้องส่งไฟล์
--   portal_submissions       : ไฟล์ที่ส่ง (1 ครู : 1 งาน, ส่งซ้ำ = upsert)
--   portal_submission_history: ประวัติการส่งซ้ำ (audit)
--   portal_notifications     : แจ้งเตือนในแอป (fan-out 1 แถว/ครู)
--   portal_settings          : global KV (Google Drive refresh token)
--
-- ไม่มีตาราง substitutions — อ่านจาก workspace_json.dailySchedules
-- และ fallback ไป substitute_shares เพื่อไม่ให้มีข้อมูลสอนแทน 2 ชุด

CREATE TABLE IF NOT EXISTS portal_config (
    timetable_id     TEXT PRIMARY KEY,
    school_name      TEXT NOT NULL DEFAULT '',
    is_published     INTEGER NOT NULL DEFAULT 0,
    drive_folder_id  TEXT,
    drive_folder_url TEXT,
    drive_drive_id   TEXT,
    webhook_url      TEXT,
    webhook_last_status TEXT,
    webhook_last_at  TEXT,
    late_policy      TEXT NOT NULL DEFAULT 'allow'
        CHECK (late_policy IN ('allow', 'block')),
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portal_teachers (
    timetable_id     TEXT NOT NULL,
    teacher_id       TEXT NOT NULL,
    prefix           TEXT NOT NULL DEFAULT '',
    full_name        TEXT NOT NULL DEFAULT '',
    dept             TEXT NOT NULL DEFAULT '',
    phone            TEXT,
    pin_hash         TEXT,
    pin_set_at       TEXT,
    pin_fail_count   INTEGER NOT NULL DEFAULT 0,
    pin_locked_until TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (timetable_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_teachers_dept
    ON portal_teachers(timetable_id, dept);

CREATE TABLE IF NOT EXISTS portal_events (
    id              TEXT PRIMARY KEY,
    timetable_id    TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    event_type      TEXT NOT NULL DEFAULT 'event'
        CHECK (event_type IN ('event', 'task')),
    event_date      TEXT NOT NULL,
    start_time      TEXT,
    end_time        TEXT,
    due_datetime    TEXT,
    requires_file   INTEGER NOT NULL DEFAULT 0,
    target_dept     TEXT,
    drive_folder_id TEXT,
    allow_late      INTEGER NOT NULL DEFAULT 1,
    is_published    INTEGER NOT NULL DEFAULT 1,
    created_by      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_portal_events_tt_date
    ON portal_events(timetable_id, event_date);
CREATE INDEX IF NOT EXISTS idx_portal_events_tt_task
    ON portal_events(timetable_id, requires_file, due_datetime);

CREATE TABLE IF NOT EXISTS portal_submissions (
    id               TEXT PRIMARY KEY,
    timetable_id     TEXT NOT NULL,
    event_id         TEXT NOT NULL,
    teacher_id       TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    storage_backend  TEXT NOT NULL DEFAULT 'local',
    storage_key      TEXT NOT NULL,
    web_view_url     TEXT,
    file_size_bytes  INTEGER,
    mime_type        TEXT,
    checksum         TEXT,
    submitted_at     TEXT,
    due_at           TEXT,
    status           TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'late')),
    note             TEXT NOT NULL DEFAULT '',
    revision         INTEGER NOT NULL DEFAULT 1,
    UNIQUE(event_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_submissions_tt
    ON portal_submissions(timetable_id, event_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_teacher
    ON portal_submissions(timetable_id, teacher_id);

CREATE TABLE IF NOT EXISTS portal_submission_history (
    id               TEXT PRIMARY KEY,
    submission_id    TEXT NOT NULL,
    timetable_id     TEXT NOT NULL,
    event_id         TEXT NOT NULL,
    teacher_id       TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    storage_backend  TEXT NOT NULL,
    storage_key      TEXT NOT NULL,
    file_size_bytes  INTEGER,
    submitted_at     TEXT,
    status           TEXT NOT NULL,
    revision         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_sub_history
    ON portal_submission_history(event_id, teacher_id);

CREATE TABLE IF NOT EXISTS portal_notifications (
    id           TEXT PRIMARY KEY,
    timetable_id TEXT NOT NULL,
    teacher_id   TEXT,
    event_id     TEXT,
    kind         TEXT NOT NULL DEFAULT 'info'
        CHECK (kind IN ('info', 'task_new', 'task_due', 'reminder', 'receipt', 'announcement')),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    link         TEXT,
    created_by   TEXT,
    created_at   TEXT,
    read_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_notif_tt_teacher
    ON portal_notifications(timetable_id, teacher_id, created_at);

CREATE TABLE IF NOT EXISTS portal_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ผูก share ลิงก์สอนแทนกับ workspace เพื่อให้พอร์ทัลหาของวันนั้นได้ตรง
-- (แถวเก่ายังใช้ได้ — fallback ด้วย owner + payload date)
ALTER TABLE substitute_shares ADD COLUMN timetable_id TEXT;
CREATE INDEX IF NOT EXISTS idx_substitute_shares_tt_date
    ON substitute_shares(timetable_id, date);
