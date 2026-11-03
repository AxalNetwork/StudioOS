/**
 * D1614 CO2–CO5 (#3976) — a company's compliance tasks, at
 * /api/company/:uid/compliance. The service (`services/compliance/
 * companyTasks.ts`) holds every gate; these handlers parse and answer.
 *
 *   GET    /company/:uid/compliance                       the list (?status=&jurisdiction=&owner=&type=)
 *   POST   /company/:uid/compliance                       a new task (company admins)
 *   GET    /company/:uid/compliance/assignable            the assignee picker
 *   GET    /company/:uid/compliance/:task                 one task, its linked work and timeline
 *   PATCH  /company/:uid/compliance/:task                 edit (company admins)
 *   PUT    /company/:uid/compliance/:task/assignee        assign, or { assignee: null } (company admins)
 *   POST   /company/:uid/compliance/:task/comments        a comment (seat holders)
 *   POST   /company/:uid/compliance/:task/ready           ready for review (seat holders)
 *   POST   /company/:uid/compliance/:task/done            mark done, { note? } (company admins only)
 *   POST   /company/:uid/compliance/:task/reopen          reopen (company admins)
 *   POST   /company/:uid/compliance/:task/work            "Create work in a project…" { project_id, title? }
 *
 * A refusal is D278's `{ error, message, detail }`: a code and our sentence; nothing else is echoed.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { agentEngineEnabled } from './agent_engine';
import { WorkRefusal } from '../services/agents/workBoard';
import type { RouteMount } from '../util/routeRegistry';
import companyRoutes from './company';
import {
  ComplianceRefusal, assignTask, assignable, commentOn, companyOf, createTask, createWork, listTasks, markDone,
  readTask, readyForReview, reopenTask, updateTask,
} from '../services/compliance/companyTasks';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const body = async (c: C): Promise<Record<string, any>> => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

function answer(c: C, e: unknown) {
  if (e instanceof ComplianceRefusal || e instanceof WorkRefusal) return refuse(c, e.status as any, { code: e.code, message: e.sentence });
  return mapError(c, e);
}

const handle = (fn: (c: C) => Promise<Response>) => async (c: C) => { try { return await fn(c); } catch (e) { return answer(c, e); } };

router.get('/:uid/compliance', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  const q = (k: string) => c.req.query(k) || null;
  return c.json(await listTasks(c.env, s, user, { status: q('status'), jurisdiction: q('jurisdiction'), owner: q('owner'), type: q('type') }));
}));

router.post('/:uid/compliance', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json({ task: await createTask(c.env, s, user, await body(c)) }, 201);
}));

router.get('/:uid/compliance/assignable', handle(async (c) => {
  const user = await requireAuth(c);
  return c.json(await assignable(c.env, await companyOf(c.env, c.req.param('uid') ?? ''), user));
}));

router.get('/:uid/compliance/:task', handle(async (c) => {
  const user = await requireAuth(c);
  return c.json(await readTask(c.env, await companyOf(c.env, c.req.param('uid') ?? ''), user, c.req.param('task') ?? ''));
}));

router.patch('/:uid/compliance/:task', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json({ task: await updateTask(c.env, s, user, c.req.param('task') ?? '', await body(c)) });
}));

router.put('/:uid/compliance/:task/assignee', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  const b = await body(c);
  return c.json({ task: await assignTask(c.env, s, user, c.req.param('task') ?? '', 'assignee' in b ? b.assignee : undefined) });
}));

router.post('/:uid/compliance/:task/comments', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json(await commentOn(c.env, s, { user }, c.req.param('task') ?? '', (await body(c)).body), 201);
}));

router.post('/:uid/compliance/:task/ready', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json({ task: await readyForReview(c.env, s, { user }, c.req.param('task') ?? '') });
}));

router.post('/:uid/compliance/:task/done', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json({ task: await markDone(c.env, s, { user }, c.req.param('task') ?? '', (await body(c)).note) });
}));

router.post('/:uid/compliance/:task/reopen', handle(async (c) => {
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json({ task: await reopenTask(c.env, s, user, c.req.param('task') ?? '') });
}));

// Project boards are W1's, behind the agent engine's switch; while it is off there is no board to land on.
router.post('/:uid/compliance/:task/work', handle(async (c) => {
  if (!agentEngineEnabled(c.env)) return c.json({ error: 'agent_engine_off' }, 404);
  const user = await requireAuth(c);
  const s = await companyOf(c.env, c.req.param('uid') ?? '');
  return c.json(await createWork(c.env, s, user, c.req.param('task') ?? '', await body(c)), 201);
}));

/** Mounts itself (#4105) at /api/company, ahead of company.ts, whose /:uid routes would otherwise answer first. */
export const mount: RouteMount = { path: '/api/company', router: router, before: [companyRoutes] };

export default router;
