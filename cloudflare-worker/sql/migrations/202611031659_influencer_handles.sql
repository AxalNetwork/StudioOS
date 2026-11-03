-- D4289 P2 (#4291): handles, the public @handle read, and attribution through
-- them. Builds on P1's `influencers` (migration 202611031502), whose `handle`
-- column this part writes.
--
-- WHAT THIS ADDS:
--   slug_history          gains the kind `handle` (D-c: an old handle redirects
--                         for 12 months, then reads unknown and can be taken
--                         again), `expires_at` (NULL for companies and projects,
--                         which keep their old slugs for ever, D1415) and
--                         `taken_down` (HQ took the handle down: it never
--                         redirects, and stays unclaimable until it expires).
--   influencers           gains `handle_changed_at` (a handle changes at most
--                         once every 30 days) and `page_line` (the public page's
--                         line in the influencer's own words).
--   influencer_links      the channel sub-links (`@jane/yt`), each with an
--                         optional UTM campaign; archived, never deleted.
--   handle_visits         one row per visitor, handle, channel and day: a
--                         day-salted hash of a client visitor id, never an IP.
--   referral_attributions (declared by migration 287, D235) gains `source`
--                         (code | handle), `handle`,
--                         `channel` and `status` (active | flagged | refused)
--                         with `refused_reason`.
--   influencer_referral_flags
--                         HQ's review queue (D-k): a self-referral or a loop
--                         refused, a sign-up over the handle's daily cap held.
--
-- WHY slug_history IS REBUILT. Migration 685 holds `kind` to company and
-- project in a CHECK, which SQLite cannot widen in place. Nothing references
-- it, so it is copied aside, dropped, recreated under its own name with the
-- wider CHECK and the two new columns, and copied back with every id and the
-- AUTOINCREMENT high-water mark. No transaction statements (D1 rejects them).

-- ─────────────────────────────────────────────── slug_history

CREATE TABLE slug_history_keep_p2 AS SELECT * FROM slug_history;
CREATE TABLE slug_history_seq_keep_p2 AS SELECT seq FROM sqlite_sequence WHERE name = 'slug_history';
DROP TABLE slug_history;
CREATE TABLE slug_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'project', 'handle')),
  scope_company_id INTEGER,
  slug TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  retired_by INTEGER REFERENCES users(id),
  retired_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- When a retired handle stops redirecting and may be taken again; NULL keeps a slug for ever.
  expires_at TEXT,
  -- HQ took the handle down: it never redirects.
  taken_down INTEGER NOT NULL DEFAULT 0 CHECK (taken_down IN (0, 1))
);
INSERT INTO slug_history (id, kind, scope_company_id, slug, target_id, retired_by, retired_at)
SELECT id, kind, scope_company_id, slug, target_id, retired_by, retired_at FROM slug_history_keep_p2 ORDER BY id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_slug_history_scope
  ON slug_history(kind, ifnull(scope_company_id, 0), slug);
-- The copy's INSERT … SELECT makes the sequence row even for no rows, so it is always there to raise.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM slug_history_seq_keep_p2), 0)) WHERE name = 'slug_history';
DROP TABLE slug_history_keep_p2;
DROP TABLE slug_history_seq_keep_p2;

-- ─────────────────────────────────────────────── the handle's page

ALTER TABLE influencers ADD COLUMN handle_changed_at TEXT;
ALTER TABLE influencers ADD COLUMN page_line TEXT CHECK (page_line IS NULL OR length(page_line) <= 160);

CREATE TABLE IF NOT EXISTS influencer_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  channel       TEXT    NOT NULL CHECK (length(channel) BETWEEN 1 AND 24 AND channel NOT GLOB '*[^a-z0-9_]*'),
  utm_campaign  TEXT    CHECK (utm_campaign IS NULL OR (length(utm_campaign) BETWEEN 1 AND 60 AND utm_campaign NOT GLOB '*[^A-Za-z0-9_.-]*')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_links_live ON influencer_links(influencer_id, channel) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS handle_visits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  handle        TEXT    NOT NULL,
  -- '' for the handle itself, else the sub-link's channel.
  channel       TEXT    NOT NULL DEFAULT '',
  day           TEXT    NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- sha-256 of a day-salted client visitor id; NULL when the visitor sent none (counted, never deduplicated).
  visitor_hash  TEXT    CHECK (visitor_hash IS NULL OR length(visitor_hash) = 64),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_handle_visits_once
  ON handle_visits(influencer_id, channel, day, visitor_hash) WHERE visitor_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_handle_visits_day ON handle_visits(influencer_id, day);

-- ─────────────────────────────────────────────── attribution

ALTER TABLE referral_attributions ADD COLUMN source TEXT NOT NULL DEFAULT 'code' CHECK (source IN ('code', 'handle'));
ALTER TABLE referral_attributions ADD COLUMN handle TEXT;
ALTER TABLE referral_attributions ADD COLUMN channel TEXT;
ALTER TABLE referral_attributions ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'refused'));
ALTER TABLE referral_attributions ADD COLUMN refused_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_referral_attributions_handle_day ON referral_attributions(referrer_user_id, source, first_touch_at);

CREATE TABLE IF NOT EXISTS influencer_referral_flags (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT    NOT NULL UNIQUE,
  influencer_id    INTEGER NOT NULL REFERENCES influencers(id),
  referred_user_id INTEGER NOT NULL REFERENCES users(id),
  reason           TEXT    NOT NULL CHECK (reason IN ('self_account', 'self_email_domain', 'self_card', 'loop', 'velocity')),
  -- refused: the attribution was refused at once; held: it waits for HQ (a velocity hold);
  -- cleared / upheld: HQ's decision on a held one.
  outcome          TEXT    NOT NULL CHECK (outcome IN ('refused', 'held', 'cleared', 'upheld')),
  handle           TEXT,
  channel          TEXT,
  decided_by       INTEGER REFERENCES users(id),
  decided_at       TEXT,
  decision_reason  TEXT    CHECK (decision_reason IS NULL OR length(decision_reason) <= 2000),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (outcome NOT IN ('cleared', 'upheld') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_influencer_referral_flags_outcome ON influencer_referral_flags(outcome, created_at);
