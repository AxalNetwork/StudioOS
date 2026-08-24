/**
 * Task #9 — Communities & Circles: lazy schema bootstrap.
 *
 * Shape-only mirror of sql/migrations/137_circles.sql so dev/preview D1 (which
 * never runs `wrangler d1 execute`) still serves the circles routes. Every
 * statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` —
 * additive, idempotent, and NEVER seeds a row (the public /circles page starts
 * EMPTY until an admin publishes real circles). Each router calls
 * `ensureCirclesSchema(env)` before touching the table (same lazy-bootstrap
 * pattern as services/jobBoardSchema.ts / services/eventsSchema.ts).
 */
import type { Env } from '../types';

let _ready = false;

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS circles (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     slug            TEXT NOT NULL UNIQUE,
     name            TEXT NOT NULL,
     type            TEXT NOT NULL DEFAULT 'founder',
     access          TEXT NOT NULL DEFAULT 'public',
     tagline         TEXT,
     region          TEXT,
     theme           TEXT,
     members         INTEGER NOT NULL DEFAULT 0,
     activity        TEXT NOT NULL DEFAULT 'new',
     upcoming_events INTEGER NOT NULL DEFAULT 0,
     discussions     INTEGER NOT NULL DEFAULT 0,
     tags            TEXT NOT NULL DEFAULT '[]',
     hosted_by       TEXT,
     featured        INTEGER NOT NULL DEFAULT 0,
     published       INTEGER NOT NULL DEFAULT 0,
     sort_order      INTEGER NOT NULL DEFAULT 0,
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_circles_public_feed ON circles (published, featured, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_circles_type ON circles (type)`,
  `CREATE INDEX IF NOT EXISTS idx_circles_access ON circles (access)`,
];

export async function ensureCirclesSchema(env: Env): Promise<boolean> {
  if (_ready) return true;
  // The production D1 migration is authoritative. Avoid running table/index
  // DDL from a cold public request, while preserving dev/preview convenience.
  if (env.ENVIRONMENT === 'production') {
    _ready = true;
    return true;
  }
  try {
    for (const ddl of STATEMENTS) {
      try {
        await env.DB.prepare(ddl).run();
      } catch (e) {
        // An individual already-exists / partial-state statement must not
        // abort the rest of the bootstrap.
        console.warn('[circlesSchema] statement failed (continuing)', (e as Error).message);
      }
    }
    _ready = true;
    return true;
  } catch (e) {
    console.error('[circlesSchema] bootstrap failed', e);
    return false;
  }
}
