-- D6107 (#6107): a tracked PostHog metric may say it measures visits.
--
-- The owner's answer on #6107 (2026-11-15): decision F (#2409) is lifted for
-- Grow › Distribution's Visit stage only, and its figure comes from a tracked
-- PostHog metric the founder gives the new role `visits` (Q2 = A).
--
-- Same rebuild as 754, 553, 331 and 266: SQLite cannot widen a CHECK in place,
-- so `posthog_tracked_metrics` (755) is rebuilt with `role` taking 'visits'
-- beside the seven roles 755 listed. Every column, default, foreign key,
-- the UNIQUE and the other CHECK are 755's, verbatim; every row is copied with
-- its id; the one index is recreated. 755 has no trigger to re-run, and no
-- table references this one (facts name a metric by `metric:<uid>` text).
--
--   role   active_users, new_users, activation, retention, conversion,
--          sessions, visits or other: what the founder says the insight
--          measures, never guessed from event names (`ROLES`,
--          `services/posthog/metrics.ts`, holds the same list).
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE IF NOT EXISTS posthog_tracked_metrics_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  insight_short_id TEXT NOT NULL,
  insight_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('active_users', 'new_users', 'activation', 'retention', 'conversion', 'sessions', 'visits', 'other')),
  module TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'count' CHECK (unit IN ('count', 'pct')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, insight_short_id, module)
);

INSERT INTO posthog_tracked_metrics_new (id, uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by, created_at)
  SELECT id, uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by, created_at FROM posthog_tracked_metrics;

DROP TABLE posthog_tracked_metrics;

ALTER TABLE posthog_tracked_metrics_new RENAME TO posthog_tracked_metrics;

CREATE INDEX IF NOT EXISTS idx_posthog_tracked_project ON posthog_tracked_metrics (project_id, module);
