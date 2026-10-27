/**
 * D1088 (#2953, Notion part 4 of #2405) — Build: what a founder's Notion lands
 * as on Product roadmap, Prototype / MVP and Solution design.
 *
 * - **Product roadmap** (fact): a database row → one `roadmap_okrs` item. Title
 *   → `objective`; a mapped status → Now, Next, Later or Done; a mapped date or
 *   select → `quarter`; a key result and a progress, when mapped, as the one key
 *   result Product roadmap stores (`[{ text, current, target: 100, unit: '%' }]`,
 *   Google's shape, D1093).
 * - **Prototype / MVP** (fact): a database row → one must-have (`mvp_features`,
 *   `is_must_have = 1`): the feature, a mapped High / Medium / Low → `added_value`,
 *   a mapped status → `delivery_status`.
 * - **Solution design** (proposal `design_note`): Accept writes one
 *   `solution_design_notes` row citing the page (`source_url`), with the first
 *   2,000 characters of its Markdown as the body.
 *
 * One owner per row (#2405 § Module map) is the engine's (`sync.ts`): a fact is
 * written new, or updated only while this connection's ledger row links it and
 * `fedOwnership.ts` names it the owner. A GitHub-, Google- or hand-entered row is
 * never touched. An update writes only the fields the founder mapped: a field
 * Notion leaves empty keeps the row's own value.
 *
 * Every statement is bound. Page text is data: stored and drawn as text, never
 * logged. Activity rows say what happened, never the title.
 */
import { logCycleWriteStatement } from '../cycleActivity';
import { registerAcceptor, registerFactWriter, type Acceptor, type FactItem, type FactWriter } from './sync';

const TITLE_MAX = 300;
const QUARTER_MAX = 20;
const LANES = new Set(['now', 'next', 'later', 'done']);
const VALUES = new Set(['High', 'Medium', 'Low']);
const STATUSES = new Set(['Backlog', 'In Progress', 'Review', 'Done', 'Blocked']);

const str = (v: unknown, max: number): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';
  return t ? t.slice(0, max) : null;
};
const oneOf = (v: unknown, allowed: Set<string>): string | null => (typeof v === 'string' && allowed.has(v) ? v : null);
const pct = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace('%', '')) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

/** Product roadmap's one key result, as it stores it; `null` when the row maps neither. */
export function keyResultsOf(values: FactItem['values']): string | null {
  const text = str(values.key_result, TITLE_MAX);
  const progress = pct(values.progress);
  if (!text && progress == null) return null;
  return JSON.stringify([{ text: text || 'Progress', current: progress, target: progress == null ? null : 100, unit: progress == null ? null : '%' }]);
}

export const roadmapWriter: FactWriter = {
  module: 'product_roadmap',
  localTable: 'roadmap_okrs',
  async write(env, ctx, item, existingId) {
    const objective = str(item.values.objective, TITLE_MAX) ?? str(item.title, TITLE_MAX) ?? 'Untitled';
    const lane = oneOf(item.values.status, LANES);
    const quarter = str(item.values.quarter, QUARTER_MAX);
    const kr = keyResultsOf(item.values);
    if (existingId != null) {
      await env.DB.prepare(
        `UPDATE roadmap_okrs SET objective = ?, kanban_status = COALESCE(?, kanban_status), quarter = COALESCE(?, quarter),
           key_results_json = COALESCE(?, key_results_json), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
      ).bind(objective, lane, quarter, kr, existingId, ctx.projectId).run();
      return existingId;
    }
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO roadmap_okrs (project_id, objective, key_results_json, kanban_status, quarter, sort_order, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM roadmap_okrs WHERE project_id = ?), 0), ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
      ).bind(ctx.projectId, objective, kr ?? '[]', lane ?? 'next', quarter, ctx.projectId, ctx.userId),
      logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'build', module: 'product-roadmap',
        readback: { table: 'roadmap_okrs', by: 'max' }, action: 'notion_roadmap_item_created', summary: 'Roadmap item added from Notion' }),
    ]);
    return Number((inserted as any).results[0].id);
  },
  async alive(env, projectId, id) {
    return !!(await env.DB.prepare('SELECT 1 AS x FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, projectId).first());
  },
  async remove(env, projectId, id) {
    const res = await env.DB.prepare('DELETE FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, projectId).run();
    return !!res?.meta?.changes;
  },
  async view(env, projectId, ids) {
    const rows = ids.length ? (await env.DB.prepare(
      `SELECT id, objective, kanban_status, quarter, key_results_json FROM roadmap_okrs WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))`,
    ).bind(projectId, JSON.stringify(ids)).all<any>()).results || [] : [];
    return new Map(rows.map((r: any) => {
      let kr: any = null;
      try { kr = JSON.parse(r.key_results_json || '[]')?.[0] ?? null; } catch { kr = null; }
      return [Number(r.id), { objective: r.objective, status: r.kanban_status, quarter: r.quarter ?? null,
        key_result: kr?.text ?? null, progress: typeof kr?.current === 'number' ? kr.current : null }];
    }));
  },
};

export const mustHaveWriter: FactWriter = {
  module: 'prototype_mvp',
  localTable: 'mvp_features',
  async write(env, ctx, item, existingId) {
    const title = str(item.values.feature, TITLE_MAX) ?? str(item.title, TITLE_MAX) ?? 'Untitled';
    const value = oneOf(item.values.added_value, VALUES);
    const status = oneOf(item.values.delivery_status, STATUSES);
    if (existingId != null) {
      // Migration 441's triggers date a must-have that moves to Done.
      await env.DB.prepare(
        `UPDATE mvp_features SET title = ?, added_value = COALESCE(?, added_value), delivery_status = COALESCE(?, delivery_status),
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
      ).bind(title, value, status, existingId, ctx.projectId).run();
      return existingId;
    }
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO mvp_features (project_id, title, is_must_have, delivery_status, added_value, effort, sort_order, created_by, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, 'M', COALESCE((SELECT MAX(sort_order) + 1 FROM mvp_features WHERE project_id = ?), 0), ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
      ).bind(ctx.projectId, title, status ?? 'Backlog', value ?? 'High', ctx.projectId, ctx.userId),
      logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'build', module: 'prototype-mvp',
        readback: { table: 'mvp_features', by: 'max' }, action: 'notion_must_have_created', summary: 'Must-have added from Notion' }),
    ]);
    return Number((inserted as any).results[0].id);
  },
  async alive(env, projectId, id) {
    return !!(await env.DB.prepare('SELECT 1 AS x FROM mvp_features WHERE id = ? AND project_id = ?').bind(id, projectId).first());
  },
  async remove(env, projectId, id) {
    const res = await env.DB.prepare('DELETE FROM mvp_features WHERE id = ? AND project_id = ?').bind(id, projectId).run();
    return !!res?.meta?.changes;
  },
  async view(env, projectId, ids) {
    const rows = ids.length ? (await env.DB.prepare(
      `SELECT id, title, added_value, delivery_status FROM mvp_features WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))`,
    ).bind(projectId, JSON.stringify(ids)).all<any>()).results || [] : [];
    return new Map(rows.map((r: any) => [Number(r.id), { feature: r.title, added_value: r.added_value, delivery_status: r.delivery_status }]));
  },
};

export const EXTRACT_MAX = 2000;

/** Accept on a spec page: one design note citing it. */
export const designNoteAcceptor: Acceptor = {
  kind: 'design_note',
  async accept(env, ctx, proposal) {
    const title = str(proposal.title, TITLE_MAX) ?? 'Untitled';
    // The engine stores at most EXTRACT_MAX characters of the page (`sync.ts`).
    const body = proposal.extract ?? null;
    const url = typeof proposal.url === 'string' && /^https:\/\//i.test(proposal.url) ? proposal.url : null;
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO solution_design_notes (project_id, proposal_id, title, body, source_url, source_path, created_by, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) RETURNING id`,
      ).bind(ctx.projectId, title, body, url, `notion/${proposal.source_key}`, ctx.userId),
      logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'build', module: 'solution-design', entityId: 'project',
        action: 'notion_design_note_accepted', summary: 'Design note added from Notion' }),
    ]);
    return { localTable: 'solution_design_notes', localId: Number((inserted as any).results[0].id) };
  },
};

registerFactWriter(roadmapWriter);
registerFactWriter(mustHaveWriter);
registerAcceptor(designNoteAcceptor);
