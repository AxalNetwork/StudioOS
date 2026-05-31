/**
 * Task #4 — Lazy bootstrap for the brand-kit columns on landing_pages.
 *
 * Migration 079 is the canonical apply path, but recent migrations have
 * a habit of landing un-applied on prod, so both the brand route (writer)
 * and the Spin-Out deck builder (reader) self-heal by adding the columns
 * on the cold path. SQLite has no `ADD COLUMN IF NOT EXISTS`, so each
 * ALTER is wrapped in try/catch — a duplicate column (or a not-yet-created
 * table) throws and is swallowed.
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureLandingPageBrandKitColumns(env: Env): Promise<void> {
  if (_ready) return;
  const alters = [
    `ALTER TABLE landing_pages ADD COLUMN palette_bg TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN palette_ink TEXT`,
    `ALTER TABLE landing_pages ADD COLUMN font_pairing TEXT`,
  ];
  for (const s of alters) {
    try { await env.DB.prepare(s).run(); } catch { /* column exists / table absent */ }
  }
  _ready = true;
}
