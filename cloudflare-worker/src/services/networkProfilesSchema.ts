/**
 * Task #1 — Lazy bootstrap for network_profiles.
 *
 * Mirrors ensureTeamMembersSchema(): migration 075 is the canonical
 * production apply path; development and preview retain the lazy fallback.
 *
 * Also exports the canonical 12-axis SKILL_CATALOG that drives the admin
 * profile editor (multi-select) and the deck's skill-coverage figures
 * (`mentor_network.skill_coverage`, services/decks/axalSpinoutDemoDay.ts).
 * No "SkillsSpider" component exists in the SPA and no slide draws that
 * coverage; what a slide draws of this roster is the Team & Network advisor
 * block. This comment named the spider and a Mentors & Network slide until
 * D214 measured neither.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

// D229 — the role this catalog called 'mentor' was renamed 'advisor', but
// the column default (`network_profiles.kind DEFAULT 'mentor'`, this file's
// `ensureNetworkProfilesSchema`) and two callers (`admin_network_profiles.ts`
// POST, `axalSpinoutDemoDay.ts` loadNetworkProfiles) still defaulted a
// missing kind to the retired name. 'mentor' stays a valid, storable value —
// existing rows carry it, and rewriting them is a data change no read fix
// makes on its own — but it is no longer the default anywhere a kind must be
// chosen without one given: `NETWORK_KIND_DEFAULT` is 'advisor'. A reader
// that wants to show a legacy 'mentor' row under its current name treats
// 'mentor' as an alias of 'advisor'; nothing here rewrites the stored value
// to do that.
export const NETWORK_KINDS = ['mentor', 'partner', 'advisor', 'investor'] as const;
export type NetworkKind = typeof NETWORK_KINDS[number];

/** The kind a new profile gets when none is given. Not 'mentor' — see above. */
export const NETWORK_KIND_DEFAULT: NetworkKind = 'advisor';

/**
 * What a reader should CALL a stored kind, without changing what is stored:
 * 'mentor' displays as 'advisor', every other known kind displays as
 * itself. Callers that write `kind` back (the admin console's edit form)
 * must not run a row's raw value through this first — resubmitting the
 * translated value would convert a legacy 'mentor' row to 'advisor' on the
 * next unrelated save, which is exactly the silent rewrite D229 fixed
 * POST's default to avoid. This is for read-only display (the deck) only.
 */
export function displayNetworkKind(kind: string): NetworkKind {
  if (kind === 'mentor') return 'advisor';
  return (NETWORK_KINDS as readonly string[]).includes(kind)
    ? (kind as NetworkKind)
    : NETWORK_KIND_DEFAULT;
}

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
  if (READY.get(bindingKey(env))) return;
  if (env.ENVIRONMENT === 'production') {
    READY.set(bindingKey(env), true);
    return;
  }
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
    READY.set(bindingKey(env), true);
  } catch (err) {
     
    console.warn('[networkProfilesSchema] ensure failed', err);
  }
}
