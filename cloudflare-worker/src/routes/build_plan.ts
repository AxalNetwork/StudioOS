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

const app = new Hono<{ Bindings: Env }>();
type Project = ProjectRef & { company_id: number | null };
async function context(c: any, write: boolean) {
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
  return { projectId, user, scope, partner };
}
async function handle(c: any, write: boolean) {
  try {
    const ctx = await context(c, write);
    if (ctx instanceof Response) return ctx;
    return c.json(write ? await preparePlan(c.env, ctx.projectId, ctx.user.id, ctx.scope) : await readPlan(c.env, ctx.projectId, ctx.scope, ctx.partner));
  } catch (e) {
    if (e instanceof BuildPlanError) {
      const detail = e.code === 'no_evidence' ? 'Accept findings in Validate before preparing a plan.' : e.code === 'plan_paused' ? 'The plan is paused. Record a new decision to resume.' : 'This plan does not belong to this venture.';
      return c.json({ code: e.code, detail }, e.status);
    }
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
    if (e instanceof PlanItemError) return refuse(c, e.status, { code: e.code, message: e.message, extra: { code: e.code } });
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
