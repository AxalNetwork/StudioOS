-- T8 — atomic dedup for official scoring runs.
--
-- Problem: two concurrent POST /api/scoring/score calls for the same project
-- both pass the read-then-write cooldown check (`SELECT ... ORDER BY id DESC
-- LIMIT 1` + `Date.now() < lockUntilMs`) because there's nothing atomic
-- enforcing one-per-week. The fix is a SQL UNIQUE INDEX on
-- (project_id, official_week) that the second concurrent INSERT bounces off
-- with a UNIQUE-constraint error — which the route converts into 409.
--
-- `official_week` is `strftime('%Y-%W', created_at)` (Monday-based week of
-- year, matches SQLite's %W). NULL for sandbox rows so the partial index
-- ignores them entirely (founders practice freely).
--
-- This migration is safe to re-run: ALTER + UPDATE + CREATE INDEX are all
-- idempotent or `IF NOT EXISTS`-guarded. Re-running the ALTER will error
-- "duplicate column name" — ignore that single error.

ALTER TABLE score_snapshots ADD COLUMN official_week TEXT;

-- Backfill existing official rows so a duplicate (project_id, week) pair
-- already in the table doesn't slip through. Sandbox rows stay NULL.
UPDATE score_snapshots
   SET official_week = strftime('%Y-%W', created_at)
 WHERE is_sandbox = 0
   AND official_week IS NULL;

-- Pre-existing duplicates would block CREATE UNIQUE INDEX. Keep the LATEST
-- row per (project_id, week) and NULL out the others — they remain in the
-- table for audit (admin can still see them) but no longer participate in
-- the partial unique index. This is correct because the cooldown rule has
-- always been "newest official wins" anyway.
UPDATE score_snapshots
   SET official_week = NULL
 WHERE is_sandbox = 0
   AND official_week IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM score_snapshots
      WHERE is_sandbox = 0 AND official_week IS NOT NULL
      GROUP BY project_id, official_week
   );

-- Partial unique: only enforced on official, week-stamped rows. Concurrent
-- INSERTs for the same (project_id, current_week) race here and the loser
-- gets a UNIQUE constraint error → routes/scoring.ts catches and returns
-- 409 { error: "Already scored this week." }.
CREATE UNIQUE INDEX IF NOT EXISTS uq_score_official_week
  ON score_snapshots(project_id, official_week)
  WHERE is_sandbox = 0 AND official_week IS NOT NULL;
