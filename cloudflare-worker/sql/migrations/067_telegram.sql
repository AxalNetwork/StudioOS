-- Task #3 — Admin Telegram channels + aggregator.
--
-- Admin-only system to broadcast curated digests to the public @axalvc
-- channel + five invite-only cohort channels (founders, investors, mentors,
-- operating partners, alumni). All sends gated by typed admin approval +
-- PII linter; never auto-posts.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/067_telegram.sql
--
-- Worker also carries a lazy `ensureTelegramSchema()` helper that runs
-- the same CREATE TABLE IF NOT EXISTS on first hit — matches the
-- `ensureTeamMembersSchema()` / `ensurePartnerDirectoryColumns()` pattern
-- documented in replit.md (so the routes keep working even if this
-- migration lands unapplied on prod).

-- ---------- channels ----------
CREATE TABLE IF NOT EXISTS telegram_channels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  chat_id         TEXT,                                   -- nullable until admin pastes real id
  audience        TEXT NOT NULL,                          -- public|founders|investors|mentors|partners|alumni
  is_invite_only  INTEGER NOT NULL DEFAULT 1,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_test_at    TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_channels_audience
  ON telegram_channels (audience, enabled);

-- ---------- posts ----------
CREATE TABLE IF NOT EXISTS telegram_posts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id           INTEGER NOT NULL REFERENCES telegram_channels(id),
  audience             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',     -- draft|scheduled|sent|failed
  title                TEXT,
  body_md              TEXT NOT NULL,
  media_r2_key         TEXT,
  media_kind           TEXT,                              -- photo|document|null
  scheduled_for        TEXT,
  sent_at              TEXT,
  telegram_message_id  INTEGER,
  telegram_link        TEXT,
  source               TEXT NOT NULL DEFAULT 'manual',    -- manual|aggregator
  source_kind          TEXT,                              -- e.g. 'mentor_sessions', 'mrr_milestone'
  body_hash            TEXT,                              -- sha256 of body_md at send time
  send_error           TEXT,
  override_reason      TEXT,                              -- typed admin reason when PII linter overridden
  override_findings    TEXT,                              -- JSON of linter findings at override time
  created_by           INTEGER NOT NULL REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_posts_status
  ON telegram_posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_posts_channel
  ON telegram_posts (channel_id, created_at DESC);

-- ---------- aggregations (audit/dedup trail for aggregator runs) ----------
CREATE TABLE IF NOT EXISTS telegram_aggregations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  audience        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  draft_post_id   INTEGER REFERENCES telegram_posts(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_aggregations_audience
  ON telegram_aggregations (audience, created_at DESC);

-- ---------- promotion consent (side table — users at D1 ALTER limit) ----------
CREATE TABLE IF NOT EXISTS user_promotion_consent (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  consented     INTEGER NOT NULL DEFAULT 0,
  consented_at  TEXT,
  source        TEXT,                                       -- 'settings'|'onboarding'|'admin'
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- seed the six canonical channels ----------
-- chat_id stays NULL until the admin pastes the real Telegram chat_id
-- (post-BotFather setup). Slugs are stable identifiers used by the
-- aggregator's audience routing.
INSERT OR IGNORE INTO telegram_channels (slug, label, audience, is_invite_only) VALUES
  ('axalvc-public',  '@axalvc Public',          'public',     0),
  ('axal-founders',  'Axal Founders',           'founders',   1),
  ('axal-investors', 'Axal Investors',          'investors',  1),
  ('axal-mentors',   'Axal Mentors',            'mentors',    1),
  ('axal-partners',  'Axal Operating Partners', 'partners',   1),
  ('axal-alumni',    'Axal Alumni',             'alumni',     1);
