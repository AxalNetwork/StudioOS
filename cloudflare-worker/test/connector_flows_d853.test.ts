/**
 * D853 (#2476) — multi-connector flows on JOB_QUEUE: a crashed step resumes
 * without a second charge, a cancelled run releases its holds, a duplicate
 * queue message is a no-op, a proposal waits for the founder's accept, and a
 * run that runs out of AI tokens mid-way stops without charging the step it
 * could not hold. On `_ai_budget_fixture.mjs` with 510, 525 and 526, the real
 * holds (`meteredCall`, D844) and a fake JOB_QUEUE.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/connector_flows_d853.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { loadAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { holdKey } from '../src/services/metering.ts';
import {
  DEMO_RECIPE, FLOW_STEP_JOB, FlowRefused, FlowStepError, LEASE_MS, RECIPES, RETRY_DELAYS_SECONDS,
  acceptFlow, assertRecipe, cancelFlow, runFlowStep, startFlow, stepKey,
  type Recipe, type RecipeStep,
} from '../src/services/flows.ts';
import { queueConsumer } from '../src/queue-consumer.ts';

const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-21T12:00:00Z');
const MAP = 300_000;
const PUBLISH = 200_000;

function fixture(allowance = 1_000_000) {
  const f = aiBudgetFixture();
  f.db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql') + migration('526_connector_flows.sql') + `
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    UPDATE users SET founder_id = 20 WHERE id = 2;
    UPDATE users SET founder_id = 30 WHERE id = 4;
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, deleted_at TEXT);
    INSERT INTO projects VALUES (7, 'Member venture', 20, NULL), (8, 'Someone else''s venture', 30, NULL);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    INSERT INTO integrations(user_id, provider_key, status) VALUES (2, 'github', 'active'), (4, 'github', 'active');
  `);
  setFixtureAllowance(f.db, allowance);
  const sent: Array<{ body: any; opts: any }> = [];
  const JOB_QUEUE = { async send(body: any, opts?: any) { sent.push({ body, opts: opts ?? null }); } };
  return { ...f, sent, env: { DB: f.DB, ENVIRONMENT: 'development', USE_CF_QUEUE: 'true', JOB_QUEUE } as any };
}

const holds = (db: any, user = 2) => db.prepare(`SELECT uid, status, idempotency_key, included_microusd + topup_microusd AS held,
  COALESCE(actual_included_microusd,0) + COALESCE(actual_topup_microusd,0) AS charged FROM ai_budget_reservations WHERE user_id = ? ORDER BY rowid`).all(user);
const spent = async (env: any) => { const b = await loadAiBudget(env, 2, NOW); return b.month_spend_microusd + b.month_reserved_microusd; };
const runRow = (db: any, uid: string) => db.prepare('SELECT * FROM connector_flow_runs WHERE uid = ?').get(uid);
const steps = (db: any, uid: string) => db.prepare('SELECT step_key, attempt, status, outcome, error_class, charged_microusd FROM connector_flow_steps WHERE run_uid = ? ORDER BY id').all(uid);
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** Deliver queued messages until none is left (delays ignored). */
async function drain(f: ReturnType<typeof fixture>, opts: Record<string, unknown> = {}, limit = 30) {
  const notes: string[] = [];
  for (let i = 0; i < limit && f.sent.length; i++) {
    const { body } = f.sent.shift()!;
    assert.equal(body.job_type, FLOW_STEP_JOB);
    const d = await runFlowStep(f.env, body.payload, { now: NOW, ...opts });
    notes.push(`${body.payload.step_key}#${body.payload.attempt}:${d.note}`);
  }
  return notes;
}

/** The demo recipe with some steps replaced. */
function variant(over: Record<string, Partial<RecipeStep>>): Record<string, Recipe> {
  const r: Recipe = { ...DEMO_RECIPE, key: 'test.variant', steps: DEMO_RECIPE.steps.map((s) => ({ ...s, ...(over[s.key] ?? {}) }) as RecipeStep) };
  return { [r.key]: r };
}

test('the migration: two tables, statuses and attempts held by CHECKs, one key per attempt', () => {
  const f = fixture();
  try {
    const cols = (t: string) => f.db.prepare(`PRAGMA table_info(${t})`).all().map((c: any) => c.name);
    for (const c of ['uid', 'user_id', 'company_id', 'recipe_key', 'recipe_version', 'status', 'execution_id']) assert.ok(cols('connector_flow_runs').includes(c), c);
    for (const c of ['step_key', 'attempt', 'idempotency_key', 'reservation_uid', 'outcome', 'error_class']) assert.ok(cols('connector_flow_steps').includes(c), c);
    const run = (status: string, uid = 'r1') => f.db.prepare("INSERT INTO connector_flow_runs(uid,user_id,recipe_key,recipe_version,status,execution_id) VALUES (?,2,'x',1,?,?)").run(uid, status, `e-${uid}`);
    assert.throws(() => run('paused'), /CHECK/);
    run('queued');
    const step = (attempt: number, key: string) => f.db.prepare("INSERT INTO connector_flow_steps(run_uid,step_key,attempt,idempotency_key) VALUES ('r1','map',?,?)").run(attempt, key);
    step(1, 'k1');
    assert.throws(() => step(4, 'k4'), /CHECK/, 'at most three attempts');
    assert.throws(() => step(2, 'k1'), /UNIQUE/, 'one key per attempt');
    assert.throws(() => step(1, 'k9'), /UNIQUE/, 'one row per step attempt');
  } finally { f.db.close(); }
});

test('recipes: the demo is well-formed; a publish before a proposal, or an unpriced step, is refused', () => {
  // Mutation checked: `assertRecipe` without the publish-before-proposal check → the swapped recipe is accepted.
  assert.equal(RECIPES[DEMO_RECIPE.key], DEMO_RECIPE);
  assert.deepEqual(DEMO_RECIPE.steps.map((s) => s.kind), ['trigger', 'read', 'map', 'proposal', 'publish', 'result']);
  const swapped = { ...DEMO_RECIPE, steps: [DEMO_RECIPE.steps[0], DEMO_RECIPE.steps[4], DEMO_RECIPE.steps[3]] };
  assert.throws(() => assertRecipe(swapped), /publishes before a proposal/);
  assert.throws(() => assertRecipe({ ...DEMO_RECIPE, steps: [{ ...DEMO_RECIPE.steps[0], operation: 'flow.unpriced' }] }), /no price/);
  assert.throws(() => assertRecipe({ ...DEMO_RECIPE, steps: [DEMO_RECIPE.steps[0], DEMO_RECIPE.steps[0]] }), /step key/);
});

test('a run: each step holds and settles its own tokens under one execution, and stops at waiting_accept until the founder accepts', async () => {
  // Mutation checked: `finish` without the proposal branch → the run publishes with no accept; acceptFlow without the
  // owner check → another member's accept moves the run.
  const f = fixture();
  try {
    const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key, input: { from: 'validate' } }, { now: NOW });
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0].body.payload, { run_uid: run.uid, step_key: 'trigger', attempt: 1 });
    await drain(f);
    assert.equal(runRow(f.db, run.uid).status, 'waiting_accept');
    assert.deepEqual(steps(f.db, run.uid).map((s: any) => s.step_key), ['trigger', 'read', 'map', 'proposal'], 'nothing after the proposal is even queued');
    assert.equal(f.sent.length, 0);
    const mapHold = holds(f.db).find((h: any) => h.idempotency_key === holdKey(run.execution_id, stepKey(run.uid, 'map', 1)));
    assert.ok(mapHold && mapHold.status === 'settled' && mapHold.charged === MAP, 'the map step held and settled its own tokens');
    assert.equal(holds(f.db).length, 1, 'free steps hold nothing');

    await assert.rejects(acceptFlow(f.env, 4, run.uid, { now: NOW }), (e: any) => e instanceof FlowRefused && e.code === 'not_found');
    await assert.rejects(cancelFlow(f.env, 4, run.uid, { now: NOW }), (e: any) => e instanceof FlowRefused && e.code === 'not_found');
    assert.equal(runRow(f.db, run.uid).status, 'waiting_accept');
    await acceptFlow(f.env, 2, run.uid, { now: NOW });
    await assert.rejects(acceptFlow(f.env, 2, run.uid, { now: NOW }), (e: any) => e.code === 'not_waiting', 'accepted once');
    await drain(f);
    const done = runRow(f.db, run.uid);
    assert.equal(done.status, 'done');
    assert.deepEqual(JSON.parse(done.result_json), { done: true, published: true });
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['settled', MAP], ['settled', PUBLISH]]);
    assert.equal(await spent(f.env), MAP + PUBLISH);
    assert.ok(holds(f.db).every((h: any) => h.idempotency_key.startsWith(`exec:${run.execution_id}:flow:${run.uid}:`)), 'one execution');
    assert.deepEqual(steps(f.db, run.uid).map((s: any) => [s.step_key, s.outcome, s.charged_microusd]),
      [['trigger', 'ok', 0], ['read', 'ok', 0], ['map', 'ok', MAP], ['proposal', 'ok', 0], ['publish', 'ok', PUBLISH], ['result', 'ok', 0]]);
  } finally { f.db.close(); }
});

test('a duplicate queue message is a no-op: a finished step does not run again, and two deliveries at once run it once', async () => {
  // Mutation checked: the lease without its status condition → the concurrent pair both run the step (two calls);
  // the `done` branch removed → a next-step message lost after its row was written is never sent again.
  const f = fixture();
  try {
    let calls = 0;
    const recipes = variant({ map: { run: async () => { calls += 1; return { pages: [] }; } } });
    const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
    await drain(f, { recipes }, 2); // trigger, read
    const mapMsg = f.sent.shift()!.body.payload;
    const [a, b] = await Promise.all([runFlowStep(f.env, mapMsg, { now: NOW, recipes }), runFlowStep(f.env, { ...mapMsg }, { now: NOW, recipes })]);
    assert.equal(calls, 1, 'one of two concurrent deliveries ran the step');
    assert.ok([a.note, b.note].includes('next'));
    // The next step's message is lost; a redelivery of the finished step sends it again and runs nothing.
    assert.deepEqual(f.sent.map((m) => m.body.payload.step_key), ['proposal']);
    f.sent.length = 0;
    const again = await runFlowStep(f.env, mapMsg, { now: NOW, recipes });
    assert.equal(again.note, 'duplicate');
    assert.equal(calls, 1);
    assert.deepEqual(f.sent.map((m) => m.body.payload.step_key), ['proposal'], 'the lost message is sent again');
    assert.equal(holds(f.db).length, 1);
    assert.equal(await spent(f.env), MAP);
    assert.equal(steps(f.db, run.uid).filter((s: any) => s.step_key === 'map').length, 1);
    // A malformed message, and one for a run that does not exist, are acked and do nothing.
    assert.equal((await runFlowStep(f.env, { run_uid: 'x', step_key: 'map', attempt: 1 })).note, 'unreadable');
    assert.equal((await runFlowStep(f.env, { ...mapMsg, run_uid: '00000000-0000-4000-8000-000000000000' })).note, 'stale');
  } finally { f.db.close(); }
});

test('a crashed step resumes without a second charge, wherever it crashed', async () => {
  // Mutation checked: the hold's key with `Date.now()` in it → (a) takes a second hold; `finishRan` without its
  // settle → (b) leaves the hold pending; a refunded hold read as unknown → (b′) records NULL for a known 0; the `ran`
  // recovery removed → (c) is taken for a duplicate and the run stops.
  // (a) The worker dies mid-step: the hold is pending and the step leased. A delivery inside the lease is put off
  // until it ends; after it, the step runs again under the same key and the one hold.
  {
    const f = fixture();
    try {
      let calls = 0; let release!: () => void;
      const recipes = variant({ map: { run: async () => { calls += 1; if (calls === 1) await new Promise<void>((r) => { release = r; }); return { pages: [] }; } } });
      const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
      await drain(f, { recipes }, 2);
      const mapMsg = f.sent.shift()!.body.payload;
      const dead = runFlowStep(f.env, mapMsg, { now: NOW, recipes }); // never finishes on its own
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(holds(f.db).length, 1);
      const early = await runFlowStep(f.env, mapMsg, { now: later(1_000), recipes });
      assert.equal(early.kind, 'retry');
      assert.ok(early.kind === 'retry' && early.delaySeconds >= 58 && early.delaySeconds <= 60, 'redelivered once the lease ends');
      const resumed = await runFlowStep(f.env, mapMsg, { now: later(LEASE_MS + 1_000), recipes });
      assert.equal(resumed.note, 'next');
      assert.equal(calls, 2);
      assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['settled', MAP]], 'one hold, charged once');
      // The dead worker wakes: its row is no longer its own, so it records nothing and charges nothing.
      release();
      assert.equal((await dead).note, 'closed');
      assert.equal(await spent(f.env), MAP);
      assert.equal(steps(f.db, run.uid).filter((s: any) => s.step_key === 'map').length, 1);
    } finally { f.db.close(); }
  }
  // (b) The work is recorded and the settlement fails: the redelivery settles the pending hold, without re-running it.
  {
    const f = fixture();
    try {
      let calls = 0;
      const recipes = variant({ map: { run: async () => { calls += 1; return { pages: [] }; } } });
      await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
      await drain(f, { recipes }, 2);
      const mapMsg = f.sent.shift()!.body.payload;
      const prepare = f.DB.prepare.bind(f.DB);
      let broken = true;
      f.env.DB = { ...f.DB, batch: f.DB.batch.bind(f.DB), prepare: (sql: string) => {
        if (broken && sql.startsWith('SELECT * FROM ai_budget_reservations WHERE uid = ?')) { broken = false; throw new Error('D1 went away'); }
        return prepare(sql);
      } };
      const first = await runFlowStep(f.env, mapMsg, { now: NOW, recipes });
      assert.equal(first.kind, 'retry');
      assert.equal(first.note, 'settle_pending');
      assert.deepEqual(holds(f.db).map((h: any) => h.status), ['pending']);
      const second = await runFlowStep(f.env, mapMsg, { now: NOW, recipes });
      assert.equal(second.note, 'next');
      assert.equal(calls, 1, 'the work ran once');
      assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['settled', MAP]]);
    } finally { f.db.close(); }
  }
  // (b′) The same, but the pending hold expired (refunded) before the redelivery: nothing is charged, and the step
  // records a known 0, not an unknown.
  {
    const f = fixture();
    try {
      const recipes = variant({ map: { run: async () => ({ pages: [] }) } });
      const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
      await drain(f, { recipes }, 2);
      const mapMsg = f.sent.shift()!.body.payload;
      const prepare = f.DB.prepare.bind(f.DB);
      let broken = true;
      f.env.DB = { ...f.DB, batch: f.DB.batch.bind(f.DB), prepare: (sql: string) => {
        if (broken && sql.startsWith('SELECT * FROM ai_budget_reservations WHERE uid = ?')) { broken = false; throw new Error('D1 went away'); }
        return prepare(sql);
      } };
      assert.equal((await runFlowStep(f.env, mapMsg, { now: NOW, recipes })).note, 'settle_pending');
      await settleAiReservation(f.env, { uid: holds(f.db)[0].uid, userId: 2 }, 0, true); // as the expiry release does
      assert.equal((await runFlowStep(f.env, mapMsg, { now: NOW, recipes })).note, 'next');
      assert.equal(steps(f.db, run.uid).find((s: any) => s.step_key === 'map').charged_microusd, 0);
    } finally { f.db.close(); }
  }
  // (c) The hold settles and the step's close fails: the redelivery only closes it.
  {
    const f = fixture();
    try {
      let calls = 0;
      const recipes = variant({ map: { run: async () => { calls += 1; return { pages: [] }; } } });
      const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
      await drain(f, { recipes }, 2);
      const mapMsg = f.sent.shift()!.body.payload;
      const batch = f.DB.batch.bind(f.DB);
      let broken = true;
      f.env.DB = { ...f.DB, prepare: f.DB.prepare.bind(f.DB), batch: (stmts: any[]) => {
        if (broken && f.db.prepare("SELECT status FROM connector_flow_steps WHERE step_key = 'map'").get()?.status === 'ran'
          && f.db.prepare('SELECT status FROM ai_budget_reservations').get()?.status === 'settled') { broken = false; throw new Error('D1 went away'); }
        return batch(stmts);
      } };
      await assert.rejects(runFlowStep(f.env, mapMsg, { now: NOW, recipes }), /D1 went away/);
      assert.deepEqual(holds(f.db).map((h: any) => h.status), ['settled']);
      assert.equal((await runFlowStep(f.env, mapMsg, { now: NOW, recipes })).note, 'next');
      assert.equal(calls, 1);
      assert.equal(await spent(f.env), MAP);
      assert.equal(steps(f.db, run.uid).find((s: any) => s.step_key === 'map').charged_microusd, MAP);
    } finally { f.db.close(); }
  }
});

test('a cancelled run releases its holds: the running step is never charged and nothing after it runs', async () => {
  // Mutation checked: cancelFlow without the release loop → the map hold stays pending and counts as spent;
  // the `ran` write without `AND status = 'running'` → the cancelled step records its output and its next step is queued;
  // cancelFlow returning early for a cancelled run → a hold an earlier cancel could not release stays pending.
  const f = fixture();
  try {
    let release!: () => void;
    const recipes = variant({ map: { run: async () => { await new Promise<void>((r) => { release = r; }); return { pages: [] }; } } });
    const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
    await drain(f, { recipes }, 2);
    const running = runFlowStep(f.env, f.sent.shift()!.body.payload, { now: NOW, recipes });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await spent(f.env), MAP, 'held while it runs');
    const out = await cancelFlow(f.env, 2, run.uid, { now: NOW });
    assert.equal(out.released, 1);
    assert.equal(await spent(f.env), 0, 'released, never charged');
    release();
    assert.equal((await running).note, 'closed');
    assert.equal(runRow(f.db, run.uid).status, 'cancelled');
    assert.equal(f.sent.length, 0, 'nothing after it is queued');
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['refunded', 0]]);
    assert.ok(steps(f.db, run.uid).every((s: any) => s.status === 'done'));
    assert.equal(steps(f.db, run.uid).find((s: any) => s.step_key === 'map').outcome, 'cancelled');
    assert.deepEqual(await cancelFlow(f.env, 2, run.uid, { now: NOW }), { uid: run.uid, status: 'cancelled', released: 0 }, 'a second cancel changes nothing');
    // A release that fails leaves the hold pending; cancelling again releases it.
    const k = fixture();
    try {
      let hold!: () => void;
      const blocked = variant({ map: { run: async () => { await new Promise<void>((r) => { hold = r; }); return { pages: [] }; } } });
      const r3 = await startFlow(k.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes: blocked });
      await drain(k, { recipes: blocked }, 2);
      const inFlight = runFlowStep(k.env, k.sent.shift()!.body.payload, { now: NOW, recipes: blocked });
      await new Promise((r) => setTimeout(r, 20));
      const prepare = k.DB.prepare.bind(k.DB);
      let broken = true;
      const env = { ...k.env, DB: { ...k.DB, batch: k.DB.batch.bind(k.DB), prepare: (sql: string) => {
        if (broken && sql.startsWith('SELECT * FROM ai_budget_reservations WHERE uid = ?')) { broken = false; throw new Error('D1 went away'); }
        return prepare(sql);
      } } };
      const warn = console.warn; console.warn = () => {};
      try { assert.equal((await cancelFlow(env, 2, r3.uid, { now: NOW })).released, 0); } finally { console.warn = warn; }
      assert.deepEqual(holds(k.db).map((h: any) => h.status), ['pending']);
      assert.equal((await cancelFlow(k.env, 2, r3.uid, { now: NOW })).released, 1, 'the second cancel releases it');
      assert.equal(await spent(k.env), 0);
      hold();
      assert.equal((await inFlight).note, 'closed');
    } finally { k.db.close(); }
    // A run cancelled while it waits for the accept cannot be accepted.
    const g = fixture();
    try {
      const r2 = await startFlow(g.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: NOW });
      await drain(g);
      await cancelFlow(g.env, 2, r2.uid, { now: NOW });
      await assert.rejects(acceptFlow(g.env, 2, r2.uid, { now: NOW }), (e: any) => e.code === 'not_waiting');
      assert.equal(await spent(g.env), MAP, 'what already ran stays charged');
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test('not enough AI tokens mid-run: the run fails at that step, nothing is held for it, and earlier steps stay charged once', async () => {
  // Mutation checked: refusals routed through `retryOrFail` → the publish step is queued again.
  const f = fixture(MAP + 100_000);
  try {
    const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: NOW });
    await drain(f);
    await acceptFlow(f.env, 2, run.uid, { now: NOW });
    const notes = await drain(f);
    assert.deepEqual(notes, ['publish#1:failed']);
    const r = runRow(f.db, run.uid);
    assert.equal(r.status, 'failed');
    assert.equal(r.error_class, 'insufficient_tokens');
    assert.equal(f.sent.length, 0, 'no retry');
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['settled', MAP]]);
    assert.equal(await spent(f.env), MAP);
  } finally { f.db.close(); }
});

test('retries: a failed attempt is released, the next takes a new key after the backoff, and three failures fail the run', async () => {
  // Mutation checked: the next attempt written under attempt 1's key → its row is never written and the step stops;
  // MAX_ATTEMPTS ignored → a fourth attempt is queued and the run never fails.
  const f = fixture();
  try {
    let calls = 0;
    const recipes = variant({ map: { run: async () => { calls += 1; if (calls < 3) throw new Error('provider said: token sk_live_should_not_be_stored'); return { pages: [] }; } } });
    const warn = console.warn; const lines: string[] = [];
    console.warn = (...a: unknown[]) => { lines.push(JSON.stringify(a)); };
    try {
      const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes });
      await drain(f, { recipes }, 2);
      const delays: number[] = [];
      for (let i = 0; i < 3; i++) {
        const { body, opts } = f.sent.shift()!;
        if (opts?.delaySeconds) delays.push(opts.delaySeconds);
        await runFlowStep(f.env, body.payload, { now: NOW, recipes });
      }
      assert.deepEqual(delays, [...RETRY_DELAYS_SECONDS]);
      assert.deepEqual(steps(f.db, run.uid).filter((s: any) => s.step_key === 'map').map((s: any) => [s.attempt, s.outcome, s.error_class]),
        [[1, 'failed', 'error'], [2, 'failed', 'error'], [3, 'ok', null]]);
      assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['refunded', 0], ['refunded', 0], ['settled', MAP]], 'two released, one charged');
      assert.equal(await spent(f.env), MAP);
      const everything = JSON.stringify(f.db.prepare('SELECT * FROM connector_flow_steps').all()) + JSON.stringify(f.db.prepare('SELECT * FROM connector_flow_runs').all()) + lines.join('');
      assert.ok(!everything.includes('sk_live'), 'no error message is stored or logged');
    } finally { console.warn = warn; }
    // Three failures: the run fails, nothing is charged for the step.
    const g = fixture();
    try {
      const failing = variant({ map: { run: async () => { throw new FlowStepError('error'); } } });
      const r2 = await startFlow(g.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes: failing });
      await drain(g, { recipes: failing });
      assert.equal(runRow(g.db, r2.uid).status, 'failed');
      assert.equal(runRow(g.db, r2.uid).error_class, 'error');
      assert.equal(steps(g.db, r2.uid).filter((s: any) => s.step_key === 'map').length, 3);
      assert.equal(await spent(g.env), 0);
      // A permanent failure is not retried.
      const h = fixture();
      try {
        const permanent = variant({ map: { run: async () => { throw new FlowStepError('permanent'); } } });
        const r3 = await startFlow(h.env, { userId: 2, companyId: 7, recipeKey: 'test.variant' }, { now: NOW, recipes: permanent });
        await drain(h, { recipes: permanent });
        assert.equal(steps(h.db, r3.uid).filter((s: any) => s.step_key === 'map').length, 1);
        assert.equal(runRow(h.db, r3.uid).error_class, 'permanent');
      } finally { h.db.close(); }
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test('scope at every step: a run stops when its member loses the company, the connection or the account, before any hold', async () => {
  // Mutation checked: `checkScope` without the company check, the connection check, the jwt_min_iat check or the
  // account check → the matching case runs the step and holds for it.
  const cases: Array<[string, (db: any) => void]> = [
    ['company', (db) => db.exec('UPDATE projects SET founder_id = 99 WHERE id = 7')],
    ['connection', (db) => db.exec("UPDATE integrations SET status = 'disconnected' WHERE user_id = 2")],
    ['sign out everywhere', (db) => db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = 2').run(Math.floor(NOW.getTime() / 1000) + 60)],
    ['ended account', (db) => db.exec('UPDATE users SET is_active = 0 WHERE id = 2')],
  ];
  for (const [label, change] of cases) {
    const f = fixture();
    try {
      const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: NOW });
      await drain(f, {}, 1); // trigger
      change(f.db);
      await drain(f);
      const r = runRow(f.db, run.uid);
      assert.equal(r.status, 'failed', label);
      assert.equal(r.error_class, 'forbidden', label);
      assert.equal(holds(f.db).length, 0, `${label}: nothing held`);
    } finally { f.db.close(); }
  }
  // At the start: another member's company, a missing connection, an unknown recipe.
  const f = fixture();
  try {
    await assert.rejects(startFlow(f.env, { userId: 2, companyId: 8, recipeKey: DEMO_RECIPE.key }, { now: NOW }), (e: any) => e.code === 'forbidden');
    f.db.exec("DELETE FROM integrations WHERE user_id = 2");
    await assert.rejects(startFlow(f.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: NOW }), (e: any) => e.code === 'forbidden');
    await assert.rejects(startFlow(f.env, { userId: 2, companyId: 7, recipeKey: 'nope' }, { now: NOW }), (e: any) => e.code === 'unknown_recipe');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM connector_flow_runs').get().n, 0);
    // Without the Cloudflare queue, a flow fails closed.
    f.db.exec("INSERT INTO integrations(user_id, provider_key, status) VALUES (2, 'github', 'active')");
    await assert.rejects(startFlow({ ...f.env, USE_CF_QUEUE: 'false' }, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: NOW }), (e: any) => e.code === 'queue');
    assert.equal(f.db.prepare("SELECT status FROM connector_flow_runs").get().status, 'failed');
  } finally { f.db.close(); }
});

test('the queue consumer: a flow step is dispatched to the runner, acked when done, and redelivered while leased', async () => {
  // Mutation checked: the dispatch removed → the message reaches `claimDelivery`, which has no table here, and is retried.
  const f = fixture();
  try {
    const run = await startFlow(f.env, { userId: 2, companyId: 7, recipeKey: DEMO_RECIPE.key }, { now: new Date() });
    const outcome: string[] = [];
    const message = (body: any) => ({ body, attempts: 1, timestamp: Date.now(), id: 'm', ack() { outcome.push('ack'); }, retry(o?: any) { outcome.push(`retry:${o?.delaySeconds ?? ''}`); } });
    const first = f.sent.shift()!.body;
    await queueConsumer({ messages: [message(first)] } as any, f.env, {} as any);
    assert.deepEqual(outcome, ['ack']);
    assert.equal(steps(f.db, run.uid)[0].outcome, 'ok');
    // A step another delivery holds the lease on is redelivered after the lease.
    f.db.prepare("UPDATE connector_flow_steps SET status = 'running', lease_until = ? WHERE step_key = 'read'").run(new Date(Date.now() + 30_000).toISOString());
    await queueConsumer({ messages: [message(f.sent.shift()!.body)] } as any, f.env, {} as any);
    assert.match(outcome[1], /^retry:\d+$/);
  } finally { f.db.close(); }
});
