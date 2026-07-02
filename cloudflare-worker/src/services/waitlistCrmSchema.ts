/**
 * Task #5 — Lazy schema-bootstrap for the waitlist CRM columns on
 * waitlist_signups. Mirrors `ensureDiscoveryInterviewFeaturedColumn()`:
 * the canonical migration is `121_waitlist_crm.sql`, but this helper
 * guarantees the columns exist on first request so the worker is
 * self-healing on environments where the migration has not landed yet
 * (recent migrations have a habit of arriving un-applied on prod).
 *
 * Cached per isolate so the PRAGMA round-trip only happens once.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export async function ensureWaitlistCrmColumns(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(waitlist_signups)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    const adds: Array<[string, string]> = [
      ['crm_status', `ALTER TABLE waitlist_signups ADD COLUMN crm_status TEXT DEFAULT 'new'`],
      ['invited_at', `ALTER TABLE waitlist_signups ADD COLUMN invited_at TEXT`],
      ['followed_up_at', `ALTER TABLE waitlist_signups ADD COLUMN followed_up_at TEXT`],
      ['promoted_at', `ALTER TABLE waitlist_signups ADD COLUMN promoted_at TEXT`],
      ['promoted_interview_id', `ALTER TABLE waitlist_signups ADD COLUMN promoted_interview_id INTEGER`],
    ];
    for (const [col, sql] of adds) {
      if (have.has(col)) continue;
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
        console.warn(`[waitlistCrmSchema] ALTER ${col} failed (likely already applied)`, e);
      }
    }
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_waitlist_crm ON waitlist_signups(project_id, crm_status)`,
      ).run();
    } catch { /* idempotent */ }
    READY.set(key, true);
  } catch (e) {
    console.warn('[waitlistCrmSchema] bootstrap failed', e);
  }
}
