-- D8815 (#8815, part 3a of #2403) — a founder's own X in Grow: the venture the
-- account serves, the account's audience snapshot, each of the founder's own
-- posts' figures, and the per-founder monthly read budget (owner decision 2).
--
-- NAMES. HQ's own X (migration 068) holds `x_accounts` and `x_posts`; nothing
-- here reuses them. Every table below is `x_grow_*` or `x_founder_*`.
--
-- ONE ACCOUNT, ONE VENTURE (TikTok's rule, D5863). `x_grow_links.project_id`
-- and `integration_id` are each unique. The first sync makes the link; the link
-- goes with its connection (ON DELETE CASCADE, and the disconnect purge).
--
-- FACTS, NEVER KPIs. Counts and dates only: no post text, no handle, no other
-- user's id or name. A count X did not give is NULL, never 0. Nothing here is
-- written to `project_metrics` or `custom_kpi_values`. Monthly totals are
-- computed when read, from the per-post rows.
--
-- Each fact row is linked in `connector_fed_items` (kinds `x_audience_snapshot`
-- and `x_post`), so a row the founder deleted stays deleted on re-sync.
-- Disconnect deletes the connection's facts, ledger rows and link.
--
-- THE BUDGET is per founder (user) and per UTC month, counted in resources X
-- bills for (one user read, one post returned). It is not deleted on disconnect,
-- so reconnecting does not reset a spent month.

CREATE TABLE IF NOT EXISTS x_grow_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL UNIQUE REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  linked_by INTEGER NOT NULL REFERENCES users(id),
  -- 1 when the last sync stopped before it had read every post it meant to (a failed page or the budget).
  partly_synced INTEGER NOT NULL DEFAULT 0 CHECK (partly_synced IN (0, 1)),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS x_grow_audience_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL CHECK (snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  followers INTEGER CHECK (followers IS NULL OR followers >= 0),
  following INTEGER CHECK (following IS NULL OR following >= 0),
  post_count INTEGER CHECK (post_count IS NULL OR post_count >= 0),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_x_grow_audience_facts_integration ON x_grow_audience_facts (integration_id);

CREATE TABLE IF NOT EXISTS x_grow_post_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL CHECK (length(post_id) BETWEEN 1 AND 25),
  posted_on TEXT CHECK (posted_on IS NULL OR posted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  impressions INTEGER CHECK (impressions IS NULL OR impressions >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  reposts INTEGER CHECK (reposts IS NULL OR reposts >= 0),
  replies INTEGER CHECK (replies IS NULL OR replies >= 0),
  quotes INTEGER CHECK (quotes IS NULL OR quotes >= 0),
  bookmarks INTEGER CHECK (bookmarks IS NULL OR bookmarks >= 0),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_x_grow_post_facts_posted ON x_grow_post_facts (project_id, posted_on);
CREATE INDEX IF NOT EXISTS idx_x_grow_post_facts_integration ON x_grow_post_facts (integration_id);

CREATE TABLE IF NOT EXISTS x_founder_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  reads INTEGER NOT NULL DEFAULT 0 CHECK (reads >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, period)
);
