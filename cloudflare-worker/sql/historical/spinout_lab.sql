-- Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.
-- Apply via:
--   npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/spinout_lab.sql
--
-- Apply order is deliberate: the table + spinout column ALTERs come FIRST
-- so the lab itself is fully provisioned even if the trailing
-- `is_incorporated` ALTER ever fails (D1 returns the first error per
-- statement and stops; preceding statements have already committed). At
-- the time this file was written `is_incorporated` did not exist anywhere
-- in the worker schema; if it ever lands via a separate migration, drop
-- the trailing ALTER from this file before re-running.
--
-- Re-run safety: the CREATE TABLE/INDEX use `IF NOT EXISTS`, but SQLite
-- has no `ADD COLUMN IF NOT EXISTS`. Re-running this file on a populated
-- DB will report "duplicate column name" on the first ALTER and stop.
-- That's expected and harmless — the file is intended to be applied once
-- per environment.

-- ---------- 1. spinout_lab_milestones table (idempotent) ----------
-- One row per (user_id, milestone_key). Handlers only ever issue
-- INSERT OR IGNORE so re-completing a milestone is a no-op.
CREATE TABLE IF NOT EXISTS spinout_lab_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week INTEGER NOT NULL,
    milestone_key TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_spinout_lab_milestones_user
    ON spinout_lab_milestones(user_id);

-- ---------- 2. users.spinout_lab_* columns ----------
ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN spinout_lab_week INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN spinout_lab_started_at TEXT;

-- ---------- 3. users.is_incorporated (kept LAST on purpose) ----------
-- The /exit and /milestone (week-4 auto-exit) routes flip this on; the
-- rest of the app reads it as the canonical "this founder has finished
-- formation" flag. The Lab spec assumed this column already existed; it
-- did not, so we add it here. Kept last so the spinout state above lands
-- even if a future deploy ever pre-creates this column.
ALTER TABLE users ADD COLUMN is_incorporated INTEGER NOT NULL DEFAULT 0;
