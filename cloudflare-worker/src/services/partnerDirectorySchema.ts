/**
 * Lazy schema-bootstrap helper for the Service Provider Directory
 * approval flags. Mirrors `ensureAdvisorWeekColumn()` /
 * `ensureMarketIntelSchema()` — the canonical migration is
 * `063_partner_directory_approval.sql`, but this helper guarantees the
 * columns exist on first request so the worker is self-healing on
 * fresh environments where the migration has not been applied yet.
 *
 * Cached per isolate so the PRAGMA round-trip only happens once.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export async function ensurePartnerDirectoryColumns(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(partners)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    const adds: string[] = [];
    if (!have.has('directory_listed')) {
      adds.push(`ALTER TABLE partners ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0`);
    }
    if (!have.has('directory_featured')) {
      adds.push(`ALTER TABLE partners ADD COLUMN directory_featured INTEGER NOT NULL DEFAULT 0`);
    }
    if (!have.has('directory_decided_at')) {
      adds.push(`ALTER TABLE partners ADD COLUMN directory_decided_at TEXT`);
    }
    if (!have.has('directory_decided_by')) {
      adds.push(`ALTER TABLE partners ADD COLUMN directory_decided_by INTEGER`);
    }
    for (const stmt of adds) {
      try { await env.DB.prepare(stmt).run(); }
      catch (e) { console.warn('[partnerDirectorySchema] ALTER failed (likely already applied)', e); }
    }
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_partners_directory_listed
           ON partners (directory_listed, directory_featured)`,
      ).run();
    } catch { /* idempotent */ }
    READY.set(key, true);
  } catch (e) {
    console.warn('[partnerDirectorySchema] bootstrap failed', e);
  }
}
