-- 657 — PostHog part 1: the one PostHog project each venture reads (D1385, #3731, #2409).
--
-- One new table, no change to an existing one.
--
--   posthog_project_links   one row per venture: the PostHog project the
--       member chose for it on the connector page. `project_id` is the
--       StudioOS venture and is UNIQUE, so a venture reads one PostHog
--       project, through one member's connection, at a time; a teammate's
--       page then names whose PostHog serves it. The PostHog ids are kept
--       as text (`posthog_project_id` digits only, checked before it is
--       sent as `x-posthog-project-id`). Nothing here names a person at
--       PostHog. The row goes with its connection (`integration_id`
--       cascades): disconnecting PostHog unlinks every venture it served.
CREATE TABLE IF NOT EXISTS posthog_project_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  posthog_org_id TEXT,
  posthog_project_id TEXT NOT NULL,
  posthog_project_name TEXT,
  region TEXT CHECK (region IS NULL OR region IN ('US', 'EU')),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posthog_project_links_integration ON posthog_project_links (integration_id);
