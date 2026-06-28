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

let _ready = false;

export async function ensureCapTableVariantColumn(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.prepare(
      'ALTER TABLE cap_table_scenarios ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0',
    ).run();
  } catch {
    /* column already exists, or the table isn't created yet — both safe to ignore */
  }
  _ready = true;
}
