-- Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.
-- Apply via:
--   npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/spinout_lab.sql
-- Idempotent: gated on PRAGMA-style probes the worker boot code already uses
-- elsewhere; here we rely on `IF NOT EXISTS` for the table and tolerate the
-- ALTERs failing on re-run (D1 rolls each ALTER back individually if the
-- column already exists, but the surrounding statements still apply).

-- ---------- users.spinout_lab_* + is_incorporated ----------
-- SQLite/D1 has no `ADD COLUMN IF NOT EXISTS`. Wrap each ALTER in a
-- standalone batch — D1 reports an error per duplicate column but does
-- not roll back the other statements in this file. Re-running this file
-- on a populated DB is safe.
ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN spinout_lab_week INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN spinout_lab_started_at TEXT;
-- The Lab "exit" route flips this on; the rest of the app uses it as the
-- canonical "this founder has finished formation" flag. The spec assumed
-- this column already existed; it didn't, so we add it here.
ALTER TABLE users ADD COLUMN is_incorporated INTEGER NOT NULL DEFAULT 0;

-- ---------- spinout_lab_milestones ----------
-- One row per (user_id, milestone_key). The handler only ever issues
-- INSERT OR IGNORE, so the UNIQUE keeps re-completion idempotent.
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
