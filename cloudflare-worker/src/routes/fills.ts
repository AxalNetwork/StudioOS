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
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { FILL_FIELDS, fieldsOf, offeredToEadwyn, type FillField } from '../services/fills/fields';
import { neverFillReason } from '../services/fills/neverFill';
import { marksForRows, type FillMark } from '../services/fills/provenance';
import { readSources } from '../services/fills/sources';

const fills = new Hono<{ Bindings: Env }>();

const SENTENCES: Record<string, string> = {
  unknown_form: 'That form has nothing Eadwyn fills.',
  invalid_project: 'Choose a venture.',
  project_not_available: 'You cannot read this venture.',
  record_not_found: 'That record is not on this venture.',
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
});

const blank = (v: unknown) => v == null || String(v).trim() === '';

fills.get('/sheet', async (c) => {
  const user = await requireAuth(c) as User;
  const page = String(c.req.query('page') ?? '');
  const form = String(c.req.query('form') ?? '');
  const fields = fieldsOf(page, form);
  if (!fields.length) return refuse(c, 404, 'unknown_form');
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

  // The marks: one read for the row; a failure is this block only.
  let marks: Map<string, FillMark> = new Map();
  let marksState: 'ok' | 'unreadable' = 'ok';
  if (row && recordId) {
    try { marks = (await marksForRows(c.env, table, [recordId], new Map([[recordId, row]]))).get(recordId) ?? new Map(); }
    catch (e) { marksState = 'unreadable'; console.warn('[fills] sheet marks unreadable:', (e as Error)?.name); }
  }

  const sources = await readSources(c.env, { userId: Number(user.id), projectId, form, recordRef }, fields);

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
    page, form, project: projectId, record: recordRef, can_fill: canFill,
    marks_state: marksState,
    fields: fields.map(fieldView),
    sources: sources.map((s) => ({ key: s.key, kind: s.kind, label: s.label, state: s.state, as_of: s.as_of })),
    quote,
  });
});

/** The forms FILL_FIELDS lists, for a test and for the drift check's reader. */
export const FILL_FORMS = Object.freeze([...new Set(FILL_FIELDS.map((f) => `${f.page} / ${f.form}`))]);

export default fills;
