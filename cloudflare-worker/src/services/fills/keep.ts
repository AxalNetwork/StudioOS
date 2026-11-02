/**
 * D1326 (#3487, #2431 part 3) — what happens to a proposal after the member
 * decides: the record of what a form's Save kept, Accept all for row
 * proposals, and the undo of one fill.
 *
 * "EADWYN PROPOSES AND A PERSON ACCEPTS" (D1323 §4). Nothing here writes a
 * value the member did not keep:
 *
 *   recordKept   runs AFTER the form's own Save. It re-reads the row the Save
 *                wrote and keeps only the fields that still equal what Eadwyn
 *                proposed, so a value the member changed before Save is theirs
 *                and files no Eadwyn row. Each proposal uid is decided on its
 *                own: kept is `accepted` with one `fill_provenance` row (its
 *                source and `prior_value`), anything else says why.
 *   acceptRows   Accept all for an Add form's row proposals: at most
 *                ACCEPT_ALL_MAX (#2431 question 3, A), each row through the
 *                form's own writer (`featureCreateStatements` for Add feature,
 *                the statements `POST /features` runs), each outcome reported.
 *   undoFill     puts back what a fill replaced, through a literal statement on
 *                that column only, and only while the field still holds what
 *                the fill wrote: a field the member edited since is refused.
 *
 * Every read binds the member (`user_id`) or the venture; never-fill is
 * checked again at each step (`recordFill` checks it a third time).
 */
import type { Env } from '../../types';
import { featureCreateStatements, mustHaveCreateStatements, createdId } from '../buildCreates';
import { WriterError, createHypothesis, writeSegment, writeTheme } from '../validateWriters';
import { decideRail, getRail } from '../railProposals';
import { fieldsOf, offeredToEadwyn, type FillField } from './fields';
import { neverFillReason } from './neverFill';
import { ensureFillProvenanceSchema, recordFill } from './provenance';
import { ACCEPT_ALL_MAX } from './formRun';
import type { FillClass } from './types';

const same = (a: unknown, b: unknown) => a != null && b != null && String(a).trim() === String(b).trim();

/** Where the fill came from, and what it replaced, on the row `recordFill` wrote (migration 643). */
async function noteSource(env: Env, provenanceId: number, prior: unknown) {
  await env.DB.prepare(
    "UPDATE fill_provenance SET source_kind = 'eadwyn', source_ref = NULL, source_label = NULL, prior_value = ? WHERE id = ?",
  ).bind(prior == null || String(prior).trim() === '' ? null : String(prior), provenanceId).run();
}

export type KeepOutcome = { uid: string; field: string | null; outcome: 'kept'; provenance_id: number }
  | { uid: string; field: string | null; outcome: 'not_kept' | 'refused'; why: string };

/**
 * After the form's Save: one decision per proposal uid, and one provenance row
 * per field that still holds Eadwyn's value. `row` is the record as the Save
 * left it, read by the caller on this venture.
 */
export async function recordKept(env: Env, a: {
  userId: number; page: string; form: string; projectId: number | null; recordId: number; row: Record<string, unknown>; uids: readonly string[];
  /** D1329: for a record that is not a venture's, the scopes a proposal for this row may carry (its record, its parent). */
  scopeRefs?: readonly string[];
}): Promise<KeepOutcome[]> {
  await ensureFillProvenanceSchema(env);
  const fields = fieldsOf(a.page, a.form);
  const table = fields[0]?.table;
  const out: KeepOutcome[] = [];
  for (const uid of [...new Set(a.uids)]) {
    const p = await getRail(env, a.userId, uid);
    const name = typeof p?.payload.field === 'string' ? p.payload.field : null;
    const refuse = (why: string): KeepOutcome => ({ uid, field: name, outcome: 'refused', why });
    if (!p) { out.push(refuse('not_found')); continue; }
    if (p.rail_option !== `form:${a.form}` || p.kind !== 'proposal' || !name) { out.push(refuse('not_this_form')); continue; }
    if (a.scopeRefs) {
      if (!a.scopeRefs.includes(String(p.payload.scope ?? ''))) { out.push(refuse('other_record')); continue; }
    } else {
      if (Number(p.payload.project) !== a.projectId) { out.push(refuse('other_venture')); continue; }
      if (p.record_ref && p.record_ref !== `${table}:${a.recordId}`) { out.push(refuse('other_record')); continue; }
    }
    const f = fields.find((x) => x.field === name);
    if (neverFillReason(name) || (f && neverFillReason(`${f.table}.${f.column}`))) { out.push(refuse('never_fill')); continue; }
    if (!f || !offeredToEadwyn(f)) { out.push(refuse('not_offered')); continue; }
    if (p.status !== 'proposed') { out.push(refuse('decided')); continue; }
    const written = a.row[f.column];
    if (!same(written, p.payload.value)) {
      // The Save did not keep it: the member's value is theirs, and the proposal is let go.
      await decideRail(env, a.userId, uid, 'discard');
      out.push({ uid, field: name, outcome: 'not_kept', why: 'changed_before_save' });
      continue;
    }
    const decided = await decideRail(env, a.userId, uid, 'accept');
    if (!decided) { out.push(refuse('decided')); continue; }
    try {
      const id = await recordFill(env, {
        target: { table: f.table, rowId: a.recordId, column: f.column }, proposalId: null, aiProposalId: await railRowId(env, a.userId, uid),
        usageLogId: p.usage_log_id, fillClass: f.class as FillClass, proposedValue: String(p.payload.value), writtenValue: String(written),
        citation: (p.payload.citation as never) ?? null, model: p.model, task: p.rail_option, decidedBy: a.userId,
      });
      await noteSource(env, id, p.payload.prior);
      out.push({ uid, field: name, outcome: 'kept', provenance_id: id });
    } catch (e) {
      console.error('[fills] record kept:', (e as Error)?.name);
      out.push(refuse('not_recorded'));
    }
  }
  return out;
}

async function railRowId(env: Env, userId: number, uid: string): Promise<number | null> {
  const r = await env.DB.prepare('SELECT id FROM ai_rail_proposals WHERE uid = ? AND user_id = ?').bind(uid, userId).first<{ id: number }>();
  return r ? Number(r.id) : null;
}

/** Each Add form's own writer for a whole row, by table. A table with none has no Accept all. */
type RowWriter = (env: Env, a: { projectId: number; userId: number; row: Record<string, unknown> }) => Promise<number | string>;
const EFFORTS = new Set(['S', 'M', 'L', 'XL']);
export const ROW_WRITERS: Readonly<Record<string, RowWriter>> = Object.freeze({
  /** Add feature: `POST /features`'s own statements and rules (a title; an owned pain theme and hypothesis; Impact is the founder's, Medium until they set it). */
  mvp_features: async (env, a) => {
    const title = typeof a.row.title === 'string' ? a.row.title.trim().slice(0, 300) : '';
    if (!title) return 'no_title';
    const effort = a.row.effort == null ? 'M' : String(a.row.effort);
    if (!EFFORTS.has(effort)) return 'invalid';
    const owned = async (sql: string, raw: unknown) => {
      if (raw == null) return null;
      const id = Number(raw);
      if (!Number.isSafeInteger(id) || id <= 0) return false;
      return (await env.DB.prepare(sql).bind(id, a.projectId).first()) ? id : false;
    };
    const painId = await owned('SELECT 1 FROM pain_groups WHERE id = ? AND project_id = ?', a.row.pain_group_id);
    const hypothesisId = await owned('SELECT 1 FROM hypotheses WHERE id = ? AND project_id = ? AND retired_at IS NULL', a.row.hypothesis_id);
    if (painId === false || hypothesisId === false) return 'unmatched';
    const results = await env.DB.batch(featureCreateStatements(env, {
      projectId: a.projectId, userId: a.userId, title, description: null, impact: 'Medium', effort, scope: null, painId, hypothesisId,
    }));
    return createdId(results);
  },
  // D1328 (#3489), part one: Validate's Add forms, each through its route's own writer.
  /** New theme: `writeTheme`, the title only (a severity and the quotes are the founder's). */
  pain_groups: async (env, a) => validateWrite(() => writeTheme(env, { projectId: a.projectId, userId: a.userId, title: a.row.title })),
  /** New segment: `writeSegment`, which answers an existing name instead of a second row. */
  customer_segments: async (env, a) => validateWrite(async () => {
    const out = await writeSegment(env, {
      projectId: a.projectId, userId: a.userId, name: a.row.name, source: 'manual',
      who_they_are: a.row.who_they_are, job_to_be_done: a.row.job_to_be_done, value_promised: a.row.value_promised,
    });
    return out.created ? out : 'duplicate';
  }),
  /** New hypothesis: `createHypothesis`, its claim and its two bars; no pain links, direction or owner. */
  hypotheses: async (env, a) => validateWrite(() => createHypothesis(env, {
    projectId: a.projectId, userId: a.userId, claim: a.row.claim, success_bar: a.row.success_bar, disproof: a.row.disproof,
  })),
});

/** A Validate writer's row id, or its refusal as a reason: a WriterError is the writer's own "no". */
async function validateWrite(write: () => Promise<{ id: number } | string>): Promise<number | string> {
  try {
    const out = await write();
    return typeof out === 'string' ? out : out.id;
  } catch (e) {
    if (e instanceof WriterError) return e.status === 404 ? 'unmatched' : 'invalid';
    throw e;
  }
}

/**
 * A writer for one form whose table another form shares, keyed `<page> / <form>`
 * (`FILL_FORMS`' words). Add must-have writes `mvp_features` as Add feature
 * does, but as a must-have: `POST /must-haves`' own statements.
 */
export const FORM_ROW_WRITERS: Readonly<Record<string, RowWriter>> = Object.freeze({
  'Founder · Build · Prototype / MVP / must-have': async (env, a) => {
    const title = typeof a.row.title === 'string' ? a.row.title.trim().slice(0, 200) : '';
    if (!title) return 'no_title';
    let hypothesisId: number | null = null;
    if (a.row.hypothesis_id != null) {
      const id = Number(a.row.hypothesis_id);
      if (!Number.isSafeInteger(id) || id <= 0) return 'unmatched';
      if (!(await env.DB.prepare('SELECT 1 FROM hypotheses WHERE id = ? AND project_id = ? AND retired_at IS NULL').bind(id, a.projectId).first())) return 'unmatched';
      hypothesisId = id;
    }
    const results = await env.DB.batch(mustHaveCreateStatements(env, {
      projectId: a.projectId, userId: a.userId, title, hypothesisId, status: 'Backlog', owner: null, due: null, links: [],
    }));
    return createdId(results);
  },
});

/**
 * D1329 (#3490): Add forms whose rows hang under a parent that is not a
 * venture, by table, each through its route's own statement. An agenda
 * session is `POST /api/events/:id/agenda`'s insert: a title, what happens,
 * and the next place in the running order; times, speakers and places are
 * the host's.
 */
type ScopedRowWriter = (env: Env, a: { parentId: number; userId: number; row: Record<string, unknown> }) => Promise<number | string>;
export const SCOPED_ROW_WRITERS: Readonly<Record<string, ScopedRowWriter>> = Object.freeze({
  event_agenda_items: async (env, a) => {
    const title = typeof a.row.title === 'string' ? a.row.title.trim().slice(0, 300) : '';
    if (!title) return 'no_title';
    const description = typeof a.row.description === 'string' && a.row.description.trim() ? a.row.description.trim().slice(0, 4000) : null;
    const r = await env.DB.prepare(
      `INSERT INTO event_agenda_items (event_id, title, description, display_order)
       VALUES (?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM event_agenda_items WHERE event_id = ?), 0)) RETURNING id`,
    ).bind(a.parentId, title, description, a.parentId).first<{ id: number }>();
    return r ? Number(r.id) : 'not_written';
  },
});

export type RowOutcome = { uid: string; outcome: 'created'; id: number } | { uid: string; outcome: 'refused'; why: string };

/** Accept all: at most ACCEPT_ALL_MAX row proposals, each written by its form's own writer and reported. */
export async function acceptRows(env: Env, a: {
  userId: number; page: string; form: string; projectId: number | null; uids: readonly string[];
  /** D1329: a parent that is not a venture (`scopes.ts`), as `<kind>:<id>`, and its id. */
  scope?: { key: string; parentId: number };
}): Promise<{ outcomes: RowOutcome[]; over_limit: string[] }> {
  await ensureFillProvenanceSchema(env);
  const fields = fieldsOf(a.page, a.form);
  const table = fields[0]?.table;
  const unique = [...new Set(a.uids)];
  const take = unique.slice(0, ACCEPT_ALL_MAX);
  const outcomes: RowOutcome[] = [];
  for (const uid of take) {
    const refuse = (why: string) => outcomes.push({ uid, outcome: 'refused', why });
    const p = await getRail(env, a.userId, uid);
    const row = p?.payload.row as Record<string, unknown> | undefined;
    if (!p) { refuse('not_found'); continue; }
    if (p.rail_option !== `form:${a.form}` || p.kind !== 'proposal' || !row || typeof row !== 'object') { refuse('not_this_form'); continue; }
    if (a.scope ? p.payload.scope !== a.scope.key || p.payload.table !== table
      : Number(p.payload.project) !== a.projectId || p.payload.table !== table) { refuse(a.scope ? 'other_record' : 'other_venture'); continue; }
    const scoped = a.scope && table ? SCOPED_ROW_WRITERS[table] : undefined;
    const writer: RowWriter | undefined = a.scope
      ? (scoped ? (e, w) => scoped(e, { parentId: a.scope!.parentId, userId: w.userId, row: w.row }) : undefined)
      : (FORM_ROW_WRITERS[`${a.page} / ${a.form}`] ?? (table ? ROW_WRITERS[table] : undefined));
    if (!writer) { refuse('no_writer'); continue; }
    // Only the form's own fields that Eadwyn is offered; a never-fill or measured name refuses the whole row.
    const bad = Object.keys(row).find((k) => { const f = fields.find((x) => x.field === k); return !f || neverFillReason(k) || !offeredToEadwyn(f); });
    if (bad) { refuse(neverFillReason(bad) ? 'never_fill' : 'not_offered'); continue; }
    if (p.status !== 'proposed') { refuse('decided'); continue; }
    // Decided first, atomically, so two presses cannot both create the row; put back if the writer refuses.
    if (!(await decideRail(env, a.userId, uid, 'accept'))) { refuse('decided'); continue; }
    let made: number | string;
    try { made = await writer(env, { projectId: a.projectId ?? 0, userId: a.userId, row }); }
    catch (e) { console.error('[fills] accept row:', (e as Error)?.name); made = 'not_written'; }
    if (typeof made === 'string') {
      await env.DB.prepare("UPDATE ai_rail_proposals SET status = 'proposed', decided_at = NULL WHERE uid = ? AND user_id = ? AND status = 'accepted'")
        .bind(uid, a.userId).run();
      refuse(made);
      continue;
    }
    const proposalRow = await railRowId(env, a.userId, uid);
    for (const [k, v] of Object.entries(row)) {
      const f = fields.find((x) => x.field === k) as FillField;
      try {
        const id = await recordFill(env, {
          target: { table: f.table, rowId: made, column: f.column }, proposalId: null, aiProposalId: proposalRow, usageLogId: p.usage_log_id,
          fillClass: f.class as FillClass, proposedValue: String(v), writtenValue: String(v), model: p.model, task: p.rail_option, decidedBy: a.userId,
        });
        await noteSource(env, id, null);
      } catch (e) { console.error('[fills] accept row provenance:', (e as Error)?.name); }
    }
    outcomes.push({ uid, outcome: 'created', id: made });
  }
  return { outcomes, over_limit: unique.slice(ACCEPT_ALL_MAX) };
}

/**
 * The column-by-column writes an undo may make, each one literal statement on
 * the module's own row, scoped to the venture. `required`: a column the
 * module's writer never leaves blank, so an undo to blank is refused.
 */
export const UNDO_WRITES: Readonly<Record<string, { read: string; write: string; int: boolean; required: boolean; scoped?: true }>> = Object.freeze({
  'mvp_features.title': { read: 'SELECT project_id, title AS value FROM mvp_features WHERE id = ?', write: 'UPDATE mvp_features SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true },
  'mvp_features.effort': { read: 'SELECT project_id, effort AS value FROM mvp_features WHERE id = ?', write: 'UPDATE mvp_features SET effort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true },
  'mvp_features.pain_group_id': { read: 'SELECT project_id, pain_group_id AS value FROM mvp_features WHERE id = ?', write: 'UPDATE mvp_features SET pain_group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: true, required: false },
  'mvp_features.hypothesis_id': { read: 'SELECT project_id, hypothesis_id AS value FROM mvp_features WHERE id = ?', write: 'UPDATE mvp_features SET hypothesis_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: true, required: false },
  // D1328 (#3489), part one. A segment's name has no undo: its writer keeps `name_norm` beside it, which no literal statement can.
  'pain_groups.title': { read: 'SELECT project_id, title AS value FROM pain_groups WHERE id = ?', write: 'UPDATE pain_groups SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true },
  'customer_segments.who_they_are': { read: 'SELECT project_id, who_they_are AS value FROM customer_segments WHERE id = ?', write: 'UPDATE customer_segments SET who_they_are = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false },
  'customer_segments.job_to_be_done': { read: 'SELECT project_id, job_to_be_done AS value FROM customer_segments WHERE id = ?', write: 'UPDATE customer_segments SET job_to_be_done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false },
  'customer_segments.value_promised': { read: 'SELECT project_id, value_promised AS value FROM customer_segments WHERE id = ?', write: 'UPDATE customer_segments SET value_promised = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false },
  'hypotheses.claim': { read: 'SELECT project_id, claim AS value FROM hypotheses WHERE id = ?', write: 'UPDATE hypotheses SET claim = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true },
  'hypotheses.success_bar': { read: 'SELECT project_id, success_bar AS value FROM hypotheses WHERE id = ?', write: 'UPDATE hypotheses SET success_bar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false },
  'hypotheses.disproof': { read: 'SELECT project_id, disproof AS value FROM hypotheses WHERE id = ?', write: 'UPDATE hypotheses SET disproof = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false },
  // #3740 part 2a. An item's words and a role's title are required by their writers, so an undo to blank is refused.
  'roadmap_okrs.objective': { read: 'SELECT project_id, objective AS value FROM roadmap_okrs WHERE id = ?', write: 'UPDATE roadmap_okrs SET objective = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true },
  'raise_prospects.notes': { read: 'SELECT project_id, notes AS value FROM raise_prospects WHERE id = ?', write: "UPDATE raise_prospects SET notes = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: false },
  'job_postings.title': { read: 'SELECT project_id, title AS value FROM job_postings WHERE id = ?', write: "UPDATE job_postings SET title = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: true },
  // #4046 (Group A1). An obligation's title is required by its writer, so an undo to blank is refused.
  'competitor_tracking.why_it_matters': { read: 'SELECT project_id, why_it_matters AS value FROM competitor_tracking WHERE id = ?', write: "UPDATE competitor_tracking SET why_it_matters = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: false },
  'product_feedback.theme': { read: 'SELECT project_id, theme AS value FROM product_feedback WHERE id = ?', write: "UPDATE product_feedback SET theme = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: false },
  'compliance_events.title': { read: 'SELECT project_id, title AS value FROM compliance_events WHERE id = ?', write: "UPDATE compliance_events SET title = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: true },
  // D1329 (#3490): records that are not a venture's. `scoped`: the route has checked the record's own scope
  // (`scopes.ts`), so the write is bound on the row and the fill alone.
  'ic_decisions.memo': { read: 'SELECT NULL AS project_id, memo AS value FROM ic_decisions WHERE id = ?', write: 'UPDATE ic_decisions SET memo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'advisor_services.title': { read: 'SELECT NULL AS project_id, title AS value FROM advisor_services WHERE id = ?', write: 'UPDATE advisor_services SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true, scoped: true },
  'advisor_services.scope': { read: 'SELECT NULL AS project_id, scope AS value FROM advisor_services WHERE id = ?', write: 'UPDATE advisor_services SET scope = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'engagement_status_reports.shipped': { read: 'SELECT NULL AS project_id, shipped AS value FROM engagement_status_reports WHERE id = ?', write: 'UPDATE engagement_status_reports SET shipped = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'engagement_status_reports.next_up': { read: 'SELECT NULL AS project_id, next_up AS value FROM engagement_status_reports WHERE id = ?', write: 'UPDATE engagement_status_reports SET next_up = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'events.description': { read: 'SELECT NULL AS project_id, description AS value FROM events WHERE id = ?', write: 'UPDATE events SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'event_agenda_items.title': { read: 'SELECT NULL AS project_id, title AS value FROM event_agenda_items WHERE id = ?', write: 'UPDATE event_agenda_items SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true, scoped: true },
  'event_agenda_items.description': { read: 'SELECT NULL AS project_id, description AS value FROM event_agenda_items WHERE id = ?', write: 'UPDATE event_agenda_items SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: false, scoped: true },
  'admin_publications.summary_text': { read: 'SELECT NULL AS project_id, summary_text AS value FROM admin_publications WHERE id = ?', write: 'UPDATE admin_publications SET summary_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', int: false, required: true, scoped: true },
  // D1595 (#3868). These three routes stamp `updated_at` as an ISO string (`nowIso`, `toISOString`), so the undo does too.
  'portfolio_support_entries.summary': { read: 'SELECT NULL AS project_id, summary AS value FROM portfolio_support_entries WHERE id = ?', write: "UPDATE portfolio_support_entries SET summary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: true, scoped: true },
  'service_offerings.summary': { read: 'SELECT NULL AS project_id, summary AS value FROM service_offerings WHERE id = ?', write: "UPDATE service_offerings SET summary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: false, scoped: true },
  'perks.blurb': { read: 'SELECT NULL AS project_id, blurb AS value FROM perks WHERE id = ?', write: "UPDATE perks SET blurb = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND (SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL", int: false, required: false, scoped: true },
});

export type UndoResult = { ok: true; value: string | number | null } | { ok: false; status: 404 | 409; code: 'fill_not_found' | 'not_undoable' | 'already_undone' | 'edited' | 'no_prior' };

/**
 * The fill and its target row, for the route to authorise before `undoFill`
 * writes: `projectId` is the venture the target row is on.
 */
export async function fillForUndo(env: Env, id: number) {
  await ensureFillProvenanceSchema(env);
  const f = await env.DB.prepare(
    'SELECT id, target_table, target_row_id, target_column, written_value, prior_value, undone_at FROM fill_provenance WHERE id = ?',
  ).bind(id).first<{ id: number; target_table: string; target_row_id: number; target_column: string; written_value: string | null; prior_value: string | null; undone_at: string | null }>();
  if (!f) return null;
  const w = UNDO_WRITES[`${f.target_table}.${f.target_column}`];
  const target = w ? await env.DB.prepare(w.read).bind(f.target_row_id).first<{ project_id: number; value: unknown }>() : null;
  return { fill: f, write: w ?? null, projectId: target ? Number(target.project_id) : null, current: target?.value ?? null };
}

export async function undoFill(env: Env, userId: number, found: NonNullable<Awaited<ReturnType<typeof fillForUndo>>>): Promise<UndoResult> {
  const { fill, write, projectId, current } = found;
  if (!write || (projectId == null && !write.scoped)) return { ok: false, status: 404, code: 'not_undoable' };
  if (fill.undone_at) return { ok: false, status: 409, code: 'already_undone' };
  // Only while the field still holds what the fill wrote: an edit since is the member's.
  if (!same(current, fill.written_value)) return { ok: false, status: 409, code: 'edited' };
  const prior = fill.prior_value == null || fill.prior_value.trim() === '' ? null : fill.prior_value;
  if (prior == null && write.required) return { ok: false, status: 409, code: 'no_prior' };
  const value = prior == null ? null : write.int ? Number(prior) : prior;
  const res = await env.DB.batch([
    // The row's write is guarded on the fill not being undone, so two undos racing write it once.
    write.scoped ? env.DB.prepare(write.write).bind(value, fill.target_row_id, fill.id) : env.DB.prepare(write.write).bind(value, fill.target_row_id, projectId, fill.id),
    env.DB.prepare('UPDATE fill_provenance SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ? AND undone_at IS NULL').bind(userId, fill.id),
  ]);
  if (!Number(res[1]?.meta?.changes)) return { ok: false, status: 409, code: 'already_undone' };
  return { ok: true, value };
}
