-- 202611150136 — Search Console part 1: finalized daily property totals and
-- weekly top landing pages, fixture-backed (D5840, #5840; track #5826).
--
-- Seven new tables, no change to an existing one. Every row is keyed by the
-- venture (`project_id`) and the EXACT Search Console property identifier
-- (`site_url`: `sc-domain:example.com` or a URL-prefix `https://example.com/`,
-- byte for byte as Google lists it). No table has a column for a search query:
-- the first release never requests the `query` dimension.
--
--   search_console_selections    the one property bound to a venture. #5839
--       (OAuth and the sites.list picker) is not on main yet; this is the
--       minimal stored selection that sync reads, and #5839 writes it. A sync
--       lands data only for the property selected here.
--   search_console_sync_state    per venture, property and search type: the
--       bounded initial window, the provider date (Pacific Time) fetched
--       through, the units, the last outcome and the run claim that keeps two
--       runs from writing at once.
--   search_console_daily_totals  one row per provider date: either a reported
--       byProperty aggregate (a true zero is a reported 0) or `not_returned`
--       (a final date Google returned no row for: missing or suppressed, never
--       0). A failed fetch writes no row, so a date never fetched has none.
--       `fingerprint` and `source_revision` record later corrections.
--   search_console_page_weeks    one row per week of top landing pages: the
--       byPage request's range, row limit, rows returned, whether the list was
--       truncated and whether the week was complete when fetched.
--   search_console_top_pages     the landing pages of that week, by rank. Never
--       summed into property totals.
--   search_console_revisions     the previous fingerprint and values each time
--       a re-fetch changed a stored day or week (a late correction).
--   search_console_sync_runs     one row per sync attempt and its outcome.

CREATE TABLE IF NOT EXISTS search_console_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  site_url TEXT NOT NULL,
  property_kind TEXT NOT NULL CHECK (property_kind IN ('domain', 'url_prefix')),
  permission_level TEXT,
  access_state TEXT NOT NULL DEFAULT 'ok' CHECK (access_state IN ('ok', 'denied', 'revoked')),
  selected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_console_sync_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web' CHECK (search_type IN ('web')),
  data_state TEXT NOT NULL DEFAULT 'final' CHECK (data_state IN ('final')),
  provider_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  units_json TEXT NOT NULL DEFAULT '{"clicks":"count","impressions":"count","ctr":"ratio","position":"average_rank"}',
  initial_from TEXT,
  fetched_through TEXT,
  last_status TEXT CHECK (last_status IN ('ok', 'partial', 'failed', 'denied', 'revoked')),
  last_error_code TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  run_token TEXT,
  run_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, site_url, search_type)
);

CREATE TABLE IF NOT EXISTS search_console_daily_totals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web' CHECK (search_type IN ('web')),
  data_date TEXT NOT NULL,
  data_state TEXT NOT NULL DEFAULT 'final' CHECK (data_state IN ('final')),
  aggregation_type TEXT NOT NULL DEFAULT 'byProperty' CHECK (aggregation_type IN ('byProperty')),
  row_state TEXT NOT NULL CHECK (row_state IN ('reported', 'not_returned')),
  clicks INTEGER,
  impressions INTEGER,
  ctr REAL,
  position REAL,
  fingerprint TEXT NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 1,
  run_id INTEGER,
  first_fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, site_url, search_type, data_date),
  CHECK ((row_state = 'reported' AND clicks IS NOT NULL AND impressions IS NOT NULL)
      OR (row_state = 'not_returned' AND clicks IS NULL AND impressions IS NULL AND ctr IS NULL AND position IS NULL))
);

CREATE TABLE IF NOT EXISTS search_console_page_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web' CHECK (search_type IN ('web')),
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  fetched_through TEXT NOT NULL,
  aggregation_type TEXT NOT NULL DEFAULT 'byPage' CHECK (aggregation_type IN ('byPage')),
  row_limit INTEGER NOT NULL,
  rows_returned INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  fingerprint TEXT NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 1,
  run_id INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, site_url, search_type, week_start)
);

CREATE TABLE IF NOT EXISTS search_console_top_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web' CHECK (search_type IN ('web')),
  week_start TEXT NOT NULL,
  page TEXT NOT NULL,
  rank INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL,
  position REAL,
  UNIQUE (project_id, site_url, search_type, week_start, page)
);

CREATE TABLE IF NOT EXISTS search_console_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  dataset TEXT NOT NULL CHECK (dataset IN ('daily_totals', 'top_pages')),
  period_key TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  previous_fingerprint TEXT NOT NULL,
  previous_json TEXT NOT NULL,
  run_id INTEGER,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, site_url, search_type, dataset, period_key, source_revision)
);

CREATE TABLE IF NOT EXISTS search_console_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  trigger TEXT NOT NULL CHECK (trigger IN ('connect', 'manual', 'cron')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed', 'denied', 'revoked', 'busy')),
  range_from TEXT,
  range_to TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  days_written INTEGER NOT NULL DEFAULT 0,
  weeks_written INTEGER NOT NULL DEFAULT 0,
  corrections INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_console_runs_project ON search_console_sync_runs (project_id, started_at DESC);
