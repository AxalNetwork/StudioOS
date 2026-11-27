-- Task #4 (ID) — Public marketing surfaces.
--
-- Adds three small tables backing the public /status, /roadmap, and
-- /demo pages. Every table uses IF NOT EXISTS so re-running on a
-- partially-applied D1 is safe.

-- 1. Status page: admin-authored incidents + their updates.
CREATE TABLE IF NOT EXISTS status_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'investigating',  -- investigating|identified|monitoring|resolved
  severity TEXT NOT NULL DEFAULT 'minor',        -- minor|major|critical
  affected_services TEXT,                        -- JSON array of service slugs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_status_incidents_created ON status_incidents(created_at DESC);

CREATE TABLE IF NOT EXISTS status_incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_status_incident_updates_incident ON status_incident_updates(incident_id, created_at);

-- 2. Roadmap upvotes — one row per (user, item).
CREATE TABLE IF NOT EXISTS roadmap_votes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_votes_item ON roadmap_votes(item_id);

-- 3. Demo / contact-form submissions from /demo (when Calendly is not configured).
CREATE TABLE IF NOT EXISTS demo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,            -- product|investor|partnership
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  message TEXT,
  github_issue_url TEXT,          -- populated if we successfully open a GitHub Issue
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created ON demo_requests(created_at DESC);

-- 4. Lightweight per-page pageview tally for the privacy-friendly first-party
--    analytics beacon. We do NOT store IPs or user agents — only a day bucket.
CREATE TABLE IF NOT EXISTS public_pageviews (
  day TEXT NOT NULL,              -- YYYY-MM-DD UTC
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
