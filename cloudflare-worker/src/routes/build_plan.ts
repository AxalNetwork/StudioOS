/**
 * D1065 (#2935): prepare and read. D1066 (#2936): Accept, Edit and accept,
 * Dismiss, Accept all in a module (`services/buildPlanAccept.ts`), and the
 * evidence trail, mounted on its own at `/api/cycles/build/evidence`.
 *
 *   POST  /items/:uid/accept             the founder accepts, with an optional edited payload
 *   PATCH /items/:uid                    saves the founder's version; it stays proposed
 *   POST  /items/:uid/dismiss            never proposed again
 *   POST  /modules/:module/accept?project=&scope=   each item's own claim, at most 50
 *
 * D1071 (#2941): Eadwyn's wording (`services/buildPlanWord.ts`).
 *
 *   POST  /word?project=&scope=          one metered run under `draft:build/plan` → the wording, not saved
 *   GET   /word?project=&scope=          the founder's latest wording on the plan, or null
 *   POST  /word/:uid/keep?project=&scope=      { target: brief | prompt }
 *   POST  /word/:uid/discard?project=&scope=   { target: brief | prompt | <item uid> }
 *   An item's wording is kept by its Save: PATCH /items/:uid { wording }.
 *
 * D1068 (#2938): Send to… and Back in (`services/buildHandoffs.ts`).
 *
 *   POST  /handoffs?project=&scope=       { provider, items, repository? } → the link or the Markdown, recorded
 *   GET   /handoffs?project=&scope=       the venture's handoffs; the text for its founders only
 *   GET   /links?project=&scope=          link proposals and links from the tools (a partner: links only)
 *   POST  /links/:uid/accept?project=&scope=   Link
 *   POST  /links/:uid/dismiss?project=&scope=  Not this one: the next sync lands it as its own row
 *   POST  /items/:uid/link                { fed: "issue:owner/repo#n" | "pull:owner/repo#n" } a link by hand
 *
 * D968 (#3351): the later stages (`services/buildStates.ts`).
 *
 *   GET   /states?project=&scope=&limit=&offset=   each accepted, landed item's Built, Live and Tested, paged
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { refuse } from '../util/refusal';
import { requireAuth } from '../auth';
import { ownsVenture, type ProjectRef } from './_founder_validate_helpers';
import { BuildPlanError, PLAN_MODULES, preparePlan, readPlan } from '../services/buildPlanner';
import { BUILD_TABLES, PlanItemError, acceptItem, acceptModule, dismissItem, editItem, evidenceTrail, type BuildTable } from '../services/buildPlanAccept';
import { WORD_OPTION, WORD_PAGE, WORD_SYSTEM, decideWording, latestWording, planFor, screenWording, storeWording, wordMaterial, wordPrompt } from '../services/buildPlanWord';
import { run as aiRouterRun } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { parseJsonLoose } from '../services/decks/autofill';
import { railFor, refuseRun } from '../util/railContext';
import { acceptLink, dismissLink, linkByHand, listHandoffs, listLinks, sendHandoff } from '../services/buildHandoffs';
import { STATES_PAGE, STATES_PAGE_MAX, listStates } from '../services/buildStates';

const app = new Hono<{ Bindings: Env }>();
type Project = ProjectRef & { company_id: number | null };
/** The caller, venture and scope of a plan request, or the refusal (D1067's routes share it). */
export async function context(c: any, write: boolean) {
  let user: User;
  try { user = await requireAuth(c); } catch { return c.json({ code: 'unauthorized', detail: 'Sign in to read this plan.' }, 401); }
  const raw = String(c.req.query('project') ?? '');
  const scope = String(c.req.query('scope') ?? 'venture');
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || !/^(venture|h-[1-9][0-9]{0,9})$/.test(scope)) return c.json({ code: 'invalid_project', detail: 'Choose a venture and plan scope.' }, 400);
  const projectId = Number(raw);
  const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first() as Project | null;
  if (!project) return c.json({ code: 'not_this_project', detail: 'This plan does not belong to this venture.' }, 404);
  if (scope !== 'venture' && !await c.env.DB.prepare('SELECT id FROM hypotheses WHERE id = ? AND project_id = ? AND retired_at IS NULL').bind(Number(scope.slice(2)), projectId).first()) return c.json({ code: 'not_this_project', detail: 'This plan does not belong to this venture.' }, 404);
  const owner = ownsVenture(project, user);
  let partner = false;
  if (!write && user.role === 'partner' && project.company_id != null) {
    partner = Boolean(await c.env.DB.prepare('SELECT id FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(project.company_id, user.id).first());
  }
  if (!(owner || (!write && (user.role === 'admin' || partner)))) return c.json({ code: 'not_this_project', detail: 'This plan belongs to the venture’s founders.' }, 404);
  return { projectId, user, scope, partner, owner };
}
/** Whether the reader is one of the venture's founders, who alone read a handoff's text. */
const ownsVentureOf = (ctx: { owner?: boolean }) => Boolean(ctx.owner);
/** A BuildPlanError as its answer, the same words for every plan route. */
export function refusal(c: any, e: BuildPlanError) {
  const detail = e.code === 'no_evidence' ? 'Accept findings in Validate before preparing a plan.'
    : e.code === 'plan_paused' ? 'The plan is paused. Record a new decision to resume.'
      : e.code === 'plan_stopped' ? 'Your verdict is Stop. Record a new decision to resume.' : 'This plan does not belong to this venture.';
  return c.json({ code: e.code, detail }, e.status);
}
async function handle(c: any, write: boolean) {
  try {
    const ctx = await context(c, write);
    if (ctx instanceof Response) return ctx;
    return c.json(write ? await preparePlan(c.env, ctx.projectId, ctx.user.id, ctx.scope) : await readPlan(c.env, ctx.projectId, ctx.scope, ctx.partner));
  } catch (e) {
    if (e instanceof BuildPlanError) return refusal(c, e);
    console.warn('[build-plan] read or preparation unavailable');
    return c.json({ code: 'unreadable', detail: 'The build plan could not be read or prepared. Try again.' }, 503);
  }
}
app.get('/', c => handle(c, false));
app.post('/', c => handle(c, true));

// ─────────────────────────────────────────────── D1066: deciding items

const ITEM_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A decision write: the signed-in founder, the item's own refusals as `code`, a store failure 503. */
async function decide(c: any, run: (user: User) => Promise<unknown>) {
  let user: User;
  try { user = await requireAuth(c); } catch { return c.json({ code: 'unauthorized', detail: 'Sign in to decide this plan.' }, 401); }
  try {
    return c.json(await run(user));
  } catch (e) {
    // Our own sentence, keyed on `code`; `error` carries the same code (D278).
    if (e instanceof PlanItemError) return refuse(c, e.status, { code: e.code, message: e.message, extra: { ...(e.extra || {}), code: e.code } });
    console.warn('[build-plan] a decision could not be read or written');
    return c.json({ code: 'unreadable', detail: 'The build plan could not be read or saved. Try again.' }, 503);
  }
}
const bodyOf = async (c: any) => c.req.json().catch(() => ({}));
const itemUid = (c: any) => {
  const uid = String(c.req.param('uid') ?? '');
  if (!ITEM_UID.test(uid)) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  return uid;
};

app.post('/items/:uid/accept', c => decide(c, async user => acceptItem(c.env, user, itemUid(c), (await bodyOf(c))?.payload)));
app.patch('/items/:uid', c => decide(c, async user => {
  const b = await bodyOf(c);
  return editItem(c.env, user, itemUid(c), b?.payload, b?.wording);
}));
app.post('/items/:uid/dismiss', c => decide(c, async user => dismissItem(c.env, user, itemUid(c))));
app.post('/modules/:module/accept', c => decide(c, async user => {
  const module = String(c.req.param('module'));
  const raw = String(c.req.query('project') ?? '');
  const scope = String(c.req.query('scope') ?? 'venture');
  if (!(PLAN_MODULES as readonly string[]).includes(module) || !/^[1-9][0-9]{0,9}$/.test(raw) || !/^(venture|h-[1-9][0-9]{0,9})$/.test(scope)) {
    throw new PlanItemError('not_this_project', 404, 'This plan does not belong to this venture.');
  }
  return acceptModule(c.env, user, Number(raw), scope, module);
}));

// ─────────────────────────────────────────────── D1071: Eadwyn's wording

// One `rail_write` run under `draft:build/plan`, metered like every rail
// option, only on the founder's press; `run()` refuses it in Manual mode
// (`assist_off`). It stores the wording row and nothing else.
app.post('/word', async (c) => {
  let ctx: Awaited<ReturnType<typeof context>>;
  try { ctx = await context(c, true); } catch { return c.json({ code: 'unreadable', detail: 'The build plan could not be read. Try again.' }, 503); }
  if (ctx instanceof Response) return ctx;
  let plan: Awaited<ReturnType<typeof planFor>>, read: Awaited<ReturnType<typeof readPlan>>;
  try {
    plan = await planFor(c.env, ctx.projectId, ctx.scope);
    read = await readPlan(c.env, ctx.projectId, ctx.scope);
  } catch {
    console.warn('[build-plan] wording read unavailable');
    return c.json({ code: 'unreadable', detail: 'The build plan could not be read, so Eadwyn has nothing to word. Try again.' }, 503);
  }
  if (!plan) return c.json({ code: 'no_plan', detail: 'Prepare the plan first. Eadwyn words what the rules propose.' }, 409);
  if (plan.status === 'paused') return c.json({ code: 'plan_paused', detail: 'The plan is paused. Record a new decision to resume.' }, 409);
  const m = wordMaterial(read.modules as any, read.brief as any);
  if (!m) return c.json({ code: 'nothing_to_word', detail: 'No item is waiting for your decision, so there is nothing to word.' }, 422);
  const result = await aiRouterRun(c.env, {
    task: 'rail_write',
    userId: Number(ctx.user.id),
    surface: AI_SURFACE.buildPlan,
    rail: railFor(c, { page: WORD_PAGE, option: WORD_OPTION }, `build_plan:${plan.uid}`),
    systemPrompt: WORD_SYSTEM,
    messages: [{ role: 'user', content: wordPrompt(m) }],
    temperature: 0.4,
    maxTokens: 2400,
  });
  if (!result.ok || !result.output) {
    return refuseRun(c, result) || c.json({ code: 'ai_unavailable', detail: 'Eadwyn could not word the plan just now. Nothing was charged. Try again.' }, 503);
  }
  const w = screenWording(parseJsonLoose<unknown>(result.output), m);
  if (!Object.keys(w.items).length && !w.brief && !w.lovable_prompt) {
    return c.json({ code: 'nothing_kept', detail: 'Eadwyn’s wording all held a number, a name or a link, so none was kept. The rule’s titles stand.', removed: w.removed }, 422);
  }
  try {
    await storeWording(c.env, ctx.user.id, plan, w, { model: result.usage?.model ?? null, usageLogId: result.usageLogId ?? null });
    return c.json({ wording: await latestWording(c.env, ctx.user.id, plan) });
  } catch {
    console.warn('[build-plan] wording could not be stored');
    return c.json({ code: 'unreadable', detail: 'Eadwyn’s wording could not be kept for you to review. Try again.' }, 503);
  }
});

app.get('/word', async (c) => {
  try {
    const ctx = await context(c, true);
    if (ctx instanceof Response) return ctx;
    const plan = await planFor(c.env, ctx.projectId, ctx.scope);
    return c.json({ wording: plan ? await latestWording(c.env, ctx.user.id, plan) : null });
  } catch {
    console.warn('[build-plan] wording read unavailable');
    return c.json({ code: 'unreadable', detail: 'Eadwyn’s wording could not be read. Try again.' }, 503);
  }
});

const wordingDecision = (how: 'kept' | 'discarded') => async (c: any) => {
  const ctx = await context(c, true).catch(() => null);
  if (!ctx) return c.json({ code: 'unreadable', detail: 'The build plan could not be read. Try again.' }, 503);
  if (ctx instanceof Response) return ctx;
  return decide(c, async (user) => {
    const uid = String(c.req.param('uid') ?? '');
    if (!ITEM_UID.test(uid)) throw new PlanItemError('invalid_edit', 400, 'That wording is not on this plan.');
    const target = String((await bodyOf(c))?.target ?? '');
    return { wording: await decideWording(c.env, user, ctx.projectId, ctx.scope, uid, target, how) };
  });
};
app.post('/word/:uid/keep', wordingDecision('kept'));
app.post('/word/:uid/discard', wordingDecision('discarded'));

// ─────────────────────────────────────────────── D1068: Send to… and Back in

/** A plan-scoped route: the context's refusal, else the run as a decision write. */
const scoped = (write: boolean, run: (ctx: { projectId: number; user: User; scope: string; partner: boolean; owner: boolean }, c: any) => Promise<unknown>) => async (c: any) => {
  const ctx = await context(c, write).catch(() => null);
  if (!ctx) return c.json({ code: 'unreadable', detail: 'The build plan could not be read. Try again.' }, 503);
  if (ctx instanceof Response) return ctx;
  return decide(c, async () => run(ctx, c));
};
const linkUid = (c: any) => String(c.req.param('uid') ?? '');

app.post('/handoffs', scoped(true, async (ctx, c) => sendHandoff(c.env, ctx.user, ctx.projectId, ctx.scope, await bodyOf(c))));
app.get('/handoffs', scoped(false, async (ctx, c) => ({ handoffs: await listHandoffs(c.env, ctx.projectId, ownsVentureOf(ctx)) })));
app.get('/links', scoped(false, async (ctx, c) => ({ links: await listLinks(c.env, ctx.projectId, ctx.partner) })));
// D968 (#3351): each accepted, landed item's Built, Live and Tested, from the row it landed in. Paged.
app.get('/states', scoped(false, async (ctx, c) => {
  const limit = c.req.query('limit') === undefined ? STATES_PAGE : Number(c.req.query('limit'));
  const offset = c.req.query('offset') === undefined ? 0 : Number(c.req.query('offset'));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > STATES_PAGE_MAX || !Number.isSafeInteger(offset) || offset < 0) {
    throw new PlanItemError('invalid_page', 400, `Use a limit from 1 to ${STATES_PAGE_MAX} and a nonnegative offset.`);
  }
  return listStates(c.env, ctx.projectId, limit, offset);
}));
app.post('/links/:uid/accept', scoped(true, async (ctx, c) => acceptLink(c.env, ctx.user, ctx.projectId, linkUid(c))));
app.post('/links/:uid/dismiss', scoped(true, async (ctx, c) => dismissLink(c.env, ctx.user, ctx.projectId, linkUid(c))));
app.post('/items/:uid/link', c => decide(c, async user => linkByHand(c.env, user, itemUid(c), (await bodyOf(c))?.fed)));

export default app;

/**
 * GET /api/cycles/build/evidence?project=&table=&id= — one Build row's trail
 * (D1066). Readers are the plan's: the venture's own, an admin, and a partner
 * of the venture's company (D1065). The decision is in it only for
 * `canReadDecision`. PIPE-RAISE (#2430) reads this.
 */
export const buildEvidenceRoutes = new Hono<{ Bindings: Env }>();
buildEvidenceRoutes.get('/', async (c) => {
  let user: User;
  try { user = await requireAuth(c); } catch { return c.json({ code: 'unauthorized', detail: 'Sign in to read this trail.' }, 401); }
  const raw = String(c.req.query('project') ?? ''), table = String(c.req.query('table') ?? ''), rawId = String(c.req.query('id') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || !/^[1-9][0-9]{0,9}$/.test(rawId) || !(BUILD_TABLES as readonly string[]).includes(table)) {
    return c.json({ code: 'invalid_project', detail: 'Choose a venture and one of its Build rows.' }, 400);
  }
  try {
    const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(Number(raw)).first() as (Project & { id: number }) | null;
    const refused = c.json({ code: 'not_this_project', detail: 'This row does not belong to this venture.' }, 404);
    if (!project) return refused;
    let reader = ownsVenture(project, user) || user.role === 'admin';
    if (!reader && user.role === 'partner' && project.company_id != null) {
      reader = Boolean(await c.env.DB.prepare('SELECT id FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(project.company_id, user.id).first());
    }
    if (!reader) return refused;
    const trail = await evidenceTrail(c.env, user, project, table as BuildTable, Number(rawId));
    return trail ? c.json(trail) : refused;
  } catch {
    console.warn('[build-evidence] trail unavailable');
    return c.json({ code: 'unreadable', detail: 'The evidence trail could not be read. Try again.' }, 503);
  }
});
