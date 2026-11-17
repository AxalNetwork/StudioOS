/**
 * D7073 (#7073) — the agent gateway fails closed, and a busy model pauses
 * nothing. The pure checks and the task loop here; the real `agentRun` (its
 * hold, its guard, its usage rows) is exercised in `team_agents_d1496.test.ts`,
 * whose run world is local to that file.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_gateway_7073.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { runTaskLoop } from '../src/agents/loop.ts';
import { agentGateway, agentGatewayId, gatewayLimited, gatewayRefusal, modelThrottled } from '../src/services/agents/agentRun.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const admit = (w: World, taskId: number) => w.runtime.admit(P, { agentId: AGENT, taskId, by: SPONSOR, source: 'person' });
const taskRow = (w: World, id: number) => w.db.prepare('SELECT * FROM scope_tasks WHERE id = ?').get(id) as any;
const agentRow = (w: World, id: number) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(id) as any;
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;

async function fullRun(w: World, taskId: number, agentRun = fakeAgentRun(w)) {
  const a = await admit(w, taskId);
  assert.ok(a.ok, JSON.stringify(a));
  const h = harness();
  h.opts.decision = { status: 'accepted' };
  const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, agentRun.fn));
  return { uid: a.run.uid, out, h, agentRun };
}

test('the gateway id is none, ok or malformed; a malformed id is never read as none', () => {
  // Mutation checked: `malformed` folded into `none` → the third and fourth cases read `none`.
  assert.deepEqual(agentGateway({}), { kind: 'none' });
  assert.deepEqual(agentGateway({ AGENT_AI_GATEWAY: '   ' }), { kind: 'none' });
  assert.deepEqual(agentGateway({ AGENT_AI_GATEWAY: ' agents ' }), { kind: 'ok', id: 'agents' });
  assert.deepEqual(agentGateway({ AGENT_AI_GATEWAY: 'agents gateway' }), { kind: 'malformed' });
  assert.deepEqual(agentGateway({ AGENT_AI_GATEWAY: 'a'.repeat(65) }), { kind: 'malformed' });
  // The id the router is handed is unchanged: only a usable id.
  assert.equal(agentGatewayId({ AGENT_AI_GATEWAY: 'agents' }), 'agents');
  assert.equal(agentGatewayId({ AGENT_AI_GATEWAY: 'agents gateway' }), null);
  assert.equal(agentGatewayId({}), null);
});

test('a malformed gateway refuses every run; a missing one refuses an engine run only; the inference stub needs none', () => {
  // Mutations checked: the `engineRun` condition dropped → the sponsor's own run is refused;
  // the stub exemption dropped → the Stage A preview is refused; the stub read outside preview → production is let through.
  const code = (env: Record<string, string>, engine: boolean) => gatewayRefusal(env as any, engine)?.code ?? null;
  assert.equal(code({ AGENT_AI_GATEWAY: 'not a gateway!' }, false), 'gateway_misconfigured');
  assert.equal(code({ AGENT_AI_GATEWAY: 'not a gateway!' }, true), 'gateway_misconfigured');
  assert.equal(code({}, false), null, 'a sponsor\'s own run with no gateway is unchanged');
  assert.equal(code({}, true), 'gateway_required');
  assert.equal(code({ AGENT_AI_GATEWAY: 'agents' }, true), null);
  assert.equal(code({ AGENT_AI_GATEWAY: 'agents' }, false), null);
  // The deterministic stub: no model is reached, so no gateway is needed. Only in preview.
  assert.equal(code({ ENVIRONMENT: 'preview', AGENT_INFERENCE_STUB: 'deterministic' }, true), null);
  assert.equal(code({ ENVIRONMENT: 'production', AGENT_INFERENCE_STUB: 'deterministic' }, true), 'gateway_required');
  assert.equal(code({ ENVIRONMENT: 'preview', STUDIOOS_ENV: 'production', AGENT_INFERENCE_STUB: 'deterministic' }, true), 'gateway_required');
  // A malformed id is refused even where the stub answers: a wrong setting is surfaced, not hidden.
  assert.equal(code({ ENVIRONMENT: 'preview', AGENT_INFERENCE_STUB: 'deterministic', AGENT_AI_GATEWAY: '!' }, true), 'gateway_misconfigured');
  const r = gatewayRefusal({}, true)!;
  assert.equal(r.status, 503);
  assert.ok(!/agents:|AGENT_AI_GATEWAY/.test(r.message), 'the message names no setting');
});

test('a 429 Workers AI explains (3040, 3036) is model throttling; any other 429 is the gateway\'s limit', () => {
  // Mutation checked: `gatewayLimited` as before D7073 (any failed 429) → the first three cases read as the gateway's limit.
  const busy = { ok: false, status: 429, code: 3040 };
  const allocation = { ok: false, status: 429, code: 3036 };
  const gateway = { ok: false, status: 429, code: null };
  const down = { ok: false, status: 500, code: null };
  const skipped = { ok: false, status: 413, code: null };
  for (const attempts of [[busy], [busy, allocation], [skipped, busy, down]]) {
    assert.equal(modelThrottled({ attempts }), true, JSON.stringify(attempts));
    assert.equal(gatewayLimited({ attempts }), false, JSON.stringify(attempts));
  }
  for (const attempts of [[gateway], [busy, gateway], [{ ok: false, status: 429 }], [{ ok: false, status: 429, code: 5035 }]]) {
    assert.equal(gatewayLimited({ attempts }), true, JSON.stringify(attempts));
    assert.equal(modelThrottled({ attempts }), false, JSON.stringify(attempts));
  }
  // No 429 at all is neither.
  for (const attempts of [[down], [skipped], [], [{ ok: true, status: 429, code: 3040 }]]) {
    assert.equal(gatewayLimited({ attempts }), false);
    assert.equal(modelThrottled({ attempts }), false);
  }
  assert.equal(modelThrottled({}), false);
  assert.equal(gatewayLimited({}), false);
});

test('the task loop tells agentRun the run is the engine\'s', async () => {
  // Mutation checked: `engine: true` dropped from the loop's call → the assert below fails, and an engine run would need no gateway.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const seen: unknown[] = [];
    const inner = fakeAgentRun(w);
    const spy = { ...inner, fn: (async (env, input) => { seen.push(input.engine); return inner.fn(env, input); }) as typeof inner.fn };
    const { out } = await fullRun(w, 200, spy);
    assert.equal(out.go, true, JSON.stringify(out));
    assert.deepEqual(seen, [true]);
  } finally { w.close(); }
});

test('a busy model ends the run and pauses nothing: no breaker, the agent active, the task open again, one attempt', async () => {
  // Mutations checked: the `model_throttled` branch removed → the 503 throws, the step is retried 4 times and the loop rejects;
  // the branch writing the breaker → `agents:paused` is set and the second task is refused `engine_paused`.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT); w.task(201, AGENT);
    const throttled = fakeAgentRun(w, { refuse: { status: 503, code: 'model_throttled' } });
    const { uid, out, h } = await fullRun(w, 200, throttled);
    assert.deepEqual(out, { go: false, status: 'failed', refusal: 'model_throttled' });
    assert.equal(throttled.state.calls, 1, 'the step is not retried: a retry would replay its hold and run nothing');
    assert.equal(h.executed.filter((n) => n === 'run').length, 1);
    assert.equal(await w.kv.get('agents:paused'), null, 'the platform breaker is not written');
    assert.deepEqual([agentRow(w, AGENT).status, agentRow(w, AGENT).paused_reason], ['active', null]);
    assert.equal(taskRow(w, 200).status, 'open');
    assert.deepEqual([runRow(w, uid).status, runRow(w, uid).refusal], ['failed', 'model_throttled']);
    // The engine still admits: the same task again, and another.
    assert.ok((await admit(w, 200)).ok);
  } finally { w.close(); }
});

test('a gateway that is not set up ends the run without a retry, a pause or the breaker', async () => {
  for (const code of ['gateway_required', 'gateway_misconfigured']) {
    const w = world();
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const refusing = fakeAgentRun(w, { refuse: { status: 503, code } });
      const { uid, out } = await fullRun(w, 200, refusing);
      assert.deepEqual(out, { go: false, status: 'failed', refusal: code });
      assert.equal(refusing.state.calls, 1);
      assert.equal(await w.kv.get('agents:paused'), null);
      assert.equal(agentRow(w, AGENT).status, 'active');
      assert.equal(taskRow(w, 200).status, 'open');
      assert.equal(runRow(w, uid).refusal, code);
    } finally { w.close(); }
  }
});

test('the gateway\'s own limit still sets the breaker', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const { out } = await fullRun(w, 200, fakeAgentRun(w, { refuse: { status: 503, code: 'gateway_limit' } }));
    assert.deepEqual(out, { go: false, status: 'failed', refusal: 'gateway_limit' });
    assert.equal(await w.kv.get('agents:paused'), 'gateway_limit');
  } finally { w.close(); }
});
