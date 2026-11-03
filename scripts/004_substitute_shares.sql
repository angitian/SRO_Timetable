-- SRO Timetable — D1 upgrade migration (004)
-- Adds `substitute_shares` for shareable daily substitute documents
-- (/view?sub=<short_code>) — one row per owner+date, reusable short code.
-- Apply: python backend/_run_migration.py ../scripts/004_substitute_shares.sql

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
