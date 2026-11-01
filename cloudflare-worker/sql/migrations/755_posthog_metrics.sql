-- 755 — PostHog part 2: the metrics foundation (D1604, #3731, #2409).
--
-- Three new tables, no change to an existing one. Each goes with its
-- connection (`integration_id` cascades): disconnecting PostHog takes its
-- tracked metrics, facts and undecided proposals with it. Records the founder
-- accepted into a module stay there, in that module's own store.
--
--   posthog_tracked_metrics   a saved PostHog insight the founder chose to
--       track for one venture, with the role they gave it (what it measures:
--       never guessed from event names) and the module it shows in. Its `uid`
--       names the venture's KPI `posthog-<uid>` (`growKpis.ts`).
--   posthog_metric_facts      what a section sync read: small aggregates
--       only, one row per fact and period. Each row has its
--       `connector_fed_items` row (migration 445), so a fact the founder
--       deleted keeps its ledger row with no `local_id` and is never written
--       again. No PostHog figure is written to `project_metrics` or
--       `custom_kpi_values` (#2409 decision G).
--   posthog_proposals         what waits for the founder's Accept: an
--       experiment as evidence, a survey answer as a signal or as feedback, a
--       flag linked to a must-have or shipped. `payload_json` may hold an
--       open-text survey answer: team-only, never logged, and never a person's
--       identifier.
CREATE TABLE IF NOT EXISTS posthog_tracked_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  insight_short_id TEXT NOT NULL,
  insight_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('active_users', 'new_users', 'activation', 'retention', 'conversion', 'sessions', 'other')),
  module TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'count' CHECK (unit IN ('count', 'pct')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, insight_short_id, module)
);
CREATE INDEX IF NOT EXISTS idx_posthog_tracked_project ON posthog_tracked_metrics (project_id, module);

CREATE TABLE IF NOT EXISTS posthog_metric_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('metric', 'web_overview', 'experiment_result', 'flag_state', 'survey_stats')),
  fact_key TEXT NOT NULL,
  period TEXT NOT NULL,
  value REAL,
  value_json TEXT,
  source_ref TEXT,
  label TEXT,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, project_id, fact_key, period)
);
CREATE INDEX IF NOT EXISTS idx_posthog_facts_module ON posthog_metric_facts (project_id, module, kind);

CREATE TABLE IF NOT EXISTS posthog_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('experiment_evidence', 'survey_signal', 'survey_feedback', 'flag_link', 'flag_shipped')),
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  target_ref TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, project_id, kind, source_key)
);
CREATE INDEX IF NOT EXISTS idx_posthog_proposals_module ON posthog_proposals (project_id, module, status);
