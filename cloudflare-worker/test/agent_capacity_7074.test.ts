/**
 * D7074 (#7074, part of #7072) — agent capacity from the task list and the
 * budget: sub-agent lanes and elastic scopes, under HQ's ceilings.
 *
 * The real admission (`admitInScope` through the scope object), the real task
 * loop, sweep and routes, over the migrated schema. Only the model is a fake.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_capacity_7074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { grantWriteBar } from './_write_bar_session.mjs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import {
  ADMIN, AGENT, MEMBER, MODULE, OPTION, PROJECT, SPONSOR, fakeAgentRun, harness, hex, loopDeps, world, type World,
} from './_agent_engine_fixture.ts';
import {
  DEFAULT_CAPACITY, NO_CEILINGS, backlogLimit, capacityCeilings, capacityOf, dailyLimit, freeLane, laneBudget, laneLimit, lanesOffered, needsCeilings,
  parallelLimit,
} from '../src/agents/capacity.ts';
import { putScopeSettings, scopeSettings } from '../src/agents/engine.ts';
import { load, runTaskLoop } from '../src/agents/loop.ts';
import { sweepAgents } from '../src/agents/sweep.ts';
import engineRoutes, { __setEngineRouteDeps, capacityWrite } from '../src/routes/agent_engine.ts';
import policyRoutes from '../src/routes/admin_ai_agents_policy.ts';
import { capacityCeilingsOf } from '../src/services/agents/aiPolicy.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const admit = (w: World, agentId: number, taskId: number, by: number | null = SPONSOR) => w.runtime.admit(P, { agentId, taskId, by, source: 'person' });
const code = async (p: Promise<any>) => { const r = await p; return r.ok ? 'ok' : r.code; };
const runs = (w: World, agentId = AGENT) => w.db.prepare('SELECT task_id, lane, status FROM agent_task_runs WHERE agent_id = ? ORDER BY id').all(agentId) as any[];
const agentRow = (w: World, id: number) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(id) as any;

/** HQ's ceilings and the per-run ceiling, on the one policy row. */
function hq(w: World, o: { elastic?: number | null; lanes?: number | null; perRun?: number | null }) {
  w.db.prepare(`INSERT INTO ai_agent_policy (id, elastic_runs_ceiling, lanes_ceiling, per_run_ceiling_microusd) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET elastic_runs_ceiling = excluded.elastic_runs_ceiling, lanes_ceiling = excluded.lanes_ceiling,
      per_run_ceiling_microusd = excluded.per_run_ceiling_microusd`).run(o.elastic ?? null, o.lanes ?? null, o.perRun ?? null);
}
const charge = (w: World, agentId: number, micro: number | null) => w.db.prepare(
  "INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, agent_id) VALUES (?, 'rail_numbers', ?, ?, ?)",
).run(SPONSOR, MODEL, micro, agentId);
const cap = (w: World, agentId: number, micro: number) => w.db.prepare('UPDATE team_agents SET monthly_cap_microusd = ? WHERE id = ?').run(micro, agentId);
/** Count the reads of HQ's ceilings: a scope on the defaults must make none. */
function ceilingReads(w: World) {
  const prepare = w.env.DB.prepare.bind(w.env.DB);
  const seen = { n: 0 };
  w.env.DB.prepare = (q: string) => { if (/elastic_runs_ceiling/.test(q)) seen.n += 1; return prepare(q); };
  return seen;
}

// ── The rules, pure ─────────────────────────────────────────────────────────

test('capacity reads a settings row with defaults for anything missing or out of range', () => {
  assert.deepEqual(capacityOf(null), DEFAULT_CAPACITY);
  assert.deepEqual(capacityOf({ engine_paused: 0, max_parallel_runs: 4 }), { ...DEFAULT_CAPACITY, max_parallel_runs: 4 }, 'a row from before the migration');
  assert.deepEqual(capacityOf({ capacity_mode: 'elastic', max_parallel_runs: 3, elastic_max_runs: 40, lanes_per_agent: 4, review_backlog_max: 12, daily_runs_per_agent: 60 }),
    { capacity_mode: 'elastic', max_parallel_runs: 3, elastic_max_runs: 40, lanes_per_agent: 4, review_backlog_max: 12, daily_runs_per_agent: 60 });
  assert.deepEqual(capacityOf({ capacity_mode: 'unbounded', max_parallel_runs: 99, elastic_max_runs: 0, lanes_per_agent: -1, review_backlog_max: 1.5, daily_runs_per_agent: 'x' }), DEFAULT_CAPACITY);
});

test('the limits in force: fixed unless HQ offers elastic, one lane unless HQ offers sub-agents with a per-run ceiling', () => {
  // Mutations checked: `parallelLimit` ignoring a null ceiling → the withdrawn case reads 40; `lanesOffered` without the per-run
  // ceiling → lanes are offered with no bound on one run's cost; Math.min turned Math.max → a team reaches above HQ's ceiling.
  const fixed = { ...DEFAULT_CAPACITY, max_parallel_runs: 3 };
  const elastic = { ...DEFAULT_CAPACITY, capacity_mode: 'elastic' as const, elastic_max_runs: 40, lanes_per_agent: 6 };
  assert.equal(parallelLimit(fixed, { elastic_runs: 100, lanes: 8, per_run_microusd: 1 }), 3, 'fixed ignores the elastic ceiling');
  assert.equal(parallelLimit(elastic, NO_CEILINGS), 2, 'elastic that HQ does not offer is the fixed number');
  assert.equal(parallelLimit(elastic, { ...NO_CEILINGS, elastic_runs: 100 }), 40);
  assert.equal(parallelLimit(elastic, { ...NO_CEILINGS, elastic_runs: 25 }), 25, 'never above HQ');
  assert.equal(parallelLimit({ ...elastic, elastic_max_runs: null }, { ...NO_CEILINGS, elastic_runs: 25 }), 25, 'unset takes HQ\'s ceiling');
  assert.equal(laneLimit(elastic, NO_CEILINGS), 1);
  assert.equal(laneLimit(elastic, { ...NO_CEILINGS, lanes: 8 }), 1, 'no per-run ceiling: no sub-agents');
  assert.equal(laneLimit(elastic, { elastic_runs: null, lanes: 8, per_run_microusd: 500_000 }), 6);
  assert.equal(laneLimit(elastic, { elastic_runs: null, lanes: 4, per_run_microusd: 500_000 }), 4, 'never above HQ');
  assert.equal(lanesOffered({ elastic_runs: 9, lanes: null, per_run_microusd: 1 }), false);
  assert.deepEqual([backlogLimit(DEFAULT_CAPACITY), dailyLimit(DEFAULT_CAPACITY)], [5, 20], 'the constants, unset');
  assert.deepEqual([backlogLimit({ ...fixed, review_backlog_max: 30 }), dailyLimit({ ...fixed, daily_runs_per_agent: 200 })], [30, 200]);
  assert.deepEqual([needsCeilings(DEFAULT_CAPACITY), needsCeilings(fixed), needsCeilings(elastic), needsCeilings({ ...fixed, lanes_per_agent: 2 })], [false, false, true, true]);
});

test('a free lane is the lowest not held; a sub-agent fits only when the cap covers it beside the live runs', () => {
  // Mutations checked: `live * per_run` dropped → the third lane is let in on a cap two runs already cover;
  // `>=` turned `>` → the exact fit is refused; an unreadable spend read as 0 → it is let in.
  assert.equal(freeLane([], 1), 0);
  assert.equal(freeLane([0], 1), null);
  assert.equal(freeLane([0, 2], 3), 1);
  assert.equal(freeLane([0, 1, 2], 3), null);
  assert.equal(freeLane([1], 3), 0, 'lane 0 comes back first');
  const spent = (v: number) => ({ available: true as const, value_microusd: v });
  const fit = (o: Partial<Parameters<typeof laneBudget>[0]>) => laneBudget({ cap_microusd: 1_000_000, spent: spent(0), live: 1, per_run_microusd: 400_000, ...o });
  assert.deepEqual(fit({}), { ok: true, headroom_microusd: 600_000 });
  assert.deepEqual(fit({ live: 2 }), { ok: false, reason: 'cap' }, '1.0 − 0.8 leaves 0.2, under one run');
  assert.deepEqual(fit({ spent: spent(200_000) }), { ok: true, headroom_microusd: 400_000 }, 'an exact fit is let in');
  assert.deepEqual(fit({ spent: spent(200_001) }), { ok: false, reason: 'cap' });
  assert.deepEqual(fit({ spent: { available: false } }), { ok: false, reason: 'spend_unreadable' });
  assert.deepEqual(fit({ per_run_microusd: null }), { ok: false, reason: 'no_ceiling' });
});

// ── The schema ──────────────────────────────────────────────────────────────

test('the live index is per agent and lane: two lanes may be live, one lane twice may not; the CHECKs hold', () => {
  // Mutation checked: the index left on (agent_id) alone → the second lane's insert is refused UNIQUE.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT); w.task(201, AGENT); w.task(202, AGENT);
    const ins = (uid: string, task: number, lane: number, status = 'running') =>
      w.db.prepare('INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, lane) VALUES (?, ?, ?, 1, ?, ?)').run(uid, AGENT, task, status, lane);
    ins('lane-zero-0001', 200, 0); ins('lane-one-00001', 201, 1);
    assert.throws(() => ins('lane-one-again', 202, 1), /UNIQUE/);
    ins('lane-one-done1', 202, 1, 'done'); // an ended run holds no lane
    assert.throws(() => w.db.exec("UPDATE agent_task_runs SET lane = 50 WHERE uid = 'lane-one-done1'"), /CHECK/);
    assert.throws(() => w.db.exec("UPDATE agent_task_runs SET lane = -1 WHERE uid = 'lane-one-done1'"), /CHECK/);
    w.db.exec(`INSERT INTO agent_scope_settings (scope_kind, project_id) VALUES ('project', ${PROJECT})`);
    const row = w.db.prepare('SELECT capacity_mode, elastic_max_runs, lanes_per_agent, review_backlog_max, daily_runs_per_agent FROM agent_scope_settings').get() as any;
    assert.deepEqual({ ...row }, { capacity_mode: 'fixed', elastic_max_runs: null, lanes_per_agent: 1, review_backlog_max: null, daily_runs_per_agent: null });
    for (const bad of ["capacity_mode = 'unbounded'", 'elastic_max_runs = 501', 'lanes_per_agent = 51', 'lanes_per_agent = 0', 'review_backlog_max = 201', 'daily_runs_per_agent = 1001']) {
      assert.throws(() => w.db.exec(`UPDATE agent_scope_settings SET ${bad}`), /CHECK/, bad);
    }
    assert.throws(() => w.db.exec('INSERT INTO ai_agent_policy (id, elastic_runs_ceiling) VALUES (1, 501)'), /CHECK/);
    assert.throws(() => w.db.exec('INSERT INTO ai_agent_policy (id, lanes_ceiling) VALUES (1, 51)'), /CHECK/);
  } finally { w.close(); }
});

// ── Admission ───────────────────────────────────────────────────────────────

test('on the defaults nothing changed, and admission never reads HQ\'s ceilings', async () => {
  const w = world();
  try {
    for (const [agent, role] of [[AGENT, 'ceo'], [501, 'cfo'], [502, 'cmo']] as const) w.agent(agent, role);
    w.task(200, AGENT); w.task(201, AGENT); w.task(210, 501); w.task(220, 502);
    const seen = ceilingReads(w);
    assert.equal(await code(admit(w, AGENT, 200)), 'ok');
    assert.equal(await code(admit(w, AGENT, 201)), 'agent_busy');
    assert.equal(await code(admit(w, 501, 210)), 'ok');
    const third = await admit(w, 502, 220);
    assert.deepEqual(!third.ok && [third.code, third.message], ['scope_busy', 'This team runs at most 2 agents at once. Try again when one finishes.']);
    assert.equal(seen.n, 0, 'a scope on the defaults reads no ceiling');
    assert.deepEqual(runs(w).map((r) => r.lane), [0]);
  } finally { w.close(); }
});

test('sub-agents: one agent holds a run per lane, lowest free lane first, and is busy when all are taken', async () => {
  // Mutations checked: `held.length >= lanes` turned `>` → a fourth run is admitted on three lanes;
  // the lane never written on the insert → the second run collides on lane 0 and reads agent_busy.
  const w = world();
  try {
    w.agent(AGENT); for (const t of [200, 201, 202, 203]) w.task(t, AGENT);
    hq(w, { elastic: 20, lanes: 3, perRun: 500_000 });
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic', lanes_per_agent: 3 }, SPONSOR);
    assert.deepEqual([await code(admit(w, AGENT, 200)), await code(admit(w, AGENT, 201)), await code(admit(w, AGENT, 202))], ['ok', 'ok', 'ok']);
    assert.deepEqual(runs(w).map((r) => [r.task_id, r.lane]), [[200, 0], [201, 1], [202, 2]]);
    const fourth = await admit(w, AGENT, 203);
    assert.deepEqual(!fourth.ok && [fourth.status, fourth.code, fourth.message], [409, 'agent_busy', 'This agent and its 2 sub-agents are all working. Try again when one finishes.']);
    // A run that reaches a decision no longer holds its lane: the next run takes that lane.
    w.db.prepare("UPDATE agent_task_runs SET status = 'waiting_decision' WHERE task_id = 201").run();
    assert.equal(await code(admit(w, AGENT, 203)), 'ok');
    assert.deepEqual(runs(w).filter((r) => r.status === 'admitted').map((r) => [r.task_id, r.lane]), [[200, 0], [202, 2], [203, 1]]);
    // The same task is never two runs: it left `open` when it was admitted.
    assert.equal(await code(admit(w, AGENT, 200)), 'not_ready');
  } finally { w.close(); }
});

test('a sub-agent shares its agent\'s cap: it starts only while the cap covers it beside the live runs and the month\'s spend', async () => {
  // Mutations checked: the budget check removed → the third lane starts on a cap that two live runs already use up;
  // `held.length` (the live runs) not passed → the same; the check applied to lane 0 → a lone run needs a per-run ceiling.
  const w = world();
  try {
    w.agent(AGENT); for (const t of [200, 201, 202]) w.task(t, AGENT);
    hq(w, { elastic: 20, lanes: 5, perRun: 400_000 });
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic', lanes_per_agent: 5 }, SPONSOR);
    cap(w, AGENT, 1_000_000);
    assert.equal(await code(admit(w, AGENT, 200)), 'ok', 'the agent itself is not gated by this check: agentRun holds its own cap');
    assert.equal(await code(admit(w, AGENT, 201)), 'ok', '1.0 − 0.4 live leaves 0.6: one more run fits');
    const third = await admit(w, AGENT, 202);
    assert.deepEqual(!third.ok && [third.status, third.code], [409, 'lane_budget'], '1.0 − 0.8 live leaves 0.2: it does not');
    assert.equal(agentRow(w, AGENT).status, 'active', 'a refused lane pauses nothing');
    // Raise the cap: it fits. Then spend eats the headroom for a fourth.
    cap(w, AGENT, 1_200_000);
    assert.equal(await code(admit(w, AGENT, 202)), 'ok');
    assert.deepEqual(runs(w).map((r) => r.lane), [0, 1, 2]);
  } finally { w.close(); }

  const spend = world();
  try {
    spend.agent(AGENT); spend.task(200, AGENT); spend.task(201, AGENT);
    hq(spend, { lanes: 5, perRun: 400_000 });
    await putScopeSettings(spend.env, P, { max_parallel_runs: 5, lanes_per_agent: 5 }, SPONSOR);
    cap(spend, AGENT, 1_000_000);
    charge(spend, AGENT, 300_000);
    assert.equal(await code(admit(spend, AGENT, 200)), 'ok');
    assert.equal(await code(admit(spend, AGENT, 201)), 'lane_budget', '1.0 − 0.3 spent − 0.4 live leaves 0.3');
    // A charge that is not recorded makes the month unknown, which covers nothing.
    spend.db.prepare('UPDATE ai_usage_logs SET charged_microusd = 0 WHERE agent_id = ?').run(AGENT);
    charge(spend, AGENT, null);
    assert.equal(await code(admit(spend, AGENT, 201)), 'lane_budget');
    spend.db.prepare('DELETE FROM ai_usage_logs WHERE charged_microusd IS NULL').run();
    assert.equal(await code(admit(spend, AGENT, 201)), 'ok');
  } finally { spend.close(); }

  // The agent's own run is admitted as it always was, even on a cap under one per-run ceiling: only a sub-agent is checked here.
  const small = world();
  try {
    small.agent(AGENT); small.task(200, AGENT); small.task(201, AGENT);
    hq(small, { lanes: 5, perRun: 400_000 });
    await putScopeSettings(small.env, P, { max_parallel_runs: 5, lanes_per_agent: 5 }, SPONSOR);
    cap(small, AGENT, 300_000);
    assert.equal(await code(admit(small, AGENT, 200)), 'ok');
    assert.equal(await code(admit(small, AGENT, 201)), 'lane_budget');
  } finally { small.close(); }
});

test('what HQ does not offer is not in force, whatever the team\'s row says; withdrawing a ceiling takes effect at the next admission', async () => {
  const w = world();
  try {
    for (const [agent, role] of [[AGENT, 'ceo'], [501, 'cfo'], [502, 'cmo']] as const) w.agent(agent, role);
    w.task(200, AGENT); w.task(201, AGENT); w.task(210, 501); w.task(220, 502);
    // The row is written directly: the route would refuse it while nothing is offered.
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic', elastic_max_runs: 40, lanes_per_agent: 4 }, SPONSOR);
    assert.equal(await code(admit(w, AGENT, 200)), 'ok');
    assert.equal(await code(admit(w, AGENT, 201)), 'agent_busy', 'no lanes ceiling: one lane');
    assert.equal(await code(admit(w, 501, 210)), 'ok');
    assert.equal(await code(admit(w, 502, 220)), 'scope_busy', 'no elastic ceiling: the fixed 2');
    // A lanes ceiling without a per-run ceiling offers no sub-agents.
    hq(w, { lanes: 4 });
    assert.equal(await code(admit(w, AGENT, 201)), 'agent_busy');
    // Offered: the third agent and a sub-agent start. Withdrawn again: the next admission is back on the fixed rule.
    hq(w, { elastic: 40, lanes: 4, perRun: 100_000 });
    assert.equal(await code(admit(w, 502, 220)), 'ok');
    assert.equal(await code(admit(w, AGENT, 201)), 'ok');
    hq(w, {});
    w.task(202, AGENT);
    assert.equal(await code(admit(w, AGENT, 202)), 'agent_busy');
  } finally { w.close(); }
});

test('an elastic team runs as many agents at once as its limit allows, past the fixed five, and never past HQ\'s ceiling', async () => {
  // Mutation checked: `parallel` left as settings.max_parallel_runs → the third agent is refused scope_busy at 2.
  const w = world();
  try {
    const agents = [600, 601, 602, 603, 604, 605, 606, 607];
    agents.forEach((a, i) => { w.agent(a, `role-${i}`); w.task(a + 1000, a); });
    hq(w, { elastic: 7 });
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic' }, SPONSOR);
    const out = [];
    for (const a of agents) out.push(await code(admit(w, a, a + 1000)));
    assert.deepEqual(out, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'scope_busy'], 'seven at once under a ceiling of 7');
    const eighth = await admit(w, 607, 1607);
    assert.equal(!eighth.ok && eighth.message, 'This team runs at most 7 agents at once. Try again when one finishes.');
    // The team's own number, under the ceiling.
    await putScopeSettings(w.env, P, { elastic_max_runs: 3 }, SPONSOR);
    w.db.prepare("UPDATE agent_task_runs SET status = 'done' WHERE agent_id IN (600, 601, 602, 603, 604)").run();
    assert.equal(await code(admit(w, 607, 1607)), 'ok', 'two live, a limit of 3');
    w.task(1700, 600);
    assert.equal(await code(admit(w, 600, 1700)), 'scope_busy');
  } finally { w.close(); }
});

test('the review backlog stop is the team\'s setting: five by default, more when a manager raises it', async () => {
  // Mutation checked: `backlog` left as OPEN_PROPOSALS_MAX → the raised team is still refused at five.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    for (let i = 0; i < 5; i += 1) {
      w.task(300 + i, AGENT, { status: 'waiting_decision', board: 'in_review' });
      w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES (?, ?, ?, 1, 'waiting_decision')").run(`waiting-run-${i}`, AGENT, 300 + i);
    }
    const full = await admit(w, AGENT, 200);
    assert.deepEqual(!full.ok && [full.code, full.message], ['queue_full', '5 proposals are waiting for a decision. Decide one first.']);
    await putScopeSettings(w.env, P, { review_backlog_max: 6 }, SPONSOR);
    assert.equal(await code(admit(w, AGENT, 200)), 'ok');
    w.db.prepare("UPDATE agent_task_runs SET status = 'waiting_decision' WHERE task_id = 200").run();
    w.task(201, AGENT);
    const again = await admit(w, AGENT, 201);
    assert.deepEqual(!again.ok && [again.code, again.message], ['queue_full', '6 proposals are waiting for a decision. Decide one first.']);
  } finally { w.close(); }
});

test('the daily runs per agent is the team\'s setting: the run past it is refused and the agent paused daily_limit', async () => {
  // Mutation checked: `dailyLimit(settings)` not passed to `dailyLimitReached` → the third run of a team that set 2 loads.
  const w = world();
  try {
    w.agent(AGENT); for (const t of [200, 201, 202]) w.task(t, AGENT);
    await putScopeSettings(w.env, P, { daily_runs_per_agent: 2 }, SPONSOR);
    const d = loopDeps(w, fakeAgentRun(w).fn);
    for (const t of [200, 201]) {
      const a = await admit(w, AGENT, t);
      assert.ok(a.ok);
      assert.equal((await load(d, a.run.uid)).go, true);
      w.db.prepare("UPDATE agent_task_runs SET status = 'done' WHERE uid = ?").run(a.run.uid);
    }
    const third = await admit(w, AGENT, 202);
    assert.ok(third.ok);
    assert.deepEqual(await load(d, third.run.uid), { go: false, status: 'refused', refusal: 'daily_limit' });
    assert.deepEqual([agentRow(w, AGENT).status, agentRow(w, AGENT).paused_reason], ['paused', 'daily_limit']);
  } finally { w.close(); }
});

// ── Capacity follows the task list ──────────────────────────────────────────

async function runToProposal(w: World, taskId: number) {
  const a = await admit(w, AGENT, taskId);
  assert.ok(a.ok, JSON.stringify(a));
  const h = harness();
  h.opts.decision = { status: 'accepted' };
  const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, fakeAgentRun(w).fn));
  return { uid: a.run.uid, out };
}

test('with self-start and sub-agents, a finished run is followed by one ready task per free lane', async () => {
  // Mutations checked: `ready.slice(0, lanes)` left at one task → one run follows instead of three;
  // the loop not stopping at the first refusal → it keeps asking after agent_busy.
  const w = world({ autonomy: 'self_start' });
  try {
    w.agent(AGENT); for (const t of [200, 201, 202, 203, 204]) w.task(t, AGENT);
    hq(w, { elastic: 20, lanes: 3, perRun: 100_000 });
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic', lanes_per_agent: 3, review_backlog_max: 50 }, SPONSOR);
    const { out } = await runToProposal(w, 200);
    assert.deepEqual(out, { go: true, decision: 'accepted' });
    const live = runs(w).filter((r) => r.status === 'admitted');
    assert.deepEqual(live.map((r) => [r.task_id, r.lane]), [[201, 0], [202, 1], [203, 2]], 'three lanes, three tasks, in priority order');
    assert.equal((w.db.prepare("SELECT status FROM scope_tasks WHERE id = 204").get() as any).status, 'open', 'the fifth waits for a lane');
  } finally { w.close(); }
});

test('on the defaults a finished run is followed by one task, and a proposal by none, as before', async () => {
  const w = world({ autonomy: 'self_start' });
  try {
    w.agent(AGENT); for (const t of [200, 201, 202]) w.task(t, AGENT);
    const seen = ceilingReads(w);
    const a = await admit(w, AGENT, 200);
    assert.ok(a.ok);
    const h = harness();
    h.opts.decision = 'timeout'; // the run stops at its proposal
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, fakeAgentRun(w).fn));
    assert.deepEqual(runs(w).map((r) => [r.task_id, r.status]), [[200, 'waiting_decision']], 'a proposal alone starts nothing on the defaults');
    assert.equal(seen.n, 0);
  } finally { w.close(); }
  const after = world({ autonomy: 'self_start' });
  try {
    after.agent(AGENT); for (const t of [200, 201, 202]) after.task(t, AGENT);
    await runToProposal(after, 200);
    assert.deepEqual(runs(after).filter((r) => r.status === 'admitted').map((r) => r.task_id), [201], 'one lane: one task follows');
  } finally { after.close(); }
});

test('where capacity follows the task list, a proposal frees its lane at once: the next ready task starts without waiting for a decision', async () => {
  // Mutation checked: the refill at `propose` removed → nothing follows until a person decides or the sweep runs.
  const w = world({ autonomy: 'self_start' });
  try {
    w.agent(AGENT); for (const t of [200, 201, 202]) w.task(t, AGENT);
    hq(w, { elastic: 20, lanes: 2, perRun: 100_000 });
    await putScopeSettings(w.env, P, { capacity_mode: 'elastic', lanes_per_agent: 2, review_backlog_max: 50 }, SPONSOR);
    const a = await admit(w, AGENT, 200);
    assert.ok(a.ok);
    const h = harness();
    h.opts.decision = 'timeout';
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, fakeAgentRun(w).fn));
    assert.deepEqual(runs(w).map((r) => [r.task_id, r.status, r.lane]), [[200, 'waiting_decision', 0], [201, 'admitted', 0], [202, 'admitted', 1]]);
  } finally { w.close(); }
});

test('the sweep offers an agent one ready task per free lane; with one lane, one task and only when nothing is live', async () => {
  // Mutations checked: `task_rank <= lanes - live` turned `task_rank = 1` → two lanes get one task;
  // `a.live < a.lanes` turned `a.live = 0` → an agent with a run live and a lane free is never offered its next task.
  const now = new Date('2026-11-17T09:01:00.000Z');
  const lanes = world({ autonomy: 'self_start' });
  try {
    lanes.agent(AGENT); for (const t of [200, 201, 202]) lanes.task(t, AGENT);
    hq(lanes, { elastic: 20, lanes: 2, perRun: 100_000 });
    await putScopeSettings(lanes.env, P, { capacity_mode: 'elastic', lanes_per_agent: 2 }, SPONSOR);
    const out = await sweepAgents(lanes.env, now, { runtime: async () => lanes.runtime });
    assert.equal(out.admitted, 2);
    assert.deepEqual(runs(lanes).map((r) => [r.task_id, r.lane]), [[200, 0], [201, 1]]);
    // One run ends: the next sweep fills the free lane with the next task, beside the run still live.
    lanes.db.prepare("UPDATE agent_task_runs SET status = 'done' WHERE task_id = 200").run();
    lanes.db.prepare("UPDATE scope_tasks SET status = 'done', board_column = 'done' WHERE id = 200").run();
    assert.equal((await sweepAgents(lanes.env, now, { runtime: async () => lanes.runtime })).admitted, 1);
    assert.deepEqual(runs(lanes).filter((r) => r.status === 'admitted').map((r) => [r.task_id, r.lane]), [[201, 1], [202, 0]]);
  } finally { lanes.close(); }
  const one = world({ autonomy: 'self_start' });
  try {
    one.agent(AGENT); for (const t of [200, 201, 202]) one.task(t, AGENT);
    // The team asked for two lanes, but HQ offers none: one lane.
    await putScopeSettings(one.env, P, { lanes_per_agent: 2 }, SPONSOR);
    assert.equal((await sweepAgents(one.env, now, { runtime: async () => one.runtime })).admitted, 1);
    assert.equal((await sweepAgents(one.env, now, { runtime: async () => one.runtime })).admitted, 0, 'a live run holds the only lane');
    assert.deepEqual(runs(one).map((r) => [r.task_id, r.lane]), [[200, 0]]);
  } finally { one.close(); }
});

// ── The routes ──────────────────────────────────────────────────────────────

function app(w: World) {
  __setEngineRouteDeps({ runtime: async () => w.runtime });
  w.db.exec(`INSERT OR IGNORE INTO super_admins (user_id) VALUES (${ADMIN})`);
  grantWriteBar(w.db, ADMIN);
  const a = new Hono<any>();
  a.onError((e: any, c) => c.json({ detail: e.message }, (AUTH_ERROR_STATUSES[e?.message] || 500) as any));
  a.route('/api/teams', engineRoutes).route('/api/admin/ai-agents/policy', policyRoutes);
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, ...(who === ADMIN ? { jti: `write-bar-${ADMIN}` } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app(w).request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null as any, text };
}
const ENGINE = `/api/teams/project/${PROJECT}/engine`;
const POLICY = '/api/admin/ai-agents/policy';

test('a team\'s capacity: refused while HQ offers none, saved under HQ\'s ceilings, and read back with what is in force', async () => {
  // Mutations checked: the `elastic_not_offered` refusal removed → a team sets elastic with no ceiling;
  // the ceiling compare removed → a team saves a number above HQ's.
  const w = world();
  try {
    w.agent(AGENT);
    const put = (body: unknown, who = SPONSOR) => call(w, who, 'PUT', ENGINE, body);
    const err = async (body: unknown) => { const r = await put(body); return [r.status, r.body.error]; };
    assert.deepEqual(await err({ capacity_mode: 'elastic' }), [403, 'elastic_not_offered']);
    assert.deepEqual(await err({ elastic_max_runs: 10 }), [403, 'elastic_not_offered']);
    assert.deepEqual(await err({ lanes_per_agent: 2 }), [403, 'lanes_not_offered']);
    assert.deepEqual(await err({ capacity_mode: 'unbounded' }), [400, 'invalid_engine']);
    assert.deepEqual(await err({ capacity: 'elastic' }), [400, 'invalid_engine'], 'an unknown key');
    // What needs no offer: the defaults, and the two limits that were constants.
    const plain = await put({ capacity_mode: 'fixed', lanes_per_agent: 1, elastic_max_runs: null, review_backlog_max: 12, daily_runs_per_agent: 40 });
    assert.equal(plain.status, 200, plain.text);
    assert.deepEqual(plain.body.capacity.in_force, { parallel_runs: 2, lanes_per_agent: 1, review_backlog: 12, daily_runs_per_agent: 40 });
    for (const bad of [{ review_backlog_max: 0 }, { review_backlog_max: 201 }, { daily_runs_per_agent: 1001 }, { daily_runs_per_agent: 1.5 }, { lanes_per_agent: 0 }, { lanes_per_agent: null }]) {
      assert.deepEqual(await err(bad), [400, 'invalid_engine'], JSON.stringify(bad));
    }
    assert.equal((await put({ capacity_mode: 'fixed', review_backlog_max: 99 }, MEMBER)).status, 403, 'someone who does not manage the team changes nothing');
    assert.equal((await scopeSettings(w.env, P)).review_backlog_max, 12);

    hq(w, { elastic: 25, lanes: 4, perRun: 500_000 });
    assert.deepEqual(await err({ capacity_mode: 'elastic', elastic_max_runs: 26 }), [400, 'invalid_engine']);
    assert.deepEqual(await err({ lanes_per_agent: 5 }), [400, 'invalid_engine']);
    const saved = await put({ capacity_mode: 'elastic', elastic_max_runs: 20, lanes_per_agent: 4 });
    assert.equal(saved.status, 200, saved.text);
    const read = await call(w, SPONSOR, 'GET', ENGINE);
    assert.deepEqual(read.body.capacity, {
      mode: 'elastic', elastic_max_runs: 20, lanes_per_agent: 4, review_backlog_max: 12, daily_runs_per_agent: 40,
      offered: { elastic_max_runs: 25, lanes_per_agent: 4 },
      in_force: { parallel_runs: 20, lanes_per_agent: 4, review_backlog: 12, daily_runs_per_agent: 40 },
    });
    assert.equal(read.body.max_parallel_runs, 2, 'the fixed number is kept for the day the team goes back');

    // HQ lowers its ceilings: in force at once, and the next save brings the row under them.
    hq(w, { elastic: 8, lanes: 2, perRun: 500_000 });
    assert.deepEqual((await call(w, SPONSOR, 'GET', ENGINE)).body.capacity.in_force.parallel_runs, 8);
    assert.deepEqual((await call(w, SPONSOR, 'GET', ENGINE)).body.capacity.in_force.lanes_per_agent, 2);
    assert.equal((await put({ review_backlog_max: null })).body.capacity.elastic_max_runs, 8);
    // A pause alone is the body it always was.
    const paused = await put({ paused: true });
    assert.deepEqual([paused.status, paused.body.scope_paused, paused.body.capacity.mode], [200, true, 'elastic']);
  } finally { w.close(); }
});

test('capacityWrite reads no more than the body names', () => {
  const current = { engine_paused: false, ...DEFAULT_CAPACITY };
  assert.deepEqual(capacityWrite({ review_backlog_max: 9 }, current, NO_CEILINGS), { ok: true, value: { review_backlog_max: 9 } });
  assert.deepEqual(capacityWrite({ capacity_mode: 'fixed' }, current, NO_CEILINGS), { ok: true, value: { capacity_mode: 'fixed' } });
  const r = capacityWrite({ lanes_per_agent: 3 }, current, { elastic_runs: null, lanes: 3, per_run_microusd: null });
  assert.equal(!r.ok && r.problem.code, 'lanes_not_offered', 'a lanes ceiling with no per-run ceiling offers nothing');
});

test('HQ sets the two ceilings with a reason and an audit row; sub-agents need the per-run ceiling, which then cannot be cleared', async () => {
  // Mutation checked: the `lanes_need_run_ceiling` check removed → sub-agents are offered with no bound on one run's cost.
  const w = world();
  try {
    assert.deepEqual(capacityCeilingsOf({ elastic_runs_ceiling: 501 }, { elastic_runs_ceiling: null, lanes_ceiling: null }, null).ok, false);
    assert.deepEqual(capacityCeilingsOf({}, { elastic_runs_ceiling: 9, lanes_ceiling: null }, null), { ok: true, value: { elastic_runs_ceiling: 9, lanes_ceiling: null } });
    const put = (path: string, body: unknown, who = ADMIN) => call(w, who, 'PUT', `${POLICY}${path}`, body);
    assert.equal((await put('/capacity', { elastic_runs_ceiling: 50, reason: 'x' }, SPONSOR)).status, 403, 'Super Admin only');
    assert.equal((await put('/capacity', { elastic_runs_ceiling: 50 })).body.error, 'reason_required');
    assert.equal((await put('/capacity', { elastic_runs_ceiling: 0, reason: 'Open elastic capacity' })).body.error, 'invalid_ceiling');
    const noRunCeiling = await put('/capacity', { lanes_ceiling: 4, reason: 'Offer sub-agents' });
    assert.deepEqual([noRunCeiling.status, noRunCeiling.body.error], [409, 'lanes_need_run_ceiling']);
    assert.deepEqual(await capacityCeilings(w.env), NO_CEILINGS, 'nothing was written');

    const elastic = await put('/capacity', { elastic_runs_ceiling: 50, reason: 'Open elastic capacity' });
    assert.equal(elastic.status, 200, elastic.text);
    assert.deepEqual([elastic.body.policy.elastic_runs_ceiling, elastic.body.policy.lanes_ceiling], [50, null]);
    assert.equal((await put('/caps', { per_run_ceiling_microusd: 500_000, reason: 'Bound one run' })).status, 200);
    assert.equal((await put('/capacity', { lanes_ceiling: 4, reason: 'Offer sub-agents' })).status, 200);
    assert.deepEqual(await capacityCeilings(w.env), { elastic_runs: 50, lanes: 4, per_run_microusd: 500_000 });
    const clear = await put('/caps', { per_run_ceiling_microusd: null, reason: 'Remove the ceiling' });
    assert.deepEqual([clear.status, clear.body.error], [409, 'lanes_need_run_ceiling']);
    assert.equal((await put('/capacity', { lanes_ceiling: null, reason: 'Stop offering sub-agents' })).status, 200);
    assert.equal((await put('/caps', { per_run_ceiling_microusd: null, reason: 'Remove the ceiling' })).status, 200);
    const audit = w.db.prepare("SELECT action, subject, before_json, after_json, reason FROM ai_admin_audit WHERE action = 'policy.capacity' ORDER BY id").all() as any[];
    assert.deepEqual(audit.map((a) => [a.subject, JSON.parse(a.before_json), JSON.parse(a.after_json), a.reason]), [
      ['policy:capacity', { elastic_runs_ceiling: null, lanes_ceiling: null }, { elastic_runs_ceiling: 50, lanes_ceiling: null }, 'Open elastic capacity'],
      ['policy:capacity', { elastic_runs_ceiling: 50, lanes_ceiling: null }, { elastic_runs_ceiling: 50, lanes_ceiling: 4 }, 'Offer sub-agents'],
      ['policy:capacity', { elastic_runs_ceiling: 50, lanes_ceiling: 4 }, { elastic_runs_ceiling: 50, lanes_ceiling: null }, 'Stop offering sub-agents'],
    ]);
  } finally { w.close(); }
});

test('settings written without a capacity field keep the statement they always had', async () => {
  const w = world();
  try {
    const sql: string[] = [];
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (q: string) => { sql.push(q); return prepare(q); };
    await putScopeSettings(w.env, P, { paused: true, max_parallel_runs: 3 }, SPONSOR);
    assert.ok(!sql.some((q) => /^\s*(UPDATE|INSERT)/.test(q) && /capacity_mode|lanes_per_agent/.test(q)), 'no capacity column is named');
    assert.deepEqual(await scopeSettings(w.env, P), { engine_paused: true, ...DEFAULT_CAPACITY, max_parallel_runs: 3 });
  } finally { w.close(); }
});
void MODULE; void OPTION; void hex;
