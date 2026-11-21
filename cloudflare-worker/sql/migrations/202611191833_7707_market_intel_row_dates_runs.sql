-- D7707 (#7707) — what a stored market-intelligence statistic measures, and
-- what each source run did.
--
-- Until D7707 a row's `ts` was the only date it carried, and both builders in
-- services/market_intel/sources/_live.ts wrote the fetch time there: a World
-- Bank figure for 2025 fetched today read as an observation made today. The
-- six columns below say which period a row measures, when the provider last
-- updated it, when it was fetched, which area a macro figure covers, and
-- whether the row is a per-sector signal or macro context.
--
-- Additive only, and no backfill. A row written before D7707 keeps these
-- null, meaning "not recorded"; its retrieval time is its `ts`
-- (`retrievedAtSql()` in services/market_intel/liveRows.ts reads
-- COALESCE(retrieved_at, ts)). `ts`, `metric_key`, `metric_value` and `geo`
-- keep the values they had, so no index value changes.
--
-- Period format (D7707): `YYYY`, `YYYY-Qn`, `YYYY-MM`, or
-- `YYYY-MM-DD/YYYY-MM-DD` for a queried window; `observed_period_end` is the
-- last day measured (`YYYY-MM-DD`). A response whose period cannot be read
-- stores null, never a guess. `published_at` is the provider's own
-- last-updated date and never the fetch time.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration
-- ledger stops the replay. services/market_intel/schema.ts declares the same
-- columns for a development database and adds them through
-- runSchemaBootstrap, which asks the table first.
ALTER TABLE market_intel_rows ADD COLUMN observed_period TEXT;
ALTER TABLE market_intel_rows ADD COLUMN observed_period_end TEXT;
ALTER TABLE market_intel_rows ADD COLUMN published_at TEXT;
ALTER TABLE market_intel_rows ADD COLUMN retrieved_at TEXT;
ALTER TABLE market_intel_rows ADD COLUMN coverage_area TEXT;
ALTER TABLE market_intel_rows ADD COLUMN scope TEXT CHECK (scope IS NULL OR scope IN ('sector', 'context'));

-- One row for each run of a source whose MI_FLAG_<KEY> is `live`; a source
-- that is off writes none. `error_class` is one of a fixed list and never
-- provider text or a request URL. `rows_unchanged` stays null until #7711
-- stores an unchanged observation once.
CREATE TABLE IF NOT EXISTS market_intel_source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('fetched', 'failed', 'out_of_quota', 'nothing_to_cite', 'no_live_client')),
  reason TEXT,
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_unchanged INTEGER,
  error_class TEXT CHECK (
    error_class IS NULL
    OR error_class IN ('timeout', 'unreadable_response', 'empty', 'other')
    OR error_class GLOB 'http_[1-5][0-9][0-9]'
  )
);
CREATE INDEX IF NOT EXISTS idx_mi_source_runs_source_started ON market_intel_source_runs(source_key, started_at);
