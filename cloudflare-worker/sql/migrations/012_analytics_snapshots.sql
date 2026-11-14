-- Task #13 — daily analytics snapshot table.
--
-- Why: Overview/Financial sub-tabs of /admin/monitoring derive every metric
-- on-the-fly from `users`, `activity_logs`, and `system_metrics`. That works
-- for the rolling 30-day window but historical comparisons get slower as
-- data grows, and worse, system_metrics rows are routinely pruned by the
-- nightly cleanup job — meaning anything older than ~7 days disappears.
--
-- This table preserves a per-day rollup of the daily Overview + Financial
-- numbers (USD baseline; per-currency conversion happens at read time off
-- the FX cache) so admins always see a stable historical series.
--
-- The writer is the worker `scheduled()` handler (runs every minute, but
-- gates the snapshot insert on UTC 02:05 so it fires once per day after
-- the per-day rollup window closes). INSERT OR REPLACE on the unique key
-- keeps re-runs idempotent.

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,            -- YYYY-MM-DD (the day being summarised)
  -- Overview metrics
  active_users INTEGER NOT NULL DEFAULT 0,
  new_signups INTEGER NOT NULL DEFAULT 0,
  total_users INTEGER NOT NULL DEFAULT 0,
  paid_users INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms INTEGER NOT NULL DEFAULT 0,
  p95_latency_ms INTEGER NOT NULL DEFAULT 0,
  -- Financial (USD baseline; converted at read time off the FX cache)
  mrr_usd REAL NOT NULL DEFAULT 0,
  arr_usd REAL NOT NULL DEFAULT 0,
  new_mrr_usd REAL NOT NULL DEFAULT 0,
  churn_mrr_usd REAL NOT NULL DEFAULT 0,
  churned_subscriptions INTEGER NOT NULL DEFAULT 0,
  -- Bookkeeping
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'cron',    -- 'cron' | 'backfill' | 'manual'
  UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_date
  ON analytics_snapshots(snapshot_date DESC);
