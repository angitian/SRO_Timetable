-- SRO Free Timetable — Database Schema v3
-- PostgreSQL / Supabase compatible
-- 15 tables supporting multi-template schedules, teaching load, Excel import, cross-template conflicts

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. schools ──────────────────────────────────────────────────────────────
CREATE TABLE schools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    short_name  TEXT,
    address     TEXT,
    phone       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 2. school_schedules (templates) ─────────────────────────────────────────
CREATE TABLE school_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    days_per_week   INT NOT NULL DEFAULT 5 CHECK (days_per_week BETWEEN 1 AND 7),
    periods_per_day INT NOT NULL DEFAULT 8 CHECK (periods_per_day BETWEEN 1 AND 12),
    is_preset       BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(school_id, name)
);

-- ── 3. schedule_grade_mapping ───────────────────────────────────────────────
CREATE TABLE schedule_grade_mapping (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  UUID NOT NULL REFERENCES school_schedules(id) ON DELETE CASCADE,
    grade_level  INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, grade_level)
);

-- ── 4. period_definitions ───────────────────────────────────────────────────
CREATE TABLE period_definitions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  UUID NOT NULL REFERENCES school_schedules(id) ON DELETE CASCADE,
    period_num   INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    period_type  TEXT NOT NULL DEFAULT 'teaching'
        CHECK (period_type IN ('teaching', 'break', 'lunch', 'assembly', 'activity')),
    label        TEXT,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, period_num)
);

-- ── 5. special_days ─────────────────────────────────────────────────────────
CREATE TABLE special_days (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  UUID NOT NULL REFERENCES school_schedules(id) ON DELETE CASCADE,
    day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    day_type     TEXT NOT NULL DEFAULT 'half_day'
        CHECK (day_type IN ('half_day', 'full_day_off', 'activity_day')),
    label        TEXT,
    max_periods  INT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, day_of_week)
);

-- ── 6. grade_activities ─────────────────────────────────────────────────────
CREATE TABLE grade_activities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  UUID NOT NULL REFERENCES school_schedules(id) ON DELETE CASCADE,
    grade_level  INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
    activity_name TEXT NOT NULL,
    activity_type TEXT NOT NULL DEFAULT 'scout'
        CHECK (activity_type IN ('scout', 'rotc', 'club', 'homeroom', 'assembly', 'guidance')),
    day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_num   INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    is_fixed     BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, grade_level, activity_name)
);

-- ── 7. teachers ─────────────────────────────────────────────────────────────
CREATE TABLE teachers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    email                 TEXT,
    phone                 TEXT,
    max_periods_per_week  INT NOT NULL DEFAULT 22 CHECK (max_periods_per_week BETWEEN 0 AND 40),
    min_periods_per_week  INT NOT NULL DEFAULT 0 CHECK (min_periods_per_week BETWEEN 0 AND 40),
    admin_role            TEXT NOT NULL DEFAULT 'none'
        CHECK (admin_role IN ('none', 'finance', 'discipline', 'dept_head')),
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ── 8. teacher_unavailable_slots ────────────────────────────────────────────
CREATE TABLE teacher_unavailable_slots (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id   UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_num   INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    reason       TEXT DEFAULT 'unavailable',
    is_admin_free BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(teacher_id, day_of_week, period_num)
);

-- ── 9. rooms ────────────────────────────────────────────────────────────────
CREATE TABLE rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    room_type   TEXT NOT NULL DEFAULT 'classroom'
        CHECK (room_type IN ('classroom', 'lab', 'gym', 'field', 'music_room', 'art_room', 'computer_lab')),
    capacity    INT,
    building    TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 10. subjects ────────────────────────────────────────────────────────────
CREATE TABLE subjects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    code        TEXT,
    category    TEXT NOT NULL DEFAULT 'core'
        CHECK (category IN ('core', 'pe', 'art', 'music', 'lab', 'admin')),
    is_heavy    BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 11. classes ─────────────────────────────────────────────────────────────
CREATE TABLE classes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    grade_level  INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
    room_id      UUID REFERENCES rooms(id),
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── 12. lesson_blocks (State 1: Course Offering) ────────────────────────────
CREATE TABLE lesson_blocks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id          UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subject_id         UUID NOT NULL REFERENCES subjects(id),
    teacher_id         UUID NOT NULL REFERENCES teachers(id),
    class_id           UUID NOT NULL REFERENCES classes(id),
    room_id            UUID REFERENCES rooms(id),
    periods_per_week   INT NOT NULL CHECK (periods_per_week BETWEEN 1 AND 10),
    is_double_period   BOOLEAN DEFAULT FALSE,
    is_fixed           BOOLEAN DEFAULT FALSE,
    fixed_day          INT CHECK (fixed_day BETWEEN 1 AND 7),
    fixed_period       INT CHECK (fixed_period BETWEEN 1 AND 12),
    academic_year      TEXT,
    semester           INT DEFAULT 1 CHECK (semester BETWEEN 1 AND 3),
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ── 13. timetable_slots (State 2: Timetable Matrix) ─────────────────────────
CREATE TABLE timetable_slots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    lesson_block_id  UUID NOT NULL REFERENCES lesson_blocks(id) ON DELETE CASCADE,
    day_of_week      INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_num       INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    schedule_id      UUID REFERENCES school_schedules(id),
    is_locked        BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(lesson_block_id, day_of_week, period_num)
);

-- ── 14. excel_imports ───────────────────────────────────────────────────────
CREATE TABLE excel_imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    mapping_config  JSONB,
    row_count       INT,
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'mapped', 'imported', 'error')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 15. cross_template_conflicts ────────────────────────────────────────────
CREATE TABLE cross_template_conflicts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id      UUID NOT NULL REFERENCES teachers(id),
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_num      INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    schedule_1_id   UUID REFERENCES school_schedules(id),
    schedule_2_id   UUID REFERENCES school_schedules(id),
    conflict_type   TEXT NOT NULL DEFAULT 'period_overlap',
    severity        TEXT NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('warning', 'error')),
    resolved        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_teachers_school ON teachers(school_id);
CREATE INDEX idx_rooms_school ON rooms(school_id);
CREATE INDEX idx_subjects_school ON subjects(school_id);
CREATE INDEX idx_classes_school ON classes(school_id);
CREATE INDEX idx_lesson_blocks_school ON lesson_blocks(school_id);
CREATE INDEX idx_lesson_blocks_teacher ON lesson_blocks(teacher_id);
CREATE INDEX idx_lesson_blocks_class ON lesson_blocks(class_id);
CREATE INDEX idx_lesson_blocks_subject ON lesson_blocks(subject_id);
CREATE INDEX idx_timetable_slots_school ON timetable_slots(school_id);
CREATE INDEX idx_timetable_slots_lesson ON timetable_slots(lesson_block_id);
CREATE INDEX idx_timetable_slots_day_period ON timetable_slots(day_of_week, period_num);
CREATE INDEX idx_schedule_grade_mapping_schedule ON schedule_grade_mapping(schedule_id);
CREATE INDEX idx_period_definitions_schedule ON period_definitions(schedule_id);
CREATE INDEX idx_grade_activities_schedule ON grade_activities(schedule_id);
CREATE INDEX idx_excel_imports_school ON excel_imports(school_id);
CREATE INDEX idx_cross_template_conflicts_school ON cross_template_conflicts(school_id);
CREATE INDEX idx_cross_template_conflicts_teacher ON cross_template_conflicts(teacher_id);

-- ── Views ───────────────────────────────────────────────────────────────────

-- Teacher load BEFORE timetabling (from lesson_blocks)
CREATE OR REPLACE VIEW teacher_load_before AS
SELECT
    t.id AS teacher_id,
    t.name AS teacher_name,
    t.school_id,
    COALESCE(SUM(lb.periods_per_week), 0) AS planned_periods,
    t.max_periods_per_week,
    t.min_periods_per_week,
    CASE
        WHEN COALESCE(SUM(lb.periods_per_week), 0) > t.max_periods_per_week THEN 'over'
        WHEN COALESCE(SUM(lb.periods_per_week), 0) < t.min_periods_per_week THEN 'under'
        ELSE 'ok'
    END AS load_status
FROM teachers t
LEFT JOIN lesson_blocks lb ON lb.teacher_id = t.id
GROUP BY t.id, t.name, t.school_id, t.max_periods_per_week, t.min_periods_per_week;

-- Teacher load AFTER timetabling (from timetable_slots)
CREATE OR REPLACE VIEW teacher_load_after AS
SELECT
    t.id AS teacher_id,
    t.name AS teacher_name,
    t.school_id,
    COUNT(ts.id) AS assigned_periods,
    t.max_periods_per_week,
    t.min_periods_per_week,
    CASE
        WHEN COUNT(ts.id) > t.max_periods_per_week THEN 'over'
        WHEN COUNT(ts.id) < t.min_periods_per_week THEN 'under'
        ELSE 'ok'
    END AS load_status
FROM teachers t
LEFT JOIN lesson_blocks lb ON lb.teacher_id = t.id
LEFT JOIN timetable_slots ts ON ts.lesson_block_id = lb.id
GROUP BY t.id, t.name, t.school_id, t.max_periods_per_week, t.min_periods_per_week;

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_schools_updated BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_school_schedules_updated BEFORE UPDATE ON school_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teachers_updated BEFORE UPDATE ON teachers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lesson_blocks_updated BEFORE UPDATE ON lesson_blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_excel_imports_updated BEFORE UPDATE ON excel_imports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 16. daily substitute schedules (ระบบสอนแทนรายวัน — design เตรียมไว้สำหรับระบบหลัก) ──
-- ข้อมูลรายวันเป็น layer แยกจากตารางหลัก (timetable_slots) — ไม่แก้ตารางหลัก
-- อ้างอิงดีไซน์เต็มใน docs/FUNCTION_DESIGN.md หัวข้อ 15
CREATE TABLE daily_substitute_schedules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    schedule_id       UUID REFERENCES school_schedules(id),
    calendar_date     DATE NOT NULL,
    day_of_week       INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    absent_teacher_ids JSONB DEFAULT '[]',
    note              TEXT,
    created_by        UUID,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(school_id, schedule_id, calendar_date)
);

CREATE TABLE daily_substitute_assignments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id             UUID NOT NULL REFERENCES daily_substitute_schedules(id) ON DELETE CASCADE,
    period_num              INT NOT NULL CHECK (period_num BETWEEN 1 AND 12),
    class_id                UUID NOT NULL REFERENCES classes(id),
    subject_id              UUID NOT NULL REFERENCES subjects(id),
    original_teacher_id     UUID NOT NULL REFERENCES teachers(id),
    substitute_teacher_id   UUID NOT NULL REFERENCES teachers(id),
    reason                  TEXT,
    note                    TEXT,
    created_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, period_num, class_id)
);

CREATE INDEX idx_dss_calendar_date ON daily_substitute_schedules(calendar_date);
CREATE INDEX idx_dss_school_date ON daily_substitute_schedules(school_id, calendar_date);
CREATE INDEX idx_dsa_schedule ON daily_substitute_assignments(schedule_id);
CREATE INDEX idx_dsa_substitute_teacher ON daily_substitute_assignments(substitute_teacher_id);
CREATE INDEX idx_dsa_original_teacher ON daily_substitute_assignments(original_teacher_id);

