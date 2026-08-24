/**
 * Lazy schema-bootstrap for partner office-hours booking guidance.
 * Canonical migration: 160_partner_office_hours_guidance.sql. This helper
 * guarantees the columns exist on first request so the worker is
 * self-healing on environments where the migration has not been applied.
 * Cached per isolate so the PRAGMA round-trip happens once.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export const GUIDANCE_COLUMNS: Array<[string, string]> = [
  ['oh_when_to_book', 'TEXT'],
  ['oh_stage_fit', 'TEXT'],
  ['oh_session_outcome', 'TEXT'],
  ['oh_bring_json', `TEXT DEFAULT '[]'`],
  ['oh_guidance_updated_at', 'TEXT'],
];

async function guidanceColumnsPresent(env: Env): Promise<boolean> {
  const info = await env.DB.prepare(`PRAGMA table_info(partners)`).all<{ name: string }>();
  const have = new Set((info.results || []).map((r) => r.name));
  return GUIDANCE_COLUMNS.every(([col]) => have.has(col));
}

/**
 * Returns true when all guidance columns are present (either already, or after
 * this call added them). The result is cached per isolate ONLY on success: a
 * failed ALTER must not be remembered as "ready", otherwise every later request
 * in that isolate skips the PRAGMA and the guidance query dies with a raw
 * `no such column: …` that mapError would echo to the client as a 400.
 */
export async function ensurePartnerGuidanceColumns(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return true;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(partners)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    let altered = false;
    for (const [col, ddl] of GUIDANCE_COLUMNS) {
      if (have.has(col)) continue;
      altered = true;
      // The column is KNOWN absent here, so a failure is a real bootstrap
      // failure — not "already applied". It is still swallowed so one bad
      // column cannot abort the others, but readiness is re-verified below.
      try { await env.DB.prepare(`ALTER TABLE partners ADD COLUMN ${col} ${ddl}`).run(); }
      // Column name passed as an argument, not interpolated into the format
      // string — matches the house logging style and keeps the log line a
      // constant, so no value can ever be read as a format specifier.
      catch (e) { console.warn('[partnerGuidanceSchema] ALTER failed for column', col, e); }
    }
    // No index is created: nothing filters/joins/sorts on these columns.
    // Re-read the table shape when we actually changed something; cache only
    // when every column is really there.
    const ok = altered ? await guidanceColumnsPresent(env) : true;
    if (ok) READY.set(key, true);
    else console.warn('[partnerGuidanceSchema] columns still missing after bootstrap');
    return ok;
  } catch (e) {
    console.warn('[partnerGuidanceSchema] bootstrap failed', e);
    return false;
  }
}
