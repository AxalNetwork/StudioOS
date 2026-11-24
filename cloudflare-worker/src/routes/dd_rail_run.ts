/** D6884 — five case-scoped diligence options on the shared, metered proposal-only rail. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { requireDdReader } from './dd';
import legacyRailRun, { type Runner, type Quoter } from './rail_run';
import { roomProject } from './data_room';
import { run, quoteRun, assistOff, ASSIST_OFF_MESSAGE, type RunOptions } from '../services/aiRouter';
import { loadAiBudget } from '../services/aiBudget';
import { proposeRail } from '../services/railProposals';
import { searchRoom, defaultDeps, type Hit, type Block } from '../services/dataRoomSearch';
import { DD_OPTIONS, DD_PAGE, DdRunRefusal, ddInput, ddScope, ddContext, ddMessages, ddDrafts } from '../services/ddRail';
import { runRefusalView } from '../util/railContext';

type Search = (env: Env, userId: number, projectId: number, query: string, scrub: (value: unknown) => string) => Promise<Block<{ hits: Hit[] }>>;
/** The retrieval models obey the same identity boundary as the final drafting model. */
export const searchDdRoom: Search = (env, userId, projectId, query, scrub) => {
  const deps = defaultDeps(env, userId, projectId);
  return searchRoom(env, { ...deps, embed: text => deps.embed(scrub(text)), rerank: (q, contexts) => deps.rerank(scrub(q), contexts.map(scrub)) }, projectId, scrub(query), null);
};
const event = (name: string, body: unknown) => `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`;
/** Injection changes model/retrieval transport only; real authentication, SQL and proposal storage always run. */
export function ddRailRunRoutes(deps: { run?: Runner; quote?: Quoter; search?: Search } = {}) {
  const r = new Hono<{ Bindings: Env }>();
  r.post('/run', async (c, next) => {
    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ code: 'dd_input_invalid', detail: 'Choose a supported rail option.' }, 400); }
    if (!DD_OPTIONS.includes(body?.option)) return next();
    try {
      const input = ddInput(body);
      const user = input.option === 'dd:answer_from_room' ? await requireAuth(c) : await requireDdReader(c);
      if ((await selectJwt(c))?.payload?.impersonated_by) return c.json({ code: 'support_session_refused', detail: 'Leave the support session before running Eadwyn.' }, 403);
      const ownsRoom = async (uid: string) => (await roomProject(c, user, uid))?.role === 'owner';
      const scope = await ddScope(c.env, user as any, input, ownsRoom);
      // Preserve the resolved section in the proposal even when the caller has just one assignment.
      if (scope.sectionId !== null) input.section_id = scope.sectionId;
      let ctx = await ddContext(c.env, scope, input);
      if (input.option === 'dd:request_drafts' && ctx.targets.length > 100) throw new DdRunRefusal(409, 'dd_context_large', 'Choose a smaller section before running Eadwyn.');
      const events: string[] = [];
      const finish = (done: unknown) => new Response([...events, event('done', done)].join(''), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
      // Retrieval is metered too, so the case page's switch precedes search.
      if (await assistOff(c.env, Number(user.id), DD_PAGE)) return finish({ proposals: [], dropped: [], refusal: { code: 'assist_off', status: 403, message: ASSIST_OFF_MESSAGE } });
      if (input.option === 'dd:summary' && ctx.empty) return finish({ proposals: [], dropped: [], reason: 'nothing_to_summarise', message: 'Nothing to summarise yet', risk: { state: 'not_recorded', label: 'Not recorded' } });
      if (input.option === 'dd:request_drafts' && ctx.targets.length === 0) return finish({ proposals: [], dropped: [], reason: 'no_pending_items' });
      let hits: Hit[] | undefined;
      if (scope.projectId !== null) {
        const found = await (deps.search ?? searchDdRoom)(c.env, Number(user.id), scope.projectId, ctx.query.slice(0, 500), ctx.scrub);
        if (!found.available) throw new DdRunRefusal(503, 'dd_room_unavailable', 'Your data-room search is unavailable right now.');
        hits = found.value.hits;
        ctx = await ddContext(c.env, scope, input, hits);
        if (!ctx.sources.some(s => s.file_uid)) return finish({ proposals: [], dropped: [], reason: 'no_matching_passages', message: 'No matching passage was found in your data room.' });
      }
      const prompt = ddMessages(ctx, input);
      const runInput: RunOptions = { task: 'rail_write', userId: Number(user.id), ...prompt, maxTokens: 5000, temperature: 0.2,
        model: typeof body.model === 'string' ? body.model : undefined, rail: { page: DD_PAGE, option: input.option, record: scope.record } };
      const refused = (result: { refusal?: string | null; error?: string }) => finish({ proposals: [], dropped: [], refusal: runRefusalView(result) ?? { status: 503, code: 'model_unavailable', message: 'Eadwyn could not be reached. Nothing was proposed.' } });
      const quote = await (deps.quote ?? quoteRun)(c.env, runInput);
      if (!quote.ok) return refused(quote);
      events.push(event('meta', { model: quote.model, hold_microusd: quote.hold_microusd }));
      const result = await (deps.run ?? run)(c.env, runInput);
      if (result.guard) events.push(event('guard', { input: result.guard.input, output: result.guard.output }));
      if (!result.ok) return refused(result);
      let drafts: Array<Record<string, unknown>> = [];
      let why = 'invalid_draft';
      try {
        const currentScope = await ddScope(c.env, user as any, input, ownsRoom);
        const current = await ddContext(c.env, currentScope, input, hits);
        if (JSON.stringify({ sources: current.sources, targets: current.targets, revision: current.revision }) !== JSON.stringify({ sources: ctx.sources, targets: ctx.targets, revision: ctx.revision })) why = 'record_changed';
        else drafts = ddDrafts(result.output, ctx, input);
      } catch { why = 'access_changed'; }
      const usageLogId = result.usageLogId ?? null;
      const proposals: Array<Record<string, unknown>> = [];
      for (const payload of drafts) {
        const p = await proposeRail(c.env, { userId: Number(user.id), page: DD_PAGE, option: input.option, record: scope.record, kind: 'proposal', payload, model: result.usage?.model ?? null, usageLogId });
        proposals.push({ uid: p.uid, ...payload });
      }
      const receipt = usageLogId ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, user.id).first<{ charged_microusd: number | null }>() : null;
      let budget: unknown = null;
      try { budget = await loadAiBudget(c.env, Number(user.id)); } catch { /* Receipt remains available if budget cannot be read. */ }
      return finish({ proposals, dropped: proposals.length ? [] : [{ why }], usage_log_id: usageLogId, charged_microusd: receipt?.charged_microusd ?? null, budget });
    } catch (error) {
      if (error instanceof DdRunRefusal) return c.json({ code: error.code, detail: error.sentence }, error.status);
      if ((error as Error)?.message === 'Unauthorized') return c.json({ code: 'unauthorized', detail: 'Sign in before running Eadwyn.' }, 401);
      if ((error as Error)?.message === 'Forbidden') return c.json({ code: 'dd_forbidden', detail: 'You cannot run this option on this case.' }, 403);
      return c.json({ code: 'dd_unreadable', detail: 'Diligence records are unavailable right now.' }, 503);
    }
  });
  return r;
}
const router = ddRailRunRoutes();
export const mount = { path: '/api/ai/rail', router: router, before: [legacyRailRun] };
export default router;
