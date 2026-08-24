/**
 * Lazy schema-bootstrap for the fund GP-of-record, service-provider and slug
 * columns, plus the fund_report_periods table.
 *
 * Canonical migration: 163_fund_gp_of_record.sql. This helper guarantees the
 * shape exists on first request so the worker is self-healing on an environment
 * where the migration has not been applied yet. Same pattern (and same caching
 * rules) as services/partnerGuidanceSchema.ts.
 *
 * Cached per isolate ONLY on success: a failed ALTER must not be remembered as
 * "ready", or every later request in that isolate skips the PRAGMA and the
 * query dies with a raw `no such column: …` that mapError would echo to the
 * client as a 400.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export const FUND_GP_COLUMNS: Array<[string, string]> = [
  ['gp_user_id', 'INTEGER'],
  ['gp_name', 'TEXT'],
  ['gp_title', 'TEXT'],
  ['gp_email', 'TEXT'],
  ['gp_entity', 'TEXT'],
  ['fund_admin', 'TEXT'],
  ['auditor', 'TEXT'],
  ['legal_counsel', 'TEXT'],
  ['custodian', 'TEXT'],
  ['valuation_policy', 'TEXT'],
  ['slug', 'TEXT'],
];

// `REFERENCES users(id)` is deliberately dropped from the bootstrap DDL above:
// SQLite cannot add a column with a foreign-key clause to an existing table
// unless it is nullable with a NULL default, and the constraint buys nothing
// here that the migration does not already establish on a fresh database.

const REPORT_PERIODS_DDL = `
CREATE TABLE IF NOT EXISTS fund_report_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    issued_at TEXT,
    issued_by INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    snapshot_json TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

async function columnsPresent(env: Env): Promise<boolean> {
  const info = await env.DB.prepare(`PRAGMA table_info(vc_funds)`).all<{ name: string }>();
  const have = new Set((info.results || []).map((r) => r.name));
  return FUND_GP_COLUMNS.every(([col]) => have.has(col));
}

export async function ensureFundGpColumns(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return true;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(vc_funds)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    let altered = false;
    for (const [col, ddl] of FUND_GP_COLUMNS) {
      if (have.has(col)) continue;
      altered = true;
      // The column is KNOWN absent here, so a failure is a real bootstrap
      // failure — not "already applied". It is still swallowed so one bad
      // column cannot abort the others; readiness is re-verified below.
      try { await env.DB.prepare(`ALTER TABLE vc_funds ADD COLUMN ${col} ${ddl}`).run(); }
      catch (e) { console.warn('[fundGpSchema] ALTER failed for column', col, e); }
    }
    try {
      await env.DB.prepare(REPORT_PERIODS_DDL).run();
      await env.DB.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_report_periods_fund_period
           ON fund_report_periods(fund_id, period)`
      ).run();
    } catch (e) { console.warn('[fundGpSchema] fund_report_periods bootstrap failed', e); }
    // The slug index is unique-partial; a duplicate slug already in the table
    // would make this fail, which must not block the columns above.
    try {
      await env.DB.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_funds_slug ON vc_funds(slug) WHERE slug IS NOT NULL`
      ).run();
    } catch (e) { console.warn('[fundGpSchema] slug index not created', e); }

    const ok = altered ? await columnsPresent(env) : true;
    if (ok) READY.set(key, true);
    else console.warn('[fundGpSchema] columns still missing after bootstrap');
    return ok;
  } catch (e) {
    console.warn('[fundGpSchema] bootstrap failed', e);
    return false;
  }
}
