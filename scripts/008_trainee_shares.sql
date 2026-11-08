-- SRO Timetable — trainee summary share links (008)
-- Apply: python backend/_run_migration.py ../scripts/008_trainee_shares.sql
--
-- One row per trainee module (timetable_id): re-sharing updates the existing
-- short code so external viewers keep a stable URL (/view?tr=<short_code>).

CREATE TABLE IF NOT EXISTS trainee_shares (
    id            TEXT PRIMARY KEY,
    short_code    TEXT UNIQUE NOT NULL,
    timetable_id  TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    owner_user_id TEXT,
    created_by    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainee_shares_timetable ON trainee_shares(timetable_id);
CREATE INDEX IF NOT EXISTS idx_trainee_shares_short_code ON trainee_shares(short_code);
