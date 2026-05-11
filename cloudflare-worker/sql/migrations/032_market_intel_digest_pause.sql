-- Task #32 — Per-user "pause sector digests" toggle.
--
-- Lets a user halt the weekly/monthly Market-Intel digest for a window
-- (e.g. 1 week / 1 month / indefinitely) WITHOUT deleting their pinned
-- sectors. Today the only way to stop receiving the digest is the
-- unsubscribe link, which deletes every market_intel_watchlist row for
-- the user — losing their curated watchlist as collateral damage.
--
-- The cron in services/market_intel/digest.ts joins users to the
-- watchlist for the email column, so storing the pause expiry on the
-- users row keeps the SELECT a single join and lets the pause be
-- self-clearing once the timestamp passes.
--
-- ISO-8601 UTC. NULL = not paused. A sentinel far-future date
-- ('9999-12-31T00:00:00Z') represents "paused indefinitely" so the
-- cron's `<= now` predicate stays simple — the column type stays TEXT
-- and the UI translates the sentinel to a friendly label.
--
-- ALTER ADD COLUMN is NOT idempotent on D1's SQLite, so re-running
-- this file after apply will report duplicate-column. The schema
-- bootstrap helper (services/market_intel/schema.ts) catches that
-- and is the runtime safety net for partially migrated environments.
ALTER TABLE users ADD COLUMN mi_digest_paused_until TEXT;
CREATE INDEX IF NOT EXISTS idx_users_mi_digest_paused
  ON users(mi_digest_paused_until)
  WHERE mi_digest_paused_until IS NOT NULL;
