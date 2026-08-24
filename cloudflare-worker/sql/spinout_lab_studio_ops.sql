-- Spin-Out Lab · Studio Ops — founder weekly cadence + closeout review.
--
-- Backs GET/PUT /api/spinout-lab/studio-ops (cloudflare-worker/src/routes/spinout_lab.ts).
-- Apply with:
--   npx wrangler d1 execute studioos-db --file=sql/spinout_lab_studio_ops.sql --remote
--
-- One row per (user_id, week). Per-week rather than one standing row per
-- founder because locking a cadence is a commitment made for a specific sprint
-- week: a locked Week 2 has to stay locked in the record once Week 3 begins.
-- The route seeds a new week from the previous one, so re-affirming the same
-- rhythm is one click.
--
-- Only what the founder authors lives here. The week's objective, its
-- commitments, execution health and blockers are all derived at read time from
-- the week catalog and the real `spinout_lab_milestones` rows — a second copy
-- would let this table disagree with the workspace about the same week.

CREATE TABLE IF NOT EXISTS spinout_lab_studio_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  -- JSON array of { id, day, name, time, owner, agenda, tag }. Shape and limits
  -- are enforced in services/studioOpsCadence.ts, not by the schema, so a
  -- malformed blob degrades to the starter cadence instead of failing the read.
  cadence TEXT NOT NULL DEFAULT '[]',
  -- Set once, when the founder locks the week's rhythm. Non-null IS "locked";
  -- there is no separate boolean to fall out of step with it.
  cadence_locked_at TEXT,
  -- JSON object of { shipped, slipped, changed, next }.
  review TEXT NOT NULL DEFAULT '{}',
  review_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The upsert target. Also the read path — every query here is by (user, week).
CREATE UNIQUE INDEX IF NOT EXISTS idx_spinout_lab_studio_ops_user_week
  ON spinout_lab_studio_ops(user_id, week);
