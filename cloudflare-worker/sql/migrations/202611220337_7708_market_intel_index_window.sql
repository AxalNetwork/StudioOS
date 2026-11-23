-- D7708 (#7708) — the window each market-intelligence index point covers, and
-- the source mix it used, stored beside the point.
--
-- A point in market_intel_indexes is keyed by month but holds the score over
-- the 30 days before its last recompute (WINDOW_DAYS). Until D7708 nothing said
-- which 30 days, and the source mix pages showed was recomputed on the read as
-- row share by calendar month, beside a score over a rolling window.
--
-- window_start / window_end: the ISO instants the score covers.
-- source_mix_json: what the score used, written at compute time and read back
--   as it is, never recomputed: { window_start, window_end, context_only,
--   entries: [{ source_key, share, observations, scope, coverage_area,
--   period_from, period_to }] }. The shares of one point sum to 1.
--
-- Expand only, nullable, no backfill. A point written before D7708 keeps these
-- null and reads "window not recorded", never a derived date; its composite
-- source_count is a row count that no surface prints as a provider count.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration
-- ledger stops the replay. services/market_intel/schema.ts declares the same
-- columns for a development database through runSchemaBootstrap.
ALTER TABLE market_intel_indexes ADD COLUMN window_start TEXT;
ALTER TABLE market_intel_indexes ADD COLUMN window_end TEXT;
ALTER TABLE market_intel_indexes ADD COLUMN source_mix_json TEXT;
