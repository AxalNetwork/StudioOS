/**
 * D1502 part 2 (#3753, deck v2 A3a) — the DeckGenRoom, the AiGovernor, the
 * step executor, the routes, the rate bucket and the bindings.
 *
 *   1. The governor's caps are throttles: image 3, text 6, vision 4 at once per
 *      account, two runs per account, a bucket per model; a released or expired
 *      lease frees its slot. A 40-step run is never refused for its size.
 *   2. A busy model (429 or 3040) backs off with jitter and retries, then falls
 *      back within the same tier and says so; a guard refusal does neither.
 *   3. The room drives a run from its alarm, survives a restart (rebuild first,
 *      nothing repeated) and streams a snapshot then each event.
 *   4. The routes: the deck's readers read a run, a stranger gets 404, only its
 *      starter stops it, and Stop without a room still settles in D1.
 *   5. `deck_generate`: 6 a minute and 20 an hour per member, failing closed.
 *   6. All three wrangler tables bind both classes under the v4-deck-gen tag.
 * The contract suite (`deck_gen_runtime_contract.test.ts`) runs DeckGenRoom too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  ACCOUNT_RUNS, BACKOFF_MAX_MS, Governor, KIND_CAPS, LEASE_TTL_MS, MAX_BUSY_RETRIES, backoffMs, capKindOf, isBusy,
} from '../src/services/decks/aiGovernor.ts';
import { candidatesFor, stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { ELEMENT_ROUTES } from '../src/services/decks/elementModels.ts';
import { D1GenRuntime, stepRecordRef, type PlanLine, type StepRow } from '../src/services/decks/genRuntime.ts';
import { DeckGenRoom } from '../src/durable-objects/deck-gen-room.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import deckBatches from '../src/routes/deck_batches.ts';
import { DECK_GENERATE, rateLimitMiddleware } from '../src/middleware/rateLimit.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { loadSchema } from './_schema_once.mjs';

const BATCH_SCHEMA = JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS.batch.schema}`, 'utf8'));

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1. the governor: per-kind caps, two runs per account and a bucket per model are throttles, and leases free their slots', () => {
  // Mutation checked: the kind cap read as a run ceiling (refusing the 4th image of a NEW run) → the second account assertion fails.
  const g = new Governor();
  const t0 = 1_000_000;
  const img = Array.from({ length: KIND_CAPS.image }, (_, i) => g.acquire({ account: 1, run: 'r1', kind: 'image', model: `@cf/img/${i}` }, t0));
  assert.ok(img.every((a) => a.ok));
  const fourth = g.acquire({ account: 1, run: 'r1', kind: 'draw', model: '@cf/img/9' }, t0);
  assert.deepEqual(fourth.ok ? null : fourth.reason, 'kind_cap', 'a draw is an image');
  assert.ok(g.acquire({ account: 2, run: 'x', kind: 'image', model: '@cf/img/9' }, t0).ok, 'another account has its own slots');
  // Text 6, vision 4.
  for (let i = 0; i < KIND_CAPS.text; i++) assert.ok(g.acquire({ account: 3, run: 'r', kind: i % 2 ? 'guard' : 'text', model: `@cf/t/${i}` }, t0).ok);
  assert.equal(g.acquire({ account: 3, run: 'r', kind: 'critique', model: '@cf/t/x' }, t0).ok, false, 'guards and critiques count as text');
  for (let i = 0; i < KIND_CAPS.vision; i++) assert.ok(g.acquire({ account: 4, run: 'r', kind: 'screen', model: `@cf/v/${i}` }, t0).ok);
  assert.equal(g.acquire({ account: 4, run: 'r', kind: 'vision', model: '@cf/v/x' }, t0).ok, false);
  // Two runs per account; a third waits until one frees.
  const a = g.acquire({ account: 5, run: 'A', kind: 'text', model: null }, t0);
  assert.ok(a.ok && g.acquire({ account: 5, run: 'B', kind: 'text', model: null }, t0).ok);
  const c = g.acquire({ account: 5, run: 'C', kind: 'text', model: null }, t0);
  assert.deepEqual(c.ok ? null : c.reason, 'account_runs');
  assert.equal(ACCOUNT_RUNS, 2);
  if (a.ok) g.release(a.lease.id);
  assert.ok(g.acquire({ account: 5, run: 'C', kind: 'text', model: null }, t0).ok, 'a released lease frees its run slot');
  // A lease nobody releases expires.
  assert.ok(g.acquire({ account: 1, run: 'r1', kind: 'image', model: '@cf/img/8' }, t0 + LEASE_TTL_MS + 1).ok);
  // The bucket: 20 runs of one model, then a wait that the refill ends.
  const b = new Governor();
  for (let i = 0; i < 20; i++) { const x = b.acquire({ account: 6, run: 'r', kind: 'text', model: '@cf/m' }, t0); assert.ok(x.ok); if (x.ok) b.release(x.lease.id); }
  const empty = b.acquire({ account: 6, run: 'r', kind: 'text', model: '@cf/m' }, t0);
  assert.ok(!empty.ok && empty.reason === 'model_bucket' && empty.wait_ms > 0);
  assert.ok(b.acquire({ account: 6, run: 'r', kind: 'text', model: '@cf/m' }, t0 + 3_100).ok, 'refilled');
  assert.deepEqual([capKindOf('edit_image'), capKindOf('guard'), capKindOf('screen')], ['image', 'text', 'vision']);
});

// ── 2 ────────────────────────────────────────────────────────────────────────
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, P = 1, DECK = 1;

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', '[]');
  return db;
}
const free = (n: number, extra: Partial<PlanLine> = {}): PlanLine[] =>
  Array.from({ length: n }, (_, i) => ({ card_uid: `c${i + 1}`, area_id: `a${i + 1}`, element: 'body', kind: 'text', task: null, model: null, quote_microusd: 0, ...extra }));

function stepOf(over: Partial<StepRow>): StepRow {
  return {
    batch_uid: '00000000-0000-4000-8000-000000000001', seq: 0, card_uid: 'c1', area_id: 'a1', element: 'body', kind: 'text', task: 'rail_write',
    model: null, state: 'running', quote_microusd: 1000, charged_microusd: 0, model_used: null, fallback_used: 0, usage_log_id: null,
    error_code: null, started_at: null, ended_at: null, input: JSON.stringify({ text: 'synthetic brief' }), result: null, ...over,
  };
}

test('2. a busy model backs off with jitter and retries, then falls back in the same tier; a guard refusal does neither', async () => {
  // Mutation checked: no backoff (retrying at once) → the sleeps differ; falling back on guard_blocked → the third case calls twice.
  const el = Object.entries(ELEMENT_ROUTES).find(([, r]) => r.chain.length >= 1 && r.kind === 'write')![0];
  const route = ELEMENT_ROUTES[el];
  const primary = '@cf/synthetic/primary';
  assert.deepEqual(candidatesFor({ model: primary, element: el, kind: 'text' }), [primary, ...route.chain.filter((m) => m !== primary)]);
  assert.deepEqual(candidatesFor({ model: null, element: 'no-such-element', kind: 'text' }), [undefined]);
  for (const r of [0, 0.5, 1]) for (let a = 0; a < 8; a++) {
    const ms = backoffMs(a, () => r);
    const full = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** a);
    assert.ok(ms >= full / 2 && ms <= full, `${a}/${r}: ${ms}`);
  }
  assert.deepEqual([isBusy({ status: 429 }), isBusy({ status: 500, code: 3040 }), isBusy({ status: 500, code: 5007 }), isBusy(null)], [true, true, false, false]);

  const db = world();
  try {
    const env: any = { DB: d1Over(db) };
    const calls: Array<string | undefined> = [];
    const sleeps: number[] = [];
    const busy: number[] = [];
    const g = new Governor();
    const governor = { acquire: async (i: any) => g.acquire(i), release: async (id: string) => { g.release(id); } };
    const run = async (_env: any, opts: any) => {
      calls.push(opts.model);
      assert.equal(opts.rail.record, stepRecordRef('00000000-0000-4000-8000-000000000001', 0));
      assert.deepEqual(opts.parentHold, { uid: 'hold-1', userId: FOUNDER });
      assert.equal(opts.text, 'synthetic brief');
      if (opts.model === primary) return { ok: false, refusal: 'all_models_failed', usage: {}, attempts: [{ model: primary, ok: false, called: true, status: 429 }] };
      return { ok: true, output: 'the area, rewritten', usage: { model: opts.model, fallback_used: false }, usageLogId: 7 };
    };
    const x = stepExecutor(env, { run: run as any, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, governor, onBusy: (_s, attempt) => { busy.push(attempt); } });
    const ctx: any = { batch: { created_by: FOUNDER, uid: 'r' }, parentHold: { uid: 'hold-1', userId: FOUNDER } };
    const r = await x(stepOf({ model: primary, element: el }), ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [primary, primary, primary, route.chain.find((m) => m !== primary)], 'retried twice, then the same tier');
    assert.equal(MAX_BUSY_RETRIES, 2);
    assert.deepEqual(sleeps, [backoffMs(0, () => 0.5), backoffMs(1, () => 0.5)]);
    assert.deepEqual(busy, [1, 2], '"Busy, retrying" twice');
    assert.deepEqual([r.fallback_used, r.model_used, r.variant], [true, route.chain.find((m) => m !== primary), { text: 'the area, rewritten' }]);
    assert.deepEqual(g.held(FOUNDER), { runs: 0, image: 0, text: 0, vision: 0 }, 'the lease is released');

    // A guard block is not the model's: no retry, no fallback.
    calls.length = 0;
    const blocked = stepExecutor(env, { run: (async (_e: any, o: any) => { calls.push(o.model); return { ok: false, refusal: 'guard_blocked', usage: {}, attempts: [] }; }) as any, sleep: async () => {}, governor });
    const rb = await blocked(stepOf({ model: primary, element: el }), ctx);
    assert.deepEqual([rb.ok, rb.error_code, calls.length], [false, 'guard_blocked', 1]);
    // A step with no task runs no model and is free.
    assert.deepEqual(await blocked(stepOf({ task: null }), ctx), { ok: true, charged_microusd: 0, model_used: null });
  } finally { db.close(); }
});

// ── 3 ────────────────────────────────────────────────────────────────────────
function roomState() {
  const store = new Map<string, unknown>();
  const state: any = { alarm: null as number | null };
  state.storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, setAlarm: async (t: number) => { state.alarm = t; } };
  return state;
}
async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await res.text();
  return text.trim().split('\n\n').filter(Boolean).map((block) => {
    const ev = /^event: (.+)$/m.exec(block)![1];
    return { event: ev, data: JSON.parse(/^data: (.+)$/m.exec(block)![1]) };
  });
}

test('3. the room drives a run from its alarm, survives a restart without repeating a step, and streams a snapshot then each event', async () => {
  // Mutation checked: alarm() without the first rebuild → the restarted room never runs the step left `running`.
  const db = world();
  try {
    const env: any = { DB: d1Over(db) };
    const state = roomState();
    const room = new DeckGenRoom(state, env);
    const ran: number[] = [];
    room.useExecutor(async (s) => { ran.push(s.seq); return { ok: true, charged_microusd: 0, variant: { text: `v${s.seq}` } }; });
    const res = await room.fetch(new Request('https://deck-gen-room/admit', {
      method: 'POST', headers: { 'x-deck-user': String(FOUNDER) },
      body: JSON.stringify({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'deck_build', idemKey: 'key-room-0001', lines: free(40) }),
    }));
    const a = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(a));
    assert.ok(state.alarm !== null, 'admission arms the alarm');
    // Another member cannot admit as the founder.
    const spoof = await room.fetch(new Request('https://deck-gen-room/admit', { method: 'POST', headers: { 'x-deck-user': String(OTHER) }, body: JSON.stringify({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'key-room-0002', lines: free(1) }) }));
    assert.equal(spoof.status, 403);
    // A crash: step 3 was claimed and never charged; step 4 charged before the driver died.
    db.exec(`UPDATE deck_area_batch_steps SET state = 'running' WHERE batch_uid = '${a.uid}' AND seq IN (3, 4)`);
    db.exec(`UPDATE deck_area_batches SET state = 'running', reservation_uid = 'hold-x' WHERE uid = '${a.uid}'`);
    db.prepare("INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, status, expires_at) VALUES ('hold-x', ?, '2026-11-02', '2026-11', 0, 0, 'pending', '2099-01-01T00:00:00Z')").run(FOUNDER);
    db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, 'rail_write', 'm', 0, 'hold-x', ?)").run(FOUNDER, stepRecordRef(a.uid, 4));
    const fresh = new DeckGenRoom(state, env); // the restarted instance
    const ran2: number[] = [];
    fresh.useExecutor(async (s) => { ran2.push(s.seq); return { ok: true, charged_microusd: 0, variant: { text: `v${s.seq}` } }; });
    await fresh.alarm();
    assert.ok(ran2.includes(3), 'the uncharged step runs');
    assert.equal(ran2.includes(4), false, 'the charged step is not repeated');
    assert.equal(new Set(ran2).size, ran2.length, 'no step twice, with six drivers');
    assert.equal(ran2.length, 39, 'a 40-area deck_build run is admitted whole and driven to the end');
    const st = (await fresh.status(a.uid))!;
    assert.equal(st.state, 'done');
    // The stream: the snapshot of an ended run, then the events this room saw.
    const events = await readSse(await fresh.fetch(new Request(`https://deck-gen-room/events?uid=${a.uid}`, { headers: { 'x-deck-user': String(FOUNDER) } })));
    assert.equal(events[0].event, 'snapshot');
    assert.equal(events[0].data.state, 'done');
    assert.deepEqual(events.slice(1).map((e) => e.event).filter((e, i, l) => l.indexOf(e) === i), ['area_started', 'step_done', 'variant_ready', 'batch_done']);
    assert.equal(events.filter((e) => e.event === 'batch_done').length, 1, 'six drivers, one batch_done');
    assert.deepEqual([admitStatus('deck_busy'), admitStatus('budget_user_day'), admitStatus('ai_paused'), admitStatus('plan_too_large')], [409, 402, 503, 400]);
  } finally { db.close(); }
});

// ── 4 ────────────────────────────────────────────────────────────────────────
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
async function call(db: DatabaseSync, who: number, method: string, path: string, extra: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', deckBatches);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { method, headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('4. the routes: the deck reads a run, a stranger gets 404, only its starter stops it, and Stop without a room settles in D1', async () => {
  const db = world();
  try {
    const rt = new D1GenRuntime({ DB: d1Over(db) } as any, async () => ({ ok: true, charged_microusd: 0, variant: { text: 'x' } }));
    const a = await rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'key-route-0001', lines: free(3, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', input: { text: 'private brief' } }) });
    if (!a.ok) return assert.fail(JSON.stringify(a));
    const own = await call(db, FOUNDER, 'GET', `/api/decks/areas/batches/${a.uid}`);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual([own.body.state, own.body.counts.waiting, own.body.held_microusd, own.body.charged_microusd], ['queued', 3, 0, 0]);
    assert.deepEqual(own.body.steps[0], { seq: 0, card_uid: 'c1', area_id: 'a1', element: 'body', kind: 'text', role: 'variant', model_label: 'llama-3.3-70b-instruct-fp8-fast', state: 'waiting', seconds: null, cost_microusd: 0, fallback_used: false, error_code: null, result: null });
    assert.equal(JSON.stringify(own.body).includes('private brief'), false, 'the step request stays in D1');
    assert.deepEqual(contractErrors(BATCH_SCHEMA, own.body), [], 'GET answers its D1511 contract');
    const stranger = await call(db, OTHER, 'GET', `/api/decks/areas/batches/${a.uid}`);
    assert.equal(stranger.status, 404);
    assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/areas/batches/00000000-0000-4000-8000-000000000000')).status, 404);
    const live = await call(db, FOUNDER, 'GET', `/api/decks/areas/batches/${a.uid}/events`);
    assert.deepEqual([live.status, live.body.error], [503, 'runtime_unavailable'], 'no room, no stream; the read still works');
    assert.equal((await call(db, OTHER, 'POST', `/api/decks/areas/batches/${a.uid}/cancel`)).status, 404, 'a stranger cannot even see it');
    // A co-founder reads the run and follows it, but only its starter stops it.
    db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${OTHER}, 'cofounder', 'accepted')`);
    assert.equal((await call(db, OTHER, 'GET', `/api/decks/areas/batches/${a.uid}`)).status, 200);
    const notYours = await call(db, OTHER, 'POST', `/api/decks/areas/batches/${a.uid}/cancel`);
    assert.deepEqual([notYours.status, notYours.body.error], [403, 'not_your_run']);
    const stop = await call(db, FOUNDER, 'POST', `/api/decks/areas/batches/${a.uid}/cancel`);
    assert.deepEqual([stop.status, stop.body.state, stop.body.counts.stopped], [200, 'cancelled', 3]);
    assert.deepEqual(contractErrors(BATCH_SCHEMA, stop.body), [], 'Stop answers the same contract');
    assert.equal(CONTRACTS.cancelBatch.schema, CONTRACTS.batch.schema);
  } finally { db.close(); }
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test('5. deck_generate: 6 a minute and 20 an hour per member, on the run-starting paths only, failing closed', async () => {
  // Mutation checked: failClosed false on both buckets → the outage request is let through (200).
  for (const p of ['/api/decks/7/areas/generate', '/api/decks/areas/batches', '/api/decks/7/build']) assert.ok(DECK_GENERATE.test(p), p);
  for (const p of ['/api/decks/areas/batches/00000000-0000-4000-8000-000000000000/cancel', '/api/decks/7/grid', '/api/decks/generate']) assert.equal(DECK_GENERATE.test(p), false, p);
  const previousNow = Date.now; const instant = Date.UTC(2026, 10, 2, 10, 0, 5); Date.now = () => instant;
  try {
    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('currentUser', { id: FOUNDER, role: 'founder' }); await next(); });
    app.use('/api/*', rateLimitMiddleware());
    let handled = 0;
    app.post('/api/*', (c) => { handled++; return c.json({ ok: true }); });
    const counts = new Map<string, string>();
    const e: any = { RATE_LIMITS: { get: async (k: string) => counts.get(k), put: async (k: string, v: string) => { counts.set(k, v); } }, DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
    const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await app.request('/api/decks/7/areas/generate', { method: 'POST' }, e, ctx)).status);
    assert.deepEqual([statuses.slice(0, 6), statuses[6], handled], [Array(6).fill(200), 429, 6]);
    assert.ok([...counts.keys()].some((k) => k.includes(':deck_generate_hour:')), 'the hour is counted too');
    e.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
    assert.equal((await app.request('/api/decks/8/areas/generate', { method: 'POST' }, e, ctx)).status, 503);
  } finally { Date.now = previousNow; }
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test('6. all three wrangler tables bind DeckGenRoom and AiGovernor under one new migration tag, and index.ts exports both', () => {
  // Mutation checked: dropping the preview binding → the count is 2.
  const toml = readFileSync('wrangler.toml', 'utf8');
  for (const [name, cls] of [['DECK_GEN_ROOM', 'DeckGenRoom'], ['AI_GOVERNOR', 'AiGovernor']]) {
    const re = new RegExp(`\\[\\[(?:env\\.(?:production|preview)\\.)?durable_objects\\.bindings\\]\\]\\s*\\nname\\s*=\\s*"${name}"\\s*\\nclass_name\\s*=\\s*"${cls}"`, 'g');
    assert.equal(toml.match(re)?.length, 3, name);
  }
  const tags = [...toml.matchAll(/\[\[(env\.(?:production|preview)\.)?migrations\]\]\s*\ntag\s*=\s*"v4-deck-gen"\s*\nnew_sqlite_classes\s*=\s*\["DeckGenRoom", "AiGovernor"\]/g)].map((m) => m[1] ?? 'top');
  assert.deepEqual(tags, ['top', 'env.production.', 'env.preview.']);
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /export \{ DeckGenRoom \} from '\.\/durable-objects\/deck-gen-room';/);
  assert.match(index, /export \{ AiGovernor \} from '\.\/durable-objects\/ai-governor';/);
});


