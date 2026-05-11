// Task #7 (AM) — Project trash: hard-delete cascade + 30-day sweep.
//
// Hard-delete on a fully-migrated D1 (039_project_cascade.sql applied) is a
// single `DELETE FROM projects WHERE id = ?` because every child FK now has
// ON DELETE CASCADE. We still run the legacy manual cascade BEFORE the
// final DELETE so stale installs (where 039 hasn't run yet) don't trip a
// FOREIGN KEY error. On a migrated DB the manual deletes are redundant
// but harmless (they target the same rows the cascade would).
//
// `sweepTrashedProjects` is the cron-callable hard-sweep; the actual cron
// schedule is wired in by Task #9 (AO) in worker/src/index.ts.

import type { Env } from '../types';

// Tables we know carry per-project state. Order doesn't matter (each
// statement is independent); we swallow per-table errors so a missing or
// renamed optional table on one install doesn't abort the cascade.
const CHILD_TABLES = [
  'score_snapshots', 'documents', 'deal_memos', 'deals',
  'capital_calls', 'tickets', 'discovery_interviews', 'roadmap_okrs',
  'fund_reserve_allocations', 'financial_models',
  'compliance_events', 'cap_table_scenarios', 'founder_checkins',
  'cap_table_holders', 'cap_table_securities', 'investor_introductions',
  'project_milestones', 'project_week_progress', 'spinout_lab_milestones',
  'project_health_signals', 'health_interventions', 'project_watchlist',
  'project_metrics', 'sf_sync_log',
];

export async function hardDeleteProject(env: Env, projectId: number): Promise<void> {
  for (const t of CHILD_TABLES) {
    try { await env.DB.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(projectId).run(); }
    catch { /* table absent or different shape — fine */ }
  }
  // activity_logs is preserved for audit history — null out the FK rather
  // than delete. Migration 039 makes this redundant for the cascade path
  // (CASCADE would drop these rows) but we want them KEPT, so we run it
  // here BEFORE the final DELETE to detach them first.
  try { await env.DB.prepare(`UPDATE activity_logs SET project_id = NULL WHERE project_id = ?`).bind(projectId).run(); } catch {}
  await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId).run();
}

export interface SweepResult {
  scanned: number;
  deleted: number;
  failed: number;
}

// 30-day hard-sweep — physically remove projects whose deleted_at is older
// than `daysOld`. Idempotent (re-running over a clean DB returns zeros).
export async function sweepTrashedProjects(env: Env, daysOld = 30): Promise<SweepResult> {
  // SQLite-flavored: datetime('now', '-30 days')
  const res: any = await env.DB.prepare(
    `SELECT id FROM projects WHERE deleted_at IS NOT NULL AND datetime(deleted_at) < datetime('now', ?)`,
  ).bind(`-${daysOld} days`).all();
  const ids: number[] = ((res?.results || []) as any[]).map((r) => r.id as number);
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await hardDeleteProject(env, id);
      deleted += 1;
    } catch (e) {
      failed += 1;
      console.error('[projectTrash.sweep] hard-delete failed for', id, (e as Error).message);
    }
  }
  return { scanned: ids.length, deleted, failed };
}
