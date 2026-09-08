// Task #7 (AM) — Project trash: hard-delete cascade + 30-day sweep.
//
// THE LOOP BELOW IS THE CASCADE. Not a legacy fallback for stale installs —
// the only one there is. This header used to say the opposite: that on "a
// fully-migrated D1 (039_project_cascade.sql applied)" a hard delete is one
// `DELETE FROM projects` because every child FK carries ON DELETE CASCADE, and
// that the manual deletes were "redundant but harmless".
//
// 039's cascade half NEVER RAN — not on production, not anywhere. Its
// transaction statements aborted the file in May 2026; the two statements that
// landed (`projects.deleted_at` and its index) were applied by hand, and the
// marker row says so. Read off live D1 on 2026-09-08: `deals`,
// `score_snapshots` and `documents` still say plain `REFERENCES projects(id)`,
// and `discovery_interviews` and `roadmap_okrs` carry no REFERENCES at all. The
// file has since been cut back to what it actually did (DECISIONS D60).
//
// So deleting this loop on the strength of that old sentence would have left
// hard-delete tripping a FOREIGN KEY error on the tables that do have the
// constraint, and orphaning rows on the two that do not.
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
  // activity_logs is preserved for audit history — null out the FK rather than
  // delete, before the final DELETE, so the rows are detached rather than
  // removed. Worth stating why this is a DIFFERENT decision from the loop
  // above: every other child of a project goes away with it, and this one does
  // not. Had 039's cascade ever landed it would have taken these rows too,
  // which is a second reason its absence is not a gap to close casually.
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
