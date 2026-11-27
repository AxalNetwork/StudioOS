-- Epic 5 — Anti-cheat columns on score_snapshots.
-- Run via: npx wrangler d1 execute studioos-db --file=sql/score_anti_cheat.sql --remote
--
-- IDEMPOTENT-SAFE PATTERN: D1/SQLite has no `ALTER TABLE … ADD COLUMN IF NOT
-- EXISTS`, so we gate the run on a `_migrations` marker. Re-running this file
-- after the first apply is a no-op. Drop the marker row to force-replay.

CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The ALTERs themselves only run on the very first execution because each
-- subsequent run will fail on "duplicate column" — that's expected and the
-- deploy script tolerates it. The marker insert at the bottom ensures the
-- block of related index creations is still re-asserted (with IF NOT EXISTS).
ALTER TABLE score_snapshots ADD COLUMN is_sandbox INTEGER NOT NULL DEFAULT 0;
ALTER TABLE score_snapshots ADD COLUMN integrity_hash TEXT;
ALTER TABLE score_snapshots ADD COLUMN integrity_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE score_snapshots ADD COLUMN inputs_json TEXT;
ALTER TABLE score_snapshots ADD COLUMN qualitative_text TEXT;
ALTER TABLE score_snapshots ADD COLUMN anomaly_flags TEXT;
ALTER TABLE score_snapshots ADD COLUMN admin_review_status TEXT NOT NULL DEFAULT 'auto_approved';
ALTER TABLE score_snapshots ADD COLUMN admin_review_notes TEXT;
ALTER TABLE score_snapshots ADD COLUMN admin_reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE score_snapshots ADD COLUMN admin_reviewed_at TEXT;
ALTER TABLE score_snapshots ADD COLUMN locked_until TEXT;

INSERT OR IGNORE INTO _migrations (name) VALUES ('score_anti_cheat_v1');

-- Indexes are independent of the ALTERs (idempotent) so they get re-asserted
-- on every run. Critical for the read-side paths that join on these columns.
CREATE INDEX IF NOT EXISTS idx_scores_sandbox      ON score_snapshots(project_id, is_sandbox, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_review       ON score_snapshots(admin_review_status);
CREATE INDEX IF NOT EXISTS idx_scores_locked_until ON score_snapshots(project_id, locked_until);
