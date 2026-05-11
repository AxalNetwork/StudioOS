-- Task #5 (AK) — Market Intelligence v2 schema verification.
--
-- This is an IDEMPOTENT consolidation that re-asserts every table the
-- Market Intelligence sub-tabs + investor-signals surfaces depend on.
-- The individual table-creation migrations (009, 030, 031, 032) shipped
-- earlier; this file exists so a fresh D1 (or a partially-applied env)
-- can `wrangler d1 execute … --file=037…` once and have every column +
-- index the routes touch present.
--
-- Every CREATE is `IF NOT EXISTS`. ALTER TABLE statements are split out
-- below and may report `duplicate column` on a fully-applied DB — that
-- is EXPECTED; D1 rolls back the file on the first failed statement
-- but the worker's lazy schema-bootstrap helpers
-- (services/market_intel/schema.ts and the ensureSchema() in
-- routes/investor_signals.ts) self-heal on next request.

-- ---- Aggregator observation rows ----------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  sector TEXT NOT NULL,
  geo TEXT,
  metric_key TEXT NOT NULL,
  metric_value REAL NOT NULL,
  raw_value REAL,
  unit TEXT,
  ts TEXT NOT NULL,
  citation_url TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mi_rows_sector_ts ON market_intel_rows(sector, ts);
CREATE INDEX IF NOT EXISTS idx_mi_rows_source_ts ON market_intel_rows(source_key, ts);
CREATE INDEX IF NOT EXISTS idx_mi_rows_metric    ON market_intel_rows(metric_key, sector, ts);

-- ---- Composite per-(sector, geo, period, dimension) ---------------------
CREATE TABLE IF NOT EXISTS market_intel_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  period_key TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value REAL NOT NULL,
  delta_pct REAL,
  source_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sector, geo, period_key, dimension)
);
CREATE INDEX IF NOT EXISTS idx_mi_idx_sector_period
  ON market_intel_indexes(sector, period_key);

-- ---- Per-source quota tracking ------------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  last_429_at TEXT,
  UNIQUE(source_key, day)
);

-- ---- Per-user sector watchlist ------------------------------------------
CREATE TABLE IF NOT EXISTS market_intel_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  cadence TEXT NOT NULL DEFAULT 'weekly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, sector, geo)
);
CREATE INDEX IF NOT EXISTS idx_mi_watch_user ON market_intel_watchlist(user_id);

-- ---- Investor profiles + signal snapshots (k-anonymity ≥ 5) -------------
-- IMPORTANT: every CREATE in this file lives ABOVE the ALTER statements
-- below. D1 aborts a SQL file on the first failed statement, and the
-- ALTERs are not natively idempotent — putting CREATEs first guarantees
-- a re-run on a fully-migrated DB still creates any missing table before
-- the file aborts on a duplicate-column ALTER.
CREATE TABLE IF NOT EXISTS investor_profiles (
  user_id INTEGER PRIMARY KEY,
  investor_type TEXT,
  sectors_json TEXT NOT NULL DEFAULT '[]',
  stages_json TEXT NOT NULL DEFAULT '[]',
  geos_json TEXT NOT NULL DEFAULT '[]',
  ticket_band TEXT,
  ticket_min_usd INTEGER,
  ticket_max_usd INTEGER,
  thesis_text TEXT,
  thesis_keywords_json TEXT NOT NULL DEFAULT '[]',
  contribute_to_signals INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_investor_profiles_contribute
  ON investor_profiles(contribute_to_signals);

CREATE TABLE IF NOT EXISTS investor_signals_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  n_total INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investor_signals_snapshots_computed_at
  ON investor_signals_snapshots(computed_at DESC);

-- ---- ALTERs (run last; first duplicate-column will abort the rest) ------
-- Digest bookkeeping (originally added in 031). On an already-migrated DB
-- the first ALTER below will fail with `duplicate column name`, which
-- aborts the remainder of THIS file — that's why every CREATE above is
-- ordered first. The lazy schema bootstrap in
-- services/market_intel/schema.ts also adds these columns on demand so
-- workers serving a stale D1 self-heal at request time.
ALTER TABLE market_intel_watchlist ADD COLUMN last_sent_at TEXT;
ALTER TABLE market_intel_watchlist ADD COLUMN last_period_key TEXT;
ALTER TABLE market_intel_watchlist ADD COLUMN last_composite REAL;
CREATE INDEX IF NOT EXISTS idx_mi_watch_cadence_sent
  ON market_intel_watchlist(cadence, last_sent_at);
