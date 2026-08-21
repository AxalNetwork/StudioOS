-- Build queue #120 — audience-scoped cap-table share links.
--
-- Mirrors the deck-sharing tables (pitch_deck_share_tokens /
-- deck_share_views, migration 064) because that pattern is already
-- proven in production and its redemption path is race-safe. Two
-- properties are load-bearing and must survive any future edit:
--
--   1. token_hash stores a SHA-256 digest, NEVER the raw token. A dump
--      of this table hands out no working links.
--   2. view_count / view_limit / expires_at are all consumed by ONE
--      conditional UPDATE (services/shareLink.ts claimShareToken), so
--      two simultaneous viewers of a one-view link cannot both succeed.
--
-- `audience` is what makes this different from deck sharing: a cap
-- table is not one document. The same scenario is served at three
-- different levels of detail, and the redaction runs server-side
-- (services/captableShare.ts) before serialisation — the private rows
-- never reach the browser at all.

CREATE TABLE IF NOT EXISTS captable_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_uid TEXT NOT NULL,
  -- summary | investor | full — see services/captableShare.ts
  audience TEXT NOT NULL DEFAULT 'summary',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  view_limit INTEGER NOT NULL DEFAULT 1,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  -- Free-text label so the owner can tell two live links apart
  -- ("Sequoia diligence", "new CFO candidate").
  label TEXT,
  revoked_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_captable_share_hash ON captable_share_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_captable_share_scenario ON captable_share_tokens(scenario_uid, created_at);

CREATE TABLE IF NOT EXISTS captable_share_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_token_id INTEGER NOT NULL REFERENCES captable_share_tokens(id) ON DELETE CASCADE,
  scenario_uid TEXT NOT NULL,
  -- Pseudonymous: HMAC-style digests keyed by the app secret, truncated
  -- to 16 hex chars. Enough to tell viewers apart, not enough to
  -- identify one, and no raw IP is ever written.
  ip_hash TEXT,
  ua_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_captable_share_views_token ON captable_share_views(share_token_id);
CREATE INDEX IF NOT EXISTS idx_captable_share_views_scenario ON captable_share_views(scenario_uid, created_at);
