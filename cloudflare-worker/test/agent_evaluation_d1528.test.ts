/**
 * #3851 (E7 of #3742, under D1528) — the engine's cost reads, the evaluation
 * board (TM14), the alerts and HQ's halt and rebuild.
 *
 *  · costs: a task's, a goal's and an agent's charges are summed from their
 *    runs' usage logs; one unrecorded charge (or a failed read) makes the sum
 *    `{ available: false }`, never 0;
 *  · the board: acceptance counts an edit as an acceptance; under 10
 *    decisions the rates are null and the note says "Too few decisions to rate (n)";
 *    open past 3 days, expired runs, refusals by reason, cost per accepted;
 *  · alerts: the cap at 80% and 100%, a blocked task, a waiting approval, DLQ
 *    arrivals and the gateway at 70%, each once per its window;
 *  · the halt and the rebuild: platform admins only; a halt set stops the
 *    next step of a run; HQ hears each change.
 *
 * Every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_evaluation_d1528.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, PROJECT, SPONSOR, STRANGER, fakeAgentRun, hex, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { agentCosts, evaluateScope, rateRole, runCostReader, sqlTime } from '../src/services/agents/evaluation.ts';
import { taskCosts } from '../src/services/agents/tasks.ts';
import { firstInWindow, sweepAgentAlerts } from '../src/services/agents/alerts.ts';
import adminAgents, { __setAdminAgentsDeps } from '../src/routes/admin_agents.ts';
import engineRoutes, { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import { load } from '../src/agents/loop.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const NOW = new Date('2030-03-20T12:00:00Z');
const t = (iso: string) => sqlTime(new Date(iso));

/** A usage log for `agent`, charged `charged` micro-USD (null: not recorded). */
function usage(w: World, agentId: number, charged: number | null, at = t('2030-03-10T10:00:00Z')): number {
  return Number(w.db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at, charged_microusd, agent_id)
    VALUES (?, 'agent', 'm', 0, ?, ?, ?)`).run(SPONSOR, at, charged, agentId).lastInsertRowid);
}
/** A run of `task` by `agent`, with its usage log. */
function run(w: World, agentId: number, taskId: number, o: { usage?: number | null; status?: string; refusal?: string | null; at?: string; attempt?: number } = {}) {
  const uid = `run-${agentId}-${taskId}-${o.attempt ?? 1}-${Math.random().toString(16).slice(2, 10)}`;
  w.db.prepare(`INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, usage_log_id, refusal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, agentId, taskId, o.attempt ?? 1, o.status ?? 'done', o.usage ?? null, o.refusal ?? null, o.at ?? t('2030-03-10T10:00:00Z'));
  return uid;
}
let seq = 0;
/** A proposal by `agent`, made at `made`, decided `status` after `hours` (none when proposed). */
function proposal(w: World, agentId: number, status: string, made: string, hours: number | null = 2) {
  const decided = hours == null ? null : sqlTime(new Date(Date.parse(made) + hours * 3_600_000));
  seq += 1;
  w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, decided_at, created_at, agent_id)
    VALUES (?, ?, 'Founder · Build', 'draft:build/plan', 'draft', '{}', ?, ?, ?, ?)`).run(`p-${seq}`, SPONSOR, status, decided, t(made), agentId);
  return `p-${seq}`;
}

// ── Costs ────────────────────────────────────────────────────────────────────

test('costs: summed from the runs; one unrecorded charge or a failed read is { available: false }, never 0', async () => {
  // Mutation checked: SUM(COALESCE(l.charged_microusd, 0)) and no unknown count → the task with an unrecorded
  // charge reads 300; the agent with one reads 300 too.
  const w = world();
  try {
    w.agent(AGENT); w.agent(51, 'cto');
    w.task(200, AGENT); w.task(201, AGENT); w.task(202, AGENT);
    run(w, AGENT, 200, { usage: usage(w, AGENT, 300) });
    run(w, AGENT, 200, { usage: usage(w, AGENT, 200), attempt: 2 });
    run(w, AGENT, 201, { usage: usage(w, AGENT, 300) });
    run(w, AGENT, 201, { usage: usage(w, AGENT, null), attempt: 2 });
    const costs = await taskCosts(w.env, [200, 201, 202], runCostReader);
    assert.deepEqual(costs.get(200), { available: true, value_microusd: 500 });
    assert.deepEqual(costs.get(201), { available: false }, 'an unrecorded charge is not 0');
    assert.deepEqual(costs.get(202), { available: true, value_microusd: 0 }, 'a task never run has spent nothing');
    const broken = { ...w.env, DB: { prepare() { throw new Error('D1 down'); } } };
    assert.deepEqual((await taskCosts(broken as any, [200], runCostReader)).get(200), { available: false }, 'a failed read is Not recorded');
    const agents = await agentCosts(w.env, [AGENT, 51]);
    assert.deepEqual(agents.get(AGENT), { available: false }, 'one unrecorded charge makes the agent unknown');
    assert.deepEqual(agents.get(51), { available: true, value_microusd: 0 });
    assert.deepEqual((await agentCosts(broken as any, [51])).get(51), { available: false });
    // The tasks route reads them through the same reader.
    const listed = await routeCall(w, SPONSOR, 'GET', `/api/teams/project/${PROJECT}/tasks`);
    const byUid = Object.fromEntries(listed.body.tasks.map((x: any) => [x.uid, x.cost]));
    assert.deepEqual([byUid[hex(200, 'c')], byUid[hex(201, 'c')]], [{ available: true, value_microusd: 500 }, { available: false }]);
  } finally { w.close(); }
});

// ── The board ────────────────────────────────────────────────────────────────

test('the board: an edit is an acceptance, discards are discards; medians, open past 3 days, expired, refusals and cost per accepted', async () => {
  // Mutation checked: counting `edited` as a discard → acceptance 0.5 and discard 0.5 instead of 0.75 / 0.25.
  const w = world();
  try {
    w.agent(AGENT); w.agent(51, 'cto');
    for (let i = 0; i < 4; i += 1) proposal(w, AGENT, 'accepted', `2030-03-0${i + 1}T09:00:00Z`, i + 1);
    for (let i = 0; i < 2; i += 1) proposal(w, AGENT, 'edited', `2030-03-1${i}T09:00:00Z`, 10);
    for (let i = 0; i < 2; i += 1) proposal(w, AGENT, 'discarded', `2030-03-1${i + 2}T09:00:00Z`, 20);
    proposal(w, AGENT, 'withdrawn', '2030-03-14T09:00:00Z', 1);
    proposal(w, AGENT, 'proposed', '2030-03-15T09:00:00Z', null); // open past 3 days
    proposal(w, AGENT, 'proposed', '2030-03-19T09:00:00Z', null); // open, but not three days yet
    w.task(200, AGENT); w.task(201, AGENT);
    run(w, AGENT, 200, { usage: usage(w, AGENT, 600) });
    run(w, AGENT, 200, { status: 'refused', refusal: 'daily_limit', attempt: 2 });
    run(w, AGENT, 200, { status: 'refused', refusal: 'daily_limit', attempt: 3 });
    run(w, AGENT, 201, { status: 'refused', refusal: 'decision_expired', usage: usage(w, AGENT, 0) });
    run(w, AGENT, 201, { usage: usage(w, AGENT, 0), attempt: 2, at: t('2029-11-01T10:00:00Z') }); // before the window
    const board = await evaluateScope(w.env, { kind: 'project', id: PROJECT, name: 'Kestrel', founder_id: 100, company_id: 1 }, 30, NOW);
    assert.equal(board.days, 30);
    const ceo = board.roles.find((r) => r.role_key === 'ceo')!;
    assert.equal(ceo.decided, 8);
    assert.equal(ceo.rated, false, 'eight decisions: too few');
    assert.equal(ceo.note, 'Too few decisions to rate (8)');
    assert.deepEqual([ceo.acceptance, ceo.edit, ceo.discard], [null, null, null]);
    assert.equal(ceo.median_decision_h, 7, 'hours 1,2,3,4,10,10,20,20: the median is (4 + 10) / 2');
    assert.deepEqual([ceo.open_past_3d, ceo.expired], [1, 1]);
    assert.deepEqual(ceo.refused, [{ reason: 'daily_limit', n: 2 }, { reason: 'decision_expired', n: 1 }]);
    assert.deepEqual(ceo.cost_per_accepted, { available: true, value_microusd: 100 }, '600 spent in the window over six kept proposals');
    assert.deepEqual(board.roles.map((r) => r.role_key), ['ceo', 'cto'], 'an active role with nothing yet still has its row');
    const cto = board.roles.find((r) => r.role_key === 'cto')!;
    assert.deepEqual([cto.decided, cto.note, cto.cost_per_accepted], [0, 'Too few decisions to rate (0)', { available: false }]);
    // Ten decisions are enough: the rates appear.
    proposal(w, AGENT, 'accepted', '2030-03-16T09:00:00Z', 1);
    proposal(w, AGENT, 'edited', '2030-03-16T10:00:00Z', 1);
    const rated = (await evaluateScope(w.env, { kind: 'project', id: PROJECT, name: 'Kestrel', founder_id: 100, company_id: 1 }, 30, NOW)).roles.find((r) => r.role_key === 'ceo')!;
    assert.deepEqual([rated.decided, rated.rated, rated.note, rated.acceptance, rated.edit, rated.discard], [10, true, null, 0.8, 0.3, 0.2]);
  } finally { w.close(); }
});

test('the board, rule: acceptance is (accepted + edited) / decided; an unrecorded charge makes cost per accepted unknown', () => {
  const p = [
    ...Array(6).fill({ status: 'accepted' }), ...Array(3).fill({ status: 'edited' }), ...Array(3).fill({ status: 'discarded' }),
  ].map((x) => ({ ...x, created_at: '2030-03-01 09:00:00', decided_at: '2030-03-01 10:00:00' }));
  const r = rateRole('ceo', p, [{ status: 'done', refusal: null, usage_log_id: 1, log_id: 1, charged: null }], NOW);
  assert.deepEqual([r.acceptance, r.edit, r.discard], [0.75, 0.25, 0.25]);
  assert.deepEqual(r.cost_per_accepted, { available: false });
});

// ── Alerts ───────────────────────────────────────────────────────────────────

test('alerts: cap 80% and 100%, a blocked task, a waiting approval, DLQ arrivals and the gateway at 70%, each once per window', async () => {
  // Mutation checked: no window key on the cap alert (always tell) → the second sweep tells cap_80 again;
  // a key without the month → April stays quiet.
  const w = world();
  try {
    w.agent(AGENT); // cap 5,000,000 µ$
    w.agent(51, 'cto');
    usage(w, AGENT, 4_100_000, t('2030-03-05T10:00:00Z'));
    usage(w, 51, 1_000, t('2030-03-05T10:00:00Z'));
    w.task(200, AGENT, { status: 'blocked' });
    w.db.prepare("UPDATE scope_tasks SET blocked_reason = 'needs_person', attempts = 3 WHERE id = 200").run();
    w.task(201, AGENT, { status: 'blocked' });
    w.db.prepare("UPDATE scope_tasks SET blocked_reason = 'decision_expired', attempts = 1 WHERE id = 201").run();
    proposal(w, AGENT, 'proposed', '2030-03-15T09:00:00Z', null);
    proposal(w, AGENT, 'proposed', '2030-03-19T09:00:00Z', null);
    w.db.prepare("INSERT INTO cf_dlq_mirror (message_id, job_type, payload, attempts) VALUES ('m1', 'agent_run', '{}', 3), ('m2', 'other', '{}', 3)").run();
    w.env.AGENT_GATEWAY_MONTHLY_LIMIT_MICROUSD = '5000000';
    const told: string[] = [];
    const deps = {
      tellTeam: async (_e: any, a: any, n: any) => { told.push(`${n.type}:${a.id}`); },
      tellHq: async (_e: any, n: any) => { told.push(n.type); return 1; },
    };
    const first = await sweepAgentAlerts(w.env, NOW, deps);
    assert.deepEqual(first, { cap_80: 1, cap_100: 0, blocked: 1, waiting: 1, dlq: 1, gateway: 1 });
    assert.deepEqual(told.sort(), ['agent_approval_waiting:50', 'agent_cap_near:50', 'agent_task_blocked:50', 'agents_dlq', 'agents_gateway_near'].sort());
    told.length = 0;
    assert.deepEqual(await sweepAgentAlerts(w.env, NOW, deps), { cap_80: 0, cap_100: 0, blocked: 0, waiting: 0, dlq: 0, gateway: 0 }, 'nothing twice in its window');
    assert.deepEqual(told, []);
    // Crossing 100% tells once; a new DLQ row tells again.
    usage(w, AGENT, 1_000_000, t('2030-03-06T10:00:00Z'));
    w.db.prepare("INSERT INTO cf_dlq_mirror (message_id, job_type, payload, attempts) VALUES ('m3', 'agent_run', '{}', 3)").run();
    assert.deepEqual(await sweepAgentAlerts(w.env, NOW, deps), { cap_80: 0, cap_100: 1, blocked: 0, waiting: 0, dlq: 1, gateway: 0 });
    assert.deepEqual(await sweepAgentAlerts(w.env, NOW, deps), { cap_80: 0, cap_100: 0, blocked: 0, waiting: 0, dlq: 0, gateway: 0 });
    // A new month is a new window.
    usage(w, AGENT, 4_500_000, t('2030-04-02T10:00:00Z'));
    const april = await sweepAgentAlerts(w.env, new Date('2030-04-03T12:00:00Z'), deps);
    assert.deepEqual([april.cap_80, april.cap_100], [1, 0]);
    // An unrecorded charge is not a spend past 80%.
    usage(w, 51, null, t('2030-04-02T11:00:00Z'));
    usage(w, 51, 9_000_000, t('2030-04-02T12:00:00Z'));
    assert.equal((await sweepAgentAlerts(w.env, new Date('2030-04-03T12:00:00Z'), deps)).cap_100, 0);
  } finally { w.close(); }
});

test('firstInWindow: the first call in a window is true, the rest false; a KV that cannot be read still alerts', async () => {
  const w = world();
  try {
    assert.equal(await firstInWindow(w.env, 'agents:alert:x', 60), true);
    assert.equal(await firstInWindow(w.env, 'agents:alert:x', 60), false);
    const broken = { RATE_LIMITS: { async get() { throw new Error('kv'); }, async put() { throw new Error('kv'); } } };
    assert.equal(await firstInWindow(broken as any, 'agents:alert:x', 60), true);
  } finally { w.close(); }
});

// ── The halt and the rebuild ────────────────────────────────────────────────

function app(w: World) {
  __setEngineRouteDeps({ runtime: async () => w.runtime });
  __setAdminAgentsDeps({ runtime: async () => w.runtime, now: () => NOW });
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', engineRoutes);
  a.route('/api/admin/agents', adminAgents);
  return a;
}
async function routeCall(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app(w).request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env);
  return { status: r.status, body: await r.json() as any };
}

test('the halt: platform admins only; setting it stops the next step of a run; clearing it lets runs go; HQ hears each change', async () => {
  // Mutation checked: requireAuth in place of requireAdmin → the sponsor's POST halts (200).
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    assert.equal((await routeCall(w, SPONSOR, 'POST', '/api/admin/agents/halt', { halted: true, reason: 'drill' })).status, 403, 'a founder cannot halt');
    assert.equal((await routeCall(w, SPONSOR, 'GET', '/api/admin/agents/halt')).status, 403);
    assert.deepEqual((await routeCall(w, ADMIN, 'GET', '/api/admin/agents/halt')).body, { halted: false, reason: null, by: null, at: null });
    assert.equal((await routeCall(w, ADMIN, 'POST', '/api/admin/agents/halt', { halted: 'yes' })).body.error, 'invalid_halt');
    assert.equal((await routeCall(w, ADMIN, 'POST', '/api/admin/agents/halt', { halted: true, reason: 'x'.repeat(65) })).body.error, 'invalid_halt');
    const a = await admitted(w);
    const set = await routeCall(w, ADMIN, 'POST', '/api/admin/agents/halt', { halted: true, reason: 'incident drill' });
    assert.deepEqual(set.body, { halted: true, reason: 'incident drill', by: { uid: 'u-admin', name: 'Ada Admin' }, at: NOW.toISOString() });
    assert.equal(JSON.stringify(set.body).includes('@'), false, 'no email');
    const step = await load(loopDeps(w, fakeAgentRun(w).fn), a);
    assert.equal(step.go, false);
    assert.equal((w.db.prepare('SELECT status, refusal FROM agent_task_runs WHERE uid = ?').get(a) as any).refusal, 'halted', 'the next step ended the run');
    const inbox = () => (w.db.prepare("SELECT type FROM notifications_inbox WHERE user_id = ? ORDER BY id").all(ADMIN) as any[]).map((r) => r.type);
    assert.deepEqual(inbox(), ['agents_halt_set']);
    await routeCall(w, ADMIN, 'POST', '/api/admin/agents/halt', { halted: true, reason: 'still' });
    assert.deepEqual(inbox(), ['agents_halt_set'], 'no change, no second notice');
    const cleared = await routeCall(w, ADMIN, 'POST', '/api/admin/agents/halt', { halted: false });
    assert.deepEqual(cleared.body, { halted: false, reason: null, by: null, at: null });
    assert.deepEqual(inbox(), ['agents_halt_set', 'agents_halt_cleared']);
    // The runtime's own plain-text halt reads as a reason with no author.
    await w.kv.put('agents:halt', 'gateway');
    assert.deepEqual((await routeCall(w, ADMIN, 'GET', '/api/admin/agents/halt')).body, { halted: true, reason: 'gateway', by: null, at: null });
  } finally { w.close(); }
});

async function admitted(w: World): Promise<string> {
  const r = await w.runtime.admit({ kind: 'project', id: PROJECT }, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
  assert.ok(r.ok);
  return r.run.uid;
}

test('the rebuild: platform admins only; a scope that does not exist is 404; it answers the duty timers it now holds', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    w.db.prepare(`INSERT INTO agent_duties (id, uid, agent_id, template_key, title, cadence, hour_utc, next_due_at)
      VALUES (7, 'd7', ?, 'ceo.weekly_plan', 'Weekly plan', 'daily', 9, '2030-03-21 09:00:00')`).run(AGENT);
    assert.equal((await routeCall(w, SPONSOR, 'POST', `/api/admin/agents/rebuild/project:${PROJECT}`)).status, 403);
    assert.equal((await routeCall(w, ADMIN, 'POST', '/api/admin/agents/rebuild/project:999')).status, 404);
    assert.equal((await routeCall(w, ADMIN, 'POST', '/api/admin/agents/rebuild/nonsense')).status, 404);
    const r = await routeCall(w, ADMIN, 'POST', `/api/admin/agents/rebuild/project:${PROJECT}`);
    assert.deepEqual([r.status, r.body.ok, r.body.schedules, r.body.status.scope], [200, true, 1, `project:${PROJECT}`]);
  } finally { w.close(); }
});

test('the evaluation route: a member reads it; a stranger cannot; days must be 30 or 90', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    const ok = await routeCall(w, SPONSOR, 'GET', `/api/teams/project/${PROJECT}/evaluation?days=90`);
    assert.deepEqual([ok.status, ok.body.days, ok.body.roles.map((r: any) => r.role_key)], [200, 90, ['ceo']]);
    assert.equal((await routeCall(w, SPONSOR, 'GET', `/api/teams/project/${PROJECT}/evaluation`)).body.days, 30);
    assert.equal((await routeCall(w, SPONSOR, 'GET', `/api/teams/project/${PROJECT}/evaluation?days=7`)).body.error, 'invalid_days');
    assert.equal((await routeCall(w, STRANGER, 'GET', `/api/teams/project/${PROJECT}/evaluation`)).status, 403);
  } finally { w.close(); }
});
