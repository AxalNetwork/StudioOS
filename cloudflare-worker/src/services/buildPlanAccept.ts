/**
 * D1066 (#2936, part 3 of #2426) — a plan item becomes a Build row only when
 * the venture's founder accepts it. Accept, Edit and accept, Dismiss and
 * Accept all in a module, and each Build row's evidence trail.
 *
 * ACCEPT CLAIMS, THEN WRITES ONCE. The claim is the proposal's own row moving
 * off `proposed` (`WHERE status = 'proposed'`), so two presses, or a press
 * racing a newer plan's withdrawal, decide it once. The write is one D1 batch:
 * the module's row through its statement builder (`buildCreates.ts`), the
 * item's landed row, one `build_evidence_links` row per piece of evidence, one
 * `fill_provenance` row per carried field and the activity line under its
 * module. A batch that fails writes none of it, and the claim is handed back.
 *
 * EVERY STATEMENT AFTER THE WRITER NAMES THE ROW THROUGH THE ITEM. The landed
 * update reads the new id (the venture's newest row, exact inside a batch,
 * D1064 §3; a prototype test by its own uid, because its INSERT can write
 * nothing) and the links and provenance read `landed_id` back from the item.
 * A writer that wrote no row leaves `landed_id` NULL, and the provenance
 * insert's NOT NULL fails the whole batch.
 *
 * PROVENANCE IN TODAY'S COLUMNS. `fill_provenance` has no AUTOFILL source
 * columns yet (#2431 owns them). Each carried field's row keeps the proposal
 * (`ai_proposal_id`), both values and `edited`, and `citation_json` carries
 * `source_kind: 'module'`, `source_ref`, `source_label` and `prior_value`
 * (null: Accept creates the row, so undo is its removal). AUTOFILL can copy
 * them into its columns when they land.
 *
 * WHO. The venture's founders only (`ownsVenture`, #2426 owner question 3);
 * an admin reads. Refusals carry `code`: `decided`, `writer_refused`,
 * `not_this_project`, `plan_paused`, `invalid_edit`.
 */
import type { Env, User } from '../types';
import { neverFillReason } from './fills/neverFill';
import {
  experimentCreateStatements, featureCreateStatements, formationStepCreateStatements, mustHaveCreateStatements,
  riskCreateStatements, roadmapCreateStatements,
} from './buildCreates';
import { logCycleWriteStatement, type BuildModuleSlug } from './cycleActivity';
import { canReadDecision, ownsVenture, type ProjectRef } from '../routes/_founder_validate_helpers';
import { decisionById } from './verdict';
import { itemWordingEdit } from './buildPlanWord';

type Prepared = ReturnType<Env['DB']['prepare']>;
type Ref = { kind: string; ref: string; label: string; source_label?: string };

export const MODULE_ACCEPT_LIMIT = 50;
export const BUILD_TABLES = ['mvp_features', 'venture_risks', 'roadmap_okrs', 'formation_steps', 'hypothesis_experiments'] as const;
export type BuildTable = typeof BUILD_TABLES[number];

export class PlanItemError extends Error {
  // D1068 adds the handoff and link refusals (services/buildHandoffs.ts); D968 a bad page of states.
  code: 'decided' | 'writer_refused' | 'not_this_project' | 'plan_paused' | 'invalid_edit'
    | 'no_plan' | 'not_accepted' | 'invalid_handoff' | 'repository_not_picked' | 'too_long' | 'pii_found' | 'marker_unknown' | 'already_linked'
    | 'invalid_page';
  status: 400 | 403 | 404 | 409 | 422 | 502;
  /** Fields the refusal carries beside its code and sentence, such as a privacy check's finding kinds. */
  extra?: Record<string, unknown>;
  constructor(code: PlanItemError['code'], status: PlanItemError['status'], message: string, extra?: Record<string, unknown>) {
    super(message); this.code = code; this.status = status; this.extra = extra;
  }
}

const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return null; } };

export type ItemRow = {
  uid: string; plan_id: number; project_id: number; module: string; kind: string; item_key: string;
  proposal_uid: string; evidence_json: string; marker: string; landed_table: string | null; landed_id: string | null;
  status: string; payload_json: string; decided_payload_json: string | null; source_ref: string | null; source_label: string | null;
  plan_status: string; founder_id: number | null; company_id: number | null;
};

/** One item with its proposal, its plan and its venture; null when no live venture holds it. */
export async function loadItem(env: Env, uid: string): Promise<ItemRow | null> {
  return await env.DB.prepare(`SELECT i.uid, i.plan_id, i.project_id, i.module, i.kind, i.item_key, i.proposal_uid, i.evidence_json, i.marker,
      i.landed_table, i.landed_id, q.status, q.payload_json, q.decided_payload_json, q.source_ref, q.source_label,
      p.status AS plan_status, pr.founder_id, pr.company_id
    FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    JOIN build_plans p ON p.id = i.plan_id AND p.project_id = i.project_id
    JOIN projects pr ON pr.id = i.project_id AND pr.deleted_at IS NULL
    WHERE i.uid = ?`).bind(uid).first<ItemRow>();
}

/** The founder's gate: an admin or anyone else is refused as `not_this_project`, as D1065's prepare is. */
export function assertFounder(item: Pick<ItemRow, 'founder_id'>, user: User) {
  if (!ownsVenture({ founder_id: item.founder_id } as ProjectRef, user)) {
    throw new PlanItemError('not_this_project', 404, 'This plan belongs to the venture’s founders.');
  }
}

function assertOpen(item: ItemRow) {
  if (item.plan_status === 'paused') throw new PlanItemError('plan_paused', 409, 'The plan is paused. Record a new decision to resume.');
  if (item.status !== 'proposed' || !['draft', 'open'].includes(item.plan_status)) {
    throw new PlanItemError('decided', 409, 'This item is already decided.');
  }
}

// ─────────────────────────────────────────────── the editable fields

const text = (v: unknown, max: number): string | null | false => {
  if (v == null) return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | false => (values as readonly unknown[]).includes(v) ? v as T : false;

/** What a founder may change on each kind; every other payload key stays as proposed. */
const EDITABLE: Record<string, string[]> = {
  feature: ['title', 'description', 'added_value', 'effort'],
  'must-have': ['title'],
  'prototype-test': ['title', 'method', 'target'],
  risk: ['title', 'severity', 'mitigation'],
  roadmap: ['title', 'lane'],
  'formation-step': ['title'],
  'connect-door': [],
};

/**
 * The payload as it will land: the proposal (or the founder's saved edit),
 * with the edit's allowed keys applied and checked. A key the kind does not
 * take is refused rather than dropped.
 */
export function landedPayload(kind: string, base: Record<string, unknown>, edit: unknown): Record<string, unknown> {
  const out = { ...base };
  if (edit == null) return out;
  if (typeof edit !== 'object' || Array.isArray(edit)) throw new PlanItemError('invalid_edit', 400, 'An edit is an object of the item’s fields.');
  const allowed = EDITABLE[kind] || [];
  for (const [k, v] of Object.entries(edit as Record<string, unknown>)) {
    if (!allowed.includes(k)) throw new PlanItemError('invalid_edit', 400, `${k} cannot be changed on this item.`);
    const checked = k === 'title' ? text(v, 200)
      : k === 'description' || k === 'mitigation' ? text(v, 2000)
      : k === 'method' || k === 'target' ? text(v, 500)
      : k === 'added_value' ? oneOf(v, ['High', 'Medium', 'Low'] as const)
      : k === 'effort' ? oneOf(v, ['S', 'M', 'L', 'XL'] as const)
      : k === 'severity' ? oneOf(v, ['high', 'medium', 'low'] as const)
      : oneOf(v, ['Now', 'Next', 'Later'] as const);
    if (checked === false || (k === 'title' && !checked)) throw new PlanItemError('invalid_edit', 400, `${k} is not a value this item takes.`);
    out[k] = checked;
  }
  return out;
}

const changed = (kind: string, a: Record<string, unknown>, b: Record<string, unknown>) =>
  (EDITABLE[kind] || []).some((k) => (a[k] ?? null) !== (b[k] ?? null));

// ─────────────────────────────────────────────── landing

/** The item's landed row, read inside the batch. One literal statement per table. */
const LANDED: Record<BuildTable, string> = {
  mvp_features: "UPDATE build_plan_items SET landed_table = 'mvp_features', landed_id = (SELECT CAST(MAX(id) AS TEXT) FROM mvp_features WHERE project_id = ?) WHERE uid = ?",
  venture_risks: "UPDATE build_plan_items SET landed_table = 'venture_risks', landed_id = (SELECT CAST(MAX(id) AS TEXT) FROM venture_risks WHERE project_id = ?) WHERE uid = ?",
  roadmap_okrs: "UPDATE build_plan_items SET landed_table = 'roadmap_okrs', landed_id = (SELECT CAST(MAX(id) AS TEXT) FROM roadmap_okrs WHERE project_id = ?) WHERE uid = ?",
  formation_steps: "UPDATE build_plan_items SET landed_table = 'formation_steps', landed_id = (SELECT CAST(MAX(id) AS TEXT) FROM formation_steps WHERE project_id = ?) WHERE uid = ?",
  hypothesis_experiments: "UPDATE build_plan_items SET landed_table = 'hypothesis_experiments', landed_id = (SELECT CAST(id AS TEXT) FROM hypothesis_experiments WHERE project_id = ? AND uid = ?) WHERE uid = ?",
};

/** Each carried field: its column, the value written, and the value the plan proposed. */
type Landing = { table: BuildTable | null; writer: Prepared[]; landed?: Prepared; fields: Array<[column: string, written: unknown, proposed: unknown]> };

const num = (v: unknown) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

async function landing(env: Env, item: ItemRow, userId: number, p: Record<string, unknown>, o: Record<string, unknown>): Promise<Landing> {
  const projectId = item.project_id;
  const title = String(p.title ?? '').trim();
  const landed = (table: BuildTable, ...extra: unknown[]) => env.DB.prepare(LANDED[table]).bind(projectId, ...extra, item.uid);
  switch (item.kind) {
    case 'feature':
      return { table: 'mvp_features', landed: landed('mvp_features'),
        writer: featureCreateStatements(env, { projectId, userId, title, description: (p.description as string) ?? null,
          impact: String(p.added_value ?? 'Medium'), effort: String(p.effort ?? 'M'), scope: null, painId: num(p.pain_group_id), hypothesisId: num(p.hypothesis_id) }),
        fields: [['title', title, o.title], ['description', p.description, o.description], ['added_value', p.added_value ?? 'Medium', o.added_value ?? 'Medium'], ['pain_group_id', p.pain_group_id, o.pain_group_id], ['hypothesis_id', p.hypothesis_id, o.hypothesis_id]] };
    case 'must-have':
      return { table: 'mvp_features', landed: landed('mvp_features'),
        writer: mustHaveCreateStatements(env, { projectId, userId, title, hypothesisId: num(p.hypothesis_id), status: 'Backlog', owner: null, due: null, links: [] }),
        fields: [['title', title, o.title], ['hypothesis_id', p.hypothesis_id, o.hypothesis_id]] };
    case 'prototype-test': {
      const uid = crypto.randomUUID();
      const hypothesisId = num(p.hypothesis_id);
      if (!hypothesisId) throw new PlanItemError('writer_refused', 409, 'This test names no claim, so it cannot be planned.');
      return { table: 'hypothesis_experiments', landed: landed('hypothesis_experiments', uid),
        writer: experimentCreateStatements(env, { projectId, userId, uid, hypothesisId, title, method: (p.method as string) ?? 'Prototype test', target: (p.target as string) ?? null }),
        fields: [['title', title, o.title], ['method', p.method ?? 'Prototype test', o.method ?? 'Prototype test'], ['target', p.target, o.target], ['hypothesis_id', hypothesisId, o.hypothesis_id]] };
    }
    case 'risk': {
      const severity = oneOf(p.severity, ['high', 'medium', 'low'] as const) || 'medium';
      return { table: 'venture_risks', landed: landed('venture_risks'),
        writer: riskCreateStatements(env, { projectId, userId, title, severity, mitigation: (p.mitigation as string) ?? null }),
        fields: [['title', title, o.title], ['severity', severity, o.severity]] };
    }
    case 'roadmap': {
      // A commitment carries no lane; it lands in Next, the column a planned item waits in.
      const column = (oneOf(p.lane, ['Now', 'Next', 'Later'] as const) || 'Next').toLowerCase() as 'now' | 'next' | 'later';
      const end = await env.DB.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM roadmap_okrs WHERE project_id = ? AND kanban_status = ?')
        .bind(projectId, column).first<{ n: number }>();
      const featureId = num(p.feature_id);
      if (featureId && !await env.DB.prepare('SELECT id FROM mvp_features WHERE id = ? AND project_id = ?').bind(featureId, projectId).first()) {
        throw new PlanItemError('writer_refused', 409, 'The feature this item names is no longer on this venture.');
      }
      return { table: 'roadmap_okrs', landed: landed('roadmap_okrs'),
        writer: roadmapCreateStatements(env, { projectId, userId, title, column, sortOrder: Number(end?.n ?? 0), owner: null, due: null,
          kpi: typeof p.kpi_key === 'string' ? p.kpi_key : null, theme: null, featureId, waitsOn: null }),
        fields: [['objective', title, o.title], ['kanban_status', column, String(o.lane ?? 'Next').toLowerCase()], ['feature_id', featureId, o.feature_id], ['kpi_key', p.kpi_key, o.kpi_key]] };
    }
    case 'formation-step':
      return { table: 'formation_steps', landed: landed('formation_steps'),
        writer: formationStepCreateStatements(env, { projectId, userId, title }), fields: [['title', title, o.title]] };
    case 'connect-door':
      // A door, never a system write (#2426): accepting it lands no row.
      return { table: null, fields: [], writer: [logCycleWriteStatement(env, { projectId, userId, cycle: 'build', module: 'operating-systems', entityId: 'project',
        action: 'build_plan_door_accepted', summary: 'Plan item accepted: a tool to connect' })] };
    default:
      throw new PlanItemError('writer_refused', 409, 'This kind of item has no Build writer.');
  }
}

// ─────────────────────────────────────────────── accept, edit, dismiss

const CLAIM = `UPDATE ai_rail_proposals SET status = ?, decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE uid = ? AND status = 'proposed'
  AND EXISTS (SELECT 1 FROM build_plan_items i JOIN build_plans p ON p.id = i.plan_id WHERE i.proposal_uid = ? AND p.status IN ('draft', 'open'))`;
const HAND_BACK = `UPDATE ai_rail_proposals SET status = 'proposed', decided_payload_json = ?, decided_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE uid = ? AND status IN ('accepted', 'edited')`;
const LINK = `INSERT OR IGNORE INTO build_evidence_links (project_id, build_table, build_id, evidence_kind, evidence_ref, label_snapshot, plan_item_uid)
  SELECT i.project_id, i.landed_table, i.landed_id, ?, ?, ?, i.uid FROM build_plan_items i WHERE i.uid = ?`;
const PROVENANCE = `INSERT INTO fill_provenance (target_table, target_row_id, target_column, fill_class, proposed_value, written_value, edited, citation_json, decided_by, target_row_ref, ai_proposal_id, ai_usage_log_id)
  SELECT i.landed_table, CAST(i.landed_id AS INTEGER), ?, 'sourced', ?, ?, ?, ?, ?, ?, (SELECT id FROM ai_rail_proposals WHERE uid = i.proposal_uid), ?
  FROM build_plan_items i WHERE i.uid = ?`;

/** D1071: the fields Eadwyn's wording can carry; a kept wording names its run on these only. */
const WORDED_COLUMNS = new Set(['title', 'objective', 'description']);

const value = (v: unknown) => (v == null ? '' : String(v));

export async function acceptItem(env: Env, user: User, uid: string, edit?: unknown) {
  const item = await loadItem(env, uid);
  if (!item) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  assertFounder(item, user);
  assertOpen(item);
  const proposed = parse(item.payload_json) || {};
  const saved = parse(item.decided_payload_json);
  const payload = landedPayload(item.kind, saved || proposed, edit);
  const status = changed(item.kind, proposed, payload) ? 'edited' : 'accepted';
  const land = await landing(env, item, user.id, payload, proposed);
  // Every field the plan carried must be one a fill may write (D777).
  for (const [column] of land.fields) {
    if (land.table && neverFillReason(`${land.table}.${column}`)) throw new PlanItemError('writer_refused', 409, 'This field is never filled for you.');
  }
  const claim = await env.DB.prepare(CLAIM).bind(status, JSON.stringify(payload), item.proposal_uid, item.proposal_uid).run();
  if (!claim.meta?.changes) throw new PlanItemError('decided', 409, 'This item is already decided.');
  const evidence: Ref[] = Array.isArray(parse(item.evidence_json)) ? parse(item.evidence_json) : [];
  // D1071: a kept wording rides on the saved payload; Accept names its proposal and run.
  const wording = payload.wording && typeof payload.wording === 'object' ? payload.wording as { uid?: unknown; usage_log_id?: unknown } : null;
  const wordingRun = wording && Number.isSafeInteger(Number(wording.usage_log_id)) && Number(wording.usage_log_id) > 0 ? Number(wording.usage_log_id) : null;
  const base = { source_kind: 'module', source_ref: item.source_ref, source_label: item.source_label, prior_value: null, plan_item_uid: item.uid, marker: item.marker };
  const citation = JSON.stringify(base);
  const wordedCitation = wording ? JSON.stringify({ ...base, wording: { proposal_uid: String(wording.uid ?? ''), usage_log_id: wordingRun } }) : citation;
  const batch: Prepared[] = [...land.writer];
  if (land.landed) {
    batch.push(land.landed);
    for (const e of evidence) batch.push(env.DB.prepare(LINK).bind(String(e.kind), String(e.ref), String(e.label ?? '').slice(0, 280), item.uid));
    for (const [column, written, was] of land.fields) {
      if (written == null || written === '') continue;
      const [before, after] = [value(was), value(written)];
      const worded = Boolean(wording) && WORDED_COLUMNS.has(column);
      batch.push(env.DB.prepare(PROVENANCE).bind(column, before, after, before.trim() !== after.trim() ? 1 : 0, worded ? wordedCitation : citation, user.id,
        `build_plan_item:${item.uid}`, worded ? wordingRun : null, item.uid));
    }
  }
  try {
    await env.DB.batch(batch);
  } catch {
    await env.DB.prepare(HAND_BACK).bind(item.decided_payload_json, item.proposal_uid).run().catch(() => {});
    console.warn('[build-plan] accept batch failed; the claim was handed back');
    throw new PlanItemError('writer_refused', 502, 'Build could not save this item. Nothing was saved; try again.');
  }
  const after = await loadItem(env, uid);
  return { uid, status, landed_table: after?.landed_table ?? null, landed_id: after?.landed_id ?? null, payload };
}

/**
 * Saves the founder's version on a proposed item; it stays proposed until
 * Accept. D1071: `wording` names an Eadwyn wording on this plan; its words
 * for the item are the edit (the founder's own `edit` keys over them), and
 * the saved payload names it so Accept records its run.
 */
export async function editItem(env: Env, user: User, uid: string, edit: unknown, wordingUid?: unknown) {
  const item = await loadItem(env, uid);
  if (!item) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  assertFounder(item, user);
  assertOpen(item);
  const proposed = parse(item.payload_json) || {};
  const kept = wordingUid == null ? null : await itemWordingEdit(env, user, uid, wordingUid);
  if (kept && edit != null && (typeof edit !== 'object' || Array.isArray(edit))) throw new PlanItemError('invalid_edit', 400, 'An edit is an object of the item’s fields.');
  const payload = landedPayload(item.kind, parse(item.decided_payload_json) || proposed, kept ? { ...kept.edit, ...(edit as object || {}) } : edit);
  if (kept) payload.wording = { uid: kept.wording.uid, usage_log_id: kept.wording.usage_log_id };
  // The founder's own words over a kept wording make them the founder's: the run no longer wrote them.
  else if (edit && typeof edit === 'object' && Object.keys(edit).some((k) => WORDED_COLUMNS.has(k))) delete payload.wording;
  const res = await env.DB.prepare(`UPDATE ai_rail_proposals SET decided_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status = 'proposed'`)
    .bind(JSON.stringify(payload), item.proposal_uid).run();
  if (!res.meta?.changes) throw new PlanItemError('decided', 409, 'This item is already decided.');
  if (kept) await kept.decide();
  return { uid, status: 'proposed', payload };
}

/** A dismissed item is never proposed again: preparation skips a discarded key (D1065). */
export async function dismissItem(env: Env, user: User, uid: string) {
  const item = await loadItem(env, uid);
  if (!item) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  assertFounder(item, user);
  assertOpen(item);
  const [res] = await env.DB.batch([
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'discarded', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status = 'proposed'`)
      .bind(item.proposal_uid),
    logCycleWriteStatement(env, { projectId: item.project_id, userId: user.id, cycle: 'build', module: item.module as BuildModuleSlug, entityId: 'project',
      action: 'build_plan_item_dismissed', summary: 'Plan item dismissed' }),
  ]);
  if (!res.meta?.changes) throw new PlanItemError('decided', 409, 'This item is already decided.');
  return { uid, status: 'discarded' };
}

/** Accept all in a module: each item through its own claim, at most 50, each outcome reported. */
export async function acceptModule(env: Env, user: User, projectId: number, scope: string, module: string) {
  const project = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!project) throw new PlanItemError('not_this_project', 404, 'This plan does not belong to this venture.');
  assertFounder(project, user);
  const plan = await env.DB.prepare(`SELECT id, status FROM build_plans WHERE project_id = ? AND scope = ? AND status IN ('draft', 'open', 'paused') ORDER BY id DESC LIMIT 1`)
    .bind(projectId, scope).first<{ id: number; status: string }>();
  if (plan?.status === 'paused') throw new PlanItemError('plan_paused', 409, 'The plan is paused. Record a new decision to resume.');
  const rows = plan ? (await env.DB.prepare(`SELECT i.uid FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    WHERE i.plan_id = ? AND i.module = ? AND q.status = 'proposed' ORDER BY i.item_key LIMIT ?`).bind(plan.id, module, MODULE_ACCEPT_LIMIT + 1).all<{ uid: string }>()).results || [] : [];
  const results: Array<{ uid: string; ok: boolean; status?: string; code?: string; message?: string }> = [];
  for (const r of rows.slice(0, MODULE_ACCEPT_LIMIT)) {
    try {
      const out = await acceptItem(env, user, r.uid);
      results.push({ uid: r.uid, ok: true, status: out.status });
    } catch (e) {
      if (!(e instanceof PlanItemError)) throw e;
      results.push({ uid: r.uid, ok: false, code: e.code, message: e.message });
    }
  }
  return { module, accepted: results.filter((r) => r.ok).length, results, more: rows.length > MODULE_ACCEPT_LIMIT };
}

// ─────────────────────────────────────────────── the evidence trail

/** The Build row on this venture, one literal statement per table. */
const ROW: Record<BuildTable, string> = {
  mvp_features: 'SELECT id FROM mvp_features WHERE id = ? AND project_id = ?',
  venture_risks: 'SELECT id FROM venture_risks WHERE id = ? AND project_id = ?',
  roadmap_okrs: 'SELECT id FROM roadmap_okrs WHERE id = ? AND project_id = ?',
  formation_steps: 'SELECT id FROM formation_steps WHERE id = ? AND project_id = ?',
  hypothesis_experiments: 'SELECT id FROM hypothesis_experiments WHERE id = ? AND project_id = ?',
};

export const NOT_SENT_YET = 'Sending to a tool is not built yet (Validate → Build part 5), so nothing is recorded as sent.';

/**
 * Each Build row's trail: the evidence it rests on, the plan item it came
 * from, the decision (only for `canReadDecision`), where it was sent and what
 * came back, each with its source and date. A partner reads no decision and
 * no commitment, as the plan read hides them (D1065).
 */
export async function evidenceTrail(env: Env, user: User, project: ProjectRef & { id: number }, table: BuildTable, id: number) {
  if (!await env.DB.prepare(ROW[table]).bind(id, project.id).first()) return null;
  const decisionReader = canReadDecision(project, user);
  const links = (await env.DB.prepare(`SELECT evidence_kind, evidence_ref, label_snapshot, plan_item_uid, created_at FROM build_evidence_links
    WHERE project_id = ? AND build_table = ? AND build_id = ? ORDER BY id`).bind(project.id, table, String(id)).all<any>()).results || [];
  const item = await env.DB.prepare(`SELECT i.uid, i.marker, i.evidence_json, q.status, q.decided_at, p.decision_id
    FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid JOIN build_plans p ON p.id = i.plan_id
    WHERE i.project_id = ? AND i.landed_table = ? AND i.landed_id = ? ORDER BY q.decided_at DESC LIMIT 1`)
    .bind(project.id, table, String(id)).first<any>();
  const sources = new Map<string, string>(((parse(item?.evidence_json) || []) as Ref[]).map((e) => [`${e.kind}:${e.ref}`, e.source_label || 'Typed']));
  const hidden = decisionReader ? [] : ['decision', 'commitment'];
  const evidence = links.filter((l) => !hidden.includes(l.evidence_kind)).map((l) => ({
    kind: l.evidence_kind, ref: l.evidence_ref, label: l.label_snapshot,
    source_label: sources.get(`${l.evidence_kind}:${l.evidence_ref}`) ?? null, linked_at: l.created_at,
  }));
  let decision: { decision: string; state: string; decided_at: string } | null | undefined;
  if (decisionReader) {
    // Through the Verdict's own reader (D693): only `services/verdict.ts` reads its tables.
    const d = item?.decision_id ? await decisionById(env, project.id, Number(item.decision_id)) : null;
    decision = d ? { decision: d.decision, state: d.state, decided_at: d.decided_at } : null;
  }
  const fed = (await env.DB.prepare(`SELECT f.kind, f.module, f.first_seen_at, f.last_seen_at, g.provider_key
    FROM connector_fed_items f LEFT JOIN integrations g ON g.id = f.integration_id
    WHERE f.project_id = ? AND f.local_table = ? AND f.local_id = ? ORDER BY f.id`).bind(project.id, table, id).all<any>()).results || [];
  return {
    table, id,
    evidence,
    accepted: item ? { plan_item_uid: item.uid, status: item.status, decided_at: item.decided_at, ...(decisionReader ? { marker: item.marker } : {}) } : null,
    ...(decisionReader ? { decision } : {}),
    sent: { recorded: false, reason: NOT_SENT_YET },
    came_back: fed.map((f) => ({ source: f.provider_key ?? null, kind: f.kind, module: f.module, first_seen_at: f.first_seen_at, last_seen_at: f.last_seen_at })),
  };
}
