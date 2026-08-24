/**
 * Task #10 (LD) — Lazy bootstrap for team_members.
 *
 * Mirrors `ensurePartnerDirectoryColumns()` / `ensureMarketIntelSchema()`:
 * migration 066 is the canonical production apply path. The lazy fallback is
 * retained for development and preview databases that have not run migrations.
 *
 * Cached per isolate (no re-execution on every hot request).
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureTeamMembersSchema(env: Env): Promise<void> {
  if (_ready) return;
  if (env.ENVIRONMENT === 'production') {
    _ready = true;
    return;
  }
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS team_members (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        slug              TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        title             TEXT NOT NULL,
        location          TEXT,
        short_bio         TEXT,
        long_bio          TEXT,
        photo_r2_key      TEXT,
        focus_areas_json  TEXT NOT NULL DEFAULT '[]',
        social_linkedin   TEXT,
        social_x          TEXT,
        social_website    TEXT,
        social_email      TEXT,
        display_order     INTEGER NOT NULL DEFAULT 0,
        published         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_team_members_published_order
        ON team_members (published, display_order)`),
    ]);
    _ready = true;
  } catch (err) {
     
    console.warn('[teamSchema] ensure failed', err);
  }
}
