-- Task #30 — Weekly digest for sectors users are watching.
--
-- Adds bookkeeping columns to market_intel_watchlist so the cron-driven
-- digest can:
--   * track when each row was last sent (avoid double-sends within a
--     cadence window)
--   * surface "new since last send" citations
--
-- Idempotent: ALTER TABLE on SQLite/D1 fails with "duplicate column"
-- when re-run; the worker's lazy ensureMarketIntelSchema() catches that
-- so a partial apply is harmless.

ALTER TABLE market_intel_watchlist ADD COLUMN last_sent_at TEXT;
ALTER TABLE market_intel_watchlist ADD COLUMN last_period_key TEXT;
-- Snapshot of composite at the moment of the last send, used so the
-- next digest can report a true prior-period delta even when the
-- cadence (weekly) is finer-grained than the index period (monthly).
ALTER TABLE market_intel_watchlist ADD COLUMN last_composite REAL;

CREATE INDEX IF NOT EXISTS idx_mi_watch_cadence_sent
  ON market_intel_watchlist(cadence, last_sent_at);
