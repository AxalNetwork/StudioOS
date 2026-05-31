/**
 * Task #1 — Lazy bootstrap for network_profiles.
 *
 * Mirrors ensureTeamMembersSchema(): migration 075 is the canonical
 * apply path, but several recent migrations have landed un-applied
 * on prod. CREATE TABLE IF NOT EXISTS on the cold path keeps the
 * admin + deck routes self-healing.
 *
 * Also exports the canonical 12-axis SKILL_CATALOG that drives both
 * the admin profile editor (multi-select) and the SkillsSpider radar
 * on the Spin-Out deck's Mentors & Network slide.
 */
import type { Env } from '../types';

let _ready = false;

export const NETWORK_KINDS = ['mentor', 'partner', 'advisor', 'investor'] as const;
export type NetworkKind = typeof NETWORK_KINDS[number];

// Single source of truth for the 12-axis spider/skill picker. Keep in
// sync with the front-end mirror in
// frontend/src/pages/admin/AdminNetworkProfiles.jsx if you change it.
export const SKILL_CATALOG = [
  'Legal',
  'Finance',
  'GTM',
  'Sales',
  'Marketing',
  'Product',
  'Engineering',
  'Design',
  'Recruiting',
  'Technical DD',
  'Operations',
  'Fundraising',
] as const;
export type SkillAxis = typeof SKILL_CATALOG[number];

export async function ensureNetworkProfilesSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS network_profiles (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        kind           TEXT NOT NULL DEFAULT 'mentor',
        role           TEXT,
        company        TEXT,
        bio            TEXT,
        linkedin_url   TEXT,
        photo_r2_key   TEXT,
        skills_json    TEXT NOT NULL DEFAULT '[]',
        display_order  INTEGER NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_network_profiles_active_order
        ON network_profiles (is_active, display_order)`),
    ]);
    // Task #1 — additive company column for tables created before the
    // roster gained an affiliation field (migration 077). Idempotent:
    // duplicate-column errors on re-run are swallowed.
    try { await env.DB.exec(`ALTER TABLE network_profiles ADD COLUMN company TEXT`); }
    catch (_e) { /* column already exists */ }
    _ready = true;
  } catch (err) {
     
    console.warn('[networkProfilesSchema] ensure failed', err);
  }
}
