-- 710 — event syndication, Part A: the core (D1490, #3904; the #3725 spec,
-- Design §Part A). Number given by #3904 (free on main at 3ea8e9be81).
--
-- event_channel_accounts: a channel account events are listed through. HQ's
--   (owner_kind 'hq', one live per channel) or, when HQ allows it, a host's
--   own (owner question C). credentials_enc is encrypted by
--   integrations/secrets.ts and is never returned by a read.
-- event_syndications: one row per event and account; its status is the
--   listing's, its sync_state the last edit's.
-- event_syndication_log: every action on a listing or an account, with the
--   platform's reason (never a token, never an attendee's email).
--
-- Additive only: three new tables and their indexes. No existing row changes.

CREATE TABLE IF NOT EXISTS event_channel_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('luma','eventbrite','google_business','linkedin','facebook')),
  owner_kind TEXT NOT NULL DEFAULT 'hq' CHECK (owner_kind IN ('hq','host')),
  owner_user_id INTEGER REFERENCES users(id),          -- NULL for hq; the host for 'host' (owner question C)
  external_account_id TEXT NOT NULL CHECK (length(external_account_id) BETWEEN 1 AND 200),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  credentials_enc TEXT,                                  -- integrations/secrets.ts; never returned by a read
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','error','disconnected')),
  expires_at TEXT, last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  default_on INTEGER NOT NULL DEFAULT 0 CHECK (default_on IN (0,1)),
  connected_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((owner_kind = 'hq') = (owner_user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eca_hq_live ON event_channel_accounts(channel)
  WHERE owner_kind = 'hq' AND status != 'disconnected';
CREATE UNIQUE INDEX IF NOT EXISTS idx_eca_host_live ON event_channel_accounts(channel, owner_user_id)
  WHERE owner_kind = 'host' AND status != 'disconnected';

CREATE TABLE IF NOT EXISTS event_syndications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES event_channel_accounts(id),
  channel TEXT NOT NULL,                                  -- copied from the account at selection
  status TEXT NOT NULL DEFAULT 'selected' CHECK (status IN
    ('selected','pending','posted','failed','skipped','cancelled','withdrawn')),
  sync_state TEXT CHECK (sync_state IS NULL OR sync_state IN ('in_sync','pending','failed','unsupported')),
  skip_reason TEXT, last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  overrides_json TEXT NOT NULL DEFAULT '{}',              -- {title?, description?, ticket_url?}; validated per channel
  external_id TEXT, external_url TEXT,                    -- https only
  content_hash TEXT, pushed_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  selected_by INTEGER REFERENCES users(id),
  posted_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_event_syndications_event ON event_syndications(event_id, status);

CREATE TABLE IF NOT EXISTS event_syndication_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syndication_id INTEGER REFERENCES event_syndications(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES event_channel_accounts(id) ON DELETE SET NULL,
  event_id INTEGER, channel TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('connect','disconnect','select','unselect','post','update','cancel','withdraw','retry','skip','import')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','failed','skipped')),
  http_status INTEGER, detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),   -- never a token, never an attendee's email
  actor_user_id INTEGER REFERENCES users(id),                                            -- NULL = the queue job
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_esl_created ON event_syndication_log(created_at);
CREATE INDEX IF NOT EXISTS idx_esl_event ON event_syndication_log(event_id, created_at);
