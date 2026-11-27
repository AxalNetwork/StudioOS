-- D5863 (#5863, part 2a of #2401) — a founder's own TikTok in Grow: the venture
-- the account serves, the account's daily audience snapshot and each public
-- video's counts.
--
-- ONE ACCOUNT, ONE VENTURE (owner decision F). `tiktok_account_links` holds the
-- one venture a connection serves: `project_id` and `integration_id` are each
-- unique, so a venture has one TikTok and a TikTok feeds one venture. The first
-- sync makes the link; another member's sync for a venture already served is
-- refused (`venture_served`, Beehiiv's precedent). The link goes with its
-- connection (ON DELETE CASCADE) and its venture.
--
-- FACTS, NEVER KPIs. Counts only: no cover, embed URL, comment text or open_id.
-- A title is the first 150 characters TikTok gives. A count TikTok did not give,
-- or a scope the member did not grant, is NULL, never 0. Nothing here is
-- written to `project_metrics` or `custom_kpi_values`.
--
-- Each row is linked in `connector_fed_items` (kinds `tiktok_account_snapshot`
-- and `tiktok_video`), so a row the founder deleted stays deleted on re-sync.
-- Disconnect deletes the connection's rows and their ledger rows (decision E).

CREATE TABLE IF NOT EXISTS tiktok_account_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL UNIQUE REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  linked_by INTEGER NOT NULL REFERENCES users(id),
  -- Where the last sync stopped in the video list when it hit its budget; NULL once it read to the end.
  video_cursor TEXT CHECK (video_cursor IS NULL OR length(video_cursor) <= 64),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tiktok_account_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL CHECK (snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  followers INTEGER CHECK (followers IS NULL OR followers >= 0),
  following INTEGER CHECK (following IS NULL OR following >= 0),
  likes_total INTEGER CHECK (likes_total IS NULL OR likes_total >= 0),
  video_count INTEGER CHECK (video_count IS NULL OR video_count >= 0),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_account_facts_integration ON tiktok_account_facts (integration_id);

CREATE TABLE IF NOT EXISTS tiktok_video_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL CHECK (length(video_id) BETWEEN 1 AND 40),
  posted_on TEXT,
  title TEXT CHECK (title IS NULL OR length(title) <= 150),
  duration_s INTEGER CHECK (duration_s IS NULL OR duration_s >= 0),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  comments INTEGER CHECK (comments IS NULL OR comments >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_video_facts_posted ON tiktok_video_facts (project_id, posted_on);
CREATE INDEX IF NOT EXISTS idx_tiktok_video_facts_integration ON tiktok_video_facts (integration_id);
