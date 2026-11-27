/**
 * Lazy schema-bootstrap helper for the Service Provider Directory
 * approval flags. Mirrors `ensureAdvisorWeekColumn()` /
 * `ensureMarketIntelSchema()` — the canonical migration is
 * `063_partner_directory_approval.sql`, but this helper guarantees the
 * columns exist on first request so the worker is self-healing on
 * fresh environments where the migration has not been applied yet.
 *
 * Cached per binding so the column read only happens once.
 */
import type { Env } from '../types';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

export async function ensurePartnerDirectoryColumns(env: Env): Promise<void> {
  const key = bindingKey(env);
  if (READY.get(key)) return;
  try {
    // #5343 (#4568 R2-04): through `runSchemaBootstrap`, which reads the columns
    // once per binding and skips an ALTER whose column is there. A failed ALTER
    // used to be logged as "likely already applied" and the binding marked
    // ready; it now reaches the catch below and the next call tries again.
    await runSchemaBootstrap(env, [
      `ALTER TABLE partners ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE partners ADD COLUMN directory_featured INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE partners ADD COLUMN directory_decided_at TEXT`,
      `ALTER TABLE partners ADD COLUMN directory_decided_by INTEGER`,
    ]);
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
