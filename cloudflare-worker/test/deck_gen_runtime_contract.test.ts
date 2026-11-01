/**
 * D1502 (#3753, deck v2 A3a) — the contract every `DeckGenRuntime` passes.
 *
 * Run against each implementation of the seam (`IMPLEMENTATIONS`): the D1 core
 * now; `DeckGenRoom` (part 2) and B9's Queue fallback join this list.
 *
 *   1. quote = parent hold = sum of the lines, and quote = the settled maximum;
 *   2. the same Idempotency-Key twice is one run, one hold, one charge;
 *      (and a retry while the run is going is that run, never `deck_busy`);
 *   3. a second run on a busy deck is refused (one active run per deck);
 *   4. cancel after 1 of 6 areas charges 1 and releases 5;
 *   5. a failed area never sinks the others;
 *   6. a crash between steps repeats nothing, and `rebuild` restores from D1;
 *   7. a long run keeps its hold alive past the five-minute rule;
 *   8. the events carry what pd2b draws: card, element, model or free, state,
 *      seconds, cost and the running charged-of-held.
 * Plus the router: a step under `parentHold` takes no hold of its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { D1GenRuntime, FREE_LABEL, quoteOf, stepRecordRef, type DeckGenRuntime, type GenEvent, type PlanLine, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { run as aiRun, __resetForTest } from '../src/services/aiRouter.ts';

const M716 = readFileSync('cloudflare-worker/sql/migrations/716_deck_area_batches.sql', 'utf8');
// The hold's Idempotency-Key (D844) and context (D1278), which the budget fixture predates.
const HOLD_COLUMNS = ['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map((n) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8')).join('\n');
const USER = 7, DECK = 50, P = 5;
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  const f = aiBudgetFixture();
  f.db.exec(HOLD_COLUMNS);
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (${DECK}, ${P}, 1, '[]', 'Synthetic', 1), (${DECK + 1}, ${P}, 2, '[]', 'Other', 0)`);
  f.db.exec(M716);
  f.db.exec(M716); // applies twice
  // Every charge draws on tokens, so a charge is the change in the balance.
  setFixtureAllowance(f.db, 0);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(USER, 50_000_000);
  return f;
}

/** Six areas of text, each line 1,000 micro-USD; one image at 4,000; one free check. */
function plan(n = 6): PlanLine[] {
  const lines: PlanLine[] = Array.from({ length: n }, (_, i) => ({ card_uid: `c${i + 1}`, area_id: `a${i + 1}`, element: 'body', kind: 'text', task: 'rail_write', model: TEXT_MODEL, quote_microusd: 1000 }));
  return lines;
}

type Harness = { runtime: DeckGenRuntime; calls: number[]; events: GenEvent[] };
/** Charges each step its full line, writing the usage row a real step writes (under the parent, with its record ref). */
function executorFor(db: any, opts: { fail?: Set<number>; onStep?: (seq: number) => Promise<void> } = {}) {
  const calls: number[] = [];
  const execute: StepExecutor = async (step, ctx) => {
    calls.push(step.seq);
    await opts.onStep?.(step.seq);
    if (opts.fail?.has(step.seq)) return { ok: false, charged_microusd: 0, error_code: 'model_failed' };
    const r = db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(USER, step.task ?? 'rail_write', step.model ?? 'none', step.quote_microusd, ctx.parentHold?.uid ?? null, stepRecordRef(step.batch_uid, step.seq));
    return { ok: true, charged_microusd: step.quote_microusd, model_used: step.model, usage_log_id: Number(r.lastInsertRowid), variant: { text: `area ${step.seq}` } };
  };
  return { calls, execute };
}

const IMPLEMENTATIONS: Array<[string, (env: any, execute: StepExecutor, events: GenEvent[]) => DeckGenRuntime]> = [
  ['D1GenRuntime', (env, execute, events) => new D1GenRuntime(env, execute, (e) => { events.push(e); })],
];

const admit = (rt: DeckGenRuntime, key: string, lines = plan(), cls: 'areas' | 'deck_build' = 'areas') =>
  rt.admit({ deckId: DECK, projectId: P, userId: USER, cls, idemKey: key, lines });
const hold = (db: any, uid: string) => db.prepare('SELECT * FROM ai_budget_reservations WHERE uid = ?').get(uid) as any;
const balance = (db: any) => Number((db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').get(USER) as any).balance_microusd);

for (const [name, make] of IMPLEMENTATIONS) {
  test(`${name}: quote = parent hold = sum of the lines, and quote = the settled maximum`, async () => {
    const f = world();
    try {
      const x = executorFor(f.db);
      const events: GenEvent[] = [];
      const rt = make({ DB: f.DB }, x.execute, events);
      const lines = [...plan(5), { element: 'photo', kind: 'image', task: 'deck_image', model: '@cf/black-forest-labs/flux-1-schnell', quote_microusd: 4000 }, { element: 'title', kind: 'guard', task: null, model: null, quote_microusd: 0 }];
      const a = await admit(rt, 'key-quote-001', lines, 'deck_build');
      assert.ok(a.ok);
      if (!a.ok) return;
      assert.equal(a.quote_microusd, quoteOf(lines));
      assert.equal(a.quote_microusd, 9000);
      const h = hold(f.db, a.reservation_uid!);
      assert.equal(Number(h.included_microusd) + Number(h.topup_microusd), a.quote_microusd, 'the parent hold is the quote');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1, 'one hold for the whole run');
      const s = (await rt.startBatch(a.uid))!;
      assert.equal(s.state, 'done');
      assert.equal(s.charged_microusd, a.quote_microusd, 'every step charged its line: the quote is the settled maximum');
      assert.equal(hold(f.db, a.reservation_uid!).status, 'settled');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1, 'no step took a hold of its own');
    } finally { f.db.close(); }
  });

  test(`${name}: the same Idempotency-Key twice is one run, one hold, one charge`, async () => {
    // Mutation checked: admit without the idem_key lookup and the hold's key → two holds, this fails.
    const f = world();
    try {
      const x = executorFor(f.db);
      const rt = make({ DB: f.DB }, x.execute, []);
      const before = balance(f.db);
      const [a, b] = await Promise.all([admit(rt, 'key-same-0001'), admit(rt, 'key-same-0001')]);
      assert.ok(a.ok && b.ok);
      if (!a.ok || !b.ok) return;
      assert.equal(a.uid, b.uid);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1);
      // Two drivers at once (mutation checked: without the step claim's guard both run step 0).
      await Promise.all([rt.startBatch(a.uid), rt.startBatch(b.uid)]);
      await rt.startBatch(a.uid);
      assert.deepEqual([...x.calls].sort((p, q) => p - q), [0, 1, 2, 3, 4, 5], 'each step ran once');
      assert.equal(before - balance(f.db), 6000, 'charged once');
      const again = await admit(rt, 'key-same-0001');
      assert.ok(again.ok && again.replayed);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1);
    } finally { f.db.close(); }
  });

  test(`${name}: a retry while the run is still going is that run, and the key on another deck holds nothing`, async () => {
    // Mutation checked: admit without the early idem_key lookup → the retry is refused deck_busy;
    // releasing the replayed hold on a lost race → the first run's hold is released.
    const f = world();
    try {
      const rt = make({ DB: f.DB }, executorFor(f.db).execute, []);
      const a = await admit(rt, 'key-retry-0001');
      assert.ok(a.ok);
      if (!a.ok) return;
      const retry = await admit(rt, 'key-retry-0001');
      assert.deepEqual(retry.ok ? [retry.uid, retry.replayed] : retry.refusal, [a.uid, true], 'a retry, not a busy deck');
      const elsewhere = await rt.admit({ deckId: DECK + 1, projectId: P, userId: USER, cls: 'areas', idemKey: 'key-retry-0001', lines: plan() });
      assert.deepEqual(elsewhere.ok ? null : elsewhere.refusal, 'idempotency_key_reused');
      assert.equal(hold(f.db, a.reservation_uid!).status, 'pending', 'the first run still holds its quote');
    } finally { f.db.close(); }
    // The same key on two decks at once: one run wins, and the loser leaves the winner's keyed hold alone.
    const g = world();
    try {
      const rt = make({ DB: g.DB }, executorFor(g.db).execute, []);
      const both = await Promise.all([DECK, DECK + 1].map((deckId) => rt.admit({ deckId, projectId: P, userId: USER, cls: 'areas', idemKey: 'key-race-0001', lines: plan() })));
      const won = both.filter((r) => r.ok);
      assert.equal(won.length, 1, JSON.stringify(both));
      assert.deepEqual(both.filter((r) => !r.ok).map((r: any) => r.refusal), ['idempotency_key_reused']);
      const w = won[0] as any;
      assert.equal(hold(g.db, w.reservation_uid).status, 'pending', 'the winner still holds its quote');
    } finally { g.db.close(); }
  });

  test(`${name}: a second run on a busy deck is refused; another deck is not`, async () => {
    const f = world();
    try {
      const rt = make({ DB: f.DB }, executorFor(f.db).execute, []);
      const a = await admit(rt, 'key-busy-0001');
      assert.ok(a.ok);
      const b = await admit(rt, 'key-busy-0002');
      assert.deepEqual(b.ok ? null : b.refusal, 'deck_busy');
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'pending'").get().n, 1, 'the refused run holds nothing');
      const other = await rt.admit({ deckId: DECK + 1, projectId: P, userId: USER, cls: 'areas', idemKey: 'key-busy-0003', lines: plan(1) });
      assert.ok(other.ok, 'one active run per deck, not per member');
      assert.equal((await admit(rt, 'short')).ok, false, 'an Idempotency-Key is required and sound');
      assert.equal((await admit(rt, 'key-empty-01', [])).ok, false);
    } finally { f.db.close(); }
  });

  test(`${name}: cancel after 1 of 6 areas charges 1 and releases 5`, async () => {
    const f = world();
    try {
      let rt!: DeckGenRuntime;
      let uid = '';
      const x = executorFor(f.db, { onStep: async (seq) => { if (seq === 1) await rt.cancel(uid, USER); } });
      rt = make({ DB: f.DB }, x.execute, []);
      const before = balance(f.db);
      const a = await admit(rt, 'key-cancel-01');
      assert.ok(a.ok);
      if (!a.ok) return;
      uid = a.uid;
      // Area 1 runs; Stop is pressed while area 2 is starting: area 2 finishes (it started), 3–6 never start.
      const s = (await rt.startBatch(uid))!;
      assert.equal(s.state, 'cancelled');
      assert.deepEqual(s.steps.map((st) => st.state), ['done', 'done', 'stopped', 'stopped', 'stopped', 'stopped']);
      assert.deepEqual(x.calls, [0, 1]);
      assert.equal(s.charged_microusd, 2000, 'what started is charged');
      assert.equal(before - balance(f.db), 2000, 'and the rest of the hold is released');
      // Cancel before anything starts: nothing charged, the whole hold released.
      const f2 = world();
      try {
        const rt2 = make({ DB: f2.DB }, executorFor(f2.db).execute, []);
        const b2 = balance(f2.db);
        const q = await admit(rt2, 'key-cancel-02');
        assert.ok(q.ok);
        if (!q.ok) return;
        const c = (await rt2.cancel(q.uid, USER))!;
        assert.deepEqual([c.state, c.charged_microusd], ['cancelled', 0]);
        assert.equal(balance(f2.db), b2);
        assert.equal(await rt2.cancel(q.uid, USER + 1), null, 'only the member who started it stops it');
      } finally { f2.db.close(); }
    } finally { f.db.close(); }
  });

  test(`${name}: a failed area never sinks the others`, async () => {
    const f = world();
    try {
      const events: GenEvent[] = [];
      const x = executorFor(f.db, { fail: new Set([2]) });
      const rt = make({ DB: f.DB }, x.execute, events);
      const a = await admit(rt, 'key-fail-0001');
      if (!a.ok) return assert.fail('admit');
      const s = (await rt.startBatch(a.uid))!;
      assert.equal(s.state, 'done');
      assert.deepEqual(s.steps.map((st) => st.state), ['done', 'done', 'failed', 'done', 'done', 'done']);
      assert.equal(s.charged_microusd, 5000, 'the failed area charged nothing');
      assert.deepEqual(events.filter((e) => e.type === 'area_failed').map((e) => e.seq), [2]);
    } finally { f.db.close(); }
  });

  test(`${name}: a crash between steps repeats nothing, and rebuild restores from D1`, async () => {
    // Mutation checked: rebuild sending a charged 'running' step back to 'waiting' → it runs twice, this fails.
    const f = world();
    try {
      const x = executorFor(f.db);
      const rt = make({ DB: f.DB }, x.execute, []);
      const a = await admit(rt, 'key-crash-001');
      if (!a.ok) return assert.fail('admit');
      // The driver ran 0 and 1, charged step 2 and died before writing it; step 3 had started, nothing charged.
      f.db.exec(`UPDATE deck_area_batches SET state = 'running' WHERE uid = '${a.uid}'`);
      f.db.exec(`UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 1000 WHERE batch_uid = '${a.uid}' AND seq IN (0, 1)`);
      f.db.exec(`UPDATE deck_area_batch_steps SET state = 'running' WHERE batch_uid = '${a.uid}' AND seq IN (2, 3)`);
      f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
        .run(USER, 'rail_write', TEXT_MODEL, 1000, a.reservation_uid, stepRecordRef(a.uid, 2));
      const r = (await rt.rebuild(a.uid))!;
      assert.deepEqual(r.steps.map((st) => st.state), ['done', 'done', 'done', 'waiting', 'waiting', 'waiting']);
      const s = (await rt.startBatch(a.uid))!;
      assert.deepEqual(x.calls, [3, 4, 5], 'nothing that ran or charged runs again');
      assert.deepEqual([s.state, s.charged_microusd], ['done', 6000]);
      assert.equal(await rt.rebuild('no-such-run'), null);
    } finally { f.db.close(); }
  });

  test(`${name}: a long run keeps its hold alive past the five-minute rule`, async () => {
    const f = world();
    try {
      let expiresSeen: string[] = [];
      const x = executorFor(f.db, { onStep: async () => { expiresSeen.push((f.db.prepare('SELECT expires_at FROM ai_budget_reservations').get() as any).expires_at); } });
      const rt = make({ DB: f.DB }, x.execute, []);
      const a = await admit(rt, 'key-alive-001');
      if (!a.ok) return assert.fail('admit');
      f.db.exec("UPDATE ai_budget_reservations SET expires_at = '2000-01-01 00:00:00'");
      await rt.startBatch(a.uid);
      assert.ok(expiresSeen.every((e) => e > '2026-01-01'), `each step extended the hold: ${expiresSeen.join(', ')}`);
    } finally { f.db.close(); }
  });

  test(`${name}: the events carry what pd2b draws per row, and the running charged-of-held`, async () => {
    const f = world();
    try {
      const events: GenEvent[] = [];
      const rt = make({ DB: f.DB }, executorFor(f.db).execute, events);
      const lines = [...plan(2), { card_uid: 'c3', area_id: 'a3', element: 'title', kind: 'guard', task: null, model: null, quote_microusd: 0 }];
      const a = await admit(rt, 'key-events-01', lines);
      if (!a.ok) return assert.fail('admit');
      await rt.startBatch(a.uid);
      assert.deepEqual(events.map((e) => e.type), ['area_started', 'step_done', 'variant_ready', 'area_started', 'step_done', 'variant_ready', 'area_started', 'step_done', 'variant_ready', 'batch_done']);
      const done = events.filter((e) => e.type === 'step_done');
      assert.deepEqual(done.map((e) => [e.card_uid, e.element, e.state, e.cost_microusd, e.charged_microusd, e.held_microusd]),
        [['c1', 'body', 'done', 1000, 1000, 2000], ['c2', 'body', 'done', 1000, 2000, 2000], ['c3', 'title', 'done', 0, 2000, 2000]]);
      assert.equal(done[0].model_label, 'llama-3.3-70b-instruct-fp8-fast');
      assert.equal(done[2].model_label, FREE_LABEL, 'No model · free');
      assert.ok(done.every((e) => typeof e.seconds === 'number'));
      assert.deepEqual(events.at(-1), { type: 'batch_done', batch_uid: a.uid, state: 'done', charged_microusd: 2000, held_microusd: 2000 });
    } finally { f.db.close(); }
  });
}

test('the router: a step under parentHold takes no hold of its own and records its charge against the parent', async () => {
  // Mutation checked: run() ignoring parentHold (taking its own hold) → two holds, this fails.
  __resetForTest();
  const f = world();
  try {
    const rt = new D1GenRuntime({ DB: f.DB } as any, async () => ({ ok: true, charged_microusd: 0 }));
    const a = await admit(rt, 'key-router-01', plan(1));
    if (!a.ok) return assert.fail('admit');
    const ai = { run: async () => ({ response: 'Synthetic words', usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
    const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard(ai) };
    const r = await aiRun(env, { task: 'paraphrase', userId: USER, text: 'synthetic', parentHold: { uid: a.reservation_uid!, userId: USER }, rail: { page: 'Founder · Raise · Pitch deck', option: 'deck:rewrite', record: stepRecordRef(a.uid, 0) } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1, 'no hold of its own');
    assert.equal(hold(f.db, a.reservation_uid!).status, 'pending', 'and it settled nothing: the run settles the parent');
    const row = f.db.prepare("SELECT reservation_uid, record_ref, charged_microusd FROM ai_usage_logs WHERE task = 'paraphrase' AND refusal IS NULL").get() as any;
    assert.equal(row.reservation_uid, a.reservation_uid);
    assert.equal(row.record_ref, stepRecordRef(a.uid, 0));
    assert.ok(Number(row.charged_microusd) >= 0);
    // A step under another member's hold is refused.
    const bad = await aiRun(env, { task: 'paraphrase', userId: USER + 1, text: 'x', parentHold: { uid: a.reservation_uid!, userId: USER } });
    assert.deepEqual([bad.ok, bad.refusal], [false, 'misconfigured']);
  } finally { f.db.close(); }
});
