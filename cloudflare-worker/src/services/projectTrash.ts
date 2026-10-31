// Task #7 (AM) — Project trash: hard-delete cascade + 30-day sweep.
//
// THE EXPLICIT CLEANUP BELOW IS THE CASCADE. Not a legacy fallback for stale installs —
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
// So deleting this cleanup on the strength of that old sentence would have left
// hard-delete tripping a FOREIGN KEY error on the tables that do have the
// constraint, and orphaning rows on the two that do not.
//
// `sweepTrashedProjects` is the cron-callable hard-sweep; the actual cron
// schedule is wired in by Task #9 (AO) in worker/src/index.ts.

import type { Env } from '../types';

// Existing project cleanup inventory. Optional tables are discovered before the
// batch; a real write error must roll back the entire deletion (#3747).
const CHILD_TABLES = [
  'round_calls', // D653: recipients and questions cascade before the project is removed.
  'deal_memos', 'score_snapshots', 'documents', 'deals', // Memos reference snapshots.
  'capital_calls', 'tickets', 'discovery_interviews', 'roadmap_okrs',
  'fund_reserve_allocations', 'financial_models',
  'compliance_events', 'cap_table_scenarios', 'founder_checkins',
  'cap_table_holders', 'cap_table_securities', 'investor_introductions',
  'project_milestones', 'project_week_progress', 'spinout_lab_milestones',
  'project_health_signals', 'health_interventions', 'project_watchlist',
  'project_metrics', 'sf_sync_log',
];

// #3747: content-free, durable outbox in the existing settings store. It has no
// expiry and survives removal of the project. The trash cron retries it even
// when there are no trashed projects left. No schema change is required.
const PURGE_PREFIX = 'project-deck-images-purge:';

async function tables(env: Env): Promise<Set<string>> {
  const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  if (!result.success) throw new Error('Cannot inspect project cleanup tables');
  return new Set(result.results.map(row => row.name));
}

async function purgeDeckImages(env: Env, projectId: number): Promise<void> {
  if (!env.FILES) throw new Error('Deck image storage unavailable');
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await env.FILES.list({ prefix: `deck-images/${projectId}/`, limit: 500, ...(cursor ? { cursor } : {}) });
    if (page.objects.length) {
      await env.FILES.delete(page.objects.map(object => object.key));
      count += page.objects.length;
    }
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error('Deck image pagination did not advance');
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const result = await env.DB.prepare('DELETE FROM platform_settings WHERE key = ?').bind(PURGE_PREFIX + projectId).run();
  if (!result.success) throw new Error('Cannot complete deck image cleanup');
  console.log('[projectTrash.deckImages] purged', { projectId, count });
}

async function tryPurgeDeckImages(env: Env, projectId: number): Promise<void> {
  try { await purgeDeckImages(env, projectId); }
  catch {
    // SQL has committed. Do not misreport a failed deletion or restore a
    // half-deleted venture: the marker remains for the next cron pass.
    console.error('[projectTrash.deckImages] cleanup pending', { projectId });
  }
}

export async function hardDeleteProject(env: Env, projectId: number): Promise<void> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error('Invalid project id');
  const present = await tables(env);
  const statements: D1PreparedStatement[] = [];
  const add = (sql: string) => statements.push(env.DB.prepare(sql).bind(projectId));
  // Keep the existing receipt and audit retention rules. Missing optional
  // tables are harmless; permission, constraint and storage errors are not.
  if (present.has('capital_calls') && present.has('capital_call_receipts')) {
    add(`UPDATE capital_calls SET project_id = NULL WHERE project_id = ?
      AND EXISTS (SELECT 1 FROM capital_call_receipts r WHERE r.capital_call_id = capital_calls.id)`);
  }
  for (const table of CHILD_TABLES) {
    if (!present.has(table)) continue;
    const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!columns.success) throw new Error('Cannot inspect project cleanup columns');
    if (columns.results.some(column => column.name === 'project_id')) add(`DELETE FROM ${table} WHERE project_id = ?`);
  }
  // #3747: delete dependants before decks, including stores without FKs.
  // View/feedback rows can omit project_id; resolve ownership through decks.
  const decks = 'SELECT id FROM pitch_decks WHERE project_id = ?';
  if (present.has('pitch_decks')) {
    if (present.has('deck_view_slides') && present.has('deck_share_views')) {
      add(`DELETE FROM deck_view_slides WHERE view_id IN (SELECT id FROM deck_share_views WHERE deck_id IN (${decks}))`);
    }
    for (const table of ['deck_share_conversions', 'deck_share_feedback', 'deck_share_views', 'pitch_deck_share_tokens', 'deck_exports', 'deck_checks', 'deck_notes']) {
      if (present.has(table)) add(`DELETE FROM ${table} WHERE deck_id IN (${decks})`);
    }
  }
  for (const table of ['deck_notes', 'deck_images', 'pitch_deck_proposals', 'pitch_decks']) {
    if (present.has(table)) add(`DELETE FROM ${table} WHERE project_id = ?`);
  }
  // Even orphan objects (no deck_images row) must go. Missing storage still
  // records a retry when the image schema exists. Minimal older installs with
  // neither images nor a bucket do not need an outbox.
  const purge = !!env.FILES || present.has('deck_images');
  if (purge) {
    if (!present.has('platform_settings')) throw new Error('Deck image cleanup store unavailable');
    statements.push(env.DB.prepare(`INSERT INTO platform_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .bind(PURGE_PREFIX + projectId, String(projectId)));
  }
  if (present.has('activity_logs')) {
    const columns = await env.DB.prepare('PRAGMA table_info(activity_logs)').all<{ name: string }>();
    if (!columns.success) throw new Error('Cannot inspect audit columns');
    if (columns.results.some(column => column.name === 'project_id')) add('UPDATE activity_logs SET project_id = NULL WHERE project_id = ?');
  }
  add('DELETE FROM projects WHERE id = ?');
  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) throw new Error('Project deletion batch failed');
  if (purge) await tryPurgeDeckImages(env, projectId);
}

async function retryDeckImagePurges(env: Env): Promise<void> {
  if (!(await tables(env)).has('platform_settings')) return;
  // Bound work per cron and rotate failures behind older attempts. Retry work
  // runs after the trash sweep, so an R2 outage cannot starve SQL deletion.
  const page = await env.DB.prepare(`SELECT key FROM platform_settings
    WHERE key LIKE ? ORDER BY updated_at, key LIMIT 25`)
    .bind(PURGE_PREFIX + '%').all<{ key: string }>();
  if (!page.success) throw new Error('Cannot read pending deck image cleanup');
  for (const { key } of page.results) {
    const touched = await env.DB.prepare('UPDATE platform_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = ?').bind(key).run();
    if (!touched.success) throw new Error('Cannot record deck image cleanup attempt');
    const suffix = key.slice(PURGE_PREFIX.length);
    const id = Number(suffix);
    if (/^[1-9][0-9]*$/.test(suffix) && Number.isSafeInteger(id)) await tryPurgeDeckImages(env, id);
  }
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
  try { await retryDeckImagePurges(env); }
  catch { console.error('[projectTrash.deckImages] pending retry scan failed'); }
  return { scanned: ids.length, deleted, failed };
}
