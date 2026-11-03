/**
 * D1536 (#3785, deck v2 B9) — the Queue fallback for deck generation, and the
 * weekly Workers AI catalogue drift check.
 *
 * The contract suite (`deck_gen_runtime_contract.test.ts`) holds
 * `QueueGenRuntime` to the room's ten rules. This file holds what is the
 * queue's own: which runtime takes a run, a 30-variant run driven slice by
 * slice through queue messages, the events a queue run streams from D1, and
 * the drift job (a fixture's drift alerts HQ once; no token skips quietly; a
 * failed read writes nothing).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { makeD1 } from './_d1_sqlite.mjs';
import { stepRecordRef, type BatchStatus, type PlanLine, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import {
  DECK_GEN_JOB, QUEUE_ABOVE, SLICE_MS, QueueGenRuntime, driveQueuedSlice, eventsBetween, eventsFromD1, runtimeFor, variantSteps,
} from '../src/services/decks/queueRuntime.ts';
import { admitDeckRun, cancelInRoom, eventsFromRoom } from '../src/services/decks/genRooms.ts';
import { diffCatalogue, readLiveModels, runCatalogueDrift, ALERT_TYPE } from '../src/services/ai/catalogueDrift.ts';

const MIG = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const SCHEMA = MIG('525_ai_reservation_idempotency.sql') + MIG('632_ai_hold_context.sql');
const USER = 7, DECK = 50, P = 5;
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  const f = aiBudgetFixture();
  f.db.exec(SCHEMA);
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (${DECK}, ${P}, 1, '[]', 'Synthetic', 1)`);
  f.db.exec(MIG('716_deck_area_batches.sql'));
  f.db.exec(MIG('202611022120_deck_batch_runtime.sql'));
  // D1600 (#3879): admission writes parent_batch_uid, which migration 752 adds.
  f.db.exec(MIG('752_deck_area_batches_seen.sql'));
  setFixtureAllowance(f.db, 0);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(USER, 50_000_000);
  return f;
}
const plan = (n: number): PlanLine[] => Array.from({ length: n }, (_, i) => ({ card_uid: `c${i + 1}`, area_id: `a${i + 1}`, element: 'body', kind: 'text', task: 'rail_write', model: TEXT_MODEL, quote_microusd: 1000 }));
const balance = (db: any) => Number((db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').get(USER) as any).balance_microusd);
const input = (lines: PlanLine[], key = 'key-queue-0001') => ({ deckId: DECK, projectId: P, userId: USER, cls: 'areas' as const, idemKey: key, lines });

/** A queue that keeps what was sent. */
function queue(opts: { fail?: boolean } = {}) {
  const sent: Array<{ body: any; opts: any }> = [];
  return { sent, send: async (body: any, o?: any) => { if (opts.fail) throw new Error('queue down'); sent.push({ body, opts: o }); } };
}

/** Each step charges its line and moves the test's clock a minute, so a five-minute slice ends mid-run. */
function executorFor(db: any, clock: { t: number }) {
  const calls: number[] = [];
  const execute: StepExecutor = async (step, ctx) => {
    calls.push(step.seq);
    clock.t += 60_000;
    const r = db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(USER, step.task ?? 'rail_write', step.model ?? 'none', step.quote_microusd, ctx.parentHold?.uid ?? null, stepRecordRef(step.batch_uid, step.seq));
    return { ok: true, charged_microusd: step.quote_microusd, model_used: step.model, usage_log_id: Number(r.lastInsertRowid), variant: { text: `area ${step.seq}` } };
  };
  return { calls, execute };
}

async function withClock<T>(clock: { t: number }, fn: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => clock.t;
  try { return await fn(); } finally { Date.now = real; }
}

// ---- which runtime takes a run ------------------------------------------------

test('routing: the room takes a run of up to 18 variants, the queue takes a larger one', () => {
  const both = { DECK_GEN_ROOM: {} as any, JOB_QUEUE: {} as any };
  assert.equal(QUEUE_ABOVE, 18);
  assert.equal(runtimeFor(both, plan(18)), 'do');
  assert.equal(runtimeFor(both, plan(19)), 'queue');
  // Guards and checks are not variants.
  const guarded = [...plan(18), { element: 'title', kind: 'guard', task: null, model: null, quote_microusd: 0 } as PlanLine];
  assert.equal(variantSteps(guarded), 18);
  assert.equal(runtimeFor(both, guarded), 'do');
  // An image is a variant.
  assert.equal(runtimeFor(both, [...plan(18), { element: 'photo', kind: 'image', task: 'deck_image', model: 'x', quote_microusd: 1 } as PlanLine]), 'queue');
});

test('routing: DECK_GEN_RUNTIME = "queue" sends every run to the queue; no room means the queue; neither means none', () => {
  assert.equal(runtimeFor({ DECK_GEN_RUNTIME: 'queue', DECK_GEN_ROOM: {} as any, JOB_QUEUE: {} as any }, plan(1)), 'queue');
  assert.equal(runtimeFor({ DECK_GEN_RUNTIME: 'do', DECK_GEN_ROOM: {} as any, JOB_QUEUE: {} as any }, plan(1)), 'do');
  assert.equal(runtimeFor({ JOB_QUEUE: {} as any }, plan(1)), 'queue');
  assert.equal(runtimeFor({ DECK_GEN_ROOM: {} as any }, plan(30)), 'do', 'no queue: the room takes even a large run');
  assert.equal(runtimeFor({}, plan(1)), null);
});

test('admitDeckRun: a large run is admitted on the queue, a small one goes to the room, and with neither it is a 503', async () => {
  const f = world();
  try {
    const q = queue();
    let roomCalls = 0;
    const room = { idFromName: (n: string) => n, get: () => ({ fetch: async () => { roomCalls += 1; return Response.json({ ok: true, uid: 'r', quote_microusd: 0, reservation_uid: null, replayed: false }); } }) };
    const env: any = { DB: f.DB, JOB_QUEUE: q, DECK_GEN_ROOM: room };
    const big = await admitDeckRun(env, input(plan(19)));
    assert.equal(big.status, 200);
    assert.ok(big.body.ok);
    if (!big.body.ok) return;
    assert.equal(roomCalls, 0);
    assert.equal((f.db.prepare('SELECT runtime FROM deck_area_batches WHERE uid = ?').get(big.body.uid) as any).runtime, 'queue');
    assert.deepEqual(q.sent.map((m) => m.body), [{ job_type: DECK_GEN_JOB, payload: { uid: big.body.uid, slice: 0 }, idempotency_key: `deckgen:${big.body.uid}:0` }]);
    // A queue run's Stop and events never go to a room.
    assert.equal(await cancelInRoom(env, DECK, big.body.uid, USER, 'queue'), null);
    const small = await admitDeckRun(env, input(plan(3), 'key-queue-0002'));
    assert.equal(small.status, 200);
    assert.equal(roomCalls, 1);
    const none = await admitDeckRun({ DB: f.DB } as any, input(plan(3), 'key-queue-0003'));
    assert.deepEqual([none.status, none.body.ok, (none.body as any).refusal], [503, false, 'runtime_unavailable']);
  } finally { f.db.close(); }
});

test('admit: a queue that will not take the first slice stops the run, so the hold comes back at once', async () => {
  const f = world();
  try {
    const before = balance(f.db);
    const rt = new QueueGenRuntime({ DB: f.DB, JOB_QUEUE: queue({ fail: true }) } as any, executorFor(f.db, { t: 0 }).execute);
    const a = await rt.admit(input(plan(20)));
    assert.deepEqual([a.ok, (a as any).refusal], [false, 'runtime_unavailable']);
    const row = f.db.prepare('SELECT state FROM deck_area_batches').get() as any;
    assert.equal(row.state, 'cancelled');
    assert.equal(balance(f.db), before, 'nothing charged, nothing held');
  } finally { f.db.close(); }
});

// ---- a 30-variant run through the queue ---------------------------------------

test('a 30-variant run is driven slice by slice through queue messages: every area once, one charge, then it stops sending', async () => {
  const f = world();
  const clock = { t: Date.parse('2026-11-02T10:00:00Z') };
  try {
    const q = queue();
    const env: any = { DB: f.DB, JOB_QUEUE: q };
    const x = executorFor(f.db, clock);
    const before = balance(f.db);
    const lines = plan(30);
    assert.equal(runtimeFor({ ...env, DECK_GEN_ROOM: {} }, lines), 'queue');
    const a = await withClock(clock, () => new QueueGenRuntime(env, x.execute).admit(input(lines)));
    assert.ok(a.ok);
    if (!a.ok) return;
    const slices: number[] = [];
    let guard = 0;
    while (q.sent.length && guard++ < 100) {
      const m = q.sent.shift()!;
      assert.equal(m.body.job_type, DECK_GEN_JOB);
      slices.push(m.body.payload.slice);
      // Each slice is a fresh consumer: a new runtime, rebuilt from D1.
      const out = await withClock(clock, () => driveQueuedSlice(env, m.body.payload, { runtime: new QueueGenRuntime(env, x.execute), now: () => clock.t }));
      if (out.next !== null) assert.equal(out.next, m.body.payload.slice + 1);
    }
    assert.ok(slices.length > 1, `the run took more than one slice (${slices.length})`);
    assert.deepEqual(slices, slices.map((_, i) => i), 'slices go 0, 1, 2, … each sent once');
    const st = f.db.prepare('SELECT state, charged_microusd FROM deck_area_batches WHERE uid = ?').get(a.uid) as any;
    assert.deepEqual([st.state, st.charged_microusd], ['done', 30_000]);
    assert.equal(new Set(x.calls).size, 30);
    assert.equal(x.calls.length, 30, 'no area ran twice');
    assert.equal(before - balance(f.db), 30_000, 'one charge per area, the rest released');
    assert.equal(q.sent.length, 0, 'a finished run sends no further slice');
  } finally { f.db.close(); }
});

test('driveQueuedSlice: a malformed uid or a finished run does nothing and sends nothing', async () => {
  const f = world();
  try {
    const q = queue();
    const env: any = { DB: f.DB, JOB_QUEUE: q };
    const untouched = { status: async () => { throw new Error('a malformed uid was read'); } } as any;
    assert.deepEqual(await driveQueuedSlice(env, { uid: "x' OR 1=1", slice: 0 }, { runtime: untouched }), { state: null, next: null });
    const rt = new QueueGenRuntime(env, executorFor(f.db, { t: 0 }).execute);
    const a = await rt.admit(input(plan(2)));
    assert.ok(a.ok);
    if (!a.ok) return;
    q.sent.length = 0;
    await rt.cancel(a.uid, USER);
    assert.deepEqual(await driveQueuedSlice(env, { uid: a.uid, slice: 3 }, { runtime: rt }), { state: 'cancelled', next: null });
    assert.equal(q.sent.length, 0);
  } finally { f.db.close(); }
});

test('driveQueuedSlice: a run that ends inside its slice sends no next slice', async () => {
  const f = world();
  try {
    const q = queue();
    const env: any = { DB: f.DB, JOB_QUEUE: q };
    const rt = new QueueGenRuntime(env, executorFor(f.db, { t: 0 }).execute);
    const a = await rt.admit(input(plan(2)));
    assert.ok(a.ok);
    if (!a.ok) return;
    q.sent.length = 0;
    assert.deepEqual(await driveQueuedSlice(env, { uid: a.uid, slice: 0 }, { runtime: rt }), { state: 'done', next: null });
    assert.equal(q.sent.length, 0);
  } finally { f.db.close(); }
});

test('driveQueuedSlice: a slice that died mid-step is rebuilt by the next, which runs that step once', async () => {
  const f = world();
  try {
    const env: any = { DB: f.DB, JOB_QUEUE: queue() };
    const x = executorFor(f.db, { t: 0 });
    const a = await new QueueGenRuntime(env, x.execute).admit(input(plan(2)));
    assert.ok(a.ok);
    if (!a.ok) return;
    // The consumer that took step 0 was killed before the step answered: no usage row, the step left running.
    f.db.prepare(`UPDATE deck_area_batch_steps SET state = 'running', started_at = datetime('now') WHERE batch_uid = ? AND seq = 0`).run(a.uid);
    f.db.prepare(`UPDATE deck_area_batches SET state = 'running' WHERE uid = ?`).run(a.uid);
    const out = await driveQueuedSlice(env, { uid: a.uid, slice: 1 }, { runtime: new QueueGenRuntime(env, x.execute) });
    assert.equal(out.state, 'done');
    assert.deepEqual([...x.calls].sort(), [0, 1]);
  } finally { f.db.close(); }
});

// ---- live progress from D1 ----------------------------------------------------

const step = (seq: number, state: string, extra: Record<string, unknown> = {}) => ({
  batch_uid: 'b', seq, card_uid: `c${seq}`, area_id: `a${seq}`, element: 'body', kind: 'text', task: 'rail_write', model: TEXT_MODEL,
  model_used: null, quote_microusd: 1000, charged_microusd: state === 'done' ? 1000 : 0, state, result: null,
  started_at: state === 'waiting' ? null : '2026-11-02 10:00:00', ended_at: state === 'done' || state === 'failed' ? '2026-11-02 10:00:03' : null, ...extra,
}) as any;
const status = (state: string, steps: any[]): BatchStatus => ({ uid: 'b', state, quote_microusd: 3000, charged_microusd: steps.reduce((n, s) => n + s.charged_microusd, 0), held_microusd: 3000, steps } as any);

test('eventsBetween: the room\'s events, each once, with the running charged-of-held', () => {
  const seen = new Map<number, string>();
  const e1 = eventsBetween(status('running', [step(0, 'running'), step(1, 'waiting'), step(2, 'waiting')]), seen);
  assert.deepEqual(e1.map((e) => e.type), ['area_started']);
  assert.equal((e1[0] as any).charged_microusd, 0);
  assert.equal((e1[0] as any).held_microusd, 3000);
  assert.equal(eventsBetween(status('running', [step(0, 'running'), step(1, 'waiting'), step(2, 'waiting')]), seen).length, 0, 'nothing changed, nothing sent');
  // A failed step keeps what it spent (400), and the run's charged-of-held counts it.
  const e2 = eventsBetween(status('running', [step(0, 'done', { result: '{"text":"v"}' }), step(1, 'failed', { charged_microusd: 400 }), step(2, 'waiting')]), seen);
  assert.deepEqual(e2.map((e) => [e.type, (e as any).seq]), [['step_done', 0], ['variant_ready', 0], ['area_started', 1], ['area_failed', 1]]);
  const done = e2[0] as any;
  assert.deepEqual([done.card_uid, done.element, done.seconds, done.cost_microusd, done.charged_microusd], ['c0', 'body', 3, 1000, 1400]);
  assert.deepEqual([(e2[2] as any).charged_microusd, (e2[3] as any).cost_microusd, (e2[3] as any).charged_microusd], [1000, 400, 1400], 'area_started leaves out its own charge');
  assert.deepEqual((e2[1] as any).variant, { text: 'v' });
  const e3 = eventsBetween(status('cancelled', [step(0, 'done'), step(1, 'failed'), step(2, 'stopped')]), seen);
  assert.deepEqual(e3.map((e) => e.type), ['batch_done'], 'a stopped step never started');
  assert.equal(eventsBetween(status('cancelled', [step(0, 'done'), step(1, 'failed'), step(2, 'stopped')]), seen).length, 0, 'batch_done once');
});

test('eventsFromD1 / eventsFromRoom: a queue run streams a snapshot, its steps and batch_done from D1', async () => {
  const f = world();
  const clock = { t: Date.parse('2026-11-02T10:00:00Z') };
  try {
    const env: any = { DB: f.DB, JOB_QUEUE: queue() };
    const x = executorFor(f.db, clock);
    const rt = new QueueGenRuntime(env, x.execute);
    const a = await rt.admit(input(plan(2)));
    assert.ok(a.ok);
    if (!a.ok) return;
    let polls = 0;
    // Each poll lets the run move one step.
    const res = eventsFromD1(env, a.uid, { pollMs: 1, sleep: async () => { polls += 1; await rt.startBatch(a.uid, {}); } });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    const types = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    assert.equal(types[0], 'snapshot');
    assert.deepEqual(types.filter((t) => t !== 'snapshot'), ['area_started', 'step_done', 'variant_ready', 'area_started', 'step_done', 'variant_ready', 'batch_done']);
    assert.ok(polls >= 1);
    // The route's helper sends a queue run here, never to a room.
    const viaRoute = await eventsFromRoom({ ...env, DECK_GEN_ROOM: { idFromName: () => { throw new Error('a queue run reached the room'); } } }, DECK, a.uid, USER, 'queue');
    assert.match(await viaRoute!.text(), /^event: snapshot/);
  } finally { f.db.close(); }
});

test('the consumer drives deck_gen_slice messages and the cron runs the drift job weekly on HQ', () => {
  const consumer = readFileSync('cloudflare-worker/src/queue-consumer.ts', 'utf8');
  assert.match(consumer, /body\.job_type === DECK_GEN_JOB\)[\s\S]{0,200}driveQueuedSlice\(env, body\.payload/);
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /hqCadences && now\.getUTCDay\(\) === 1 && now\.getUTCHours\(\) === 5 && now\.getUTCMinutes\(\) === 55\) \{[\s\S]{0,200}runCatalogueDrift/);
  const toml = readFileSync('wrangler.toml', 'utf8');
  assert.equal((toml.match(/^DECK_GEN_RUNTIME = "do"$/gm) ?? []).length, 3, 'one per environment');
  assert.ok(SLICE_MS <= 10 * 60_000);
});

// ---- the catalogue drift job ------------------------------------------------

const CATALOGUE = [
  { id: '@cf/a/kept', kind: 'Text Generation', status: 'ga' },
  { id: '@cf/a/gone', kind: 'Text Generation', status: 'ga' },
  { id: '@cf/a/retyped', kind: 'Text Embeddings', status: 'ga' },
  { id: '@cf/a/known-missing', kind: 'Text Generation', status: 'not_found' },
] as const;
const ACCOUNT = '0123456789abcdef0123456789abcdef';

function liveFetch(pages: any[][], opts: { status?: number; total?: number; calls?: string[] } = {}) {
  return (async (url: string) => {
    opts.calls?.push(String(url));
    if (opts.status) return new Response('{}', { status: opts.status });
    const page = Number(new URL(url).searchParams.get('page'));
    const rows = pages[page - 1] ?? [];
    return Response.json({ success: true, result: rows, result_info: { page, per_page: 100, count: rows.length, total_count: opts.total ?? pages.flat().length } });
  }) as unknown as typeof fetch;
}
const live = (id: string, task: string) => ({ id: `uuid-${id}`, name: id, task: { name: task } });
const LIVE = [live('@cf/a/kept', 'Text Generation'), live('@cf/a/retyped', 'Text Classification'), live('@cf/a/new', 'Translation')];

function driftDb() {
  return makeD1(MIG('202611022121_ai_catalogue_drift.sql'));
}
const rows = (db: any) => db.prepare('SELECT model_id, field, catalogue_value, live_value FROM ai_catalogue_drift ORDER BY model_id, field').all();

test('diffCatalogue: unlisted, unknown and retyped models; a model held as not_found is expected to be missing', () => {
  assert.deepEqual(diffCatalogue(CATALOGUE, LIVE.map((l) => ({ id: l.name, kind: l.task.name }))), [
    { model_id: '@cf/a/gone', field: 'listed', catalogue_value: 'listed', live_value: null },
    { model_id: '@cf/a/new', field: 'listed', catalogue_value: null, live_value: 'listed' },
    { model_id: '@cf/a/retyped', field: 'kind', catalogue_value: 'Text Embeddings', live_value: 'Text Classification' },
  ]);
});

test('drift job: a fixture\'s drift is recorded and alerts HQ once; a repeat is silent; a resolved row goes; a change alerts again', async () => {
  const { DB, db } = driftDb();
  const alerts: any[] = [];
  const deps = { catalogue: CATALOGUE, tellHq: (async (_env: any, n: any) => { alerts.push(n); return 1; }) as any };
  const env: any = { DB, CF_AI_CATALOGUE_TOKEN: 'synthetic-token', CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
  const calls: string[] = [];
  const r1 = await runCatalogueDrift(env, { ...deps, fetch: liveFetch([LIVE], { calls }) });
  assert.deepEqual(r1, { ran: true, live: 3, drift: 3, new_or_changed: 3, resolved: 0, told: 1 });
  assert.equal(calls[0], `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/models/search?per_page=100&page=1`);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, ALERT_TYPE);
  assert.match(alerts[0].title, /3 changes/);
  assert.match(alerts[0].body, /@cf\/a\/gone: no longer listed/);
  assert.match(alerts[0].body, /@cf\/a\/new: listed by Cloudflare, missing from the catalogue/);
  assert.match(alerts[0].body, /@cf\/a\/retyped: kind is "Text Classification" on Cloudflare, "Text Embeddings" here/);
  assert.equal(rows(db).length, 3);

  // The same drift next week: rows stay, no alert.
  const r2 = await runCatalogueDrift(env, { ...deps, fetch: liveFetch([LIVE]) });
  assert.deepEqual([r2.ran, (r2 as any).new_or_changed, (r2 as any).told], [true, 0, 0]);
  assert.equal(alerts.length, 1);
  assert.equal(rows(db).length, 3);

  // `gone` is back and `retyped` moved again: one row removed, one alert about the change only.
  const next = [...LIVE.slice(0, 1), live('@cf/a/gone', 'Text Generation'), live('@cf/a/retyped', 'Summarization'), LIVE[2]];
  const r3 = await runCatalogueDrift(env, { ...deps, fetch: liveFetch([next]) });
  assert.deepEqual([(r3 as any).new_or_changed, (r3 as any).resolved], [1, 1]);
  assert.equal(alerts.length, 2);
  assert.match(alerts[1].title, /1 change$/);
  assert.match(alerts[1].body, /Summarization/);
  assert.doesNotMatch(alerts[1].body, /@cf\/a\/new/);
  assert.deepEqual(rows(db).map((r: any) => `${r.model_id}:${r.field}:${r.live_value}`), ['@cf/a/new:listed:listed', '@cf/a/retyped:kind:Summarization']);
});

test('drift job: without the token it logs why and stops — no request, no row, no alert', async () => {
  const { DB, db } = driftDb();
  let fetched = 0, told = 0;
  const logs: string[] = [];
  const info = console.info;
  console.info = (...a: unknown[]) => { logs.push(a.join(' ')); };
  try {
    for (const env of [{ DB, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, { DB, CF_AI_CATALOGUE_TOKEN: '  ', CLOUDFLARE_ACCOUNT_ID: ACCOUNT }]) {
      const r = await runCatalogueDrift(env as any, { catalogue: CATALOGUE, fetch: (async () => { fetched += 1; return Response.json({}); }) as any, tellHq: (async () => { told += 1; return 1; }) as any });
      assert.deepEqual(r, { ran: false, reason: 'no_token' });
    }
    const r = await runCatalogueDrift({ DB, CF_AI_CATALOGUE_TOKEN: 't' } as any, { catalogue: CATALOGUE, fetch: (async () => { fetched += 1; return Response.json({}); }) as any });
    assert.deepEqual(r, { ran: false, reason: 'no_account' });
  } finally { console.info = info; }
  assert.deepEqual([fetched, told, rows(db).length], [0, 0, 0]);
  assert.ok(logs.some((l) => /skipped: CF_AI_CATALOGUE_TOKEN is not set/.test(l)), 'the reason is logged, naming the secret');
  assert.ok(!logs.some((l) => /synthetic|Bearer/.test(l)));
});

test('drift job: a failed or short read writes nothing and tells no one', async () => {
  const { DB, db } = driftDb();
  // A drift row from an earlier week must survive a bad read, not be "resolved" by it.
  db.prepare(`INSERT INTO ai_catalogue_drift (model_id, field, catalogue_value, live_value) VALUES ('@cf/a/new', 'listed', NULL, 'listed')`).run();
  let told = 0;
  const env: any = { DB, CF_AI_CATALOGUE_TOKEN: 'synthetic-token', CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const okBody = { success: true, result: LIVE, result_info: { total_count: 3 } };
    const cases: Array<[RegExp, typeof fetch]> = [
      [/HTTP 403/, (async () => Response.json(okBody, { status: 403 })) as any],
      [/short read: 3 of 250/, liveFetch([LIVE], { total: 250 })],
      [/no models listed/, liveFetch([[]])],
      [/network/, (async () => { throw new Error('offline'); }) as any],
      [/not JSON/, (async () => new Response('<html>', { status: 200 })) as any],
      [/unsuccessful/, (async () => Response.json({ ...okBody, success: false })) as any],
    ];
    for (const [detail, f] of cases) {
      const r = await runCatalogueDrift(env, { catalogue: CATALOGUE, fetch: f, tellHq: (async () => { told += 1; return 1; }) as any });
      assert.equal(r.ran, false, String(detail));
      assert.equal((r as any).reason, 'read_failed', String(detail));
      assert.match((r as any).detail, detail);
    }
  } finally { console.warn = warn; }
  assert.equal(told, 0);
  assert.deepEqual(rows(db).map((r: any) => r.model_id), ['@cf/a/new']);
});

test('readLiveModels: pages until the total, keeps only the name and task, and refuses an account id that is not one', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ ...live(`@cf/p/m${i}`, 'Text Generation'), description: 'ignored', properties: [{ property_id: 'x' }] }));
  const r = await readLiveModels({ CF_AI_CATALOGUE_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, liveFetch([page1, [live('@cf/p/last', 'Translation')]]));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.models.length, 101);
  assert.deepEqual(Object.keys(r.models[0]).sort(), ['id', 'kind']);
  const bad = await readLiveModels({ CF_AI_CATALOGUE_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: '../zones' }, liveFetch([LIVE]));
  assert.equal(bad.ok, false);
});
