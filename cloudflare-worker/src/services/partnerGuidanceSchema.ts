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

export async function ensurePartnerGuidanceColumns(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(partners)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    for (const [col, ddl] of GUIDANCE_COLUMNS) {
      if (have.has(col)) continue;
      try { await env.DB.prepare(`ALTER TABLE partners ADD COLUMN ${col} ${ddl}`).run(); }
      catch (e) { console.warn('[partnerGuidanceSchema] ALTER failed (likely already applied)', e); }
    }
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_partners_oh_guidance ON partners (oh_guidance_updated_at)`,
      ).run();
    } catch { /* idempotent */ }
    READY.set(key, true);
  } catch (e) {
    console.warn('[partnerGuidanceSchema] bootstrap failed', e);
  }
}
