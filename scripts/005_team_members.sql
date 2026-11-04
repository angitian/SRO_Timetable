-- SRO Timetable — D1 upgrade migration (005)
-- Adds team-level sharing: the owner adds an email once and every workspace
-- they own is shared with that member by default.
--   team_members : owner_user_id (google sub) + member_email (lowercase)
--   timetables.access_mode : 'team' (default) | 'private'
-- Apply: python backend/_run_migration.py scripts/005_team_members.sql

CREATE TABLE IF NOT EXISTS team_members (
    owner_user_id TEXT NOT NULL,
    member_email  TEXT NOT NULL,
    added_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_user_id, member_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(member_email);

ALTER TABLE timetables ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'team';
