-- SRO Timetable — portal v2 migration (010)
-- Apply: python backend/_run_migration.py ../scripts/010_portal_v2.sql
--
-- แยก "กิจกรรมโรงเรียน" ออกจาก "งานส่งไฟล์" อย่างชัดเจน
--   portal_events          : กิจกรรมโรงเรียน (ครู / กลุ่มสาระ / ห้องเรียน)
--   portal_tasks           : งานส่งไฟล์
--   portal_task_slots      : กล่องรับไฟล์ของแต่ละงาน (หลายกล่องต่องาน)
--   portal_audience        : ผู้เข้าร่วม/ผู้ต้องส่ง ใช้ร่วม event + task
--   portal_submissions     : 1 กล่อง : 1 ครู (UNIQUE slot_id + teacher_id)
--
-- คงเดิม: portal_config, portal_teachers, portal_settings
--
-- ⚠️ DROP TABLE — ตาราง portal_* เวอร์ชัน 009 ว่างทั้งหมดตอนรัน migration นี้
--    (ตรวจแล้ว 0 rows) ถ้ามีข้อมูลจริงให้ export ก่อน

DROP TABLE IF EXISTS portal_events;
DROP TABLE IF EXISTS portal_tasks;
DROP TABLE IF EXISTS portal_task_slots;
DROP TABLE IF EXISTS portal_audience;
DROP TABLE IF EXISTS portal_submissions;
DROP TABLE IF EXISTS portal_submission_history;
DROP TABLE IF EXISTS portal_notifications;

-- ── 1. กิจกรรมโรงเรียน (ไม่เกี่ยวกับการส่งไฟล์) ────────────────────────────
CREATE TABLE portal_events (
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

CREATE INDEX idx_portal_events_tt_date ON portal_events(timetable_id, event_date);

-- ── 2. งานส่งไฟล์ ──────────────────────────────────────────────────────────
CREATE TABLE portal_tasks (
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

CREATE INDEX idx_portal_tasks_tt_due ON portal_tasks(timetable_id, due_datetime);

-- ── 3. กล่องรับไฟล์ของแต่ละงาน ────────────────────────────────────────────
CREATE TABLE portal_task_slots (
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

CREATE INDEX idx_portal_slots_task ON portal_task_slots(task_id, sort_order);

-- ── 4. ผู้เข้าร่วม / ผู้ต้องส่ง (ใช้ร่วม event + task) ─────────────────────
CREATE TABLE portal_audience (
    kind        TEXT NOT NULL CHECK (kind IN ('event', 'task')),
    activity_id TEXT NOT NULL,
    member_kind TEXT NOT NULL CHECK (member_kind IN ('teacher', 'class', 'dept')),
    member_id   TEXT NOT NULL,
    PRIMARY KEY (kind, activity_id, member_kind, member_id)
);

CREATE INDEX idx_portal_audience_member
    ON portal_audience(member_kind, member_id);

-- ── 5. การส่งไฟล์ (1 กล่อง : 1 ครู) ────────────────────────────────────────
CREATE TABLE portal_submissions (
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

CREATE INDEX idx_portal_submissions_task
    ON portal_submissions(timetable_id, task_id);
CREATE INDEX idx_portal_submissions_teacher
    ON portal_submissions(timetable_id, teacher_id);

CREATE TABLE portal_submission_history (
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

CREATE INDEX idx_portal_sub_history
    ON portal_submission_history(task_id, teacher_id);

-- ── 6. แจ้งเตือน ──────────────────────────────────────────────────────────
CREATE TABLE portal_notifications (
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

CREATE INDEX idx_portal_notif_tt_teacher
    ON portal_notifications(timetable_id, teacher_id, created_at);
