/**
 * Task #14 (AA-1) — Idempotent Market Intelligence schema bootstrap.
 *
 * Mirrors `cloudflare-worker/sql/migrations/030_market_intel.sql`. Called
 * lazily by routes/market_intel.ts so a dev D1 that hasn't had the
 * migration applied still boots cleanly. Production runs the full SQL
 * file via `wrangler d1 execute --remote` (see CHANGELOG).
 *
 * D7707 — `market_intel_rows` declares the six columns of migration
 * `202611191833_7707_market_intel_row_dates_runs.sql`, and
 * `market_intel_source_runs` is declared here as there. Every statement runs
 * through `runSchemaBootstrap`, which reads the table's columns first and
 * issues no `ADD COLUMN` for one that is already there.
 */
import type { Env } from '../../types';
import { bindingKey, runSchemaBootstrap } from '../../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

export async function ensureMarketIntelSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS market_intel_rows (
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
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       observed_period TEXT,
       observed_period_end TEXT,
       published_at TEXT,
       retrieved_at TEXT,
       coverage_area TEXT,
       scope TEXT CHECK (scope IS NULL OR scope IN ('sector', 'context'))
     )`,
    // D7707 — a development table created before the columns existed.
    `ALTER TABLE market_intel_rows ADD COLUMN observed_period TEXT`,
    `ALTER TABLE market_intel_rows ADD COLUMN observed_period_end TEXT`,
    `ALTER TABLE market_intel_rows ADD COLUMN published_at TEXT`,
    `ALTER TABLE market_intel_rows ADD COLUMN retrieved_at TEXT`,
    `ALTER TABLE market_intel_rows ADD COLUMN coverage_area TEXT`,
    `ALTER TABLE market_intel_rows ADD COLUMN scope TEXT CHECK (scope IS NULL OR scope IN ('sector', 'context'))`,
    `CREATE INDEX IF NOT EXISTS idx_mi_rows_sector_ts ON market_intel_rows(sector, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_mi_rows_source_ts ON market_intel_rows(source_key, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_mi_rows_metric    ON market_intel_rows(metric_key, sector, ts)`,
    `CREATE TABLE IF NOT EXISTS market_intel_indexes (
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
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mi_idx_sector_period ON market_intel_indexes(sector, period_key)`,
    // D538 / migration 379 — 'live' on index rows computed from live rows
    // only. runSchemaBootstrap skips it when the column is there.
    `ALTER TABLE market_intel_indexes ADD COLUMN basis TEXT`,
    `CREATE TABLE IF NOT EXISTS market_intel_quota (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       source_key TEXT NOT NULL,
       day TEXT NOT NULL,
       calls INTEGER NOT NULL DEFAULT 0,
       errors INTEGER NOT NULL DEFAULT 0,
       cap INTEGER NOT NULL DEFAULT 1000,
       last_429_at TEXT,
       UNIQUE(source_key, day)
     )`,
    // D7707 — one row per run of a source flagged live.
    `CREATE TABLE IF NOT EXISTS market_intel_source_runs (
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
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mi_source_runs_source_started ON market_intel_source_runs(source_key, started_at)`,
    `CREATE TABLE IF NOT EXISTS market_intel_watchlist (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       sector TEXT NOT NULL,
       geo TEXT NOT NULL DEFAULT 'global',
       cadence TEXT NOT NULL DEFAULT 'weekly',
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(user_id, sector, geo)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mi_watch_user ON market_intel_watchlist(user_id)`,
    // Task #30 — digest bookkeeping. runSchemaBootstrap skips a column
    // that is already there.
    `ALTER TABLE market_intel_watchlist ADD COLUMN last_sent_at TEXT`,
    `ALTER TABLE market_intel_watchlist ADD COLUMN last_period_key TEXT`,
    `ALTER TABLE market_intel_watchlist ADD COLUMN last_composite REAL`,
    `CREATE INDEX IF NOT EXISTS idx_mi_watch_cadence_sent ON market_intel_watchlist(cadence, last_sent_at)`,
    // Task #32 — per-user pause for digest sends. NULL = not paused.
    // Sentinel '9999-12-31T00:00:00Z' = paused indefinitely. runSchemaBootstrap
    // asks the table first, so a column already there is no ALTER.
    `ALTER TABLE users ADD COLUMN mi_digest_paused_until TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_users_mi_digest_paused
       ON users(mi_digest_paused_until)
       WHERE mi_digest_paused_until IS NOT NULL`,
  ];
  // One statement at a time, so a failure is warned and the rest still run,
  // as before D7707; each ADD COLUMN now asks the table first.
  for (const s of stmts) {
    try { await runSchemaBootstrap(env, [s]); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) {
        // Surface real failures in dev but don't block requests.
        console.warn('[mi schema]', msg);
      }
    }
  }
  READY.set(bindingKey(env), true);
}
