-- SRO Timetable — workspace roles migration (006)
-- Adds explicit per-workspace member roles and team default roles.
-- Apply: python backend/_run_migration.py scripts/006_workspace_roles.sql
--
-- Legacy manager_emails remain supported by the API as implicit editors; the
-- migration copies them into workspace_members so the new UI can edit roles.

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

ALTER TABLE team_members ADD COLUMN default_workspace_role TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE team_members ADD COLUMN default_trainee_role TEXT NOT NULL DEFAULT 'none';

-- Copy legacy manager_emails into explicit editor rows (best-effort; D1/SQLite
-- JSON1 is available). Existing rows with no manager_emails are untouched.
INSERT OR IGNORE INTO workspace_members (timetable_id, email, workspace_role, trainee_role)
SELECT t.id, lower(json_each.value), 'editor', 'none'
FROM timetables t, json_each(COALESCE(t.manager_emails, '[]'))
WHERE json_each.value IS NOT NULL AND trim(json_each.value) <> '';
