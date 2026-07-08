/**
 * Advisory Suite — founder-scoped advisor directory (Task #75).
 *
 * Lazy bootstrap for advisor_profiles + advisor_startups, mirroring
 * networkProfilesSchema.ts: migration 138_advisor_directory.sql is the canonical
 * apply path, but the cold-path CREATE TABLE IF NOT EXISTS keeps the dev/preview
 * D1 (which never runs `wrangler d1 execute`) and any un-applied prod self-healing.
 *
 * Email privacy: the column always stores the advisor's email, but the read
 * layer only surfaces it when the profile arrived through a TRUSTED pipeline
 * (Brand & Landing waitlist / referral / staff-rec). Profiles seeded by any
 * other origin show the profile but redact the email.
 */
import type { Env } from '../types';
import { jload } from '../routes/_t13t14t15_helpers';

let _ready = false;

/** Origins whose email a founder is allowed to see in the directory. */
export const TRUSTED_ADVISOR_SOURCES = ['brand-landing', 'referral', 'staff-rec'] as const;

export const ADVISOR_STATUSES = ['active', 'archived'] as const;

export type AdvisorProfileRow = {
  id: number;
  founder_id: number;
  name: string;
  email: string | null;
  bio: string | null;
  sectors_json: string | null;
  expertise_json: string | null;
  linkedin_url: string | null;
  hourly_rate: number | null;
  source: string | null;
  status: string;
  source_contact_id: number | null;
  // Relationship fields (migration 143) — how the founder actually works
  // with this advisor: last session date, running notes, next follow-up.
  last_session_at: string | null;
  notes: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AdvisorAssignment = { project_id: number; name: string | null };

/** True when an advisor's email may be surfaced to the founder. */
export function emailVisible(source: string | null | undefined): boolean {
  return !!source && (TRUSTED_ADVISOR_SOURCES as readonly string[]).includes(source);
}

/**
 * Shape a raw row for the API: parse the JSON arrays, redact the email unless
 * the source is trusted (surfacing `email_hidden` so the UI can explain why),
 * and attach the advisor's startup assignments.
 */
export function shapeAdvisorProfile(row: AdvisorProfileRow, assignments: AdvisorAssignment[] = []) {
  const canSeeEmail = emailVisible(row.source);
  return {
    id: row.id,
    founder_id: row.founder_id,
    name: row.name,
    email: canSeeEmail ? row.email : null,
    email_hidden: !canSeeEmail && !!row.email,
    bio: row.bio,
    sectors: jload<string[]>(row.sectors_json, []),
    expertise: jload<string[]>(row.expertise_json, []),
    linkedin_url: row.linkedin_url,
    hourly_rate: row.hourly_rate,
    source: row.source,
    status: row.status,
    source_contact_id: row.source_contact_id,
    last_session_at: row.last_session_at ?? null,
    notes: row.notes ?? null,
    follow_up_at: row.follow_up_at ?? null,
    follow_up_note: row.follow_up_note ?? null,
    assignments,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function ensureAdvisorProfilesSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS advisor_profiles (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        founder_id        INTEGER NOT NULL,
        name              TEXT NOT NULL,
        email             TEXT,
        bio               TEXT,
        sectors_json      TEXT NOT NULL DEFAULT '[]',
        expertise_json    TEXT NOT NULL DEFAULT '[]',
        linkedin_url      TEXT,
        hourly_rate       REAL,
        source            TEXT,
        status            TEXT NOT NULL DEFAULT 'active',
        source_contact_id INTEGER,
        last_session_at   TEXT,
        notes             TEXT,
        follow_up_at      TEXT,
        follow_up_note    TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_advisor_profiles_founder
        ON advisor_profiles (founder_id, status)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_advisor_profiles_source_contact
        ON advisor_profiles (source_contact_id)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS advisor_startups (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        advisor_profile_id INTEGER NOT NULL,
        project_id         INTEGER NOT NULL,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (advisor_profile_id, project_id)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_advisor_startups_profile
        ON advisor_startups (advisor_profile_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_advisor_startups_project
        ON advisor_startups (project_id)`),
    ]);
    // Relationship columns (migration 143) for tables created before the
    // columns existed. Each ALTER runs individually OUTSIDE the batch above:
    // D1 batches are atomic, so a duplicate-column error inside the batch
    // would roll back the whole schema bootstrap. "duplicate column" is the
    // expected steady-state here, hence the per-statement swallow.
    for (const col of ['last_session_at TEXT', 'notes TEXT', 'follow_up_at TEXT', 'follow_up_note TEXT']) {
      try {
        await env.DB.prepare(`ALTER TABLE advisor_profiles ADD COLUMN ${col}`).run();
      } catch { /* column already exists */ }
    }
    _ready = true;
  } catch (err) {
    console.warn('[advisorProfilesSchema] ensure failed', err);
  }
}
