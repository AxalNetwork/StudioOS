-- Task #4 — Investor Signals + profiling chatbot
-- Two new tables:
--   * investor_profiles            — per-user input from the profiling chatbot
--   * investor_signals_snapshots   — anonymized k-anonymity ≥ 5 aggregates,
--                                     written every 6h by the cron in index.ts

CREATE TABLE IF NOT EXISTS investor_profiles (
  user_id              INTEGER PRIMARY KEY,
  investor_type        TEXT,
  sectors_json         TEXT NOT NULL DEFAULT '[]',
  stages_json          TEXT NOT NULL DEFAULT '[]',
  geos_json            TEXT NOT NULL DEFAULT '[]',
  ticket_band          TEXT,
  ticket_min_usd       INTEGER,
  ticket_max_usd       INTEGER,
  thesis_text          TEXT,
  thesis_keywords_json TEXT NOT NULL DEFAULT '[]',
  contribute_to_signals INTEGER NOT NULL DEFAULT 1,
  completed_at         TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_investor_profiles_contribute
  ON investor_profiles(contribute_to_signals);

CREATE TABLE IF NOT EXISTS investor_signals_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  computed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  period_start  TIMESTAMP,
  period_end    TIMESTAMP,
  n_total       INTEGER NOT NULL DEFAULT 0,
  payload_json  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_investor_signals_snapshots_computed_at
  ON investor_signals_snapshots(computed_at DESC);
