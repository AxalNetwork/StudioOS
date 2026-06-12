/**
 * Task #10 — Lazy bootstrap for the Skills & Values Taxonomy.
 *
 * Mirrors ensureNetworkProfilesSchema() / ensureTeamMembersSchema():
 * migrations 089 (schema) + 090 (seed) are the canonical apply path, but
 * per replit.md/GOTCHAS several recent migrations have landed un-applied on
 * prod. A CREATE TABLE IF NOT EXISTS on the cold path keeps the downstream
 * skill-profile / radar / matching routes self-healing.
 *
 * This bootstrap creates the SHAPE only — it does NOT seed the 128 skills /
 * 15 value dimensions (that is the job of migration 090, applied via
 * wrangler so no hot path ever bulk-inserts). On a cold D1 the tables exist
 * but may be empty until the seed is applied; consumers that need the 8
 * radar axes regardless of seed state can read the RADAR_AXES constant
 * exported here.
 *
 * Cached per isolate (no re-execution on every hot request).
 */
import type { Env } from '../types';

let _ready = false;

/**
 * Canonical 8-axis radar set. Single source of truth for the radar/spider
 * graph and matching code. Keep in lockstep with the skill_categories rows
 * seeded by migration 090 — slugs are stable join keys; never rename one.
 * Each axis absorbs the listed legacy 12-axis SKILL_CATALOG labels (see
 * services/networkProfilesSchema.ts) so the old free-text catalog can be
 * reconciled onto these axes in a later task.
 */
export const RADAR_AXES = [
  { slug: 'product',          label: 'Product',            weight: 1.0, legacy: ['Product'] },
  { slug: 'engineering',      label: 'Engineering',        weight: 1.0, legacy: ['Engineering', 'Technical DD'] },
  { slug: 'design',           label: 'Design',             weight: 1.0, legacy: ['Design'] },
  { slug: 'gtm_sales',        label: 'GTM / Sales',        weight: 1.0, legacy: ['GTM', 'Sales'] },
  { slug: 'marketing_brand',  label: 'Marketing / Brand',  weight: 1.0, legacy: ['Marketing'] },
  { slug: 'finance_ops',      label: 'Finance / Ops',      weight: 1.0, legacy: ['Finance', 'Operations'] },
  { slug: 'legal_compliance', label: 'Legal / Compliance', weight: 1.0, legacy: ['Legal'] },
  { slug: 'capital_network',  label: 'Capital / Network',  weight: 1.0, legacy: ['Fundraising', 'Recruiting'] },
] as const;
export type RadarAxisSlug = typeof RADAR_AXES[number]['slug'];

/**
 * Canonical proficiency ladder for a skill. Array index 0..4 == rank 1..5.
 * Matches the skills.seniority_levels_json column default in migration 089.
 */
export const SENIORITY_LEVELS = [
  'aware', 'working', 'proficient', 'advanced', 'expert',
] as const;
export type SeniorityLevel = typeof SENIORITY_LEVELS[number];

/** Value-dimension families (value_dimensions.family). */
export const VALUE_FAMILIES = ['schwartz', 'founder'] as const;
export type ValueFamily = typeof VALUE_FAMILIES[number];

export async function ensureSkillsTaxonomySchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS skill_categories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        is_radar_axis INTEGER NOT NULL DEFAULT 0,
        radar_weight  REAL    NOT NULL DEFAULT 1.0,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skill_categories_radar
        ON skill_categories (is_radar_axis, display_order)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS skills (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        slug                  TEXT NOT NULL UNIQUE,
        category_slug         TEXT NOT NULL,
        label                 TEXT NOT NULL,
        description           TEXT,
        seniority_levels_json TEXT NOT NULL DEFAULT '["aware","working","proficient","advanced","expert"]',
        display_order         INTEGER NOT NULL DEFAULT 0,
        is_active             INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skills_category
        ON skills (category_slug, display_order)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skills_active
        ON skills (is_active)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS value_dimensions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        family        TEXT NOT NULL DEFAULT 'schwartz',
        is_bipolar    INTEGER NOT NULL DEFAULT 0,
        pole_low      TEXT,
        pole_high     TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_value_dimensions_family
        ON value_dimensions (family, display_order)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_values (
        user_id     INTEGER NOT NULL,
        dimension_id INTEGER NOT NULL,
        score       REAL NOT NULL,
        confidence  REAL NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, dimension_id)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_values_user
        ON user_values (user_id, updated_at)`),
    ]);
    _ready = true;
  } catch (err) {
     
    console.warn('[skillsTaxonomySchema] ensure failed', err);
  }
}
