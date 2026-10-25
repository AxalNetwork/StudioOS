/**
 * D1065 (#2935): prepare and read. D1066 (#2936): Accept, Edit and accept,
 * Dismiss, Accept all in a module (`services/buildPlanAccept.ts`), and the
 * evidence trail, mounted on its own at `/api/cycles/build/evidence`.
 *
 *   POST  /items/:uid/accept             the founder accepts, with an optional edited payload
 *   PATCH /items/:uid                    saves the founder's version; it stays proposed
 *   POST  /items/:uid/dismiss            never proposed again
 *   POST  /modules/:module/accept?project=&scope=   each item's own claim, at most 50
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { refuse } from '../util/refusal';
import { requireAuth } from '../auth';
import { ownsVenture, type ProjectRef } from './_founder_validate_helpers';
import { BuildPlanError, PLAN_MODULES, preparePlan, readPlan } from '../services/buildPlanner';
import { BUILD_TABLES, PlanItemError, acceptItem, acceptModule, dismissItem, editItem, evidenceTrail, type BuildTable } from '../services/buildPlanAccept';

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
  return { projectId, user, scope, partner };
}
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
app.patch('/items/:uid', c => decide(c, async user => editItem(c.env, user, itemUid(c), (await bodyOf(c))?.payload)));
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
