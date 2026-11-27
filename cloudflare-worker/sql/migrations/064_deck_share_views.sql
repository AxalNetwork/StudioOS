-- Task #53 — Pitch deck share view tracking + view_limit support.
--
-- Adds:
--   * view_limit / view_count columns on pitch_deck_share_tokens so a
--     share link can be consumed up to N times (default 1 = one-time).
--   * deck_share_views table — one row per share-link impression with
--     hashed IP, UA fingerprint, and read-seconds. Surfaced in the
--     deck Engagement panel for the founder.
--
-- Additive-only; safe to re-run. D1 has no `ADD COLUMN IF NOT EXISTS`,
-- so the ALTERs may fail on a fresh run after the table already has the
-- columns — the route in cloudflare-worker/src/routes/decks.ts also
-- bootstraps the columns lazily via PRAGMA on first hit. Re-runs that
-- fail on the ALTERs leave the table intact.

ALTER TABLE pitch_deck_share_tokens ADD COLUMN view_limit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pitch_deck_share_tokens ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pitch_deck_share_tokens ADD COLUMN last_viewed_at TEXT;

CREATE TABLE IF NOT EXISTS deck_share_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_token_id INTEGER NOT NULL,
  deck_id INTEGER NOT NULL,
  ip_hash TEXT,
  ua_fingerprint TEXT,
  read_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deck_share_views_deck ON deck_share_views(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_share_views_tok  ON deck_share_views(share_token_id);
