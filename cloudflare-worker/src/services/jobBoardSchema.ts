/**
 * Task #68 — Public Job Board: lazy schema bootstrap.
 *
 * Shape-only mirror of sql/migrations/131_job_board.sql so dev/preview D1
 * (which never runs `wrangler d1 execute`) still serves the job-board routes.
 * Every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
 * EXISTS` — additive, idempotent, and NEVER seeds a row. Each router calls
 * `ensureJobBoardSchema(env)` before touching the tables (same lazy-bootstrap
 * pattern as services/eventsSchema.ts).
 *
 * NB: unrelated to models/jobs.ts (the async work QUEUE — queue_jobs). This is
 * the founder-facing hiring board.
 */
import type { Env } from '../types';

let _ready = false;

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS job_postings (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     slug             TEXT NOT NULL UNIQUE,
     host_user_id     INTEGER REFERENCES users(id),
     project_id       INTEGER REFERENCES projects(id),
     title            TEXT NOT NULL,
     employment_type  TEXT NOT NULL DEFAULT 'full_time',
     location_text    TEXT,
     remote           INTEGER NOT NULL DEFAULT 0,
     seniority        TEXT NOT NULL DEFAULT 'mid',
     summary          TEXT,
     description      TEXT,
     status           TEXT NOT NULL DEFAULT 'draft',
     admin_published  INTEGER NOT NULL DEFAULT 0,
     review_notes     TEXT,
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_job_postings_public_feed
     ON job_postings (status, admin_published, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_postings_host
     ON job_postings (host_user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_postings_project
     ON job_postings (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_postings_status
     ON job_postings (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS job_applications (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     posting_id     INTEGER NOT NULL REFERENCES job_postings(id),
     user_id        INTEGER REFERENCES users(id),
     name           TEXT,
     email          TEXT NOT NULL,
     cover_note     TEXT,
     linkedin_url   TEXT,
     portfolio_url  TEXT,
     resume_key     TEXT,
     resume_name    TEXT,
     status         TEXT NOT NULL DEFAULT 'submitted',
     created_at     TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (posting_id, email)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_job_applications_posting
     ON job_applications (posting_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_applications_user
     ON job_applications (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_applications_email
     ON job_applications (email)`,
];

export async function ensureJobBoardSchema(env: Env): Promise<boolean> {
  if (_ready) return true;
  try {
    for (const ddl of STATEMENTS) {
      try {
        await env.DB.prepare(ddl).run();
      } catch (e) {
        // An individual already-exists / partial-state statement must not
        // abort the rest of the bootstrap.
        console.warn('[jobBoardSchema] statement failed (continuing)', (e as Error).message);
      }
    }
    _ready = true;
    return true;
  } catch (e) {
    console.error('[jobBoardSchema] bootstrap failed', e);
    return false;
  }
}
