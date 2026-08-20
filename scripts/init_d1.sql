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
