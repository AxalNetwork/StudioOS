/**
 * Task #5 — Lazy schema-bootstrap for the waitlist CRM columns on
 * waitlist_signups. Mirrors `ensureDiscoveryInterviewFeaturedColumn()`:
 * the canonical migration is `121_waitlist_crm.sql`, but this helper
 * guarantees the columns exist on first request so the worker is
 * self-healing on environments where the migration has not landed yet
 * (recent migrations have a habit of arriving un-applied on prod).
 *
 * Cached per binding so the column read only happens once.
 */
import type { Env } from '../types';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

export async function ensureWaitlistCrmColumns(env: Env): Promise<void> {
  const key = bindingKey(env);
  if (READY.get(key)) return;
  try {
    // #5343 (#4568 R2-04): through `runSchemaBootstrap`, which reads the columns
    // once per binding and skips an ALTER whose column is there. A failed ALTER
    // used to be logged as "likely already applied" and the binding marked
    // ready; it now reaches the catch below and the next call tries again.
    await runSchemaBootstrap(env, [
      `ALTER TABLE waitlist_signups ADD COLUMN crm_status TEXT DEFAULT 'new'`,
      `ALTER TABLE waitlist_signups ADD COLUMN invited_at TEXT`,
      `ALTER TABLE waitlist_signups ADD COLUMN followed_up_at TEXT`,
      `ALTER TABLE waitlist_signups ADD COLUMN promoted_at TEXT`,
      `ALTER TABLE waitlist_signups ADD COLUMN promoted_interview_id INTEGER`,
    ]);
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
