-- Task #14 (AA-1) — Market Intelligence aggregator + connectors.
--
-- Two tables back the entire Market Intelligence pipeline:
--   market_intel_rows     — one row per (source, sector, ts) observation
--                           with a normalised metric_key + numeric value.
--                           Connectors write here on their own cadence.
--   market_intel_indexes  — composite per (sector, period_key, dimension)
--                           computed by the nightly aggregator from
--                           weighted + recency-decayed rows.
--
-- Re-runs are safe: every CREATE is `IF NOT EXISTS`. Aggregator does an
-- UPSERT on the (sector, period_key, dimension) UNIQUE so re-computing
-- the same period overwrites cleanly.

CREATE TABLE IF NOT EXISTS market_intel_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,            -- e.g. 'sec_edgar', 'github_trending'
  sector TEXT NOT NULL,                -- canonical sector slug
  geo TEXT,                            -- ISO country code or 'global'
  metric_key TEXT NOT NULL,            -- e.g. 'demand', 'capital', 'talent_jobs'
  metric_value REAL NOT NULL,          -- normalised 0..1 (or absolute when noted)
  raw_value REAL,                      -- pre-normalisation for debugging
  unit TEXT,                           -- 'index', 'usd', 'count', 'pct'
  ts TEXT NOT NULL,                    -- ISO timestamp of the observation
  citation_url TEXT,                   -- public URL for the citation rail
  payload_json TEXT,                   -- raw provider payload (truncated)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mi_rows_sector_ts ON market_intel_rows(sector, ts);
CREATE INDEX IF NOT EXISTS idx_mi_rows_source_ts ON market_intel_rows(source_key, ts);
CREATE INDEX IF NOT EXISTS idx_mi_rows_metric    ON market_intel_rows(metric_key, sector, ts);

CREATE TABLE IF NOT EXISTS market_intel_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  period_key TEXT NOT NULL,            -- e.g. '2026-05' (month) or '2026W19'
  -- One of: demand | supply | capital | talent | research | sentiment | composite
  dimension TEXT NOT NULL,
  value REAL NOT NULL,                 -- 0..100 composite
  delta_pct REAL,                      -- vs prior period
  source_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sector, geo, period_key, dimension)
);
CREATE INDEX IF NOT EXISTS idx_mi_idx_sector_period
  ON market_intel_indexes(sector, period_key);

-- Quota tracker per integration. One row per (source_key, day) so the
-- 429-degrade path can read a single SELECT and the nightly aggregator
-- can roll up usage. `cap` is informational; the connector enforces.
CREATE TABLE IF NOT EXISTS market_intel_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  day TEXT NOT NULL,                   -- YYYY-MM-DD
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  last_429_at TEXT,
  UNIQUE(source_key, day)
);

-- Per-investor / founder watchlist of sectors. Composite drives the
-- weekly digest (reuses services/notify.ts flushPendingDigests path).
CREATE TABLE IF NOT EXISTS market_intel_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  cadence TEXT NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'monthly'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, sector, geo)
);
CREATE INDEX IF NOT EXISTS idx_mi_watch_user ON market_intel_watchlist(user_id);
