-- SRO Timetable — D1 upgrade migration (002)
--
-- Adds:
--   1. `users` table (Google OAuth users, keyed by google_sub)
--   2. `workspace_json` column on `timetables` (private workspace payload)
--
-- Idempotent-ish: uses IF NOT EXISTS where supported. The ALTER TABLE for
-- adding a column is NOT idempotent in SQLite — re-running will error with
-- "duplicate column name". The migration runner tolerates that specific error.
--
-- Apply with:
--   python backend/_run_migration.py   (tolerates duplicate-column errors)
-- or:
--   npx wrangler d1 execute <DB> --remote --file scripts/002_upgrade.sql

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,            -- google_sub (stable across apps)
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    picture TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE timetables ADD COLUMN workspace_json TEXT;
