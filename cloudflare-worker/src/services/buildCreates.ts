/**
 * D1064 (#2934) — Build's three creates as statement builders: Add feature,
 * Add must-have and Add roadmap item. Each returns the statements one
 * `DB.batch` runs, its INSERT first with `RETURNING id`, so the route answers
 * with the row it wrote (`createdId`) and part 3's Accept can put the same
 * statements in its own batch.
 *
 * The route used to read the id back with `SELECT MAX(id)` after the batch,
 * outside it: a GitHub sync that added a feature or item in between handed
 * the founder that row's id instead. The statements after the INSERT (the
 * links, the "Waits on" edge, the feedback link and the activity line) still
 * name the new row as the project's newest, inside the batch. That is exact:
 * D1 runs a batch as one transaction, so no other write lands between them.
 *
 * Inputs are already checked by the route; nothing here refuses.
 */
import type { Env } from '../types';
import { logCycleWriteStatement } from './cycleActivity';

type Prepared = ReturnType<Env['DB']['prepare']>;
type Link = { kind: string; url: string; external_ref: string | null };

/** The id the batch's first statement returned. */
export function createdId(results: Array<{ results?: unknown[] }>): number {
  const id = Number((results[0]?.results?.[0] as { id?: unknown } | undefined)?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('The create returned no id');
  return id;
}

export function featureCreateStatements(env: Env, f: {
  projectId: number; userId: number; title: string; description: string | null;
  impact: string; effort: string; scope: string | null; painId: number | null; hypothesisId: number | null;
}): Prepared[] {
  return [
    env.DB.prepare(`INSERT INTO mvp_features (project_id, title, description, added_value, effort, scope, pain_group_id, hypothesis_id, is_must_have, delivery_status, sort_order, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'Backlog', COALESCE((SELECT MAX(sort_order) + 1 FROM mvp_features WHERE project_id = ?), 0), ?, datetime('now'), datetime('now')) RETURNING id`)
      .bind(f.projectId, f.title, f.description, f.impact, f.effort, f.scope, f.painId, f.hypothesisId, f.projectId, f.userId),
    logCycleWriteStatement(env, { projectId: f.projectId, userId: f.userId, cycle: 'build', module: 'solution-design',
      readback: { table: 'mvp_features', by: 'max' }, action: 'build_feature_created', summary: 'Feature added' }),
  ];
}

export function mustHaveCreateStatements(env: Env, m: {
  projectId: number; userId: number; title: string; hypothesisId: number | null;
  status: string; owner: number | null; due: string | null; links: Link[];
}): Prepared[] {
  return [
    // Migration 441's triggers date a must-have that starts, or moves to, Done.
    env.DB.prepare(`INSERT INTO mvp_features (project_id, title, hypothesis_id, is_must_have, delivery_status, owner_user_id, due_date, added_value, effort, sort_order, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, 'High', 'M', COALESCE((SELECT MAX(sort_order) + 1 FROM mvp_features WHERE project_id = ?), 0), ?, datetime('now'), datetime('now')) RETURNING id`)
      .bind(m.projectId, m.title, m.hypothesisId, m.status, m.owner, m.due, m.projectId, m.userId),
    ...[...new Map(m.links.map(l => [l.url, l])).values()].map(l => env.DB.prepare(
      `INSERT INTO mvp_feature_links (feature_id, kind, url, external_ref, created_by) VALUES ((SELECT MAX(id) FROM mvp_features WHERE project_id = ?), ?, ?, ?, ?)`,
    ).bind(m.projectId, l.kind, l.url, l.external_ref, m.userId)),
    // A must-have is Prototype / MVP's record (its burn-up), not Solution design's.
    logCycleWriteStatement(env, { projectId: m.projectId, userId: m.userId, cycle: 'build', module: 'prototype-mvp',
      readback: { table: 'mvp_features', by: 'max' }, action: 'build_must_have_created', summary: 'Must-have added' }),
  ];
}

/**
 * A feedback theme links this venture's open rows of that theme with no item;
 * nothing is unlinked. A new item is named by its readback, an edited one by its id.
 */
export function feedbackLink(env: Env, projectId: number, item: number | 'new', label: string, theme: string): Prepared {
  return item === 'new'
    ? env.DB.prepare(`UPDATE product_feedback SET roadmap_item_ref = (SELECT CAST(MAX(id) AS TEXT) FROM roadmap_okrs WHERE project_id = ?), roadmap_item_label = ?
        WHERE project_id = ? AND theme = ? AND status = 'open' AND roadmap_item_ref IS NULL`).bind(projectId, label, projectId, theme)
    : env.DB.prepare(`UPDATE product_feedback SET roadmap_item_ref = ?, roadmap_item_label = ?
        WHERE project_id = ? AND theme = ? AND status = 'open' AND roadmap_item_ref IS NULL`).bind(String(item), label, projectId, theme);
}

export function roadmapCreateStatements(env: Env, r: {
  projectId: number; userId: number; title: string; column: 'now' | 'next' | 'later'; sortOrder: number;
  owner: number | null; due: string | null; kpi: string | null; theme: string | null; featureId: number | null; waitsOn: number | null;
}): Prepared[] {
  return [
    env.DB.prepare(`INSERT INTO roadmap_okrs (project_id, objective, key_results_json, kanban_status, sort_order, owner_user_id, target_date, kpi_key, feedback_theme, feature_id, created_by, created_at, updated_at)
      VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) RETURNING id`)
      .bind(r.projectId, r.title, r.column, r.sortOrder, r.owner, r.due, r.kpi, r.theme, r.featureId, r.userId),
    // A new item has no edge yet, so "Waits on" can be neither a duplicate nor
    // a cycle, and the item it names is this venture's: the edge goes in the
    // insert's batch rather than through `addOkrDependency()`'s own write.
    ...(r.waitsOn ? [env.DB.prepare('INSERT INTO okr_dependencies (project_id, okr_id, blocks_okr_id, note, created_by) VALUES (?, ?, (SELECT MAX(id) FROM roadmap_okrs WHERE project_id = ?), NULL, ?)')
      .bind(r.projectId, r.waitsOn, r.projectId, r.userId)] : []),
    ...(r.theme ? [feedbackLink(env, r.projectId, 'new', r.title, r.theme)] : []),
    logCycleWriteStatement(env, { projectId: r.projectId, userId: r.userId, cycle: 'build', module: 'product-roadmap',
      readback: { table: 'roadmap_okrs', by: 'max' }, action: 'build_roadmap_item_created', summary: `Item added to ${r.column[0].toUpperCase()}${r.column.slice(1)}` }),
  ];
}
