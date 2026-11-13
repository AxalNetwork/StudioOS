CREATE TABLE IF NOT EXISTS grow_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  goal TEXT NOT NULL CHECK (goal IN ('awareness','signups','demos','sales')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
  starts_on TEXT, ends_on TEXT,                 -- YYYY-MM-DD or NULL; ends_on >= starts_on checked in code
  budget_cents INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),  -- a plan; NULL = not set, never 0
  utm_campaign TEXT CHECK (utm_campaign IS NULL OR (utm_campaign = lower(trim(utm_campaign)) AND length(utm_campaign) BETWEEN 1 AND 80)),
  segment_id INTEGER REFERENCES customer_segments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id), updated_by INTEGER REFERENCES users(id),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grow_campaigns_utm ON grow_campaigns(project_id, utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grow_campaigns_project ON grow_campaigns(project_id, status);

CREATE TABLE IF NOT EXISTS grow_campaign_channels (
  campaign_id INTEGER NOT NULL REFERENCES grow_campaigns(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES growth_channels(id) ON DELETE CASCADE,
  planned_budget_cents INTEGER CHECK (planned_budget_cents IS NULL OR planned_budget_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, channel_id)
);

CREATE TABLE IF NOT EXISTS grow_campaign_items (
  campaign_id INTEGER NOT NULL REFERENCES grow_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('content_item','publish_draft')),
  ref_id INTEGER NOT NULL,                      -- content_calendar_items.id or publish_drafts.id, same venture, checked in code
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, kind, ref_id)
);
