/**
 * Task #6 (AT-1) — Idempotent schema bootstrap for the MI extractor
 * pipeline. Mirrors `cloudflare-worker/sql/migrations/044_market_intel_extractors.sql`
 * so a dev D1 that hasn't had the migration applied still serves
 * `/api/market-intel/sentiment` and friends.
 *
 * The `users.mi_contribution_optout` column is intentionally added
 * via a try/catch ALTER so a re-run on a fully-migrated DB is a
 * no-op (D1's ALTER is not natively idempotent).
 */
import type { Env } from '../../types';

let _ready = false;

export async function ensureExtractorSchema(env: Env): Promise<void> {
  if (_ready) return;
  const stmts: Array<{ sql: string; ignoreDuplicateColumn?: boolean }> = [
    { sql:
      `CREATE TABLE IF NOT EXISTS market_intel_signals (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         extractor TEXT NOT NULL,
         user_id INTEGER NOT NULL,
         persona TEXT NOT NULL,
         advisor_answer_id INTEGER,
         question_id TEXT,
         sector TEXT,
         geo TEXT,
         period_key TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE(extractor, user_id, advisor_answer_id, content_hash)
       )` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_signals_extractor_period ON market_intel_signals(extractor, period_key)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_signals_user ON market_intel_signals(user_id)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_signals_sector_period ON market_intel_signals(sector, period_key)` },
    { sql:
      `CREATE TABLE IF NOT EXISTS market_intel_aggregates (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         extractor TEXT NOT NULL,
         dimension_key TEXT NOT NULL,
         period_key TEXT NOT NULL,
         n INTEGER NOT NULL,
         value REAL,
         payload_json TEXT,
         computed_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE(extractor, dimension_key, period_key)
       )` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_agg_extractor_period ON market_intel_aggregates(extractor, period_key)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_agg_dimension ON market_intel_aggregates(dimension_key)` },
    { sql:
      `CREATE TABLE IF NOT EXISTS market_intel_embeddings (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         persona TEXT NOT NULL,
         kind TEXT NOT NULL,
         source_question_id TEXT,
         vector BLOB NOT NULL,
         norm REAL NOT NULL,
         content_hash TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE(user_id, kind)
       )` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_emb_persona_kind ON market_intel_embeddings(persona, kind)` },
    { sql:
      `CREATE TABLE IF NOT EXISTS market_intel_snippets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         extractor TEXT NOT NULL,
         dimension_key TEXT NOT NULL,
         period_key TEXT NOT NULL,
         paraphrase TEXT NOT NULL,
         origin_redacted INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_mi_snippets_dim ON market_intel_snippets(extractor, dimension_key, period_key)` },
    { sql: `ALTER TABLE users ADD COLUMN mi_contribution_optout INTEGER NOT NULL DEFAULT 0`, ignoreDuplicateColumn: true },
    { sql: `CREATE INDEX IF NOT EXISTS idx_users_mi_optout ON users(mi_contribution_optout) WHERE mi_contribution_optout = 1` },
  ];
  for (const s of stmts) {
    try {
      await env.DB.exec(s.sql.replace(/\n\s+/g, ' '));
    } catch (e) {
      const msg = (e as Error).message || '';
      if (s.ignoreDuplicateColumn && /duplicate column/i.test(msg)) continue;
      console.warn('[mi.extractor_schema]', msg);
    }
  }
  _ready = true;
}
