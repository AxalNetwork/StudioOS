/**
 * D1325 (#3486, #2431 part 2) — `GET /api/fills/sheet`: everything the Fill
 * with Eadwyn sheet reads, with no model run.
 *
 *   GET /api/fills/sheet?page=&form=&project=&record=
 *
 * `page` and `form` name a form in FILL_FIELDS (`services/fills/fields.ts`);
 * `project` is the venture; `record` is the row the form edits (absent for an
 * Add form). Per field: the value now and its mark (`marksForRows`), what each
 * source has waiting (FILL_SOURCES), the never-fill flag, whether Eadwyn is
 * ever offered it, and whether the trigger shows. Then each source's state and
 * as-of, and Eadwyn's quote: the member's own average for this form's option,
 * as `RunEstimate` reads it, or "Not recorded".
 *
 * WHO SEES WHAT. Anyone who can read the venture reads the marks. The trigger
 * (`can_fill`) is for someone who can write it, in their own session: a reader
 * and a support session get marks and no trigger. A failed read is
 * `unreadable` for its own block (the marks, a source, the quote), never the
 * whole sheet, and never "typed by hand".
 *
 * Refusals are codes with fixed sentences; logs carry codes and kinds, never a
 * value.
 *
 * D1326 (#3487, part 3) adds the writes, each in the member's own session (a
 * support session is refused) and on a venture they may write:
 *
 *   POST /api/fills/record      { page, form, project, record, proposals: [uid] }
 *     after the form's own Save: re-reads the row and keeps only fields that
 *     equal what was proposed; one decision and one provenance row each.
 *   POST /api/fills/rows/accept { page, form, project, proposals: [uid] }
 *     Accept all for row proposals: at most 50, each through its form's writer.
 *   POST /api/fills/:id/undo
 *     puts back what the fill replaced, only while the field holds the fill.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { FILL_FIELDS, fieldsOf, offeredToEadwyn, type FillField } from '../services/fills/fields';
import { neverFillReason } from '../services/fills/neverFill';
import { marksForRows, type FillMark } from '../services/fills/provenance';
import { readSources, type SourceCtx } from '../services/fills/sources';
import { acceptRows, fillForUndo, recordKept, undoFill } from '../services/fills/keep';
import { SCOPED_READS, isExplorer, parentKey, scopeOf, type RecordScope } from '../services/fills/scopes';
import { logActorAct } from '../services/actorLog';
import { activeCompanyFor } from '../middleware/activeCompany';

const fills = new Hono<{ Bindings: Env }>();

const SENTENCES: Record<string, string> = {
  unknown_form: 'That form has nothing Eadwyn fills.',
  invalid_project: 'Choose a venture.',
  project_not_available: 'You cannot read this venture.',
  record_not_found: 'That record is not on this venture.',
  project_not_writable: 'You cannot change this venture.',
  support_session_refused: 'A support session cannot keep or undo a fill.',
  invalid_proposals: 'Name the proposals to keep, at least one.',
  fill_not_found: 'That fill is not one you can undo.',
  not_undoable: 'That fill is not one you can undo.',
  already_undone: 'That fill was already undone.',
  edited: 'The field has changed since it was filled, so it is yours now. Nothing was undone.',
  no_prior: 'The field was blank before, and it cannot be left blank, so there is nothing to put back.',
  // D1329 (#3490): a record that is not a venture's.
  no_profile: 'Ask opens once you hold a venture or a profile.', // #3740: matches EXPLORER_OFF (lib/fillScoped.js)
  record_not_available: 'You cannot read this record.',
  record_not_writable: 'You cannot change this record.',
};
const refuse = (c: any, status: number, code: string) => c.json({ error: code, detail: SENTENCES[code] }, status);

/**
 * The row a form edits, by its table, on this venture only. One literal
 * statement per registered table, so no table name is ever spliced into SQL;
 * a table FILL_FIELDS gains needs its line here, and the test holds the two.
 */
export const ROW_READS: Readonly<Record<string, string>> = Object.freeze({
  mvp_features: 'SELECT * FROM mvp_features WHERE id = ? AND project_id = ?',
  project_metrics: 'SELECT * FROM project_metrics WHERE id = ? AND project_id = ?',
  // D1328 (#3489), part one.
  pain_groups: 'SELECT * FROM pain_groups WHERE id = ? AND project_id = ?',
  customer_segments: 'SELECT * FROM customer_segments WHERE id = ? AND project_id = ?',
  hypotheses: 'SELECT * FROM hypotheses WHERE id = ? AND project_id = ?',
  // D1329 (#3490): records that are not a venture's. Each is `scopes.ts`' own read, bound on the id alone and
  // reached only through the scoped branch, after the record's own scope is checked.
  ...SCOPED_READS,
});

const blank = (v: unknown) => v == null || String(v).trim() === '';

fills.get('/sheet', async (c) => {
  const user = await requireAuth(c) as User;
  const page = String(c.req.query('page') ?? '');
  const form = String(c.req.query('form') ?? '');
  const fields = fieldsOf(page, form);
  if (!fields.length) return refuse(c, 404, 'unknown_form');
  // D1329: a record that is not a venture's has its own scope, and the venture's request is unchanged.
  const recordScope = scopeOf(fields[0].table);
  if (recordScope) return scopedSheet(c, user, page, form, fields, recordScope);
  const projectId = Number(c.req.query('project'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return refuse(c, 400, 'invalid_project');
  const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<{ id: number; founder_id: number | null; company_id: number | null }>();
  if (!project || !(await canAccessProject(c.env, user, project))) return refuse(c, 403, 'project_not_available');
  const support = !!(await selectJwt(c))?.payload?.impersonated_by;
  const canFill = !support && await canAccessProject(c.env, user, project, { write: true });

  // The record, when the form edits one.
  const table = fields[0].table;
  const rawRecord = c.req.query('record');
  let recordId: number | null = null;
  let row: Record<string, unknown> | null = null;
  if (rawRecord != null && rawRecord !== '') {
    recordId = Number(rawRecord);
    if (!Number.isSafeInteger(recordId) || recordId <= 0 || !ROW_READS[table]) return refuse(c, 404, 'record_not_found');
    row = await c.env.DB.prepare(ROW_READS[table]).bind(recordId, projectId).first<Record<string, unknown>>();
    if (!row) return refuse(c, 404, 'record_not_found');
  }
  const recordRef = recordId ? `${table}:${recordId}` : null;

  return sheetReply(c, user, { page, form, fields, table, row, recordId, recordRef, canFill,
    sourceCtx: { userId: Number(user.id), projectId, form, recordRef }, head: { project: projectId } });
});

/**
 * The sheet's reply once the record and the trigger are known: the marks, the
 * sources, Eadwyn's quote and each field's view. One body for a venture's
 * record and (D1329) a record that is not a venture's.
 */
async function sheetReply(c: Context<{ Bindings: Env }>, user: User, a: {
  page: string; form: string; fields: FillField[]; table: string; row: Record<string, unknown> | null; recordId: number | null;
  recordRef: string | null; canFill: boolean; sourceCtx: SourceCtx; head: Record<string, unknown>;
}) {
  const { page, form, fields, table, row, recordId, recordRef, canFill } = a;
  // The marks: one read for the row; a failure is this block only.
  let marks: Map<string, FillMark> = new Map();
  let marksState: 'ok' | 'unreadable' = 'ok';
  if (row && recordId) {
    try { marks = (await marksForRows(c.env, table, [recordId], new Map([[recordId, row]]))).get(recordId) ?? new Map(); }
    catch (e) { marksState = 'unreadable'; console.warn('[fills] sheet marks unreadable:', (e as Error)?.name); }
  }

  const sources = await readSources(c.env, a.sourceCtx, fields);

  // Eadwyn's quote: the member's own runs of this form's option, settled ones only.
  let quote: { option: string; state: 'ok' | 'unreadable'; runs: number | null; average_microusd: number | null };
  const option = `form:${form}`;
  try {
    const q = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n, AVG(charged_microusd) AS avg FROM ai_usage_logs WHERE user_id = ? AND rail_option = ? AND charged_microusd IS NOT NULL',
    ).bind(user.id, option).first<{ n: number; avg: number | null }>();
    const n = Number(q?.n) || 0;
    quote = { option, state: 'ok', runs: n, average_microusd: n ? Math.round(Number(q?.avg)) : null };
  } catch (e) {
    console.warn('[fills] sheet quote unreadable:', (e as Error)?.name);
    quote = { option, state: 'unreadable', runs: null, average_microusd: null };
  }

  const fieldView = (f: FillField) => {
    const nf = neverFillReason(`${f.table}.${f.column}`);
    const value = row ? row[f.column] ?? null : null;
    const mark = marksState === 'unreadable' ? { state: 'unreadable' as const } : marks.get(f.column) ?? null;
    const own = sources.filter((s) => f.sources.includes(s.key));
    const waiting = own.flatMap((s) => s.waiting.filter((w) => w.field === f.field).map((w) => ({ source: s.key, ...w })));
    const choices = own.flatMap((s) => s.choices.filter((w) => w.field === f.field).map((w) => ({ source: s.key, ...w })));
    const eadwyn = offeredToEadwyn(f);
    // A trigger on a blank field, for someone who may write it, never on a
    // never-fill one. Every entry has a source (the registry's check), so the
    // never-fill test is the only one left; it is a second lock, as there.
    const fillable = !nf;
    return {
      field: f.field, label: f.label, table: f.table, column: f.column, class: f.class, sources: f.sources,
      value, mark, never_fill: nf ? { category: nf.category, label: nf.label } : null,
      offered_to_eadwyn: eadwyn,
      trigger: canFill && fillable && blank(value),
      waiting: canFill ? waiting : [],
      choices: canFill ? choices : [],
    };
  };

  return c.json({
    page, form, ...a.head, record: recordRef, can_fill: canFill,
    marks_state: marksState,
    fields: fields.map(fieldView),
    sources: sources.map((s) => ({ key: s.key, kind: s.kind, label: s.label, state: s.state, as_of: s.as_of })),
    quote,
  });
}

/** The venture a write names, when the member may write it in their own session; else the refusal. */
async function writableVenture(c: Context<{ Bindings: Env }>, user: User, raw: unknown): Promise<{ id: number } | Response> {
  if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(c, 403, 'support_session_refused');
  const projectId = Number(raw);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return refuse(c, 400, 'invalid_project');
  const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<{ id: number; founder_id: number | null; company_id: number | null }>();
  if (!project || !(await canAccessProject(c.env, user, project, { write: true }))) return refuse(c, 403, 'project_not_writable');
  return { id: projectId };
}

const uidsOf = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) return null;
  const out = raw.filter((u) => typeof u === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(u)) as string[];
  return out.length === raw.length ? out : null;
};

fills.post('/record', async (c) => {
  const user = await requireAuth(c) as User;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const page = String(body?.page ?? ''), form = String(body?.form ?? '');
  const fields = fieldsOf(page, form);
  if (!fields.length) return refuse(c, 404, 'unknown_form');
  const recordScope = scopeOf(fields[0].table);
  if (recordScope) return scopedRecord(c, user, page, form, fields, recordScope, body);
  const venture = await writableVenture(c, user, body?.project); if (venture instanceof Response) return venture;
  const uids = uidsOf(body?.proposals); if (!uids) return refuse(c, 400, 'invalid_proposals');
  const table = fields[0].table;
  const recordId = Number(body?.record);
  if (!Number.isSafeInteger(recordId) || recordId <= 0 || !ROW_READS[table]) return refuse(c, 404, 'record_not_found');
  // The row as the form's own Save left it: the authority on what was kept.
  const row = await c.env.DB.prepare(ROW_READS[table]).bind(recordId, venture.id).first<Record<string, unknown>>();
  if (!row) return refuse(c, 404, 'record_not_found');
  const outcomes = await recordKept(c.env, { userId: Number(user.id), page, form, projectId: venture.id, recordId, row, uids });
  return c.json({ record: `${table}:${recordId}`, outcomes });
});

fills.post('/rows/accept', async (c) => {
  const user = await requireAuth(c) as User;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const page = String(body?.page ?? ''), form = String(body?.form ?? '');
  const formFields = fieldsOf(page, form);
  if (!formFields.length) return refuse(c, 404, 'unknown_form');
  const recordScope = scopeOf(formFields[0].table);
  if (recordScope) return scopedRows(c, user, page, form, formFields, recordScope, body);
  const venture = await writableVenture(c, user, body?.project); if (venture instanceof Response) return venture;
  const uids = uidsOf(body?.proposals); if (!uids) return refuse(c, 400, 'invalid_proposals');
  return c.json(await acceptRows(c.env, { userId: Number(user.id), page, form, projectId: venture.id, uids }));
});

fills.post('/:id/undo', async (c) => {
  const user = await requireAuth(c) as User;
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return refuse(c, 404, 'fill_not_found');
  const found = await fillForUndo(c.env, id);
  const undoScope = found ? scopeOf(found.fill.target_table) : null;
  if (found && undoScope) return scopedUndo(c, user, id, found, undoScope);
  // A fill on a venture the member cannot write reads as one that does not exist.
  if (!found || found.projectId == null) return refuse(c, 404, 'fill_not_found');
  const venture = await writableVenture(c, user, found.projectId);
  if (venture instanceof Response) return venture.status === 403 && (await selectJwt(c))?.payload?.impersonated_by ? venture : refuse(c, 404, 'fill_not_found');
  const r = await undoFill(c.env, Number(user.id), found);
  if (!r.ok) return refuse(c, r.status, r.code);
  // Who and when are on the provenance row; the log line carries ids only.
  await logActorAct(c.env, user, 'fill_undone', { fill_id: id, table: found.fill.target_table, column: found.fill.target_column }, venture.id);
  return c.json({ ok: true, id, value: r.value });
});

// ── D1329 (#3490, #2431 part 6): records that are not a venture's ───────────
//
// Each table's own write check is `scopes.ts`'. A record is named by `record`
// (its id); an Add form names the parent its row will hang under (`parent`),
// or none when the parent is the caller's own profile. An Explorer holds
// nothing to fill (AF22); a reader gets marks and no trigger; a support
// session gets no trigger and keeps nothing.

interface ScopedTarget {
  table: string; row: Record<string, unknown> | null; recordId: number | null; parentId: number | null;
  recordRef: string | null; scopeKey: string; canWrite: boolean;
}

/** The record (or the parent) a scoped request names, if the caller may read it; else the refusal. */
async function scopedTarget(c: Context<{ Bindings: Env }>, user: User, scope: RecordScope, table: string, rawRecord: unknown, rawParent: unknown): Promise<ScopedTarget | Response> {
  if (isExplorer(user)) return refuse(c, 403, 'no_profile');
  let recordId: number | null = null;
  let row: Record<string, unknown> | null = null;
  let parentId: number | null = null;
  if (rawRecord != null && rawRecord !== '') {
    recordId = Number(rawRecord);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) return refuse(c, 404, 'record_not_found');
    row = await c.env.DB.prepare(scope.read).bind(recordId).first<Record<string, unknown>>();
    if (!row) return refuse(c, 404, 'record_not_found');
  } else if (scope.parent?.own) {
    parentId = await scope.parent.own(c.env, user);
  } else if (scope.parent) {
    parentId = Number(rawParent);
    if (!Number.isSafeInteger(parentId) || parentId <= 0) return refuse(c, 404, 'record_not_found');
  } else {
    return refuse(c, 404, 'record_not_found');
  }
  const access = await scope.access(c.env, user, row, parentId, { activeCompany: () => activeCompanyFor(c, user) });
  // D1595: a concealed scope answers a record the caller may not read as one that does not exist.
  if (!access.read) return scope.concealed ? refuse(c, 404, 'record_not_found') : refuse(c, 403, 'record_not_available');
  const recordRef = recordId ? `${table}:${recordId}` : null;
  return { table, row, recordId, parentId, recordRef, scopeKey: recordRef ?? parentKey(scope, parentId as number), canWrite: access.write };
}

async function scopedSheet(c: Context<{ Bindings: Env }>, user: User, page: string, form: string, fields: FillField[], scope: RecordScope) {
  const t = await scopedTarget(c, user, scope, fields[0].table, c.req.query('record'), c.req.query('parent'));
  if (t instanceof Response) return t;
  const support = !!(await selectJwt(c))?.payload?.impersonated_by;
  return sheetReply(c, user, {
    page, form, fields, table: t.table, row: t.row, recordId: t.recordId, recordRef: t.recordRef, canFill: !support && t.canWrite,
    sourceCtx: { userId: Number(user.id), projectId: 0, form, recordRef: t.recordRef, scope: { table: t.table, row: t.row, parentId: t.parentId } },
    head: { project: null, scope: t.scopeKey },
  });
}

/** A scoped write: the caller's own session, a record or parent they may write. */
async function scopedWritable(c: Context<{ Bindings: Env }>, user: User, scope: RecordScope, table: string, rawRecord: unknown, rawParent: unknown): Promise<ScopedTarget | Response> {
  if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(c, 403, 'support_session_refused');
  const t = await scopedTarget(c, user, scope, table, rawRecord, rawParent);
  if (t instanceof Response) return t;
  return t.canWrite ? t : refuse(c, 403, 'record_not_writable');
}

async function scopedRecord(c: Context<{ Bindings: Env }>, user: User, page: string, form: string, fields: FillField[], scope: RecordScope, body: Record<string, unknown> | null) {
  const uids = uidsOf(body?.proposals);
  if (body?.record == null || body.record === '') return refuse(c, 404, 'record_not_found');
  const t = await scopedWritable(c, user, scope, fields[0].table, body.record, null);
  if (t instanceof Response) return t;
  if (!uids) return refuse(c, 400, 'invalid_proposals');
  // A proposal made on this record, or for an Add form under the parent the saved row now hangs under.
  const refs = [t.recordRef as string];
  const parentValue = scope.parent && t.row ? Number(t.row[scope.parent.column]) : NaN;
  if (scope.parent && Number.isSafeInteger(parentValue)) refs.push(parentKey(scope, parentValue));
  const outcomes = await recordKept(c.env, { userId: Number(user.id), page, form, projectId: null, recordId: t.recordId as number, row: t.row as Record<string, unknown>, uids, scopeRefs: refs });
  return c.json({ record: t.recordRef, outcomes });
}

async function scopedRows(c: Context<{ Bindings: Env }>, user: User, page: string, form: string, fields: FillField[], scope: RecordScope, body: Record<string, unknown> | null) {
  if (!scope.parent) return refuse(c, 404, 'record_not_found');
  const t = await scopedWritable(c, user, scope, fields[0].table, null, body?.parent);
  if (t instanceof Response) return t;
  const uids = uidsOf(body?.proposals); if (!uids) return refuse(c, 400, 'invalid_proposals');
  return c.json(await acceptRows(c.env, { userId: Number(user.id), page, form, projectId: null, uids, scope: { key: t.scopeKey, parentId: t.parentId as number } }));
}

async function scopedUndo(c: Context<{ Bindings: Env }>, user: User, id: number, found: NonNullable<Awaited<ReturnType<typeof fillForUndo>>>, scope: RecordScope) {
  const support = !!(await selectJwt(c))?.payload?.impersonated_by;
  const t = await scopedTarget(c, user, scope, found.fill.target_table, found.fill.target_row_id, null);
  // A fill on a record the member cannot write reads as one that does not exist; a support session is told why.
  if (t instanceof Response || !t.canWrite) return refuse(c, 404, 'fill_not_found');
  if (support) return refuse(c, 403, 'support_session_refused');
  const r = await undoFill(c.env, Number(user.id), found);
  if (!r.ok) return refuse(c, r.status, r.code);
  await logActorAct(c.env, user, 'fill_undone', { fill_id: id, table: found.fill.target_table, column: found.fill.target_column }, null);
  return c.json({ ok: true, id, value: r.value });
}

/** The forms FILL_FIELDS lists, for a test and for the drift check's reader. */
export const FILL_FORMS = Object.freeze([...new Set(FILL_FIELDS.map((f) => `${f.page} / ${f.form}`))]);

export default fills;
