/**
 * D7077 (#7077) — agent dispatch throughput: a queue batch's Workflows start
 * together and each message keeps its own ack or retry; the platform budget
 * per model admits up to its limit, shares a minute fairly between scopes, and
 * is off when unset; the dispatch and sweep metrics carry only low-cardinality
 * labels. The database is the real migrated schema; every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_dispatch_7077.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, world, type World } from './_agent_engine_fixture.ts';
import { DISPATCH_LABEL_KEYS, agentQueueConsumer, dispatchLabels } from '../src/agents/agentQueue.ts';
import {
  MODEL_BUDGET_KEEP_MINUTES, admitModelStart, budgetFor, minuteOf, readModelBudgets, secondsToNextMinute,
} from '../src/agents/modelBudget.ts';
import { putScopeSettings } from '../src/agents/engine.ts';
import { DISCOVERY_PER_SCOPE_MAX, DISCOVERY_SCAN_MAX, SWEEP_MAX, sweepAgents } from '../src/agents/sweep.ts';

test.after(() => removeMigratedDatabases());

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const P = { kind: 'project' as const, id: PROJECT };
const AT = new Date('2026-11-17T10:00:15Z');

function batchOf(queue: string, bodies: any[]) {
  const acks: string[] = [];
  const messages = bodies.map((body, i) => ({
    id: `m${i}`, timestamp: new Date(AT.getTime() - 40_000), attempts: 1, body,
    ack() { acks.push(`ack:${i}`); }, retry(o?: { delaySeconds?: number }) { acks.push(`retry:${i}:${o?.delaySeconds ?? ''}`); },
  }));
  return { batch: { queue, messages } as any, acks };
}
const msgOf = (uid: string) => ({ job_type: 'agent_run', payload: { run_uid: uid }, idempotency_key: `agent:${uid}` });

/** `n` agents in the fixture's project, each with one admitted run. */
async function admittedRuns(w: World, n: number): Promise<string[]> {
  const uids: string[] = [];
  await putScopeSettings(w.env, P, { max_parallel_runs: 5 }, SPONSOR);
  for (let k = 0; k < n; k += 1) {
    const id = AGENT + k;
    w.agent(id, `role-${k}`);
    w.task(300 + k, id);
    const a = await w.runtime.admit(P, { agentId: id, taskId: 300 + k, by: SPONSOR, source: 'person' });
    assert.ok(a.ok, JSON.stringify(a));
    uids.push(a.run.uid);
  }
  return uids;
}

const metricRows = (w: World, like: string) =>
  w.db.prepare('SELECT metric_name, value, labels FROM system_metrics WHERE metric_name LIKE ? ORDER BY id').all(like) as Array<{ metric_name: string; value: number; labels: string }>;

/** Yield `n` event-loop turns: lets every other start reach its await, with no timer. */
const turns = async (n: number) => { for (let i = 0; i < n; i += 1) await new Promise<void>((r) => setImmediate(r)); };

test('a batch starts its Workflows together; one failed start is retried and the others are acked', async () => {
  const w = world();
  try {
    const uids = await admittedRuns(w, 3);
    let inFlight = 0, peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const start = async (_env: any, r: { uid: string }) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      if (inFlight === uids.length) release();
      // Run one after another the gate never opens; a bounded number of event-loop turns (no clock)
      // keeps that failure a red test, not a hang.
      await Promise.race([gate, turns(50)]);
      inFlight -= 1;
      if (r.uid === uids[1]) throw new Error('workflow create failed');
    };
    const one = batchOf('studioos-agent-queue', uids.map(msgOf));
    await agentQueueConsumer(one.batch, w.env, {} as any, start, { now: () => AT });
    assert.equal(peak, 3, 'all three starts were in flight at once');
    assert.deepEqual(one.acks, ['ack:0', 'retry:1:30', 'ack:2'], 'the failed start alone is retried, 30 s as before');
  } finally { w.close(); }
});

test('two messages naming one run start it once and are both acked', async () => {
  const w = world();
  try {
    const [uid] = await admittedRuns(w, 1);
    const started: string[] = [];
    const one = batchOf('studioos-agent-queue', [msgOf(uid), { job_type: 'other' }, msgOf(uid)]);
    await agentQueueConsumer(one.batch, w.env, {} as any, async (_e, r) => { started.push(r.uid); }, { now: () => AT });
    assert.deepEqual([started, one.acks], [[uid], ['ack:0', 'ack:1', 'ack:2']]);
  } finally { w.close(); }
});

test('the knob: unset, empty or malformed is no limit; a named model or "*" is limited', () => {
  assert.equal(readModelBudgets({}), null);
  assert.equal(readModelBudgets({ AGENT_MODEL_RPM: '' }), null);
  for (const bad of ['[1]', '{"m": 0}', '{"m": 1.5}', '{"bad model": 3}', 'nope', '{}']) assert.equal(readModelBudgets({ AGENT_MODEL_RPM: bad }), null, bad);
  const b = readModelBudgets({ AGENT_MODEL_RPM: JSON.stringify({ '*': 300, [MODEL]: 50 }) });
  assert.deepEqual(budgetFor(b, MODEL), { limit: 50, label: MODEL });
  assert.deepEqual(budgetFor(b, '@cf/other/model'), { limit: 300, label: '*' });
  assert.equal(budgetFor(readModelBudgets({ AGENT_MODEL_RPM: JSON.stringify({ [MODEL]: 5 }) }), '@cf/other/model'), null);
  assert.equal(secondsToNextMinute(AT), 45);
});

test('the budget admits up to the limit, then throttles; one scope cannot starve another', async () => {
  const w = world();
  try {
    const budgets = readModelBudgets({ AGENT_MODEL_RPM: JSON.stringify({ [MODEL]: 6 }) });
    const ask = (scope: string, at = AT) => admitModelStart(w.env, budgets, MODEL, scope, at);
    // A noisy scope alone takes at most half of the minute.
    const noisy = [];
    for (let k = 0; k < 10; k += 1) noisy.push(await ask('project:1'));
    assert.equal(noisy.filter((v) => v.ok).length, 3);
    assert.deepEqual(noisy[3], { ok: false, reason: 'scope_share', retryAfterSec: 45 });
    // A quiet scope arriving later still gets its share.
    const quiet = [await ask('company:2'), await ask('company:2'), await ask('company:2'), await ask('company:2')];
    assert.deepEqual(quiet.map((v) => v.ok), [true, true, true, false]);
    assert.deepEqual(quiet[3], { ok: false, reason: 'model_full', retryAfterSec: 45 });
    // The model's minute is full for everyone, newcomers included.
    assert.equal((await ask('project:9')).ok, false);
    // The next minute is a fresh budget.
    assert.equal((await ask('project:1', new Date(AT.getTime() + 60_000))).ok, true);
    // Another model, unnamed and with no "*", is not limited and not counted.
    assert.deepEqual(await admitModelStart(w.env, budgets, '@cf/other/model', 'project:1', AT), { ok: true, counted: false });
    const total = w.db.prepare('SELECT SUM(n) AS n FROM agent_model_admissions WHERE model = ? AND minute = ?').get(MODEL, minuteOf(AT)) as any;
    assert.equal(total.n, 6);
  } finally { w.close(); }
});

test('a throttled message is sent again for the next minute and acked, never retried; metrics carry only allowed labels', async () => {
  const w = world();
  try {
    const uids = await admittedRuns(w, 3);
    w.env.AGENT_MODEL_RPM = JSON.stringify({ [MODEL]: 2 });
    const sent: Array<{ body: any; opts: any }> = [];
    w.env.AGENT_QUEUE = { async send(body: unknown, opts: unknown) { sent.push({ body, opts }); } };
    const started: string[] = [];
    const one = batchOf('studioos-agent-queue', uids.map(msgOf));
    await agentQueueConsumer(one.batch, w.env, {} as any, async (_e, r) => { started.push(r.uid); }, { now: () => AT });
    // Limit 2, one scope: its share is ceil(2 / 2) = 1, so one starts and two are throttled.
    assert.equal(started.length, 1);
    assert.deepEqual(one.acks, ['ack:0', 'ack:1', 'ack:2']);
    assert.equal(sent.length, 2);
    assert.ok(sent.every((s) => s.opts.delaySeconds === 45 && uids.includes(s.body.payload.run_uid)));
    const throttled = metricRows(w, 'agent_dispatch_throttled');
    assert.deepEqual(throttled.map((r) => [r.value, JSON.parse(r.labels)]), [[2, { model: MODEL, reason: 'scope_share' }]]);
    const names = new Set(metricRows(w, 'agent_dispatch_%').map((r) => r.metric_name));
    for (const n of ['agent_dispatch_started', 'agent_dispatch_admitted_to_started_seconds', 'agent_dispatch_queue_age_seconds']) assert.ok(names.has(n), n);
    assert.equal(metricRows(w, 'agent_dispatch_queue_age_seconds')[0].value, 40);
    for (const r of metricRows(w, 'agent_dispatch_%')) {
      const keys = Object.keys(JSON.parse(r.labels));
      assert.ok(keys.every((k) => (DISPATCH_LABEL_KEYS as readonly string[]).includes(k)), `${r.metric_name}: ${r.labels}`);
      for (const uid of uids) assert.ok(!r.labels.includes(uid));
      assert.ok(!/(project|company):[0-9]|user|task|run_uid/.test(r.labels), r.labels);
    }
    // A failed resend falls back to a retry with the same delay.
    w.env.AGENT_QUEUE = { async send() { throw new Error('queue down'); } };
    const two = batchOf('studioos-agent-queue', [msgOf(uids.find((u) => !started.includes(u))!)]);
    await agentQueueConsumer(two.batch, w.env, {} as any, async () => {}, { now: () => AT });
    assert.deepEqual(two.acks, ['retry:0:45']);
  } finally { w.close(); }
});

test('with the knob unset nothing is counted and every admitted run starts', async () => {
  const w = world();
  try {
    const uids = await admittedRuns(w, 3);
    const started: string[] = [];
    const one = batchOf('studioos-agent-queue', uids.map(msgOf));
    await agentQueueConsumer(one.batch, w.env, {} as any, async (_e, r) => { started.push(r.uid); }, { now: () => AT });
    assert.equal(started.length, 3);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_model_admissions').get() as any).n, 0);
    assert.equal(metricRows(w, 'agent_dispatch_throttled').length, 0);
  } finally { w.close(); }
});

test('the sweep records the oldest ready task beside the oldest pending decision, and prunes old buckets', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT); w.agent(51, 'cto'); w.task(201, 51);
    w.db.prepare("UPDATE scope_tasks SET created_at = '2026-11-17 09:00:00' WHERE id = 200").run();
    const a = await w.runtime.admit(P, { agentId: 51, taskId: 201, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    w.db.prepare("UPDATE agent_task_runs SET status = 'waiting_decision', updated_at = '2026-11-17 08:00:00' WHERE uid = ?").run(a.run.uid);
    w.db.prepare('INSERT INTO agent_model_admissions (model, minute, scope_key, n) VALUES (?, ?, ?, 1), (?, ?, ?, 1)')
      .run(MODEL, minuteOf(AT) - MODEL_BUDGET_KEEP_MINUTES - 1, 'project:7', MODEL, minuteOf(AT), 'project:7');
    await sweepAgents(w.env, AT, { enqueue: async () => {}, runtime: async () => w.runtime });
    assert.equal(metricRows(w, 'agent_oldest_ready_task_age_seconds')[0].value, 3600 + 15);
    assert.equal(metricRows(w, 'agent_oldest_pending_decision_age_seconds')[0].value, 7200 + 15);
    for (const r of metricRows(w, 'agent_oldest_%')) assert.deepEqual(Object.keys(JSON.parse(r.labels)).sort(), ['cadence_minutes', 'cursor_reset', 'scanned']);
    assert.deepEqual((w.db.prepare('SELECT minute FROM agent_model_admissions').all() as any[]).map((r) => r.minute), [minuteOf(AT)]);
  } finally { w.close(); }
});

test('deferred to #5573 and #7074: the queue sizing and the sweep bounds are unchanged', () => {
  assert.deepEqual([SWEEP_MAX, DISCOVERY_SCAN_MAX, DISCOVERY_PER_SCOPE_MAX], [60, 120, 4]);
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const consumers = [...toml.matchAll(/queue\s*=\s*"studioos-agent-queue(?:-preview)?"\n((?:\w+\s*=\s*[^\n]+\n)+)/g)].map((m) => m[1]);
  assert.equal(consumers.length, 3, 'top level, production and preview');
  for (const c of consumers) {
    assert.match(c, /max_batch_size\s*=\s*5\n/);
    assert.match(c, /max_concurrency\s*=\s*10\n/);
    assert.match(c, /max_retries\s*=\s*3\n/);
  }
  assert.doesNotMatch(toml, /AGENT_MODEL_RPM/, 'the budget is off until an operator sets it');
});

test('a dispatch label outside the allowed keys never reaches a metric row', () => {
  assert.deepEqual([...DISPATCH_LABEL_KEYS], ['model', 'reason']);
  assert.deepEqual(dispatchLabels({ model: MODEL, reason: 'model_full', scope: 'project:7', run_uid: 'x' } as any), { model: MODEL, reason: 'model_full' });
  assert.deepEqual(dispatchLabels(undefined), {});
});
