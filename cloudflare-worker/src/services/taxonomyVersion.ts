/**
 * Task #19 — Taxonomy versioning.
 *
 * Single source of truth for the "active taxonomy version": a deterministic
 * string derived from row counts + the latest edit time of the skills and
 * values taxonomy tables. Any admin edit/(re)seed of skill_categories, skills,
 * or value_dimensions changes the string.
 *
 * Two consumers:
 *   1. The radar KV cache key (radar.ts) folds this in, so a taxonomy bump
 *      changes the key → cached radars miss → recompute. Invalidation is
 *      effectively immediate (next request), well within the ~60s target.
 *   2. User skill/value writes stamp the active version onto their rows
 *      (taxonomy_version column), so we can tell which taxonomy a user's
 *      profile was captured against.
 */
import type { Env } from '../types';
import { getSQL } from '../db';

export async function getTaxonomyVersion(env: Env): Promise<string> {
  const sql = getSQL(env);
  try {
    const [cat] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM skill_categories`;
    const [sk] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM skills WHERE is_active = 1`;
    let vd: any = { n: 0, mx: '0' };
    try {
      [vd] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM value_dimensions`;
    } catch { /* values taxonomy table may be absent in a cold environment */ }
    return [
      `c${cat?.n || 0}@${cat?.mx || '0'}`,
      `s${sk?.n || 0}@${sk?.mx || '0'}`,
      `v${vd?.n || 0}@${vd?.mx || '0'}`,
    ].join('|');
  } catch {
    return '0';
  }
}

let _columnsReady = false;
/** Idempotently add the taxonomy_version stamp column to the user write tables. */
export async function ensureTaxonomyVersionColumns(env: Env): Promise<void> {
  if (_columnsReady) return;
  for (const table of ['user_skills', 'user_values']) {
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN taxonomy_version TEXT`).run(); } catch { /* exists */ }
  }
  _columnsReady = true;
}
