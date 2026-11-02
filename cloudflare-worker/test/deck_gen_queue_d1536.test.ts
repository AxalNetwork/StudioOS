/**
 * D1536 (#3785, deck v2 B9) — the Queue fallback of the deck generation runtime.
 *
 *   1. Only a batch of more than 18 variants goes through the queue, and only
 *      while `DECK_GEN_RUNTIME` is "queue" and `JOB_QUEUE` is bound.
 *   2. A 30-variant batch completes through the queue, over several messages,
 *      under one hold and one quote, emitting the DO batch's events.
 *   3. A delivery that died after a step charged is retried, rebuilt from D1 and
 *      resumed: every step runs once and the run is charged once.
 *   4. The events reach the deck room's existing SSE stream; the room never
 *      drives (or rebuilds) a run the queue drives.
 *   5. A message whose retries are spent ends its run and settles what ran.
 *   6. The job queue consumer routes `deck_gen_batch` before its dedup.
 *   7. wrangler.toml: `DECK_GEN_RUNTIME` in all three vars tables; the job queue reused.
 * The contract suite (`deck_gen_runtime_contract.test.ts`) runs QueueGenRuntime too.
 * Every model call is a stub; nothing reaches a real host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { stepRecordRef, type GenEvent, type PlanLine, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { QUEUE_ABOVE_VARIANTS, admitDeckRun, relayToRoom, runtimeKind, variantCount } from '../src/services/decks/genRooms.ts';
import { DECK_GEN_JOB, QueueGenRuntime, consumeDeckGenMessage, endExhaustedRun } from '../src/services/decks/queueRuntime.ts';
import { DeckGenRoom } from '../src/durable-objects/deck-gen-room.ts';
import { parseToml } from '../../scripts/lib/branchConfig.mjs';

const M716 = readFileSync('cloudflare-worker/sql/migrations/716_deck_area_batches.sql', 'utf8');
const HOLD_COLUMNS = ['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map((n) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8')).join('\n');
const USER = 7, DECK = 50, P = 5;
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  const f = aiBudgetFixture();
  f.db.exec(HOLD_COLUMNS);
  f.db.exec(`CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER);
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (${DECK}, ${P}, 1, '[]', 'Synthetic', 1);`);
  f.db.exec(M716);
  setFixtureAllowance(f.db, 0);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(USER, 50_000_000);
  return f;
}
const plan = (n: number, kind = 'text'): PlanLine[] => Array.from({ length: n }, (_, i) => ({ card_uid: `c${i + 1}`, area_id: `a${i + 1}`, element: 'body', kind, task: 'rail_write', model: TEXT_MODEL, quote_microusd: 1000 }));
const balance = (db: any) => Number(db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').get(USER).balance_microusd);
const holds = (db: any) => Number(db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n);
const input = (lines: PlanLine[], key: string) => ({ deckId: DECK, projectId: P, userId: USER, cls: 'deck_build' as const, idemKey: key, lines });

/** Charges each step its line, writing the usage row a real step writes under the parent. */
function executorFor(db: any, opts: { fail?: Set<number>; tick?: () => void } = {}) {
  const calls: number[] = [];
  const execute: StepExecutor = async (step, ctx) => {
    calls.push(step.seq);
    opts.tick?.();
    if (opts.fail?.has(step.seq)) return { ok: false, charged_microusd: 0, error_code: 'model_failed' };
    const r = db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(USER, step.task ?? 'rail_write', step.model ?? 'none', step.quote_microusd, ctx.parentHold?.uid ?? null, stepRecordRef(step.batch_uid, step.seq));
    return { ok: true, charged_microusd: step.quote_microusd, model_used: step.model, usage_log_id: Number(r.lastInsertRowid), variant: { text: `area ${step.seq}` } };
  };
  return { calls, execute };
}

/** An in-memory job queue: `send` records, `drain` delivers until nothing is left, retrying a failed delivery. */
function memoryQueue() {
  const pending: Array<{ body: any; attempts: number }> = [];
  const sent: any[] = [];
  return {
    sent, pending,
    binding: { send: async (body: any) => { sent.push(body); pending.push({ body, attempts: 1 }); } },
    async drain(make: (env: any, uid: string) => Promise<QueueGenRuntime>, env: any, max = 200) {
      let deliveries = 0;
      while (pending.length && deliveries < max) {
        const m = pending.shift()!;
        deliveries++;
        const d = await consumeDeckGenMessage(env, m.body, m.attempts, make);
        if (d === 'retry') pending.push({ body: m.body, attempts: m.attempts + 1 });
      }
      return deliveries;
    },
  };
}

/** A clock the steps move, so a slice ends after a few steps and the run hands over to the next message. */
function fakeClock() {
  const real = Date.now;
  let t = real();
  Date.now = () => t;
  return { tick: () => { t += 1000; }, restore: () => { Date.now = real; } };
}

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1. only a batch of more than 18 variants goes through the queue, with the switch on and the queue bound', async () => {
  // Mutation checked: runtimeKind ignoring the threshold (every batch to the queue) → the 18-variant case fails.
  const q = { send: async () => {} };
  const on = { DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: q } as any;
  assert.equal(QUEUE_ABOVE_VARIANTS, 18);
  assert.equal(runtimeKind(on, plan(18)), 'do', '18 variants stay on the Durable Object');
  assert.equal(runtimeKind(on, plan(19)), 'queue', '19 go through the queue');
  const checks = [...plan(18), ...plan(10, 'guard'), ...plan(5, 'critique')];
  assert.equal(variantCount(checks), 18, 'checks and critiques are steps of a variant, not variants');
  assert.equal(runtimeKind(on, checks), 'do');
  assert.equal(runtimeKind(on, plan(19, 'image')), 'queue', 'an image is a variant');
  assert.equal(runtimeKind({ DECK_GEN_RUNTIME: 'do', JOB_QUEUE: q } as any, plan(40)), 'do', '"do" is the switch back');
  assert.equal(runtimeKind({ JOB_QUEUE: q } as any, plan(40)), 'do', 'unset is "do"');
  assert.equal(runtimeKind({ DECK_GEN_RUNTIME: 'queue' } as any, plan(40)), 'do', 'no queue bound, no queue');

  // admitDeckRun: 19 variants are admitted and enqueued without a room; 18 still need the room.
  const f = world();
  try {
    const mq = memoryQueue();
    const env: any = { DB: f.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const small = await admitDeckRun(env, input(plan(18), 'key-small-001'));
    assert.deepEqual([small.status, small.body.ok ? null : small.body.refusal], [503, 'runtime_unavailable'], '18 variants went to the (absent) room');
    const big = await admitDeckRun(env, input(plan(19), 'key-big-0001'));
    assert.equal(big.status, 200, JSON.stringify(big.body));
    assert.equal(mq.sent.length, 1);
    assert.deepEqual([mq.sent[0].job_type, mq.sent[0].payload.batch_uid], [DECK_GEN_JOB, (big.body as any).uid]);
    // A retried request is the same run: no second hold, no second message.
    const again = await admitDeckRun(env, input(plan(19), 'key-big-0001'));
    assert.ok(again.body.ok && again.body.replayed);
    assert.deepEqual([holds(f.db), mq.sent.length], [1, 1]);
  } finally { f.db.close(); }
});

test('1b. a run the queue cannot take is stopped and refused, and holds nothing', async () => {
  const f = world();
  try {
    const before = balance(f.db);
    const env: any = { DB: f.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: { send: async () => { throw new Error('down'); } } };
    const r = await admitDeckRun(env, input(plan(20), 'key-down-0001'));
    assert.deepEqual([r.status, r.body.ok ? null : r.body.refusal], [503, 'runtime_unavailable']);
    assert.equal(f.db.prepare("SELECT state FROM deck_area_batches").get().state, 'cancelled');
    assert.equal(f.db.prepare("SELECT status FROM ai_budget_reservations").get().status, 'refunded', 'the whole hold is given back');
    assert.equal(balance(f.db), before);
  } finally { f.db.close(); }
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('2. a 30-variant batch completes through the queue, over several messages, under one hold and one quote, with the DO events', async () => {
  // Mutation checked: the core emitting `step_complete` for `step_done` → the event counts fail.
  const f = world();
  const clock = fakeClock();
  try {
    const mq = memoryQueue();
    const env: any = { DB: f.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const before = balance(f.db);
    const a = await admitDeckRun(env, input(plan(30), 'key-thirty-01'));
    assert.ok(a.body.ok, JSON.stringify(a.body));
    if (!a.body.ok) return;
    assert.equal(a.body.quote_microusd, 30_000);
    const events: GenEvent[] = [];
    const x = executorFor(f.db, { fail: new Set([4]), tick: clock.tick });
    const make = async (e: any) => new QueueGenRuntime(e, { execute: x.execute, emit: (ev) => { events.push(ev); }, send: mq.binding.send, sliceMs: 5_000 });
    const deliveries = await mq.drain(make, env);
    assert.ok(deliveries > 1, `the run handed over between messages (${deliveries} deliveries)`);
    const st = f.db.prepare('SELECT * FROM deck_area_batches WHERE uid = ?').get(a.body.uid);
    assert.equal(st.state, 'done');
    const steps = f.db.prepare('SELECT state FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(a.body.uid).map((s: any) => s.state);
    assert.deepEqual(steps, Array.from({ length: 30 }, (_, i) => (i === 4 ? 'failed' : 'done')));
    assert.deepEqual([...x.calls].sort((p, q) => p - q), Array.from({ length: 30 }, (_, i) => i), 'each step ran once');
    const count = (t: string) => events.filter((e) => e.type === t).length;
    assert.deepEqual(['area_started', 'step_done', 'variant_ready', 'area_failed', 'batch_done'].map(count), [30, 29, 29, 1, 1]);
    assert.deepEqual(events.filter((e) => e.type === 'area_failed').map((e) => e.seq), [4]);
    assert.deepEqual(events.at(-1), { type: 'batch_done', batch_uid: a.body.uid, state: 'done', charged_microusd: 29_000, held_microusd: 30_000 });
    assert.equal(holds(f.db), 1, 'one hold for the whole run');
    assert.equal(f.db.prepare('SELECT status FROM ai_budget_reservations').get().status, 'settled');
    assert.equal(before - balance(f.db), 29_000, 'settled once, at what ran; the failed area charged nothing');
  } finally { clock.restore(); f.db.close(); }
});

// ── 3 ────────────────────────────────────────────────────────────────────────
/** D1 that fails once on the write that records step `seq` done: the delivery dies after the step charged. */
function failingOnce(DB: any, seq: number) {
  let armed = true;
  return {
    ...DB,
    batch: DB.batch.bind(DB),
    prepare(sql: string) {
      const st = DB.prepare(sql);
      if (!/SET state = \?3, charged_microusd = \?4/.test(sql)) return st;
      const bind = st.bind.bind(st);
      st.bind = (...args: any[]) => {
        const b = bind(...args);
        if (armed && args[1] === seq) { armed = false; b.run = async () => { throw new Error('worker died'); }; }
        return b;
      };
      return st;
    },
  };
}

test('3. a delivery that died after a step charged is retried, rebuilt and resumed: every step once, charged once', async () => {
  // Mutation checked: a retry resetting running steps to waiting instead of rebuilding → step 7 runs twice, this fails.
  const f = world();
  try {
    const mq = memoryQueue();
    const DB = failingOnce(f.DB, 7);
    const env: any = { DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const before = balance(f.db);
    const a = await admitDeckRun(env, input(plan(30), 'key-resume-01'));
    if (!a.body.ok) return assert.fail(JSON.stringify(a.body));
    const x = executorFor(f.db);
    const make = async (e: any) => new QueueGenRuntime(e, { execute: x.execute, send: mq.binding.send });
    const deliveries = await mq.drain(make, env);
    assert.ok(deliveries >= 2, 'the dead delivery was retried');
    assert.equal(f.db.prepare('SELECT state FROM deck_area_batches').get().state, 'done');
    assert.deepEqual([...x.calls].sort((p, q) => p - q), Array.from({ length: 30 }, (_, i) => i), 'no step ran twice');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get().n, 30, 'one usage row per step');
    assert.equal(holds(f.db), 1, 'no second hold on resume');
    assert.equal(before - balance(f.db), 30_000, 'charged once');
    assert.equal(f.db.prepare('SELECT charged_microusd FROM deck_area_batch_steps WHERE seq = 7').get().charged_microusd, 1000, 'the charge the dead delivery made is the step\'s');
  } finally { f.db.close(); }
});

// ── 4 ────────────────────────────────────────────────────────────────────────
function roomState() {
  const store = new Map<string, unknown>();
  const state: any = { alarm: null as number | null };
  state.storage = {
    get: async (k: string) => store.get(k),
    put: async (k: string, v: unknown) => { store.set(k, v); },
    setAlarm: async (t: number) => { state.alarm = t; },
  };
  state.blockConcurrencyWhile = async (fn: () => Promise<unknown>) => fn();
  return state;
}

test('4. the events reach the room\'s SSE stream, and the room never drives a run the queue drives', async () => {
  // Mutation checked: /relay refusing every event → the stream holds only the snapshot, this fails;
  // /cancel kicking a run that is not the room's → the alarm is set, this fails.
  const f = world();
  try {
    const mq = memoryQueue();
    const state = roomState();
    const env: any = { DB: f.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const room = new DeckGenRoom(state, env);
    env.DECK_GEN_ROOM = { idFromName: (n: string) => n, get: () => ({ fetch: (u: string, init?: RequestInit) => room.fetch(new Request(u, init)) }) };
    const a = await admitDeckRun(env, input(plan(19), 'key-stream-01'));
    if (!a.body.ok) return assert.fail(JSON.stringify(a.body));
    const res = await room.fetch(new Request(`https://deck-gen-room/events?uid=${a.body.uid}`, { headers: { 'x-deck-user': String(USER) } }));
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = res.text();
    const x = executorFor(f.db);
    const make = async (e: any) => new QueueGenRuntime(e, { execute: x.execute, emit: (ev) => relayToRoom(e, DECK, USER, ev), send: mq.binding.send });
    await mq.drain(make, env);
    const names = [...(await text).matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    assert.equal(names[0], 'snapshot');
    assert.equal(names[1], 'area_started');
    assert.deepEqual(['area_started', 'step_done', 'variant_ready', 'batch_done'].map((t) => names.filter((n) => n === t).length), [19, 19, 19, 1]);
    assert.equal(names.at(-1), 'batch_done', 'the stream closes on batch_done');
    assert.equal(state.alarm, null, 'the room drove nothing');
    const bad = await room.fetch(new Request('https://deck-gen-room/relay', { method: 'POST', headers: { 'x-deck-user': String(USER) }, body: JSON.stringify({ type: 'nonsense', batch_uid: 'x' }) }));
    assert.equal(bad.status, 400);
  } finally { f.db.close(); }
  // Stop on a queue run: the room stops it in D1 and arms no alarm of its own.
  const g = world();
  try {
    const mq = memoryQueue();
    const state = roomState();
    const env: any = { DB: g.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const room = new DeckGenRoom(state, env);
    const a = await admitDeckRun(env, input(plan(20), 'key-stop-0001'));
    if (!a.body.ok) return assert.fail(JSON.stringify(a.body));
    // A step is in flight in the queue's delivery when Stop is pressed.
    g.db.prepare("UPDATE deck_area_batches SET state = 'running' WHERE uid = ?").run(a.body.uid);
    g.db.prepare("UPDATE deck_area_batch_steps SET state = 'running' WHERE batch_uid = ? AND seq = 0").run(a.body.uid);
    const r = await room.fetch(new Request(`https://deck-gen-room/cancel?uid=${a.body.uid}`, { method: 'POST', headers: { 'x-deck-user': String(USER) } }));
    assert.equal((await r.json() as any).state, 'cancelling', 'the in-flight step lands first');
    assert.equal(state.alarm, null, 'the queue\'s delivery, not the room, finishes it');
  } finally { g.db.close(); }
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test('5. a message whose retries are spent ends its run: what ran is settled once, the rest released', async () => {
  const f = world();
  try {
    const mq = memoryQueue();
    const env: any = { DB: f.DB, DECK_GEN_RUNTIME: 'queue', JOB_QUEUE: mq.binding };
    const before = balance(f.db);
    const a = await admitDeckRun(env, input(plan(20), 'key-spent-001'));
    if (!a.body.ok) return assert.fail(JSON.stringify(a.body));
    // Two steps ran; a third was charged by a delivery that then died; the rest never started.
    f.db.prepare("UPDATE deck_area_batches SET state = 'running' WHERE uid = ?").run(a.body.uid);
    f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 1000 WHERE batch_uid = ? AND seq IN (0, 1)").run(a.body.uid);
    f.db.prepare("UPDATE deck_area_batch_steps SET state = 'running' WHERE batch_uid = ? AND seq IN (2, 3)").run(a.body.uid);
    f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(USER, 'rail_write', TEXT_MODEL, 1000, a.body.reservation_uid, stepRecordRef(a.body.uid, 2));
    assert.equal(await endExhaustedRun(env, mq.sent[0]), true);
    const run = f.db.prepare('SELECT state, charged_microusd FROM deck_area_batches').get();
    assert.deepEqual([run.state, run.charged_microusd], ['cancelled', 3000]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM deck_area_batch_steps WHERE state = 'stopped'").get().n, 17);
    assert.equal(before - balance(f.db), 3000);
    assert.equal(await endExhaustedRun(env, mq.sent[0]), false, 'an ended run is left alone');
    assert.equal(await endExhaustedRun(env, { job_type: 'other', payload: {} } as any), false);
  } finally { f.db.close(); }
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test('6. the job queue consumer routes deck_gen_batch before its dedup, and acks what names no run', async () => {
  const { queueConsumer } = await import('../src/queue-consumer.ts');
  const f = world(); // no job_idempotency table: a message that reached the dedup would throw
  try {
    const out: string[] = [];
    const msg = (body: any) => ({ body, attempts: 1, id: 'm', timestamp: new Date(), ack: () => out.push('ack'), retry: () => out.push('retry') });
    const env: any = { DB: f.DB };
    await queueConsumer({ queue: 'studioos-job-queue', messages: [msg({ job_type: DECK_GEN_JOB, payload: { batch_uid: '00000000-0000-4000-8000-000000000000' }, idempotency_key: 'deck-gen:x:0' })] } as any, env, {} as any);
    await queueConsumer({ queue: 'studioos-job-queue', messages: [msg({ job_type: DECK_GEN_JOB, payload: { batch_uid: 'not a uid' } })] } as any, env, {} as any);
    assert.deepEqual(out, ['ack', 'ack']);
    assert.equal(await consumeDeckGenMessage(env, { job_type: DECK_GEN_JOB, payload: {} } as any, 1), 'ack');
  } finally { f.db.close(); }
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test('7. wrangler.toml: DECK_GEN_RUNTIME in all three vars tables, the job queue reused, main unchanged', () => {
  const TOML = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const { sections } = parseToml(TOML);
  const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));
  for (const prefix of ['', 'env.production.', 'env.preview.']) {
    const vars = sections.find((s: any) => s.name === `${prefix}vars`);
    assert.equal(unq(vars?.kv.get('DECK_GEN_RUNTIME')), 'queue', `${prefix}vars`);
    const producers = sections.filter((s: any) => s.name === `${prefix}queues.producers`).map((s: any) => unq(s.kv.get('binding')));
    assert.ok(producers.includes('JOB_QUEUE'), `${prefix}: JOB_QUEUE is bound`);
  }
  assert.match(TOML, /^main = "cloudflare-worker\/src\/index\.ts"$/m);
});
