/**
 * Lazy schema bootstrap for migration 212's two tables.
 *
 * Mirrors `ensureAdvisorStoresSchema` and `ensureDiscoveryEvidenceColumns`: the
 * canonical definition is `sql/migrations/212_cohort_guidance.sql`, and this
 * guarantees the tables exist on first request so the Worker is self-healing on
 * an environment where the migration has not been applied. Cached per isolate.
 *
 * The DDL below is a copy, and copies drift — `check-sqlite-table-collisions`
 * exists because this repository has 254 tables defined more than once. It is
 * kept identical to 212 deliberately, including the two NULLABLE columns that
 * carry the design: `asked_by_user_id` NULL is the advisor posting unprompted,
 * and a NOT NULL here would make broadcast guidance unstorable; `week_number`
 * NULL is guidance about the whole programme rather than one week.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export async function ensureCohortGuidanceSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cohort_guidance (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         uid TEXT NOT NULL UNIQUE,
         cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
         advisor_user_id INTEGER NOT NULL REFERENCES users(id),
         asked_by_user_id INTEGER REFERENCES users(id),
         body TEXT NOT NULL,
         answer TEXT,
         answered_at TEXT,
         week_number INTEGER,
         posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         retired_at TEXT,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cohort_guidance_cycle
         ON cohort_guidance (cohort_cycle_id, posted_at)`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cohort_guidance_advisor
         ON cohort_guidance (advisor_user_id)`,
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cohort_guidance_acks (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         guidance_id INTEGER NOT NULL REFERENCES cohort_guidance(id) ON DELETE CASCADE,
         founder_user_id INTEGER NOT NULL REFERENCES users(id),
         acted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         note TEXT,
         UNIQUE (guidance_id, founder_user_id)
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cohort_guidance_acks_founder
         ON cohort_guidance_acks (founder_user_id)`,
    ).run();
    READY.set(key, true);
  } catch (e) {
    // Never cached as ready on failure, so the next request retries rather than
    // remembering a bootstrap that did not happen.
    console.warn('[cohortGuidanceSchema] bootstrap failed', e);
  }
}
