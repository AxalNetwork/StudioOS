/** D690 — one scoped activity convention for cycle record writes. */
import type { Env } from '../types';
import { RECORD_ID } from './records/owned';
import { isRaiseStore, type Cycle, type OldRowsMatcher, type RaiseStore, type Store } from './records/types';

export type CycleWrite = {
  projectId: number;
  userId: number | null;
  cycle: Cycle;
  module: string;
  entityId: string | number;
  action: string;
  summary: string;
};

export type Readback =
  | { table: 'pain_groups' | 'hypotheses' | 'mvp_features' | 'roadmap_okrs' | 'formation_steps'; by: 'max'; prefix?: string }
  | { table: 'interview_sessions'; by: 'uid'; uid: string; prefix?: string }
  // D693 (#1703): a decision's rows. `max` names the venture's newest
  // decision; `supersedes` names the decision it replaced, and writes no row
  // when it replaced none.
  | { table: 'validation_decisions'; by: 'max' | 'supersedes'; prefix?: string };

export type BatchedCycleWrite = Omit<CycleWrite, 'entityId'> & { readback: Readback };

type Prepared = ReturnType<Env['DB']['prepare']>;

function checked(input: Omit<CycleWrite, 'entityId'>): { entityType: string; summary: string; actor: string } {
  if (!Number.isSafeInteger(input.projectId) || input.projectId < 1
    || !/^[a-z][a-z0-9_-]*$/.test(input.module)
    || !/^[a-z][a-z0-9_-]*$/.test(input.action)) throw new Error('Invalid cycle activity key');
  const summary = String(input.summary).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!summary) throw new Error('A cycle activity summary is required');
  return { entityType: `${input.cycle}.${input.module}`, summary, actor: input.userId == null ? 'system' : `user:${input.userId}` };
}

/** The prepared form participates in the same DB.batch as the write. */
export function logCycleWriteStatement(env: Env, input: CycleWrite | BatchedCycleWrite): Prepared {
  const { entityType, summary, actor } = checked(input);
  const common = [input.projectId, input.userId, entityType];
  if ('entityId' in input) {
    const entityId = String(input.entityId);
    if (!RECORD_ID.test(entityId)) throw new Error('Invalid cycle activity record id');
    return env.DB.prepare(
      'INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(...common, entityId, input.action, summary, actor);
  }
  const { readback } = input;
  const prefix = readback.prefix ?? '';
  if (prefix && !/^[a-z][a-z0-9_-]*-$/.test(prefix)) throw new Error('Invalid cycle activity prefix');
  const tail = [input.action, summary, actor];
  if (readback.table === 'validation_decisions' && readback.by === 'supersedes') {
    return env.DB.prepare(
      "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) SELECT ?, ?, ?, ? || CAST(d.supersedes_id AS TEXT), ?, ?, ? FROM validation_decisions d WHERE d.id = (SELECT MAX(id) FROM validation_decisions WHERE project_id = ?) AND d.supersedes_id IS NOT NULL",
    ).bind(...common, prefix, ...tail, input.projectId);
  }
  if (readback.by === 'uid') {
    return env.DB.prepare(
      "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(id AS TEXT) FROM interview_sessions WHERE uid = ? AND project_id = ?), ?, ?, ?)",
    ).bind(...common, prefix, readback.uid, input.projectId, ...tail);
  }
  const sql = {
    pain_groups: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM pain_groups WHERE project_id = ?), ?, ?, ?)",
    hypotheses: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM hypotheses WHERE project_id = ?), ?, ?, ?)",
    mvp_features: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM mvp_features WHERE project_id = ?), ?, ?, ?)",
    roadmap_okrs: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM roadmap_okrs WHERE project_id = ?), ?, ?, ?)",
    // D690 (#1693): Build's filings, read back as `step-<id>`.
    formation_steps: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM formation_steps WHERE project_id = ?), ?, ?, ?)",
    validation_decisions: "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, ?, ? || (SELECT CAST(MAX(id) AS TEXT) FROM validation_decisions WHERE project_id = ?), ?, ?, ?)",
  }[readback.table];
  return env.DB.prepare(sql).bind(...common, prefix, input.projectId, ...tail);
}

export async function logCycleWrite(env: Env, input: CycleWrite): Promise<void> {
  await logCycleWriteStatement(env, input).run();
}

type Creator = { name: string | null; created_at: string | null };
type CreatorStore = Store | 'mvp_features' | 'roadmap_okrs';

/**
 * D691 decision 12 (#1699): a Raise record's creator column, for a record
 * with no create row: `scored_by` (its first score), the version marker's
 * `updated_by`, a link's `created_by`, a file's `uploaded_by_user_id`, the
 * base scenario's `owner_user_id`; a prospect has only its date, and a
 * use-of-funds section neither.
 */
async function raiseCreatorFor(env: Env, store: RaiseStore, id: string, projectId: number): Promise<Creator | null> {
  const n = Number(id);
  const numeric = Number.isSafeInteger(n) && n > 0;
  switch (store) {
    case 'readiness_items':
      return env.DB.prepare(
        `SELECT u.name, COALESCE(s.scored_at, i.created_at) AS created_at FROM readiness_items i
           LEFT JOIN readiness_scores s ON s.id = (SELECT MIN(f.id) FROM readiness_scores f WHERE f.item_id = i.id)
           LEFT JOIN users u ON u.id = s.scored_by
          WHERE i.project_id = ? AND i.item_key = ?`,
      ).bind(projectId, id).first<Creator>();
    case 'spinout_deck_overrides':
      return numeric ? env.DB.prepare(
        `SELECT u.name, o.updated_at AS created_at FROM spinout_deck_overrides o LEFT JOIN users u ON u.id = o.updated_by
          WHERE o.project_id = ? AND o.version = ? ORDER BY (o.field_key = '_version') DESC, o.id LIMIT 1`,
      ).bind(projectId, n).first<Creator>() : null;
    case 'pitch_deck_share_tokens':
      return numeric ? env.DB.prepare(
        `SELECT u.name, t.created_at FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
           LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ? AND d.project_id = ?`,
      ).bind(n, projectId).first<Creator>() : null;
    case 'data_room_files':
      return numeric ? env.DB.prepare(
        'SELECT u.name, f.created_at FROM data_room_files f LEFT JOIN users u ON u.id = f.uploaded_by_user_id WHERE f.id = ? AND f.project_id = ?',
      ).bind(n, projectId).first<Creator>() : null;
    case 'cap_table_scenarios':
      return env.DB.prepare(
        `SELECT u.name, s.created_at FROM cap_table_scenarios s LEFT JOIN users u ON u.id = s.owner_user_id
          WHERE s.project_id = ? AND COALESCE(s.is_variant, 0) = 0 ORDER BY s.updated_at DESC LIMIT 1`,
      ).bind(projectId).first<Creator>();
    case 'raise_prospects':
      return numeric ? env.DB.prepare('SELECT NULL AS name, p.created_at FROM raise_prospects p WHERE p.id = ? AND p.project_id = ?')
        .bind(n, projectId).first<Creator>() : null;
    case 'use_of_funds':
      return null;
  }
}

/** Literal lookups only; legacy rows are never updated to manufacture a creator. */
async function creatorFor(env: Env, store: CreatorStore, id: string, projectId: number): Promise<Creator | null> {
  if (isRaiseStore(store)) return raiseCreatorFor(env, store, id, projectId);
  if (store === 'competitor_candidates') {
    return env.DB.prepare('SELECT NULL AS name, c.created_at FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id WHERE c.id = ? AND a.project_id = ?').bind(id, projectId).first<Creator>();
  }
  const n = Number(id.replace(/^(signal|revenue|waitlist)-/, ''));
  if (!Number.isSafeInteger(n) || n < 1) return null;
  switch (store) {
    case 'pain_groups':
      return env.DB.prepare('SELECT u.name, p.created_at FROM pain_groups p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ? AND p.project_id = ?').bind(n, projectId).first<Creator>();
    case 'hypotheses':
      return env.DB.prepare('SELECT u.name, h.created_at FROM hypotheses h LEFT JOIN users u ON u.id = h.created_by WHERE h.id = ? AND h.project_id = ?').bind(n, projectId).first<Creator>();
    case 'customer_segments':
      return env.DB.prepare('SELECT u.name, s.created_at FROM customer_segments s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ? AND s.project_id = ?').bind(n, projectId).first<Creator>();
    case 'discovery_interviews':
      return env.DB.prepare('SELECT NULL AS name, i.created_at FROM discovery_interviews i WHERE i.id = ? AND i.project_id = ?').bind(n, projectId).first<Creator>();
    case 'demand_signals':
      return env.DB.prepare('SELECT u.name, s.created_at FROM demand_signals s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ? AND s.project_id = ?').bind(n, projectId).first<Creator>();
    case 'interview_sessions':
      return env.DB.prepare('SELECT u.name, s.created_at FROM interview_sessions s JOIN discovery_interviews i ON i.id = s.interview_id LEFT JOIN users u ON u.id = s.created_by_user_id WHERE s.id = ? AND i.project_id = ?').bind(n, projectId).first<Creator>();
    case 'mvp_must_haves':
    case 'mvp_features':
      return env.DB.prepare('SELECT u.name, f.created_at FROM mvp_features f LEFT JOIN users u ON u.id = f.created_by WHERE f.id = ? AND f.project_id = ?').bind(n, projectId).first<Creator>();
    case 'roadmap_okrs':
      return env.DB.prepare('SELECT u.name, r.created_at FROM roadmap_okrs r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.project_id = ?').bind(n, projectId).first<Creator>();
    case 'revenue_entries':
      return env.DB.prepare('SELECT u.name, r.created_at FROM revenue_entries r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.project_id = ?').bind(n, projectId).first<Creator>();
    case 'waitlist_signups':
      return env.DB.prepare('SELECT NULL AS name, w.created_at FROM waitlist_signups w WHERE w.id = ? AND w.project_id = ? AND (w.audience IS NULL OR w.audience = \'customer\')').bind(n, projectId).first<Creator>();
    case 'hypothesis_pain_links':
      return env.DB.prepare('SELECT NULL AS name, l.created_at FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id WHERE l.id = ? AND h.project_id = ?').bind(n, projectId).first<Creator>();
    default:
      // Verdict logs every decision it records, so it has no creator to fall back on.
      return null;
  }
}

export type ActivityItem = { a: string; b: string; action: string; created_at: string };
export type ActivityPage = { items: ActivityItem[]; total: number; page: number; page_size: 20 };

/** New rows match the entity exactly. An explicit matcher admits older shapes. */
export async function activityFor(env: Env, input: {
  projectId: number;
  entityType: string;
  entityId: string;
  page?: number;
  oldRows?: OldRowsMatcher;
  store?: CreatorStore;
}): Promise<ActivityPage> {
  const page = Number.isSafeInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  const oldTypes = JSON.stringify(input.oldRows?.entityTypes ?? []);
  const oldActions = JSON.stringify(input.oldRows?.actions ?? []);
  const oldId = input.oldRows?.idWithoutPrefix && input.entityId.startsWith(input.oldRows.idWithoutPrefix)
    ? input.entityId.slice(input.oldRows.idWithoutPrefix.length) : input.entityId;
  const args = [input.projectId, input.entityType, input.entityId, oldTypes, input.entityId, oldActions, oldId];
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
       SUM(CASE WHEN action LIKE '%created' OR action = 'interview_logged' THEN 1 ELSE 0 END) AS creates
       FROM activity_logs WHERE project_id = ? AND (
       (entity_type = ? AND entity_id = ?)
       OR (entity_type IN (SELECT value FROM json_each(?)) AND entity_id = ?)
       OR (entity_type IS NULL AND action IN (SELECT value FROM json_each(?))
           AND CASE WHEN json_valid(details) THEN CAST(json_extract(details, '$.id') AS TEXT) ELSE NULL END = ?))`,
  ).bind(...args).first<{ n: number; creates: number }>();
  const totalLogs = Number(count?.n ?? 0);
  const rows = await env.DB.prepare(
    `SELECT a.action, a.details, a.created_at, u.name AS actor_name
       FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.project_id = ? AND (
       (a.entity_type = ? AND a.entity_id = ?)
       OR (a.entity_type IN (SELECT value FROM json_each(?)) AND a.entity_id = ?)
       OR (a.entity_type IS NULL AND a.action IN (SELECT value FROM json_each(?))
           AND CASE WHEN json_valid(a.details) THEN CAST(json_extract(a.details, '$.id') AS TEXT) ELSE NULL END = ?))
      ORDER BY a.created_at DESC, a.id DESC LIMIT 20 OFFSET ?`,
  ).bind(...args, (page - 1) * 20).all<{ action: string; details: string | null; created_at: string; actor_name: string | null }>();
  const items = (rows.results ?? []).map((r) => ({
    a: r.action.endsWith('_created') || r.action === 'interview_logged'
      ? (r.actor_name ? `Created by ${r.actor_name}` : `Created ${r.created_at.slice(0, 10)}`)
      : `${String(r.details ?? r.action).replace(/\s+/g, ' ').trim()}${r.actor_name ? ` by ${r.actor_name}` : ''}`,
    b: r.created_at,
    action: r.action,
    created_at: r.created_at,
  }));
  // Older rows have no attributed activity. The creator column is an actual
  // source where one exists; otherwise only the date can be stated.
  let total = totalLogs;
  if (Number(count?.creates ?? 0) === 0 && input.store) {
    const creator = await creatorFor(env, input.store, input.entityId, input.projectId);
    if (creator?.created_at) {
      total += 1;
      if ((page - 1) * 20 <= totalLogs && totalLogs < page * 20) items.push({
        a: creator.name ? `Created by ${creator.name}` : `Created ${creator.created_at.slice(0, 10)}`,
        b: creator.created_at,
        action: 'created',
        created_at: creator.created_at,
      });
    }
  }
  return { items, total, page, page_size: 20 };
}
