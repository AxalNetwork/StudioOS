/**
 * The `workflows` / `workflow_tasks` / `shared_services_log` bootstrap.
 *
 * These three tables are shared by four route files — pipeline, networkfx,
 * legalcap and dashboard — and that is exactly why they went missing. Every
 * other table in those routers is created by the one router that owns it, in
 * its local `ensureSchema`. These three belong to no single router, so no
 * router created them, and nothing in `sql/` did either. They were queried
 * from the day they were written and have never existed.
 *
 * Migration 177 is the canonical definition. This module mirrors it so the
 * worker self-heals if 177 lands unapplied on production (see the
 * pending-migrations gotcha in GOTCHAS.md), the same arrangement
 * `ensureAxalFitSchema` has with migration 115.
 *
 * One module rather than four copies: four `ensureSchema` arrays holding the
 * same DDL is how the definitions drift, and a rate limiter that counts rows
 * in a table whose shape depends on which router happened to create it first
 * is not a rate limiter.
 */
import type { Env } from '../types';

/**
 * Exported for the schema test, which runs these against a real SQLite
 * database and then executes each route's actual queries over the result.
 * Keep in step with `sql/migrations/177_workflow_shared_services.sql`.
 */
export const WORKFLOW_SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS workflows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT    NOT NULL DEFAULT 'strategic',
    title         TEXT    NOT NULL,
    description   TEXT,
    status        TEXT    NOT NULL DEFAULT 'active',
    project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    template_key  TEXT,
    owner_user_id INTEGER REFERENCES users(id),
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // SQLite treats NULLs as distinct, so one UNIQUE(template_key, project_id)
  // would not stop the project-less marketplace-intro workflow being created
  // twice under a race. Two partial indexes cover both find-or-create shapes.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_template_project
    ON workflows(template_key, project_id) WHERE template_key IS NOT NULL AND project_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_template_global
    ON workflows(template_key) WHERE template_key IS NOT NULL AND project_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflows_owner   ON workflows(owner_user_id, status)`,

  `CREATE TABLE IF NOT EXISTS workflow_tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id      INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    title            TEXT    NOT NULL,
    description      TEXT,
    status           TEXT    NOT NULL DEFAULT 'todo',
    priority         TEXT    NOT NULL DEFAULT 'normal',
    ai_assisted      INTEGER NOT NULL DEFAULT 0,
    metadata         TEXT,
    assignee_user_id INTEGER REFERENCES users(id),
    due_date         TIMESTAMP,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wtasks_assignee ON workflow_tasks(assignee_user_id, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_wtasks_workflow ON workflow_tasks(workflow_id, status)`,

  `CREATE TABLE IF NOT EXISTS shared_services_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id  INTEGER REFERENCES workflows(id) ON DELETE SET NULL,
    action_type  TEXT    NOT NULL,
    details      TEXT,
    performed_by INTEGER REFERENCES users(id),
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // This index is the rate limiter: every quota check counts rows by
  // (performed_by, action_type, created_at) before the model call it guards.
  `CREATE INDEX IF NOT EXISTS idx_ssl_actor_action_ts
    ON shared_services_log(performed_by, action_type, created_at)`,
];

let _ready = false;

export async function ensureWorkflowSchema(env: Env): Promise<void> {
  if (_ready) return;
  for (const stmt of WORKFLOW_SCHEMA_DDL) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: any) {
      // Log rather than swallow. A silent catch around this DDL is how the
      // absence of these tables stayed invisible for as long as it did.
      console.error('ensureWorkflowSchema:', e?.message);
    }
  }
  _ready = true;
}

/** Test seam — the module-level cache would otherwise leak across cases. */
export function __resetWorkflowSchemaCache(): void {
  _ready = false;
}
