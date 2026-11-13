/**
 * The cadence store's runtime bootstrap, so `/build/cadence` works on a
 * database that has not had migration 250 applied yet.
 *
 * WHY THIS EXISTS AT ALL, given that migrations run on every deploy. Because
 * they run on every deploy of THIS repo, and the tables have to be there on the
 * first request after the deploy that introduces them — `npm run deploy` applies
 * migrations in its `predeploy` hook, but a dev SQLite file, a preview Worker
 * built from `[assets]` only, and any D1 whose migration ledger has drifted all
 * reach the route without them. The pattern is `progress.ts`'s
 * `ensureProjectMetricsSchema` and `discoveryInterviewSchema.ts`'s column
 * bootstraps; this is a third instance of it, not a new idea.
 *
 * THE READINESS CACHE IS KEYED ON `env.DB`, NOT A MODULE BOOLEAN. A
 * module-level flag is shared by every request an isolate serves, so the first
 * database to be bootstrapped marks the job done for all of them — which is
 * wrong the moment a test, a preview Worker and production share one build.
 * That exact bug was written and caught by a test in #203; a `WeakMap` keyed on
 * the binding is the fix, and it also lets the entry be collected with the
 * binding.
 *
 * IT NEVER THROWS. A bootstrap that fails must leave the route to return its own
 * empty view rather than a 500: the store being absent is a state the page
 * already renders honestly, and a stack trace is not.
 */
import type { Env } from '../types';

const CADENCE_READY = new WeakMap<object, boolean>();

/**
 * The three tables of migration 250, verbatim in shape.
 *
 * Written out here rather than read from the .sql file because a Worker has no
 * filesystem. `cloudflare-worker/test/cadence_schema_parity.test.ts` compares
 * the two texts column by column, so the copy cannot drift from the migration
 * without failing the build — which is the only thing that makes a second copy
 * of a schema safe to keep.
 */
const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS project_rituals (`
    + ` id INTEGER PRIMARY KEY AUTOINCREMENT,`
    + ` project_id INTEGER NOT NULL,`
    + ` name TEXT NOT NULL,`
    + ` kind TEXT NOT NULL DEFAULT 'other',`
    + ` frequency TEXT NOT NULL DEFAULT 'weekly',`
    + ` weekday INTEGER,`
    + ` target_minutes INTEGER,`
    + ` template_id INTEGER,`
    + ` active INTEGER NOT NULL DEFAULT 1,`
    + ` created_by INTEGER,`
    + ` created_at TEXT NOT NULL DEFAULT (datetime('now')),`
    + ` updated_at TEXT`
    + `)`,
  `CREATE INDEX IF NOT EXISTS idx_project_rituals_project`
    + ` ON project_rituals(project_id, active, kind)`,
  `CREATE TABLE IF NOT EXISTS ritual_runs (`
    + ` id INTEGER PRIMARY KEY AUTOINCREMENT,`
    + ` project_id INTEGER NOT NULL,`
    + ` ritual_id INTEGER NOT NULL,`
    + ` run_date TEXT NOT NULL,`
    + ` state TEXT NOT NULL DEFAULT 'done',`
    + ` outcome TEXT,`
    + ` duration_minutes INTEGER,`
    + ` notes TEXT,`
    + ` created_by INTEGER,`
    + ` created_at TEXT NOT NULL DEFAULT (datetime('now')),`
    + ` updated_at TEXT`
    + `)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ritual_runs_once`
    + ` ON ritual_runs(ritual_id, run_date)`,
  `CREATE INDEX IF NOT EXISTS idx_ritual_runs_archive`
    + ` ON ritual_runs(project_id, run_date DESC)`,
  `CREATE TABLE IF NOT EXISTS ritual_templates (`
    + ` id INTEGER PRIMARY KEY AUTOINCREMENT,`
    + ` project_id INTEGER NOT NULL,`
    + ` name TEXT NOT NULL,`
    + ` kind TEXT NOT NULL DEFAULT 'other',`
    + ` body TEXT NOT NULL,`
    + ` based_on TEXT,`
    + ` edited_at TEXT,`
    + ` created_by INTEGER,`
    + ` created_at TEXT NOT NULL DEFAULT (datetime('now'))`
    + `)`,
  `CREATE INDEX IF NOT EXISTS idx_ritual_templates_project`
    + ` ON ritual_templates(project_id, kind)`,
];

/** Every table and index migration 250 declares, or nothing and no throw. */
export async function ensureCadenceSchema(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (CADENCE_READY.get(key)) return true;
  try {
    for (const sql of STATEMENTS) await env.DB.exec(sql);
    CADENCE_READY.set(key, true);
    return true;
  } catch (e) {
    console.error('[cadence] ensureCadenceSchema:', (e as Error).message);
    return false;
  }
}

/** The statement list, for the parity test. Not for callers. */
export const CADENCE_DDL = STATEMENTS;
