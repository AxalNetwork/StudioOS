/**
 * Task #14 (AA-1) — Idempotent Market Intelligence schema bootstrap.
 *
 * Mirrors `cloudflare-worker/sql/migrations/030_market_intel.sql`. Called
 * lazily by routes/market_intel.ts so a dev D1 that hasn't had the
 * migration applied still boots cleanly. Production runs the full SQL
 * file via `wrangler d1 execute --remote` (see CHANGELOG).
 */
import type { Env } from '../../types';

let _ready = false;

export async function ensureMarketIntelSchema(env: Env): Promise<void> {
  if (_ready) return;
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
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
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
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) {
        // Surface real failures in dev but don't block requests.
        console.warn('[mi schema]', msg);
      }
    }
  }
  _ready = true;
}
