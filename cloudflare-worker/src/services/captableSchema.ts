/**
 * Task #29 — Lazy bootstrap for cap_table_scenarios.is_variant.
 *
 * Migration 118 is the canonical apply path, but migrations have a habit of
 * landing un-applied on prod, so every reader/writer that filters on
 * is_variant self-heals by adding the column on the cold path. SQLite/D1 has
 * no `ADD COLUMN IF NOT EXISTS`, so the ALTER is wrapped in try/catch — a
 * duplicate column (or a not-yet-created table) throws and is swallowed.
 *
 * is_variant = 0 → the project's canonical cap table (the ONLY row the Demo
 * Day deck Slide 08 and the one-per-project upsert / by-project lookups read).
 * is_variant = 1 → a named draft variant shown only in the compare view.
 */
import type { Env } from '../types';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

/** #5343: what a genuinely failed bootstrap throws (no table, no room); never remembered as ready. */
export const CAPTABLE_SCHEMA_NOT_READY = 'captable_schema_not_ready';

/**
 * #5343 (#4568 R2-04): asked first (`runSchemaBootstrap`), so an up-to-date
 * database issues no ALTER. Before, the ALTER ran blind and every error was
 * swallowed, a missing table included, and the binding was marked ready.
 */
export async function ensureCapTableVariantColumn(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  try {
    await runSchemaBootstrap(env, ['ALTER TABLE cap_table_scenarios ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0']);
  } catch {
    console.error('[captable] schema_not_ready');
    throw new Error(CAPTABLE_SCHEMA_NOT_READY);
  }
  READY.set(bindingKey(env), true);
}
