/**
 * D1600 (#3879, deck v2) — retry a run's failed areas, the "finished while you
 * were away" notice and banner, and "Busy, retrying". The issue's table, one
 * test each (with the mutation each must catch), plus the access rules.
 *
 *   1. 6 areas, 4 done and 2 failed: Retry runs the 2 alone, as a child run, and
 *      charges their quote, against what is left of the first run's quote.
 *   2. The same Idempotency-Key twice: one child run, one charge.
 *   3. What is left of the first run's quote is under the retry's quote: 402
 *      `hold_exhausted` with the quote and what is left; nothing held or run.
 *   4. No failed area: 409 `nothing_to_retry`; a bad key or body: 400. A
 *      stopped retry leaves its areas failed; a retry of a retry links to the
 *      first run.
 *   5. `batch_done` with a stream attached: no notice.
 *   6. `batch_done` with none: exactly one notice, with no number in it.
 *   7. `seen`, then the banner: the run is gone.
 *   8. Another founder's run: 404 on retry, seen and the banner.
 *   9. `area_retrying` before each automatic retry; 3 retries, then `area_failed`;
 *      a retried step is charged once.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_batch_retry_d1600.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Governor } from '../src/services/decks/aiGovernor.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { D1GenRuntime, stepRecordRef, type GenEvent, type PlanLine, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { noticeBuildDone } from '../src/services/decks/batchFollowUp.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import { DeckGenRoom } from '../src/durable-objects/deck-gen-room.ts';
import deckBatches from '../src/routes/deck_batches.ts';
import { DECK_GENERATE } from '../src/middleware/rateLimit.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const FOUNDER = 10, OTHER = 20, COFOUNDER = 30, P = 1, DECK = 1, OTHER_P = 2, OTHER_DECK = 2;
const LINE = 1000;
const TEXT_MODEL = '@cf/synthetic/primary';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${OTHER_P}, 'Other venture', 1002)`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)');
  deck.run(DECK, P, 'Synthetic deck', '[]');
  deck.run(OTHER_DECK, OTHER_P, 'Other deck', '[]');
  // Every charge draws on tokens: the change in the balance is what was charged.
  db.exec('DELETE FROM member_subscription_amounts');
  for (const u of [FOUNDER, OTHER, COFOUNDER]) db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(u, 50_000_000);
  return db;
}
const balance = (db: DatabaseSync, u = FOUNDER) => Number((db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').get(u) as any).balance_microusd);
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
const plan = (n = 6): PlanLine[] => Array.from({ length: n }, (_, i) => ({
  card_uid: `c${i + 1}`, area_id: `a${i + 1}`, element: 'body', kind: 'text', task: 'rail_write', model: TEXT_MODEL, quote_microusd: LINE,
  input: { text: `synthetic brief ${i + 1}`, option: 'deck:rewrite' },
}));

/** Writes the usage row a step writes under its parent hold, at `micro`. */
function usageRow(db: DatabaseSync, holdUid: string | null, ref: string, micro: number) {
  return Number(db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, 'rail_write', ?, ?, ?, ?)")
    .run(FOUNDER, TEXT_MODEL, micro, holdUid, ref).lastInsertRowid);
}

/**
 * The first run: 6 areas through the D1 runtime; the steps in `fail` fail,
 * each having charged `failCharge` first (a guard call that ran, say).
 */
async function firstRun(db: DatabaseSync, opts: { fail?: number[]; failCharge?: number; key?: string } = {}) {
  const fail = new Set(opts.fail ?? [4, 5]);
  const execute: StepExecutor = async (step, ctx) => {
    const ref = stepRecordRef(step.batch_uid, step.seq);
    if (fail.has(step.seq)) {
      if (opts.failCharge) usageRow(db, ctx.parentHold?.uid ?? null, ref, opts.failCharge);
      return { ok: false, charged_microusd: opts.failCharge ?? 0, error_code: 'model_failed' };
    }
    const id = usageRow(db, ctx.parentHold?.uid ?? null, ref, step.quote_microusd);
    return { ok: true, charged_microusd: step.quote_microusd, model_used: step.model, usage_log_id: id, variant: { text: `area ${step.seq}` } };
  };
  const rt = new D1GenRuntime({ DB: d1Over(db) } as any, execute);
  const a = await rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: opts.key ?? 'first-run-0001', lines: plan() });
  if (!a.ok) throw new Error(JSON.stringify(a));
  const st = (await rt.startBatch(a.uid))!;
  return { uid: a.uid, st };
}

function roomState() {
  const store = new Map<string, unknown>();
  const state: any = { alarm: null as number | null };
  state.storage = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, setAlarm: async (t: number) => { state.alarm = t; } };
  return state;
}
/** The deck's room behind a namespace the routes reach through `genRooms`. */
function roomEnv(db: DatabaseSync) {
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const room = new DeckGenRoom(roomState(), env);
  const events: GenEvent[] = [];
  room.onEvent((e) => { events.push(e); });
  env.DECK_GEN_ROOM = { idFromName: (n: string) => n, get: () => ({ fetch: (url: string, init?: RequestInit) => room.fetch(new Request(url, init)) }) };
  return { env, room, events };
}
/** A fake `aiRouter.run` that charges each answer its line, as a usage row under the parent hold. */
function fakeRun(db: DatabaseSync, opts: { busy?: number; status?: number } = {}) {
  const calls: Array<{ model: string | undefined; record: string }> = [];
  const run = async (_env: any, o: any) => {
    calls.push({ model: o.model, record: o.rail.record });
    if (calls.length <= (opts.busy ?? 0)) return { ok: false, refusal: 'all_models_failed', usage: {}, attempts: [{ model: o.model, ok: false, called: true, status: opts.status ?? 429 }] };
    const id = usageRow(db, o.parentHold?.uid ?? null, o.rail.record, LINE);
    return { ok: true, output: 'the area, rewritten', usage: { model: o.model, fallback_used: false }, usageLogId: id };
  };
  return { calls, run };
}
function governor() {
  const g = new Governor();
  return { acquire: async (i: any) => g.acquire(i), release: async (id: string) => { g.release(id); } };
}

async function call(env: any, who: number, method: string, path: string, init: { key?: string; body?: unknown } = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', deckBatches);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.key !== undefined) headers['Idempotency-Key'] = init.key;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await withThrownResponses(() => app.request(path, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, env));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const retry = (env: any, who: number, uid: string, key: string | undefined, body?: unknown) => call(env, who, 'POST', `/api/decks/areas/batches/${uid}/retry-failed`, { key, body });

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1. 6 areas, 4 done and 2 failed: Retry runs only the 2, as a child run, and charges exactly their quote', async () => {
  // Mutation checked: retryPlan keeping every line that ran (not only the failed) → the quote is 6,000, past what is left: 402.
  const db = world();
  try {
    const first = await firstRun(db);
    assert.deepEqual([first.st.state, first.st.steps.filter((s) => s.state === 'failed').length], ['done', 2]);
    const { env, room } = roomEnv(db);
    const x = fakeRun(db);
    room.useExecutor(stepExecutor(env, { run: x.run as any, governor: governor(), sleep: async () => {} }));
    const before = balance(db);
    const r = await retry(env, FOUNDER, first.uid, 'retry-key-0001');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { batch_uid: r.body.batch_uid, retried: ['a5', 'a6'], quote: { microusd: 2 * LINE } });
    const child = db.prepare('SELECT * FROM deck_area_batches WHERE uid = ?').get(r.body.batch_uid) as any;
    assert.equal(child.parent_batch_uid, first.uid, 'a new run, linked to the first');
    assert.equal(balance(db), before - 2 * LINE, 'the child holds its quote');
    await room.alarm();
    assert.equal(x.calls.length, 2, 'two run() calls: the done areas are never re-run');
    assert.deepEqual(x.calls.map((c) => c.record), [stepRecordRef(child.uid, 0), stepRecordRef(child.uid, 1)]);
    const steps = db.prepare('SELECT area_id, model, input, state FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(child.uid) as any[];
    assert.deepEqual(steps.map((s) => [s.area_id, s.model, JSON.parse(s.input).option, s.state]), [['a5', TEXT_MODEL, 'deck:rewrite', 'done'], ['a6', TEXT_MODEL, 'deck:rewrite', 'done']], 'the same model pick and rail option');
    const done = db.prepare('SELECT state, charged_microusd, reservation_uid FROM deck_area_batches WHERE uid = ?').get(child.uid) as any;
    assert.deepEqual([done.state, Number(done.charged_microusd)], ['done', 2 * LINE], 'the charge equals the 2 areas\' quote');
    assert.equal((db.prepare('SELECT status FROM ai_budget_reservations WHERE uid = ?').get(done.reservation_uid) as any).status, 'settled');
    assert.equal(balance(db), before - 2 * LINE, 'charged the two areas, nothing more');
    // The family is whole: nothing left to retry, from the first run or the child.
    for (const uid of [first.uid, child.uid]) {
      const again = await retry(env, FOUNDER, uid, `retry-key-again-${uid.slice(0, 4)}`);
      assert.deepEqual([again.status, again.body.error], [409, 'nothing_to_retry']);
    }
  } finally { db.close(); }
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('2. the same Idempotency-Key twice: one child run, one charge, and the first answer even after the child ran', async () => {
  // Mutation checked: the route not looking the key up → the repeat after the child ran answers 409 nothing_to_retry.
  const db = world();
  try {
    const first = await firstRun(db);
    const { env, room } = roomEnv(db);
    const x = fakeRun(db);
    room.useExecutor(stepExecutor(env, { run: x.run as any, governor: governor(), sleep: async () => {} }));
    const before = balance(db);
    const a = await retry(env, FOUNDER, first.uid, 'retry-same-0001');
    const b = await retry(env, FOUNDER, first.uid, 'retry-same-0001');
    assert.equal(a.status, 200);
    assert.deepEqual(b, a, 'the repeat while it is queued');
    await room.alarm();
    const c = await retry(env, FOUNDER, first.uid, 'retry-same-0001');
    assert.deepEqual(c, a, 'the repeat after it ran');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches WHERE parent_batch_uid = ?', first.uid), 1, 'one child run');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ai_budget_reservations'), 2, 'the first run\'s hold and the child\'s, no third');
    assert.equal(x.calls.length, 2);
    assert.equal(balance(db), before - 2 * LINE, 'one charge');
    // The key of another run is not a retry's.
    const reused = await retry(env, FOUNDER, first.uid, 'first-run-0001');
    assert.deepEqual([reused.status, reused.body.error], [409, 'idempotency_key_reused']);
  } finally { db.close(); }
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test('3. what is left of the first run\'s quote is under the retry\'s quote: 402 hold_exhausted with both, and nothing held or run', async () => {
  // Mutation checked: the route not comparing before admitting → a hold is taken and given back (a third reservation row).
  // Mutation checked: admit's family clause dropped → the runtime case below admits the retry.
  const db = world();
  try {
    // The hold set in the fixture: 6,000 held; 4 areas charged 1,000 and the 2 that failed 600 each before failing.
    const first = await firstRun(db, { failCharge: 600 });
    assert.equal(first.st.charged_microusd, 4 * LINE + 2 * 600);
    const { env, room } = roomEnv(db);
    const x = fakeRun(db);
    room.useExecutor(stepExecutor(env, { run: x.run as any, governor: governor(), sleep: async () => {} }));
    const before = balance(db);
    const holds = count(db, 'SELECT COUNT(*) AS n FROM ai_budget_reservations');
    const r = await retry(env, FOUNDER, first.uid, 'retry-short-0001');
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(r.body.error, 'hold_exhausted');
    assert.deepEqual(r.body.quote, { microusd: 2 * LINE });
    assert.equal(r.body.hold_remaining_microusd, 6 * LINE - 4 * LINE - 2 * 600);
    await room.alarm();
    assert.equal(x.calls.length, 0, 'no run');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches WHERE parent_batch_uid = ?', first.uid), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ai_budget_reservations'), holds, 'nothing held, not even for a moment');
    assert.equal(balance(db), before);
    // One area alone (1,000) is still more than the 800 left: refused too.
    const one = await retry(env, FOUNDER, first.uid, 'retry-short-0002', { areas: ['a5'] });
    assert.deepEqual([one.status, one.body.quote, one.body.hold_remaining_microusd], [402, { microusd: LINE }, 800]);
    // The runtime refuses on its own too, and gives back the hold it took.
    const rt = new D1GenRuntime({ DB: d1Over(db) } as any, async () => ({ ok: true, charged_microusd: 0 }));
    const lines = plan(2).map((l, i) => ({ ...l, area_id: `a${i + 5}` }));
    const a = await rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'retry-short-0003', lines, parentBatchUid: first.uid });
    assert.deepEqual(a, { ok: false, refusal: 'hold_exhausted', message: 'What is left of the first run\'s hold cannot cover this retry.' });
    assert.equal(admitStatus('hold_exhausted'), 402);
    assert.equal(balance(db), before, 'the hold the runtime took was given back');
  } finally { db.close(); }
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test('4. no failed area: 409 nothing_to_retry; a missing or bad Idempotency-Key, or a bad body: 400', async () => {
  const db = world();
  try {
    const first = await firstRun(db, { fail: [] });
    const { env } = roomEnv(db);
    const r = await retry(env, FOUNDER, first.uid, 'retry-none-0001');
    assert.deepEqual([r.status, r.body.error], [409, 'nothing_to_retry']);
    const failed = await firstRun(db, { key: 'first-run-0002' });
    for (const key of [undefined, 'short', 'x'.repeat(65), 'has space 0001']) {
      const bad = await retry(env, FOUNDER, failed.uid, key);
      assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_idempotency_key'], String(key));
    }
    assert.equal((await retry(env, FOUNDER, failed.uid, 'x'.repeat(64))).status, 200, '64 characters is a key');
    for (const body of [{ areas: [] }, { areas: [7] }, { areas: 'a5' }, [1]]) {
      const bad = await retry(env, FOUNDER, failed.uid, 'retry-body-0001', body);
      assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_areas'], JSON.stringify(body));
    }
    // A subset names only failed areas; one that did not fail is nothing to retry.
    const done = await retry(env, FOUNDER, first.uid, 'retry-none-0002', { areas: ['a1'] });
    assert.deepEqual([done.status, done.body.error], [409, 'nothing_to_retry']);
    // Retrying starts a run, so it counts against deck_generate; Seen and the banner do not.
    assert.ok(DECK_GENERATE.test(`/api/decks/areas/batches/${first.uid}/retry-failed`));
    for (const p of [`/api/decks/areas/batches/${first.uid}/seen`, '/api/decks/1/batches']) assert.equal(DECK_GENERATE.test(p), false, p);
  } finally { db.close(); }
});

test('4b. a stopped retry leaves its areas failed, and a retry of a retry links to the first run and draws on its quote', async () => {
  // Mutation checked: retryPlan counting a stopped step as the line's state → the second retry is 409 nothing_to_retry.
  // Mutation checked: rootOf answering the run itself → the second retry links to the child (and finds nothing failed).
  const db = world();
  try {
    const first = await firstRun(db);
    const { env, room } = roomEnv(db);
    const a = await retry(env, FOUNDER, first.uid, 'retry-stop-0001');
    assert.equal(a.status, 200);
    const stopped = (await room.cancel(a.body.batch_uid, FOUNDER))!;
    assert.deepEqual([stopped.state, stopped.steps.map((s) => s.state)], ['cancelled', ['stopped', 'stopped']]);
    const b = await retry(env, FOUNDER, a.body.batch_uid, 'retry-stop-0002');
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(b.body.retried, ['a5', 'a6']);
    assert.equal((db.prepare('SELECT parent_batch_uid FROM deck_area_batches WHERE uid = ?').get(b.body.batch_uid) as any).parent_batch_uid, first.uid);
  } finally { db.close(); }
});

// ── 5 and 6 ──────────────────────────────────────────────────────────────────
async function roomRun(db: DatabaseSync, key: string) {
  const { env, room, events } = roomEnv(db);
  const x = fakeRun(db);
  room.useExecutor(stepExecutor(env, { run: x.run as any, governor: governor(), sleep: async () => {} }));
  const res = await room.fetch(new Request('https://deck-gen-room/admit', {
    method: 'POST', headers: { 'x-deck-user': String(FOUNDER) },
    body: JSON.stringify({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'deck_build', idemKey: key, lines: plan(3) }),
  }));
  const a = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(a));
  return { env, room, events, uid: a.uid as string };
}
const notices = (db: DatabaseSync) => db.prepare("SELECT * FROM notifications_inbox WHERE user_id = ? AND type = 'deck_build_done'").all(FOUNDER) as any[];

test('5. batch_done with a stream attached: the founder is watching, so no notice', async () => {
  // Mutation checked: noticing whatever the streams took → one notice here.
  const db = world();
  try {
    const { room, uid } = await roomRun(db, 'room-watch-0001');
    const res = await room.fetch(new Request(`https://deck-gen-room/events?uid=${uid}`, { headers: { 'x-deck-user': String(FOUNDER) } }));
    const text = res.text(); // read while the room drives the run
    await room.alarm();
    const body = await text;
    assert.match(body, /event: batch_done/);
    assert.equal(notices(db).length, 0);
    assert.equal((db.prepare('SELECT notified_at FROM deck_area_batches WHERE uid = ?').get(uid) as any).notified_at, null);
  } finally { db.close(); }
});

test('6. batch_done with no stream: exactly one notice, linking to the proposal review, with no number in it', async () => {
  // Mutation checked: the claim without `notified_at IS NULL` → the second call notifies again (two rows).
  const db = world();
  try {
    const { env, room, events, uid } = await roomRun(db, 'room-away-0001');
    await room.alarm();
    assert.equal(events.filter((e) => e.type === 'batch_done').length, 1);
    let rows = notices(db);
    assert.equal(rows.length, 1);
    const n = rows[0];
    assert.equal(n.link, `/raise/pitch?project_id=${P}&proposal=${uid}`);
    for (const field of [n.title, n.body]) assert.equal(/\d/.test(String(field)), false, `no figure: ${field}`);
    assert.deepEqual(JSON.parse(n.payload), { batch_uid: uid }, 'the payload names the run and nothing else');
    assert.ok((db.prepare('SELECT notified_at FROM deck_area_batches WHERE uid = ?').get(uid) as any).notified_at);
    // A second driver or a restarted room ends the run again: still one notice.
    assert.equal(await noticeBuildDone(env, uid), false);
    rows = notices(db);
    assert.equal(rows.length, 1, 'sent once');
    // A run that did not finish done (stopped) is not announced.
    const stopped = await roomRun(db, 'room-away-0002');
    await stopped.room.cancel(stopped.uid, FOUNDER);
    assert.equal(await noticeBuildDone(stopped.env, stopped.uid), false);
    assert.equal(notices(db).length, 1);
  } finally { db.close(); }
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test('7. the banner lists finished runs nobody opened, newest first, at most 5; seen takes one off and can be repeated', async () => {
  // Mutation checked: the banner query without `seen_at IS NULL` → the seen run is still listed.
  const db = world();
  try {
    const first = await firstRun(db);
    const { env } = roomEnv(db);
    const list = () => call(env, FOUNDER, 'GET', `/api/decks/${DECK}/batches?state=done&unseen=1`);
    const r = await list();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { batches: [{ batch_uid: first.uid, finished_at: first.st.settled_at, cards_waiting: 4 }] }, 'the 4 cards with a proposal');
    assert.equal((await call(env, FOUNDER, 'GET', `/api/decks/${DECK}/batches?state=done`)).status, 400, 'only the banner\'s filter');
    const seen = await call(env, FOUNDER, 'POST', `/api/decks/areas/batches/${first.uid}/seen`);
    assert.deepEqual([seen.status, seen.body], [200, { ok: true }]);
    assert.deepEqual((await list()).body, { batches: [] }, 'the run is gone');
    const at = (db.prepare('SELECT seen_at FROM deck_area_batches WHERE uid = ?').get(first.uid) as any).seen_at;
    assert.deepEqual((await call(env, FOUNDER, 'POST', `/api/decks/areas/batches/${first.uid}/seen`)).body, { ok: true });
    assert.equal((db.prepare('SELECT seen_at FROM deck_area_batches WHERE uid = ?').get(first.uid) as any).seen_at, at, 'repeating it keeps the first time');
    // Seven more runs: six done, one cancelled. The five newest done are listed.
    const add = db.prepare("INSERT INTO deck_area_batches (uid, deck_id, project_id, state, quote_microusd, idem_key, created_by, settled_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)");
    for (let i = 1; i <= 7; i++) add.run(`00000000-0000-4000-8000-00000000000${i}`, DECK, P, i === 7 ? 'cancelled' : 'done', `banner-key-000${i}`, FOUNDER, `2026-11-0${i} 10:00:00`);
    const five = (await list()).body.batches.map((b: any) => b.batch_uid.slice(-1));
    assert.deepEqual(five, ['6', '5', '4', '3', '2']);
  } finally { db.close(); }
});

// ── 8 ────────────────────────────────────────────────────────────────────────
test('8. another founder\'s run: 404 on retry, seen and the banner; a co-founder reads the banner but cannot retry another\'s run', async () => {
  const db = world();
  try {
    const first = await firstRun(db);
    const { env } = roomEnv(db);
    const stranger = await retry(env, OTHER, first.uid, 'retry-other-0001');
    assert.deepEqual([stranger.status, stranger.body.error], [404, 'run_not_found']);
    assert.equal((await call(env, OTHER, 'POST', `/api/decks/areas/batches/${first.uid}/seen`)).status, 404);
    assert.equal((await call(env, OTHER, 'GET', `/api/decks/${DECK}/batches?state=done&unseen=1`)).status, 404);
    assert.equal((await call(env, FOUNDER, 'GET', `/api/decks/${OTHER_DECK}/batches?state=done&unseen=1`)).status, 404, 'and the other way');
    assert.equal((await call(env, FOUNDER, 'GET', '/api/decks/999/batches?state=done&unseen=1')).status, 404);
    assert.equal((db.prepare('SELECT seen_at FROM deck_area_batches WHERE uid = ?').get(first.uid) as any).seen_at, null, 'the stranger cleared nothing');
    const co = await retry(env, COFOUNDER, first.uid, 'retry-co-0001');
    assert.deepEqual([co.status, co.body.error], [404, 'run_not_found'], 'the quote is its starter\'s');
    assert.equal((await call(env, COFOUNDER, 'GET', `/api/decks/${DECK}/batches?state=done&unseen=1`)).body.batches.length, 1);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches'), 1, 'nothing was started');
  } finally { db.close(); }
});

// ── 9 ────────────────────────────────────────────────────────────────────────
test('9. area_retrying before each automatic retry, at most 3 across the fallback, then area_failed; a retried step charges once', async () => {
  // Mutation checked: no step-wide cap → a fourth retry. 503 not busy → no retry at all.
  const db = world();
  try {
    // Always busy (503): the primary three times, the fallback twice, then the step fails.
    const busy = await roomRun(db, 'room-busy-0001');
    const x = fakeRun(db, { busy: 99, status: 503 });
    busy.room.useExecutor(stepExecutor(busy.env, { run: x.run as any, governor: governor(), sleep: async () => {}, random: () => 0.5, onBusy: (s, a, ms) => busy.room.retrying(s, a, ms) }));
    const t0 = Date.now();
    await busy.room.alarm();
    const first = busy.events.filter((e) => e.seq === 0);
    const retrying = first.filter((e) => e.type === 'area_retrying');
    assert.deepEqual(retrying.map((e) => e.attempt), [1, 2, 3], 'three retries, numbered');
    for (const e of retrying) {
      assert.equal(e.area_id, 'a1');
      assert.ok(Date.parse(e.next_at!) >= t0 + e.wait_ms! - 5, 'next_at is when the retry runs');
    }
    assert.deepEqual(first.map((e) => e.type).filter((t) => t !== 'area_busy'), ['area_started', 'area_retrying', 'area_retrying', 'area_retrying', 'area_failed']);
    assert.equal(x.calls.filter((c) => c.record === stepRecordRef(busy.uid, 0)).length, 5, 'three tries of the primary, two of the fallback');
    const st = db.prepare('SELECT state, error_code, charged_microusd FROM deck_area_batch_steps WHERE batch_uid = ? AND seq = 0').get(busy.uid) as any;
    assert.deepEqual([st.state, st.error_code, Number(st.charged_microusd)], ['failed', 'model_busy', 0]);

    // Busy twice, then it answers: two retries, one charge.
    assert.equal((db.prepare('SELECT state FROM deck_area_batches WHERE uid = ?').get(busy.uid) as any).state, 'failed', 'no area answered');
    const ok = await roomRun(db, 'room-busy-0002');
    const y = fakeRun(db, { busy: 2 });
    ok.room.useExecutor(stepExecutor(ok.env, { run: y.run as any, governor: governor(), sleep: async () => {}, onBusy: (s, a, ms) => ok.room.retrying(s, a, ms) }));
    await ok.room.alarm();
    // The room's drivers run the three steps at once, so which step met the two busy answers is not fixed.
    assert.equal(ok.events.filter((e) => e.type === 'area_retrying').length, 2);
    assert.equal(y.calls.length, 5, 'three answers and two busy tries');
    const charged = db.prepare('SELECT seq, state, charged_microusd FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(ok.uid) as any[];
    assert.deepEqual(charged.map((s) => [s.state, Number(s.charged_microusd)]), [['done', LINE], ['done', LINE], ['done', LINE]], 'the retried step charged its line once');
  } finally { db.close(); }
});
