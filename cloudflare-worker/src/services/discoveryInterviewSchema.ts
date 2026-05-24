/**
 * Lazy schema-bootstrap helper for the discovery_interviews.featured
 * column (Task #18). Mirrors `ensurePartnerDirectoryColumns()` /
 * `ensureAdvisorWeekColumn()` — the canonical migration is
 * `072_discovery_interview_featured.sql`, but this helper guarantees the
 * column exists on first request so the worker is self-healing on
 * environments where the migration has not been applied yet.
 *
 * Cached per isolate so the PRAGMA round-trip only happens once.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export async function ensureDiscoveryInterviewFeaturedColumn(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    if (!have.has('featured')) {
      try {
        await env.DB.prepare(
          `ALTER TABLE discovery_interviews ADD COLUMN featured INTEGER NOT NULL DEFAULT 0`,
        ).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] ALTER failed (likely already applied)', e);
      }
    }
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project_featured
           ON discovery_interviews (project_id, featured)`,
      ).run();
    } catch { /* idempotent */ }
    READY.set(key, true);
  } catch (e) {
    console.warn('[discoveryInterviewSchema] bootstrap failed', e);
  }
}
