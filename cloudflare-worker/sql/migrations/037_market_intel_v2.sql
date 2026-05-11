-- Task #5 (AK) — Market Intelligence v2 schema verification.
--
-- FULLY IDEMPOTENT consolidation that re-asserts every table the Market
-- Intelligence sub-tabs + investor-signals surfaces depend on. Every
-- statement is `CREATE … IF NOT EXISTS` so a re-run on a fully-migrated
-- DB is a complete no-op (no aborted files, no duplicate-column errors).
--
-- Additive columns added by 031 (`market_intel_watchlist.last_sent_at`
-- + friends) and 032 (`users.mi_digest_paused_until`) are intentionally
-- NOT re-asserted here — `ALTER TABLE … ADD COLUMN` is not natively
-- idempotent in D1 and would abort the file. They are bootstrapped at
-- request time by `services/market_intel/schema.ts`
-- (`ensureMarketIntelSchema`, called by the `/api/market-intel/*`
-- middleware), which wraps each ALTER in a try/catch that swallows
-- `duplicate column`. That helper is the single source of truth for
-- those columns.

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

-- NOTE: digest-bookkeeping columns (`last_sent_at`, `last_period_key`,
-- `last_composite`) and the `idx_mi_watch_cadence_sent` index are
-- bootstrapped by `services/market_intel/schema.ts` at request time —
-- see header comment for rationale (D1 ALTERs are not idempotent).
