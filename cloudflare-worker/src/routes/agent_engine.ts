/**
 * D1529 (#3845, E1 of #3742) — the agent engine's goals, tasks and
 * dependencies. Mounted at `/api/teams` in `index.ts`, before
 * `team_agents.ts`, in its own module.
 *
 *   GET    /:scope/:id/goals                   read
 *   POST   /:scope/:id/goals                   manage
 *   PATCH  /goals/:uid                         manage
 *   GET    /:scope/:id/tasks?goal=&assignee=&status=&module=   read
 *   POST   /:scope/:id/tasks                   manage
 *   PATCH  /tasks/:uid                         manage; a person assignee may change status only
 *   PUT    /tasks/:uid/deps                    manage
 *
 * `:scope` is `company` (by uid) or `project` (by numeric id). The gates are
 * D1496's (`services/agents/teams.ts`), so the company branch #3697 part 2
 * adds to `isProjectManager` reaches them unchanged.
 *
 * Every route answers 404 `agent_engine_off` unless `AGENT_ENGINE` is set and
 * not "off" and `TEAM_AGENTS_ENABLED` is "true". The check is in each handler,
 * not a `*` middleware, so this router never answers for team_agents' paths.
 *
 * D1528 (#3847, E3 of #3742) — the runtime's routes, behind the same flag and gates:
 *
 *   GET    /tasks/:uid/quote          manage or sponsor  { quote: { available, value_microusd } }
 *   POST   /tasks/:uid/start          manage or sponsor  202 { run }; 409 agent_busy | scope_busy | queue_full | not_ready;
 *                                                        403 engine_paused | scope_paused
 *   GET    /agents/:uid/runs          read               { runs: [Run] }
 *   GET    /runs/:uid                 read               { run, steps: [{ name, status, at, summary }], cost }
 *   POST   /runs/:uid/cancel          manage             { run }; 409 not_running
 *   GET    /:scope/:id/engine         read               { engine, halted, scope_paused, max_parallel_runs, autonomy }
 *   PUT    /:scope/:id/engine         manage             body { paused?, max_parallel_runs? }; 400 invalid_engine
 *
 * A start goes through the runtime's seam (`src/agents/runtime.ts`), never a
 * binding. With the engine off or paused, #3727's own
 * `POST /agents/:uid/run` (team_agents.ts) still runs an agent by hand.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC USER ID. A person is `{ uid, name }`; an
 * agent `{ uid, role_key, first_name, last_name }`. `cost` is
 * `{ available: false }` until E3 records task runs, never 0.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { canManage, canRead, loadScope, scopeOfAgent, type Scope } from '../services/agents/teams';
import { goalByUid, goalDto, goalWrite, goalsOf, insertGoal, updateGoal, type Refusal } from '../services/agents/goals';
import {
  TASK_STATUSES, depsOf, insertTask, isReady, setDeps, statusWrite, taskByUid, taskCosts, taskWrite, tasksOf, updateTask, type TaskRow,
} from '../services/agents/tasks';
import { workBoardRoutes } from './work_board';
import { agentQuote } from '../services/agents/agentRun';
import { agentByUid, type AgentRow } from '../services/agents/teams';
import { agentRuntime, autonomy, engineMode, haltedAll, type AgentRuntime, type ScopeRef } from '../agents/runtime';
import { moveTask, putScopeSettings, runByUid, runDto, scopeOfRow as runScopeOf, scopeSettings, stepsOf, type RunRow } from '../agents/engine';
import { terminateRun, trackRun } from '../agents/doRuntime';

type C = Context<{ Bindings: Env }>;

export const agentEngineEnabled = (env: Env) =>
  typeof env.AGENT_ENGINE === 'string' && env.AGENT_ENGINE !== '' && env.AGENT_ENGINE !== 'off' && env.TEAM_AGENTS_ENABLED === 'true';

/** The runtime the routes reach; tests pass their own (the `railRunRoutes` pattern). */
export type EngineRouteDeps = { runtime: (env: Env) => Promise<AgentRuntime> };
const DEFAULT_DEPS: EngineRouteDeps = { runtime: agentRuntime };
let deps: EngineRouteDeps = DEFAULT_DEPS;
/** Tests only. */
export function __setEngineRouteDeps(d: Partial<EngineRouteDeps> | null) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

const router = new Hono<{ Bindings: Env }>();
// D1614 W1 (#3969): a project's Work board, its moves and its task fields, ahead of E1's
// handlers. Project scope only; a company task falls through to E1 unchanged.
router.route('/', workBoardRoutes(agentEngineEnabled));

const say = (c: C, r: Refusal) => refuse(c, r.status, { code: r.code, message: r.message });
const off = (c: C) => c.json({ error: 'agent_engine_off' }, 404);
const noScope = (c: C) => refuse(c, 404, { code: 'not_found', message: 'There is no such team.' });
const notMember = (c: C) => refuse(c, 403, { code: 'not_member', message: 'Only the team can see its goals and tasks.' });
const notManager = (c: C) => refuse(c, 403, { code: 'not_manager', message: 'Only the team’s editors can change its goals and tasks.' });

async function readBody(c: C): Promise<Record<string, any> | null> {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}

/** The scope a row belongs to. */
const scopeOfRow = (env: Env, r: { scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null }) => scopeOfAgent(env, r);

// ── Answers ─────────────────────────────────────────────────────────────────

async function personOf(env: Env, id: number | null) {
  if (!id) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

async function tasksDto(env: Env, rows: TaskRow[]) {
  const ids = rows.map((t) => t.id);
  const deps = await depsOf(env, ids);
  const costs = await taskCosts(env, ids);
  const out = [];
  for (const t of rows) {
    const goal = t.goal_id ? await env.DB.prepare('SELECT uid, title FROM scope_goals WHERE id = ?').bind(t.goal_id).first<{ uid: string; title: string }>() : null;
    const agent = t.assignee_agent_id
      ? await env.DB.prepare('SELECT uid, role_key, first_name, last_name FROM team_agents WHERE id = ?').bind(t.assignee_agent_id)
        .first<{ uid: string; role_key: string; first_name: string | null; last_name: string | null }>()
      : null;
    const project = t.context_project_id ? await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(t.context_project_id).first<{ id: number; name: string }>() : null;
    const d = deps.get(t.id) ?? [];
    const person = t.assignee_kind === 'person' ? await personOf(env, t.assignee_user_id) : null;
    out.push({
      uid: t.uid, title: t.title, detail: t.detail, module: t.module, option: t.option, kind: t.kind,
      goal: goal ? { uid: goal.uid, title: goal.title } : null,
      assignee: {
        kind: t.assignee_kind,
        ...(person ? { person } : {}),
        ...(agent ? { agent: { uid: agent.uid, role_key: agent.role_key, first_name: agent.first_name, last_name: agent.last_name } } : {}),
      },
      context_project: project ? { id: project.id, name: project.name } : null,
      status: t.status, blocked_reason: t.blocked_reason, ready: isReady(t, d),
      depends_on: d.map((x) => x.uid), priority: t.priority, due_at: t.due_at, attempts: t.attempts,
      cost: costs.get(t.id) ?? { available: false },
    });
  }
  return out;
}

async function oneTask(env: Env, t: TaskRow) {
  return (await tasksDto(env, [t]))[0];
}

async function goalsDto(env: Env, s: Scope) {
  const goals = await goalsOf(env, s);
  const tasks = await tasksOf(env, s);
  const costs = await taskCosts(env, tasks.map((t) => t.id));
  const out = [];
  for (const g of goals) {
    const mine = tasks.filter((t) => t.goal_id === g.id).map((t) => ({ status: t.status, cost: costs.get(t.id)! }));
    out.push(await goalDto(env, s, g, mine));
  }
  return out;
}

// ── Goals ───────────────────────────────────────────────────────────────────

router.get('/:scope/:id/goals', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    return c.json({ goals: await goalsDto(c.env, s) });
  } catch (e) { return mapError(c, e); }
});

router.post('/:scope/:id/goals', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    if (!(await canManage(c.env, s, user))) return notManager(c);
    const b = await readBody(c);
    if (!b) return say(c, { status: 400, code: 'invalid_goal', message: 'Send the goal’s title.' });
    const w = await goalWrite(c.env, s, b, true);
    if (!w.ok) return say(c, w.refusal);
    const g = await insertGoal(c.env, s, w.write, user.id);
    return c.json({ goal: await goalDto(c.env, s, g, []) }, 201);
  } catch (e) { return mapError(c, e); }
});

router.patch('/goals/:uid', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const g = await goalByUid(c.env, c.req.param('uid') ?? '');
    const s = g && await scopeOfRow(c.env, g);
    if (!g || !s || !(await canRead(c.env, s, user))) return refuse(c, 404, { code: 'not_found', message: 'There is no such goal.' });
    if (!(await canManage(c.env, s, user))) return notManager(c);
    const b = await readBody(c);
    if (!b) return say(c, { status: 400, code: 'invalid_goal', message: 'Send what to change.' });
    const w = await goalWrite(c.env, s, b, false);
    if (!w.ok) return say(c, w.refusal);
    const fresh = await updateGoal(c.env, g, w.write);
    const tasks = (await tasksOf(c.env, s, { goalId: g.id }));
    const costs = await taskCosts(c.env, tasks.map((t) => t.id));
    return c.json({ goal: await goalDto(c.env, s, fresh, tasks.map((t) => ({ status: t.status, cost: costs.get(t.id)! }))) });
  } catch (e) { return mapError(c, e); }
});

// ── Tasks ───────────────────────────────────────────────────────────────────

router.get('/:scope/:id/tasks', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    const q = (k: string) => c.req.query(k) || null;
    let goalId: number | null = null;
    if (q('goal')) {
      const g = await goalByUid(c.env, q('goal')!);
      // A goal of another scope matches nothing here.
      goalId = g ? g.id : -1;
    }
    const assignee = q('assignee');
    if (assignee && !['person', 'agent', 'none'].includes(assignee)) return say(c, { status: 400, code: 'invalid_filter', message: 'assignee is person, agent or none.' });
    const status = q('status');
    if (status && !(TASK_STATUSES as readonly string[]).includes(status)) return say(c, { status: 400, code: 'invalid_filter', message: 'That is not a task status.' });
    const rows = await tasksOf(c.env, s, { goalId, assignee: assignee as any, status, module: q('module') });
    return c.json({ tasks: await tasksDto(c.env, rows) });
  } catch (e) { return mapError(c, e); }
});

router.post('/:scope/:id/tasks', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    if (!(await canManage(c.env, s, user))) return notManager(c);
    const b = await readBody(c);
    if (!b) return say(c, { status: 400, code: 'invalid_task', message: 'Send the task’s title.' });
    const w = await taskWrite(c.env, s, b, null);
    if (!w.ok) return say(c, w.refusal);
    const t = await insertTask(c.env, s, w.write, user.id);
    return c.json({ task: await oneTask(c.env, t) }, 201);
  } catch (e) { return mapError(c, e); }
});

/** The task and its scope, when the caller can see it. */
async function visibleTask(c: C, user: User) {
  const t = await taskByUid(c.env, c.req.param('uid') ?? '');
  const s = t && await scopeOfRow(c.env, t);
  if (!t || !s || !(await canRead(c.env, s, user))) return null;
  return { t, s };
}

router.patch('/tasks/:uid', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await visibleTask(c, user);
    if (!got) return refuse(c, 404, { code: 'not_found', message: 'There is no such task.' });
    const b = await readBody(c);
    if (!b) return say(c, { status: 400, code: 'invalid_task', message: 'Send what to change.' });
    if (!(await canManage(c.env, got.s, user))) {
      // A person given the task moves its status, and nothing else.
      const mine = got.t.assignee_kind === 'person' && got.t.assignee_user_id === user.id;
      if (!mine || Object.keys(b).some((k) => k !== 'status' && k !== 'blocked_reason')) return notManager(c);
      const w = statusWrite(b);
      if (!w) return say(c, { status: 400, code: 'invalid_task', message: 'Send the new status.' });
      if (!w.ok) return say(c, w.refusal);
      return c.json({ task: await oneTask(c.env, await updateTask(c.env, got.t, w.write, user.id)) });
    }
    const w = await taskWrite(c.env, got.s, b, got.t);
    if (!w.ok) return say(c, w.refusal);
    return c.json({ task: await oneTask(c.env, await updateTask(c.env, got.t, w.write, user.id)) });
  } catch (e) { return mapError(c, e); }
});

router.put('/tasks/:uid/deps', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await visibleTask(c, user);
    if (!got) return refuse(c, 404, { code: 'not_found', message: 'There is no such task.' });
    if (!(await canManage(c.env, got.s, user))) return notManager(c);
    const b = await readBody(c);
    const r = await setDeps(c.env, got.t, b?.depends_on, user.id);
    if (!r.ok) return say(c, r.refusal);
    return c.json({ task: await oneTask(c.env, (await taskByUid(c.env, got.t.uid))!) });
  } catch (e) { return mapError(c, e); }
});

// ── The runtime (D1528, E3) ─────────────────────────────────────────────────

const refRef = (s: Scope): ScopeRef => ({ kind: s.kind, id: s.id });

/** The task's agent, when the caller may start it: the scope's manager or the agent's sponsor. */
async function startableTask(c: C, user: User) {
  const got = await visibleTask(c, user);
  if (!got) return { refusal: refuse(c, 404, { code: 'not_found', message: 'There is no such task.' }) };
  const agent = got.t.assignee_kind === 'agent' && got.t.assignee_agent_id
    ? await c.env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(got.t.assignee_agent_id).first<AgentRow>()
    : null;
  const sponsor = !!agent && agent.sponsor_user_id === user.id;
  if (!sponsor && !(await canManage(c.env, got.s, user))) {
    return { refusal: refuse(c, 403, { code: 'not_manager', message: 'Only the team’s editors, or the person who added this agent, can start it.' }) };
  }
  if (!agent) return { refusal: refuse(c, 409, { code: 'not_ready', message: 'That task is not assigned to an agent.' }) };
  return { ...got, agent };
}

router.get('/tasks/:uid/quote', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await startableTask(c, user);
    if ('refusal' in got) return got.refusal;
    if (!got.t.module || !got.t.option) return refuse(c, 409, { code: 'not_ready', message: 'That task has no module and option for the agent to work in.' });
    const q = await agentQuote(c.env, { agent: got.agent, module: got.t.module, option: got.t.option, taskId: got.t.id });
    if (!q.ok) return refuse(c, q.status, { code: q.code, message: q.message });
    return c.json({ quote: q.quote.available ? { available: true, value_microusd: q.quote.value_microusd } : { available: false } });
  } catch (e) { return mapError(c, e); }
});

router.post('/tasks/:uid/start', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await startableTask(c, user);
    if ('refusal' in got) return got.refusal;
    const rt = await deps.runtime(c.env);
    const a = await rt.admit(refRef(got.s), { agentId: got.agent.id, taskId: got.t.id, by: user.id, source: 'person' });
    if (!a.ok) return refuse(c, a.status, { code: a.code, message: a.message });
    const run = await runByUid(c.env, a.run.uid);
    return c.json({ run: run ? await runDto(c.env, run) : { uid: a.run.uid } }, 202);
  } catch (e) { return mapError(c, e); }
});

/** The run and its agent's scope, when the caller can read it. */
async function visibleRun(c: C, user: User): Promise<{ run: RunRow; agent: AgentRow; s: Scope } | null> {
  const run = await runByUid(c.env, c.req.param('uid') ?? '');
  const agent = run && await c.env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(run.agent_id).first<AgentRow>();
  const s = agent && await scopeOfAgent(c.env, agent);
  if (!run || !agent || !s || !(await canRead(c.env, s, user))) return null;
  return { run, agent, s };
}

router.get('/agents/:uid/runs', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid') ?? '');
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s || !(await canRead(c.env, s, user))) return refuse(c, 404, { code: 'not_found', message: 'There is no such agent.' });
    const rows = (await c.env.DB.prepare('SELECT * FROM agent_task_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 50').bind(a.id).all<RunRow>()).results ?? [];
    const runs = [];
    for (const r of rows) runs.push(await runDto(c.env, r));
    return c.json({ runs });
  } catch (e) { return mapError(c, e); }
});

router.get('/runs/:uid', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await visibleRun(c, user);
    if (!got) return refuse(c, 404, { code: 'not_found', message: 'There is no such run.' });
    const run = await runDto(c.env, got.run);
    return c.json({ run, steps: stepsOf(got.run).map(({ name, status, at, summary }) => ({ name, status, at, summary })), cost: run.cost });
  } catch (e) { return mapError(c, e); }
});

router.post('/runs/:uid/cancel', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const got = await visibleRun(c, user);
    if (!got) return refuse(c, 404, { code: 'not_found', message: 'There is no such run.' });
    if (!(await canManage(c.env, got.s, user))) return notManager(c);
    if (!['admitted', 'running', 'waiting_decision'].includes(got.run.status)) {
      return refuse(c, 409, { code: 'not_running', message: 'That run has already ended.' });
    }
    await terminateRun(c.env, got.run.uid, 'cancelled_by_person');
    await moveTask(c.env, got.run.task_id, 'open', ['in_progress', 'waiting_decision']);
    const fresh = (await runByUid(c.env, got.run.uid))!;
    await trackRun(c.env, runScopeOf(got.agent), fresh);
    return c.json({ run: await runDto(c.env, fresh) });
  } catch (e) { return mapError(c, e); }
});

async function engineDto(env: Env, s: Scope) {
  const settings = await scopeSettings(env, refRef(s));
  return {
    engine: await engineMode(env),
    halted: await haltedAll(env),
    scope_paused: settings.engine_paused,
    max_parallel_runs: settings.max_parallel_runs,
    autonomy: autonomy(env),
  };
}

router.get('/:scope/:id/engine', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    return c.json(await engineDto(c.env, s));
  } catch (e) { return mapError(c, e); }
});

router.put('/:scope/:id/engine', async (c) => {
  try {
    if (!agentEngineEnabled(c.env)) return off(c);
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return noScope(c);
    if (!(await canRead(c.env, s, user))) return notMember(c);
    if (!(await canManage(c.env, s, user))) return notManager(c);
    const b = await readBody(c);
    const bad = (message: string) => say(c, { status: 400, code: 'invalid_engine', message });
    if (!b || Object.keys(b).some((k) => k !== 'paused' && k !== 'max_parallel_runs') || !Object.keys(b).length) {
      return bad('Send paused (true or false) and/or max_parallel_runs (1 to 5).');
    }
    if ('paused' in b && typeof b.paused !== 'boolean') return bad('paused is true or false.');
    if ('max_parallel_runs' in b && !(Number.isSafeInteger(b.max_parallel_runs) && b.max_parallel_runs >= 1 && b.max_parallel_runs <= 5)) {
      return bad('max_parallel_runs is a whole number from 1 to 5.');
    }
    const ref = refRef(s);
    await putScopeSettings(c.env, ref, { paused: b.paused, max_parallel_runs: b.max_parallel_runs }, user.id);
    const rt = await deps.runtime(c.env);
    // A pause stops admissions in the scope's object from the next request on; a resume rebuilds it from D1.
    if (b.paused === true) await rt.halt(ref, 'scope_paused');
    else if (b.paused === false) await rt.rebuild(ref);
    return c.json(await engineDto(c.env, s));
  } catch (e) { return mapError(c, e); }
});

export default router;
