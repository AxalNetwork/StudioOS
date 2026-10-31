/**
 * D1326 (#3487, #2431 part 3) — `POST /api/ai/rail/run`, D720 §7's one run
 * path, with its first handler: `form`.
 *
 *   POST /api/ai/rail/run
 *     { page, option: 'form:<form>', project, record?: { type, id }, model?,
 *       input?: { values?: { <field>: … }, text?, rows? } }
 *     → text/event-stream:
 *         meta   { model, hold_microusd }                       before the run
 *         guard  { input, output }                              after it
 *         done   { proposals[{ uid, field?, value?, row? }], dropped[{ field, why, row? }],
 *                  usage_log_id, charged_microusd|null, budget }  or { refusal: { code, status, message } }
 *
 * THE STEPS (D720 §7). The form is one FILL_FIELDS knows (D1325); the venture
 * is one the member may write, in their own session; the record, when there
 * is one, is on that venture. Then `run()` (`services/aiRouter.ts`) does the
 * rest in its own order: it refuses a page the member switched off
 * (`assist_off`, D765), reserves the hold (D762), guards the input and the
 * output (D763), runs, and settles. A refusal from any of those is `done`'s
 * `refusal`, in `refuseRun`'s words (`runRefusalView`).
 *
 * WHAT IT WRITES. Proposals only, one `ai_rail_proposals` row per kept field
 * (or per row, for an Add form's `rows`), each naming the run's
 * `usage_log_id`. Never the record: in a form nothing is written until Save
 * (#2431; D1323 §4), and `POST /api/fills/record` keeps what was kept.
 *
 * A CHANGED FORM DROPS THE RESULT. The record's fields are read before the run
 * and again after it; when any of the asked fields changed meanwhile, nothing
 * is proposed (`dropped: [{ why: 'record_changed' }]`), so a value is never
 * proposed over one someone just wrote.
 *
 * Logs carry codes and kinds only, never a value, a prompt or a model output.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { run as aiRun, quoteRun, type RunOptions, type RunResult } from '../services/aiRouter';
import { loadAiBudget } from '../services/aiBudget';
import { proposeRail } from '../services/railProposals';
import { fieldsOf, type FillField } from '../services/fills/fields';
import { MAX_RUN_ROWS, fieldsToAsk, formMessages, gatherForm, gatherScoped, parseFields, parseRows, type Dropped } from '../services/fills/formRun';
import { isExplorer, parentKey, scopeOf } from '../services/fills/scopes';
import { runRefusalView } from '../util/railContext';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { sessionBlockProposals, windowDays } from '../services/sessionsBlock';
import { ROW_READS } from './fills';

/** The form fields an Add form needs before a whole row can be proposed (the writer's own rule). */
export const ROW_REQUIRED: Readonly<Record<string, readonly string[]>> = Object.freeze({
  mvp_features: ['title'],
  // D1328 (#3489), part one: each Add form's own required field.
  pain_groups: ['title'],
  customer_segments: ['name'],
  hypotheses: ['claim'],
  // D1329 (#3490): a session in an event's agenda, and an advisor's service, each need a title.
  event_agenda_items: ['title'],
  advisor_services: ['title'],
});

const SENTENCES: Record<string, string> = {
  unknown_handler: 'That option has no run here yet.',
  unknown_form: 'That form has nothing Eadwyn fills.',
  invalid_project: 'Choose a venture.',
  project_not_available: 'You cannot change this venture.',
  support_session_refused: 'A support session cannot ask Eadwyn to fill a form.',
  record_not_found: 'That record is not on this venture.',
  nothing_to_fill: 'Every field Eadwyn can fill already holds a value.',
  // D1329 (#3490).
  no_profile: 'Fill opens once you hold a venture or a profile.',
  record_not_available: 'You cannot change this record.',
  // D1596 (#3869).
  unknown_page: 'That option runs on Advisor · Practice · Sessions only.',
};

export type Runner = (env: Env, input: RunOptions) => Promise<RunResult>;
export type Quoter = typeof quoteRun;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The record's asked columns, for the before-and-after check. */
const snapshot = (row: Record<string, unknown> | null, asked: readonly FillField[]) =>
  JSON.stringify(asked.map((f) => (row ? row[f.column] ?? null : null)));

/** D1596 (#3869): the one page `sessions:block` runs on. */
export const SESSIONS_PAGE = 'Advisor · Practice · Sessions';

/**
 * `sessions:block`: Block proposals from the advisor's own Axal records, at no
 * charge (`services/sessionsBlock.ts`). Refused before any read for another
 * page, an Explorer, a support session, or a caller with no advisor profile.
 * Never calls the runner or the quoter; writes `ai_rail_proposals` rows only.
 */
async function sessionsBlockRun(c: any, user: User, page: string, option: string, body: Record<string, any> | null) {
  const refuse = (status: number, code: string) => c.json({ error: code, detail: SENTENCES[code] }, status);
  if (page !== SESSIONS_PAGE) return refuse(404, 'unknown_page');
  if (isExplorer(user)) return refuse(403, 'no_profile');
  if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(403, 'support_session_refused');
  // `requireMyAdvisor`'s rule: the advisor profile whose user is the caller.
  const advisor = (await c.env.DB.prepare('SELECT id, timezone FROM advisors WHERE user_id = ?').bind(user.id).first()) as { id: number; timezone: string | null } | null;
  if (!advisor) return refuse(403, 'no_profile');
  await ensureAdvisorStoresSchema(c.env);
  const days = windowDays(body?.input?.days);
  const { proposals, dropped } = await sessionBlockProposals(c.env, { advisorId: Number(advisor.id), userId: Number(user.id), timezone: advisor.timezone, days });
  const events = [sse('meta', { model: null, hold_microusd: 0 })];
  const out: Array<Record<string, unknown>> = [];
  for (const p of proposals) {
    const row = await proposeRail(c.env, { userId: Number(user.id), page, option, record: `advisor:${advisor.id}`, kind: 'proposal', payload: { ...p }, model: null, usageLogId: null });
    out.push({ uid: row.uid, ...p });
  }
  events.push(sse('done', out.length
    ? { proposals: out, dropped, usage_log_id: null, charged_microusd: null }
    : { proposals: [], dropped, reason: 'nothing_to_propose', usage_log_id: null, charged_microusd: null }));
  return new Response(events.join(''), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** The routes, with the model runner injectable: the app passes `run()`; a test passes a stub. */
export function railRunRoutes(deps: { run?: Runner; quote?: Quoter } = {}) {
  const runModel = deps.run ?? aiRun;
  const quote = deps.quote ?? quoteRun;
  const r = new Hono<{ Bindings: Env }>();
  const refuse = (c: any, status: number, code: string) => c.json({ error: code, detail: SENTENCES[code] }, status);

  r.post('/run', async (c) => {
    const user = await requireAuth(c) as User;
    const body = (await c.req.json().catch(() => null)) as Record<string, any> | null;
    const page = String(body?.page ?? '');
    const option = String(body?.option ?? '');
    // D1596 (#3869): `sessions:block` runs no model. It branches before the form path and never quotes or holds.
    if (/^sessions:block$/.test(option)) return sessionsBlockRun(c, user, page, option, body);
    const m = /^form:([a-z0-9_-]{1,60})$/.exec(option);
    if (!m) return refuse(c, 400, 'unknown_handler');
    const form = m[1];
    const fields = fieldsOf(page, form);
    if (!fields.length) return refuse(c, 404, 'unknown_form');
    const table = fields[0].table;
    const rec = body?.record;
    // D1329 (#3490): a record that is not a venture's is checked by its own scope (`scopes.ts`).
    const recordScope = scopeOf(table);
    let projectId: number | null = null;
    let recordId: number | null = null;
    let row: Record<string, unknown> | null = null;
    let scopeKey: string | null = null;
    let scopedParent: number | null = null;
    let reread: () => Promise<Record<string, unknown> | null>;
    if (recordScope) {
      if (isExplorer(user)) return refuse(c, 403, 'no_profile');
      if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(c, 403, 'support_session_refused');
      let parentId: number | null = null;
      if (rec != null) {
        recordId = Number(rec?.id);
        if (rec?.type !== table || !Number.isSafeInteger(recordId) || recordId <= 0) return refuse(c, 404, 'record_not_found');
        row = await c.env.DB.prepare(recordScope.read).bind(recordId).first<Record<string, unknown>>();
        if (!row) return refuse(c, 404, 'record_not_found');
      } else if (recordScope.parent?.own) {
        parentId = await recordScope.parent.own(c.env, user);
      } else if (recordScope.parent) {
        parentId = Number(body?.parent);
        if (!Number.isSafeInteger(parentId) || parentId <= 0) return refuse(c, 404, 'record_not_found');
      } else {
        return refuse(c, 404, 'record_not_found');
      }
      const access = await recordScope.access(c.env, user, row, parentId);
      if (!access.write) return refuse(c, 403, 'record_not_available');
      scopeKey = recordId ? `${table}:${recordId}` : parentKey(recordScope, parentId as number);
      scopedParent = parentId;
      const id = recordId;
      reread = async () => (id ? await c.env.DB.prepare(recordScope.read).bind(id).first<Record<string, unknown>>() : null);
    } else {
      projectId = Number(body?.project);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) return refuse(c, 400, 'invalid_project');
      if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(c, 403, 'support_session_refused');
      const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
        .bind(projectId).first<{ id: number; founder_id: number | null; company_id: number | null }>();
      if (!project || !(await canAccessProject(c.env, user, project, { write: true }))) return refuse(c, 403, 'project_not_available');
      if (rec != null) {
        recordId = Number(rec?.id);
        if (rec?.type !== table || !Number.isSafeInteger(recordId) || recordId <= 0 || !ROW_READS[table]) return refuse(c, 404, 'record_not_found');
        row = await c.env.DB.prepare(ROW_READS[table]).bind(recordId, projectId).first<Record<string, unknown>>();
        if (!row) return refuse(c, 404, 'record_not_found');
      }
      const id = recordId, venture = projectId;
      reread = async () => (id ? await c.env.DB.prepare(ROW_READS[table]).bind(id, venture).first<Record<string, unknown>>() : null);
    }
    const recordRef = recordId ? `${table}:${recordId}` : null;
    // What the proposals are filed under: the venture, or (D1329) the record or parent of a scoped one.
    const filed = scopeKey ? { project: null, scope: scopeKey } : { project: projectId };
    const input = (body?.input && typeof body.input === 'object' ? body.input : {}) as { values?: Record<string, unknown>; text?: unknown; rows?: unknown };
    const rowsWanted = !recordId && Number.isSafeInteger(Number(input.rows)) ? Math.max(0, Math.min(MAX_RUN_ROWS, Number(input.rows))) : 0;
    const asked = rowsWanted ? fields.filter((f) => fieldsToAsk([f]).length) : fieldsToAsk(fields, input.values ?? {}, row);
    if (!asked.length) return refuse(c, 400, 'nothing_to_fill');

    const gather = recordScope ? await gatherScoped(c.env, Number(user.id), table, row, scopedParent) : await gatherForm(c.env, projectId as number, asked);
    const { messages, guardText } = formMessages(asked, gather, { text: typeof input.text === 'string' ? input.text : '', rows: rowsWanted || undefined });
    const runInput: RunOptions = {
      task: 'rail_write', userId: Number(user.id), messages, guardText, maxTokens: rowsWanted ? 1200 : 600, temperature: 0.2,
      model: typeof body?.model === 'string' && body.model ? body.model : undefined,
      rail: { page, option, record: recordRef },
    };

    const events: string[] = [];
    const finish = () => new Response(events.join(''), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
    const refusalDone = (res: { refusal?: string | null; error?: string }) => {
      const v = runRefusalView(res) ?? { status: 503 as const, code: res.refusal || 'model_unavailable', message: 'Eadwyn could not be reached. Nothing was proposed.' };
      events.push(sse('done', { refusal: v, proposals: [], dropped: [] }));
      console.warn('[rail-run] refused', option, v.code);
      return finish();
    };

    // meta: what the run will hold, from the same arithmetic as the hold. A refusal here (the switch, a stale pick) is the run's own.
    const q = await quote(c.env, runInput);
    if (!q.ok) return refusalDone(q);
    events.push(sse('meta', { model: q.model, hold_microusd: q.hold_microusd }));

    const result = await runModel(c.env, runInput);
    if (result.guard) events.push(sse('guard', { input: result.guard.input, output: result.guard.output }));
    if (!result.ok) return refusalDone(result);

    // A changed form drops the result.
    if (recordId) {
      const after = await reread();
      if (!after || snapshot(after, asked) !== snapshot(row, asked)) {
        events.push(sse('done', { proposals: [], dropped: [{ field: '', why: 'record_changed' }], usage_log_id: result.usageLogId ?? null }));
        return finish();
      }
    }

    const proposals: Array<Record<string, unknown>> = [];
    let dropped: Array<Dropped | { field: string; why: 'record_changed' }> = [];
    const usageLogId = result.usageLogId ?? null;
    const model = result.usage?.model ?? null;
    const base = { userId: Number(user.id), page, option, record: recordRef, model, usageLogId };
    if (rowsWanted) {
      const parsed = parseRows(result.output, fields, asked, gather, rowsWanted, ROW_REQUIRED[table] ?? []);
      dropped = parsed.dropped;
      for (const one of parsed.rows) {
        const p = await proposeRail(c.env, { ...base, kind: 'proposal', payload: { row: one, table, ...filed, source: 'eadwyn' } });
        proposals.push({ uid: p.uid, row: one });
      }
    } else {
      const parsed = parseFields(result.output, fields, asked, gather);
      dropped = parsed.dropped;
      for (const k of parsed.kept) {
        const f = fields.find((x) => x.field === k.field)!;
        // `prior` is what the field held when the run read it: what an undo puts back.
        const prior = row ? row[f.column] ?? null : null;
        const p = await proposeRail(c.env, { ...base, kind: 'proposal', payload: {
          field: k.field, value: k.value, label: f.label, class: f.class, table, column: f.column,
          ...filed, prior, ...(k.citation ? { citation: k.citation } : {}), source: 'eadwyn',
        } });
        proposals.push({ uid: p.uid, field: k.field, value: k.value });
      }
    }

    let charged: number | null = null;
    if (usageLogId) {
      const u = await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?')
        .bind(usageLogId, user.id).first<{ charged_microusd: number | null }>().catch(() => null);
      charged = u?.charged_microusd ?? null;
    }
    let budget: unknown = null;
    try { budget = await loadAiBudget(c.env, Number(user.id)); } catch { budget = null; }
    events.push(sse('done', { proposals, dropped, usage_log_id: usageLogId, charged_microusd: charged, budget }));
    return finish();
  });

  return r;
}

export default railRunRoutes();
