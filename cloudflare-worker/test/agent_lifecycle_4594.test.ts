/**
 * #4594 (audit R2-11) Stage A and Stage B — the agent lifecycle, recovery and
 * cleanup, as LOCAL SIMULATION with the real orchestration and accounting code
 * and STUBBED INFERENCE (`_agent_lifecycle_fixture.ts` says exactly what is
 * real, stubbed and faked). This is not a hosted test and proves nothing about
 * an upstream provider; the hosted stages need owner approval, ceilings and a
 * passed #4566 preflight (D4594).
 *
 * Stage A: one Workflow-driven lifecycle and one manual sponsor run, each from
 * an authorized start through admission, queue dispatch, the loop, a proposal,
 * a person's decision, a terminal run and a settled hold that equals what was
 * charged; and the refusals (wrong tenant, missing permission, engine off,
 * duplicate start, revoked sponsor), each with zero unauthorized effects.
 *
 * Stage B: failures injected at the existing seams. After every one the
 * invariants hold: no pending hold, no live slot left behind, at most one
 * proposal and one settled hold per run key, and no continuation nobody
 * authorized. "At most once" here is EFFECT deduplication (run key, hold
 * idempotency key, run status guards); the queue may deliver a message more
 * than once and the tests do exactly that.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_lifecycle_4594.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, MEMBER, MODULE, OPTION, PROJECT, SPONSOR, STRANGER, hex, loopDeps, type World } from './_agent_engine_fixture.ts';
import { EVIDENCE_LABEL, STUB_ANSWER, batchOf, ledger, lifecycleStep, lifecycleWorld, modelCalls, until, type LifeWorld } from './_agent_lifecycle_fixture.ts';
import { agentRun } from '../src/services/agents/agentRun.ts';
import { runTaskLoop } from '../src/agents/loop.ts';
import { agentDlqConsumer, agentQueueConsumer, dispatchQueue, DLQ_FINAL_ATTEMPT } from '../src/agents/agentQueue.ts';
import { scopeOfRow } from '../src/agents/engine.ts';
import engineRoutes, { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => { __setEngineRouteDeps(null); removeMigratedDatabases(); });

const P = { kind: 'project' as const, id: PROJECT };
const T200 = hex(200, 'c');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;
const taskRow = (w: World, id: number) => w.db.prepare('SELECT * FROM scope_tasks WHERE id = ?').get(id) as any;
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

function app(w: World) {
  __setEngineRouteDeps({ runtime: async () => w.runtime });
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/teams', engineRoutes);
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const r = await app(w).request(`/api/teams${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, w.env);
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
  } finally { [console.warn, console.error, console.info] = saved; }
}

/** The queue runtime delivering what was sent, through the production routing. */
async function deliver(w: World, attempts = 1) {
  const sent = w.queue.splice(0);
  const b = batchOf('studioos-agent-queue', sent, attempts);
  const start = async (_env: any, run: { uid: string; agent: any }) => { await w.runtime.startRun(scopeOfRow(run.agent), run.uid); };
  await dispatchQueue(b.batch, w.env, ctx, {
    queue: async () => { throw new Error('not the agent queue'); }, dlq: async () => {},
    agent: (batch, env, c) => agentQueueConsumer(batch, env, c, start), agentDlq: agentDlqConsumer,
  });
  return { ...b, sent };
}

/** The invariants every lifecycle must leave, whatever happened in between. */
async function assertClean(w: LifeWorld, what: string) {
  const l = ledger(w);
  assert.equal(l.pendingHolds, 0, `${what}: no hold left pending`);
  assert.equal(l.duplicateProposals, 0, `${what}: at most one proposal per run key`);
  assert.equal(l.duplicateSettlements, 0, `${what}: at most one settled hold per run key`);
  const settled = l.holds.filter((h) => h.status === 'settled').reduce((s, h) => s + h.actual, 0);
  assert.equal(settled, l.charged, `${what}: what the holds settled is what the usage rows charged`);
  const live = (await w.runtime.status(P)).live;
  const open = l.runs.filter((r) => ['admitted', 'running', 'waiting_decision'].includes(r.status)).map((r) => r.uid);
  assert.deepEqual(live.map((x: any) => x.run_uid ?? x).filter((u: string) => !open.includes(u)), [], `${what}: no live slot for an ended run`);
  return l;
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { [console.warn, console.error, console.info] = saved; }
}

/** Start through the route, deliver the message, and run the Workflow in the background. */
async function startAndRun(w: LifeWorld, taskUid = T200) {
  const started = await call(w, SPONSOR, 'POST', `/tasks/${taskUid}/start`);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const uid = started.body.run.uid as string;
  const d = await deliver(w);
  assert.deepEqual(d.acked, [0], 'the queue message was acknowledged once the Workflow was created');
  const s = lifecycleStep(w, uid);
  const loop = quietly(() => runTaskLoop(uid, s.step, loopDeps(w, agentRun)));
  return { uid, s, loop };
}

// ── Stage A ─────────────────────────────────────────────────────────────────

test(`A1. Workflow path: authorized start → admission → queue → Workflow → proposal → a person accepts → done, one hold settled at what was charged [${EVIDENCE_LABEL}]`, async () => {
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT, { title: 'Draft the plan' });
    const { uid, loop } = await startAndRun(w);
    assert.equal(w.workflows.instances.size, 1, 'one Workflow instance, named by the run');
    await until(() => runRow(w, uid)?.status === 'waiting_decision', 'the proposal');
    const r = runRow(w, uid);
    // The person decides through the queue route, as the sponsor, with the normal authorization.
    const decided = await call(w, SPONSOR, 'POST', `/queue/${r.proposal_uid}/decide`, { decision: 'accept' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    const out = await loop;
    assert.deepEqual(out, { go: true, decision: 'accepted' });
    const end = runRow(w, uid);
    assert.deepEqual([end.status, end.step, taskRow(w, 200).status, taskRow(w, 200).board_column], ['done', 'after', 'done', 'done']);
    const l = await assertClean(w, 'A1');
    // Provenance: one model call on the agent's own model, one proposal tied to its usage row, one hold named by the run.
    assert.equal(modelCalls(w), 1);
    assert.deepEqual([...new Set(w.ai.models.filter((m) => !m.includes('guard')))], [MODEL]);
    assert.equal(l.proposals.length, 1);
    const p = l.proposals[0];
    assert.deepEqual([p.run_key, p.agent_id, p.task_id, p.status], [`agent:${uid}`, AGENT, 200, 'accepted']);
    const usage = l.usage.find((u) => u.id === p.usage_log_id);
    assert.ok(usage, 'the proposal names its usage row');
    assert.deepEqual([usage.model, usage.agent_id, usage.user_id, usage.rail_option], [MODEL, AGENT, SPONSOR, OPTION]);
    assert.equal(l.holds.length, 1);
    assert.deepEqual([l.holds[0].idempotency_key, l.holds[0].execution_id, l.holds[0].status, l.holds[0].operation], [`agent:${uid}:run`, uid, 'settled', 'agent.ceo']);
    assert.ok(l.charged > 0, 'the run was charged');
    assert.equal(l.holds[0].actual, l.charged, 'settled at exactly what was charged');
    assert.ok(l.holds[0].actual <= l.holds[0].held, 'never more than was held');
    const prop = w.db.prepare('SELECT payload_json FROM ai_rail_proposals WHERE uid = ?').get(p.uid) as any;
    assert.equal(JSON.parse(prop.payload_json).text, STUB_ANSWER, 'the stubbed answer is what was proposed');
  } finally { w.close(); }
});

test(`A2. Manual sponsor run: the sponsor's own run route → proposal → a person accepts; no engine run, one hold settled at what was charged [${EVIDENCE_LABEL}]`, async () => {
  const w = lifecycleWorld({ engine: 'off' });
  try {
    w.agent(AGENT);
    const ran = await call(w, SPONSOR, 'POST', `/agents/${hex(AGENT, 'b')}/run`, { module: MODULE, option: OPTION, prompt: 'Draft the plan for the next quarter.' });
    assert.equal(ran.status, 200, JSON.stringify(ran.body));
    const decided = await call(w, SPONSOR, 'POST', `/queue/${ran.body.proposal.uid}/decide`, { decision: 'accept' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    const l = await assertClean(w, 'A2');
    assert.deepEqual([l.runs.length, l.instances, l.queued], [0, 0, 0], 'the manual path uses no engine run, Workflow or queue');
    assert.deepEqual([l.proposals.length, l.proposals[0].status, l.proposals[0].agent_id], [1, 'accepted', AGENT]);
    assert.equal(l.holds.length, 1);
    assert.equal(l.holds[0].status, 'settled');
    assert.equal(l.holds[0].actual, l.charged);
    assert.deepEqual(ran.body.charged, { available: true, value_microusd: l.charged }, 'the answer reports what was charged');
    assert.equal(modelCalls(w), 1);
  } finally { w.close(); }
});

test(`A3. Refusals: wrong tenant, missing permission, engine off, duplicate start and a revoked sponsor each refuse with no unauthorized effect [${EVIDENCE_LABEL}]`, async () => {
  // Mutation checked: the engine flag ignored (agentEngineEnabled always true) → the engine-off start is admitted.
  const effects = (w: LifeWorld) => { const l = ledger(w); return { runs: l.runs.length, holds: l.holds.length, proposals: l.proposals.length, charged: l.charged, queued: l.queued, instances: l.instances, model: modelCalls(w) }; };
  const cases: Array<[string, (w: LifeWorld) => Promise<{ status: number; body: any }>, number, string | null]> = [
    ['a stranger (wrong tenant)', (w) => call(w, STRANGER, 'POST', `/tasks/${T200}/start`), 404, null],
    ['a member of another team (missing permission)', (w) => call(w, MEMBER, 'POST', `/tasks/${T200}/start`), 404, null],
    ['the engine switched off', async (w) => { w.env.AGENT_ENGINE = 'off'; return call(w, SPONSOR, 'POST', `/tasks/${T200}/start`); }, 404, 'agent_engine_off'],
    ['a stranger running the agent by hand', (w) => call(w, STRANGER, 'POST', `/agents/${hex(AGENT, 'b')}/run`, { module: MODULE, option: OPTION, prompt: 'x' }), 404, null],
  ];
  for (const [what, act, status, code] of cases) {
    const w = lifecycleWorld();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const before = effects(w);
      const r = await act(w);
      assert.ok(r.status === status || (status === 404 && r.status === 403), `${what}: ${r.status} ${JSON.stringify(r.body)}`);
      if (code) assert.equal(r.body.error, code, what);
      assert.deepEqual(effects(w), before, `${what}: nothing was admitted, queued, held, charged or proposed`);
    } finally { w.close(); }
  }
  // A duplicate start: the second is refused and adds nothing to the first run's effects.
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    assert.equal((await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`)).status, 202);
    const after1 = effects(w);
    const again = await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`);
    assert.notEqual(again.status, 202, 'a second start of the same task is refused');
    assert.deepEqual(effects(w), after1, 'the duplicate added no run, message, hold or charge');
  } finally { w.close(); }
  // A revoked sponsor: admitted before the revocation, the run step refuses; nothing is held, charged or proposed.
  const v = lifecycleWorld();
  try {
    v.agent(AGENT); v.task(200, AGENT);
    const { uid, loop } = await startAndRun(v);
    v.db.prepare('UPDATE projects SET founder_id = 999 WHERE id = ?').run(PROJECT); // the sponsor no longer manages the scope
    const out = await loop;
    assert.equal(out.go, false);
    const l = await assertClean(v, 'revoked sponsor');
    assert.deepEqual([l.holds.length, l.proposals.length, l.charged, modelCalls(v)], [0, 0, 0, 0], 'no hold, proposal, charge or model call');
    assert.notEqual(runRow(v, uid).status, 'waiting_decision');
  } finally { v.close(); }
});

// ── Stage B ─────────────────────────────────────────────────────────────────

/** Run a lifecycle to its proposal and have the sponsor accept it through the queue route. */
async function acceptWhenProposed(w: LifeWorld, uid: string) {
  await until(() => runRow(w, uid)?.status === 'waiting_decision', 'the proposal');
  const d = await call(w, SPONSOR, 'POST', `/queue/${runRow(w, uid).proposal_uid}/decide`, { decision: 'accept' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
}

test(`B1. a duplicated and a late-redelivered queue message start one Workflow and take one hold [${EVIDENCE_LABEL}]`, async () => {
  // Mutation checked: the consumer's "past admitted" guard removed → the late redelivery creates a second lifecycle.
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const started = await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`);
    const uid = started.body.run.uid as string;
    const message = structuredClone(w.queue[0]);
    w.queue.push(structuredClone(message)); // delivered twice in one batch
    const d = await deliver(w);
    assert.deepEqual(d.acked, [0, 1], 'both copies are acknowledged');
    assert.equal(w.workflows.instances.size, 1, 'one instance for two deliveries');
    const s = lifecycleStep(w, uid);
    const loop = quietly(() => runTaskLoop(uid, s.step, loopDeps(w, agentRun)));
    await acceptWhenProposed(w, uid);
    await loop;
    w.queue.push(structuredClone(message)); // a redelivery after the run ended
    const late = await deliver(w);
    assert.deepEqual([late.acked, w.workflows.instances.size], [[0], 1], 'a late redelivery is acknowledged and starts nothing');
    const l = await assertClean(w, 'B1');
    assert.deepEqual([l.holds.length, l.proposals.length, modelCalls(w)], [1, 1, 1]);
  } finally { w.close(); }
});

for (const mode of ['timeout', 'rate_limited'] as const) {
  test(`B2. the model ${mode === 'timeout' ? 'times out' : 'answers 429'}: the run is refused, its hold is released, nothing is proposed, and a fresh start then completes once [${EVIDENCE_LABEL}]`, async () => {
    const w = lifecycleWorld({ modes: [mode] }); // every model call fails, the router's fallback included
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const first = await startAndRun(w);
      const out = await first.loop;
      assert.equal(out.go, false, `the run stopped: ${JSON.stringify(out)}`);
      let l = await assertClean(w, `B2 ${mode}`);
      assert.deepEqual([l.proposals.length, l.charged], [0, 0], 'no proposal and no charge for a model that did not answer');
      assert.ok(l.holds.every((h) => h.status === 'refunded'), `every hold released: ${JSON.stringify(l.holds)}`);
      assert.notEqual(taskRow(w, 200).status, 'in_progress', 'the task is not left in progress');
      // Recovery: the provider answers again and the person starts it again; the second run completes and is charged once.
      w.ai.modes.splice(0, w.ai.modes.length, 'ok');
      if (taskRow(w, 200).status !== 'open') w.db.prepare("UPDATE scope_tasks SET status = 'open', board_column = 'ready' WHERE id = 200").run();
      const second = await startAndRun(w);
      await acceptWhenProposed(w, second.uid);
      assert.deepEqual(await second.loop, { go: true, decision: 'accepted' });
      l = await assertClean(w, `B2 ${mode} recovery`);
      assert.equal(l.holds.filter((h) => h.status === 'settled').length, 1);
      assert.equal(l.proposals.length, 1);
    } finally { w.close(); }
  });
}

test(`B3. an ambiguous commit (the model ran and was charged, the proposal write failed): the retry runs nothing, charges nothing more, and ends step_lost [${EVIDENCE_LABEL}]`, async () => {
  // Mutation checked: the hold's idempotency key dropped → the retry takes a second hold and a second charge.
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    let failOnce = true;
    w.env.DB.prepare = (q: string) => {
      if (failOnce && /^\s*INSERT INTO ai_rail_proposals/.test(q)) { failOnce = false; throw new Error('D1 unavailable'); }
      return prepare(q);
    };
    const { uid, loop } = await startAndRun(w);
    const out = await loop;
    assert.equal(out.go, false);
    const l = await assertClean(w, 'B3');
    assert.equal(modelCalls(w), 1, 'the model ran once; the retry ran nothing');
    assert.equal(l.holds.length, 1);
    assert.equal(l.holds[0].status, 'settled', 'the one run that happened is paid for once');
    assert.equal(l.proposals.length, 0, 'no proposal was invented by the retry');
    assert.ok(['step_lost', 'refused', 'failed'].includes(runRow(w, uid).status), runRow(w, uid).status);
    assert.notEqual(runRow(w, uid).status, 'waiting_decision');
  } finally { w.close(); }
});

test(`B4. the Workflow is interrupted after the run step and replays: one model call, one hold, one proposal [${EVIDENCE_LABEL}]`, async () => {
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const started = await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`);
    const uid = started.body.run.uid as string;
    await deliver(w);
    const s = lifecycleStep(w, uid);
    s.opts.crashBeforeSave = 'run';
    await assert.rejects(quietly(() => runTaskLoop(uid, s.step, loopDeps(w, agentRun))), (e) => s.isCrash(e));
    const replay = quietly(() => runTaskLoop(uid, s.step, loopDeps(w, agentRun)));
    await acceptWhenProposed(w, uid);
    assert.deepEqual(await replay, { go: true, decision: 'accepted' });
    const l = await assertClean(w, 'B4');
    assert.deepEqual([modelCalls(w), l.holds.length, l.proposals.length], [1, 1, 1], 'the replayed step answered its first proposal');
  } finally { w.close(); }
});

test(`B5. the decision wait runs out, then a late decision still completes the task once, with no new charge [${EVIDENCE_LABEL}]`, async () => {
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const { uid, s, loop } = await startAndRun(w);
    await until(() => runRow(w, uid)?.status === 'waiting_decision', 'the proposal');
    s.opts.expired = true; // the seven days ran out
    await loop;
    assert.equal(runRow(w, uid).refusal, 'decision_expired');
    const chargedBefore = ledger(w).charged;
    const d = await call(w, SPONSOR, 'POST', `/queue/${runRow(w, uid).proposal_uid}/decide`, { decision: 'accept' });
    assert.equal(d.status, 200);
    assert.deepEqual([runRow(w, uid).status, taskRow(w, 200).status], ['done', 'done'], 'the late decision was applied');
    const l = await assertClean(w, 'B5');
    assert.equal(l.charged, chargedBefore, 'deciding charges nothing');
    assert.deepEqual([modelCalls(w), l.proposals.length], [1, 1]);
  } finally { w.close(); }
});

test(`B6. a run cancelled while it waits for a decision ends; a later decision on its proposal does not continue it [${EVIDENCE_LABEL}]`, async () => {
  // Mutation checked: deliverDecision's waiting_decision guard removed → the cancelled run is moved to done.
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const { uid, loop } = await startAndRun(w);
    await until(() => runRow(w, uid)?.status === 'waiting_decision', 'the proposal');
    const c = await call(w, SPONSOR, 'POST', `/runs/${uid}/cancel`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    await loop;
    assert.equal(runRow(w, uid).status, 'cancelled');
    const proposal = runRow(w, uid).proposal_uid;
    await call(w, SPONSOR, 'POST', `/queue/${proposal}/decide`, { decision: 'accept' });
    assert.equal(runRow(w, uid).status, 'cancelled', 'the run stayed cancelled');
    assert.notEqual(taskRow(w, 200).status, 'done', 'the task was not completed by a run nobody let continue');
    await assertClean(w, 'B6');
  } finally { w.close(); }
});

test(`B7. the scope moves, or the halt key is set, after admission: the run stops before the model, holds nothing and leaves no live slot [${EVIDENCE_LABEL}]`, async () => {
  for (const what of ['scope_moved', 'halted'] as const) {
    const w = lifecycleWorld();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const started = await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`);
      const uid = started.body.run.uid as string;
      await deliver(w);
      if (what === 'scope_moved') w.db.prepare('UPDATE projects SET company_id = NULL WHERE id = ?').run(PROJECT);
      else await w.kv.put('agents:halt', 'drill');
      const s = lifecycleStep(w, uid);
      const out = await quietly(() => runTaskLoop(uid, s.step, loopDeps(w, agentRun)));
      assert.deepEqual(out, { go: false, status: what, refusal: what });
      const l = await assertClean(w, `B7 ${what}`);
      assert.deepEqual([l.holds.length, l.proposals.length, l.charged, modelCalls(w)], [0, 0, 0, 0]);
    } finally { w.close(); }
  }
});

test(`B8. a message that never starts goes to the DLQ: repaired before it is acknowledged, then a replay of it starts nothing [${EVIDENCE_LABEL}]`, async () => {
  // Mutation checked: acknowledging the DLQ message before its repair is read back → the task stays in_progress.
  const w = lifecycleWorld();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const started = await call(w, SPONSOR, 'POST', `/tasks/${T200}/start`);
    const uid = started.body.run.uid as string;
    const message = structuredClone(w.queue.splice(0)[0]);
    // Every delivery fails to start the Workflow (the binding is down).
    const create = w.workflows.create;
    w.workflows.create = async () => { throw new Error('workflows unavailable'); };
    const failing = batchOf('studioos-agent-queue', [message]);
    await quietly(() => agentQueueConsumer(failing.batch, w.env, ctx, async (_e, run) => { const h = await w.runtime.startRun(scopeOfRow(run.agent), run.uid); if (!h.started) throw new Error('not started'); }));
    assert.deepEqual([failing.acked, failing.retried], [[], [0]], 'not started: retried, not acknowledged');
    w.workflows.create = create;
    // The retries are exhausted; the DLQ batch arrives.
    const mirrored: unknown[] = [];
    const dlq = batchOf('studioos-agent-queue-dlq', [message], DLQ_FINAL_ATTEMPT);
    await quietly(() => dispatchQueue(dlq.batch, w.env, ctx, {
      queue: async () => {}, dlq: async (b) => { mirrored.push(...b.messages.map((m: any) => m.body)); }, agent: async () => {}, agentDlq: agentDlqConsumer,
    }));
    assert.equal(mirrored.length, 1, 'mirrored once its repair was read back');
    assert.deepEqual([runRow(w, uid).status, runRow(w, uid).refusal, taskRow(w, 200).status], ['failed', 'queue_exhausted', 'open']);
    // A replay of the original message after the repair starts nothing.
    w.queue.push(message);
    const replay = await deliver(w);
    assert.deepEqual([replay.acked, w.workflows.instances.size], [[0], 0]);
    // FINDING (D4594 §4): the repair writes D1 only, so the scope object's live view still lists the
    // failed run. Admission is decided by D1 (doRuntime.ts), so the agent is not blocked; a rebuild clears it.
    assert.deepEqual((await w.runtime.status(P)).live.map((x: any) => x.run_uid), [uid], 'the live view is stale after the repair (the finding)');
    const again = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(again.ok, `the stale view does not block the agent: ${JSON.stringify(again)}`);
    w.db.prepare("UPDATE agent_task_runs SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE uid = ?").run(again.ok ? again.run.uid : '');
    await w.runtime.rebuild(P);
    const l = await assertClean(w, 'B8 after rebuild');
    assert.deepEqual([l.holds.length, l.proposals.length, modelCalls(w)], [0, 0, 0]);
  } finally { w.close(); }
});

test.todo('B8b. the DLQ repair also clears the run from the scope object\'s live view (finding; proposed one-line fix in D4594 §4, for #4593\'s owner)');

test(`B9. the evidence is labelled for what it is [${EVIDENCE_LABEL}]`, () => {
  // #4594: results separate LOCAL SIMULATION, HOSTED PLATFORM WITH STUB, REAL PROVIDER and PRODUCTION OBSERVATION.
  assert.match(EVIDENCE_LABEL, /^LOCAL SIMULATION/);
  assert.match(EVIDENCE_LABEL, /STUBBED INFERENCE/);
  assert.doesNotMatch(EVIDENCE_LABEL, /HOSTED|REAL PROVIDER|PRODUCTION/);
});
