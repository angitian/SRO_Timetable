-- SRO Timetable — D1 upgrade migration (003)
-- Adds `manager_emails` column on `timetables` for shared workspaces
-- (ผู้จัดการ 2+ คน ใช้ workspace/db เดียวกัน)
-- Apply: python backend/_run_migration.py scripts/003_workspace_managers.sql
ALTER TABLE timetables ADD COLUMN manager_emails TEXT NOT NULL DEFAULT '[]';
