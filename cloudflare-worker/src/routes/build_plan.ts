/** D1065 (#2935): prepare/read only. Founders accept through D1066's writers. */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ownsVenture, type ProjectRef } from './_founder_validate_helpers';
import { BuildPlanError, preparePlan, readPlan } from '../services/buildPlanner';

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
export default app;
