-- D2407 (#2407 parts 1–2) — a founder's own Beehiiv newsletter: the one
-- publication each venture reads, and the aggregates Grow lands from it.
--
-- Three new tables and one index on the ledger; no existing table changes.
-- Nothing creates these at runtime: a database without them reads the
-- Beehiiv part as "Unreadable", never as zero. No table holds a subscriber,
-- an email address or anything about a person at Beehiiv: aggregates only.
--
--   beehiiv_publication_links   one row per venture (`project_id` UNIQUE):
--       the Beehiiv publication the member chose for it, through one
--       member's connection. The row goes with its connection: the provider's
--       disconnect deletes it, and `integration_id` cascades as a backstop.
--       `channel_state` is the Distribution channel proposal's (none,
--       pending, accepted, dismissed); Accept links `growth_channel_id`.
--
--   beehiiv_grow_facts   one dated snapshot per venture, kind and day:
--       active, free and premium subscribers (counts) and the average open
--       and click rates (fractions, 0 to 1, after one normaliser). Active
--       and premium land in Revenue and traction as traction, beside
--       revenue and never as revenue; the rest in Distribution. Growth is
--       computed from two snapshots when read, never stored.
--
--   beehiiv_post_stats   the venture's sent posts and their figures (rates
--       as fractions). `publish_send_id` is PUBLISH's record of the draft a
--       post came from, null until #2407 part 3 links one.
--
-- Facts and post rows keep `integration_id` with no foreign key, as
-- `mercury_grow_facts` does: a disconnect leaves them, dated, for the founder
-- to delete. Every landing goes through `connector_fed_items` (D655); the
-- new index lets a reconnect's sync find a figure the founder deleted under
-- the earlier connection, so it is never re-created.
CREATE TABLE IF NOT EXISTS beehiiv_publication_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  publication_name TEXT,
  channel_state TEXT NOT NULL DEFAULT 'none' CHECK (channel_state IN ('none', 'pending', 'accepted', 'dismissed')),
  growth_channel_id INTEGER REFERENCES growth_channels(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_beehiiv_publication_links_integration ON beehiiv_publication_links (integration_id);

CREATE TABLE IF NOT EXISTS beehiiv_grow_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('distribution', 'revenue_and_traction')),
  kind TEXT NOT NULL CHECK (kind IN ('subscribers_active', 'subscribers_free', 'subscribers_premium', 'open_rate_avg', 'click_rate_avg')),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  count INTEGER CHECK (count IS NULL OR count >= 0),
  value REAL CHECK (value IS NULL OR (value >= 0 AND value <= 1)),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_beehiiv_grow_facts_module ON beehiiv_grow_facts (project_id, module, period);

CREATE TABLE IF NOT EXISTS beehiiv_post_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  post_external_id TEXT NOT NULL,
  title TEXT,
  sent_at TEXT,
  recipients INTEGER CHECK (recipients IS NULL OR recipients >= 0),
  unique_opens INTEGER CHECK (unique_opens IS NULL OR unique_opens >= 0),
  open_rate REAL CHECK (open_rate IS NULL OR (open_rate >= 0 AND open_rate <= 1)),
  unique_clicks INTEGER CHECK (unique_clicks IS NULL OR unique_clicks >= 0),
  click_rate REAL CHECK (click_rate IS NULL OR (click_rate >= 0 AND click_rate <= 1)),
  publish_send_id INTEGER REFERENCES publish_sends(id) ON DELETE SET NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, post_external_id)
);
CREATE INDEX IF NOT EXISTS idx_beehiiv_post_stats_sent ON beehiiv_post_stats (project_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_connector_fed_items_project_external ON connector_fed_items (project_id, external_id);
