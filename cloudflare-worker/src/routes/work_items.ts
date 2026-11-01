/**
 * D1614 W7 (#3993): a project task's timeline, comments, review, agent drafts,
 * labels and milestones. Mounted under agent_engine's /api/teams beside W1's
 * board (`work_board.ts`), behind the same flags. Project scope only: a
 * company scope answers 404.
 *
 *   GET    /project/:id/tasks/:number/timeline     read
 *   POST   /project/:id/tasks/:number/comments     read      { body, mentions? }
 *   PATCH  /project/:id/comments/:uid              its author { body }
 *   DELETE /project/:id/comments/:uid              its author
 *   POST   /project/:id/tasks/:number/review       manage    { decision, comment? }
 *   PUT    /project/:id/tasks/:number/labels       manage    { labels: [uid] }
 *   PUT    /project/:id/tasks/:number/milestone    manage    { milestone: uid | null }
 *   GET    /project/:id/work/drafts                read
 *   POST   /project/:id/work/drafts/:uid/accept    manage
 *   POST   /project/:id/work/drafts/:uid/discard   manage    { reason }
 *   GET    /project/:id/work/labels                read
 *   POST   /project/:id/work/labels                manage    { name, color?, description? }
 *   PATCH  /project/:id/work/labels/:uid           manage
 *   DELETE /project/:id/work/labels/:uid           manage
 *   GET    /project/:id/work/milestones            read
 *   POST   /project/:id/work/milestones            manage    { title, description?, due_on? }
 *   PATCH  /project/:id/work/milestones/:uid       manage    (and state open/closed)
 *   DELETE /project/:id/work/milestones/:uid       manage
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { canRead, loadScope, type Scope } from '../services/agents/teams';
import { notify } from '../services/notify';
import { workCards, WorkRefusal, NO_WORK_RUNS_RECORDED, type WorkRunReader } from '../services/agents/workBoard';
import {
  acceptDraft, addComment, createLabel, createMilestone, deleteComment, deleteLabel, deleteMilestone, discardDraft, editComment,
  listDrafts, listLabels, listMilestones, reviewTask, setTaskLabels, setTaskMilestone, taskByNumber, timeline, updateLabel, updateMilestone,
  type Publish,
} from '../services/agents/workItems';

type C = Context<{ Bindings: Env }>;
type Project = Extract<Scope, { kind: 'project' }>;

export function workItemRoutes(enabled: (env: Env) => boolean, publish: Publish = notify, readRuns: WorkRunReader = NO_WORK_RUNS_RECORDED) {
  const router = new Hono<{ Bindings: Env }>();
  const absent = () => new WorkRefusal(404, 'not_found', 'There is no project task here.');
  async function body(c: C) {
    let b: unknown; try { b = await c.req.json(); } catch { /* malformed body */ }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new WorkRefusal(400, 'invalid_body', 'Send a JSON object.');
    return b as Record<string, any>;
  }
  function failure(c: C, e: unknown) {
    if (e instanceof WorkRefusal) return refuse(c, e.status as any, { code: e.code, message: e.sentence, extra: e.blockers ? { blockers: e.blockers } : undefined });
    return mapError(c, e);
  }
  /** Every route: the flags, a signed-in member, and a project (a company scope is 404). */
  async function project(c: C): Promise<{ user: User; s: Project }> {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, 'project', c.req.param('id') ?? '');
    if (!s || s.kind !== 'project' || !(await canRead(c.env, s, user))) throw absent();
    return { user, s: s as Project };
  }
  const card = async (c: C, t: any) => (await workCards(c.env, [t], readRuns))[0];
  const handle = (fn: (c: C) => Promise<Response>) => async (c: C) => {
    try {
      if (!enabled(c.env)) return c.json({ error: 'agent_engine_off' }, 404);
      return await fn(c);
    } catch (e) { return failure(c, e); }
  };

  router.get('/project/:id/tasks/:number/timeline', handle(async (c) => {
    const { s } = await project(c);
    return c.json(await timeline(c.env, s, await taskByNumber(c.env, s, c.req.param('number'))));
  }));
  router.post('/project/:id/tasks/:number/comments', handle(async (c) => {
    const { s, user } = await project(c);
    const t = await taskByNumber(c.env, s, c.req.param('number'));
    return c.json({ comment: await addComment(c.env, s, t, await body(c), user, publish) }, 201);
  }));
  router.patch('/project/:id/comments/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ comment: await editComment(c.env, s, c.req.param('uid') ?? '', await body(c), user) });
  }));
  router.delete('/project/:id/comments/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ comment: await deleteComment(c.env, s, c.req.param('uid') ?? '', user) });
  }));
  router.post('/project/:id/tasks/:number/review', handle(async (c) => {
    const { s, user } = await project(c);
    const t = await taskByNumber(c.env, s, c.req.param('number'));
    return c.json({ task: await card(c, await reviewTask(c.env, s, t, await body(c), user, publish)) });
  }));
  router.put('/project/:id/tasks/:number/labels', handle(async (c) => {
    const { s, user } = await project(c);
    const t = await taskByNumber(c.env, s, c.req.param('number'));
    return c.json({ task: await card(c, await setTaskLabels(c.env, s, t, await body(c), user)) });
  }));
  router.put('/project/:id/tasks/:number/milestone', handle(async (c) => {
    const { s, user } = await project(c);
    const t = await taskByNumber(c.env, s, c.req.param('number'));
    return c.json({ task: await card(c, await setTaskMilestone(c.env, s, t, await body(c), user)) });
  }));

  router.get('/project/:id/work/drafts', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ drafts: await listDrafts(c.env, s, user) });
  }));
  router.post('/project/:id/work/drafts/:uid/accept', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ task: await card(c, await acceptDraft(c.env, s, c.req.param('uid') ?? '', user)) }, 201);
  }));
  router.post('/project/:id/work/drafts/:uid/discard', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ draft: await discardDraft(c.env, s, c.req.param('uid') ?? '', await body(c), user) });
  }));

  router.get('/project/:id/work/labels', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ labels: await listLabels(c.env, s, user) });
  }));
  router.post('/project/:id/work/labels', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ label: await createLabel(c.env, s, await body(c), user) }, 201);
  }));
  router.patch('/project/:id/work/labels/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ label: await updateLabel(c.env, s, c.req.param('uid') ?? '', await body(c), user) });
  }));
  router.delete('/project/:id/work/labels/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json(await deleteLabel(c.env, s, c.req.param('uid') ?? '', user));
  }));

  router.get('/project/:id/work/milestones', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ milestones: await listMilestones(c.env, s, user) });
  }));
  router.post('/project/:id/work/milestones', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ milestone: await createMilestone(c.env, s, await body(c), user) }, 201);
  }));
  router.patch('/project/:id/work/milestones/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json({ milestone: await updateMilestone(c.env, s, c.req.param('uid') ?? '', await body(c), user) });
  }));
  router.delete('/project/:id/work/milestones/:uid', handle(async (c) => {
    const { s, user } = await project(c);
    return c.json(await deleteMilestone(c.env, s, c.req.param('uid') ?? '', user));
  }));

  // A company has no Work: its W7 paths answer 404, never a company read.
  router.all('/company/:id/tasks/:number/*', handle(async () => { throw absent(); }));
  router.all('/company/:id/work/*', handle(async () => { throw absent(); }));
  router.all('/company/:id/comments/*', handle(async () => { throw absent(); }));
  return router;
}
