-- D5859 (#5859, part 2a of #2399) — a connected Facebook Page in Grow: which
-- venture a Page feeds, and the Page's followers, views, unique viewers and
-- engagements.
--
-- ONE PAGE PER VENTURE (owner, 2026-11-15, option A on #2399). The connection
-- saves the Pages a member chose per company (`config_json.pages_by_company`),
-- and a company can hold several ventures (migration 189), so a venture names
-- its Page here. `project_id` is unique: a venture has one Page. A Page feeds
-- one venture per connection (`UNIQUE (integration_id, page_id)`). The link goes
-- with its connection and its venture (ON DELETE CASCADE).
--
-- `insights_cursor` is the oldest day the sync has read back to while it has not
-- yet reached 12 months; `backfilled` is 1 once it has. No Page access token is
-- stored: each sync reads it from `/me/accounts` and drops it.
--
-- FACTS, NEVER KPIs. One row per venture, kind, day and Page (`subject`). A
-- metric Facebook did not return has no row and reads "Not recorded"; a 0
-- Facebook returned is stored as 0. Nothing here is written to
-- `project_metrics` or `custom_kpi_values`.
--
-- Each row is linked in `connector_fed_items` (kind `facebook_page_fact`), so a
-- row the founder deleted stays deleted on re-sync. Disconnect and the Meta
-- deletion callback delete the connection's rows, their ledger rows and links.

CREATE TABLE IF NOT EXISTS facebook_page_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL CHECK (length(page_id) BETWEEN 1 AND 32),
  page_name TEXT CHECK (page_name IS NULL OR length(page_name) <= 200),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  insights_cursor TEXT CHECK (insights_cursor IS NULL OR insights_cursor GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  backfilled INTEGER NOT NULL DEFAULT 0 CHECK (backfilled IN (0, 1)),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, page_id)
);

CREATE TABLE IF NOT EXISTS facebook_page_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('distribution', 'revenue_and_traction')),
  kind TEXT NOT NULL CHECK (kind IN ('followers', 'views', 'viewers', 'engagements')),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 32),
  value INTEGER NOT NULL CHECK (value >= 0),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, period, subject)
);
CREATE INDEX IF NOT EXISTS idx_facebook_page_facts_integration ON facebook_page_facts (integration_id);
CREATE INDEX IF NOT EXISTS idx_facebook_page_facts_read ON facebook_page_facts (project_id, kind, period);
