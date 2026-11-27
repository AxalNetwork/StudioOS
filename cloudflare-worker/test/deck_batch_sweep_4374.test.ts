/**
 * D4374 (#4374) — the stuck-run sweep.
 *
 *   1. A stuck run (active, no step event for STUCK_AFTER_MS) is swept: its
 *      steps end by rebuild's rule (a usage row under the hold is a charge that
 *      happened), the run closes `cancelled` with `stop_reason = 'timed_out'`,
 *      and its hold settles at what the steps charged, releasing the rest.
 *   2. A live run is left alone.
 *   3. The hold settles exactly once, a second sweep included.
 *   4. The batch read says "Stopped · timed out", never "Running".
 *   5. One audit row per sweep, with its counts; a hold already released is
 *      counted, not settled twice.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_batch_sweep_4374.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { D1GenRuntime, stepRecordRef, type PlanLine } from '../src/services/decks/genRuntime.ts';
import { STUCK_AFTER_MS, sweepStuckBatches } from '../src/services/decks/batchSweep.ts';
import { runView, stateLine } from '../src/routes/deck_batches.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { settleAiReservation } from '../src/services/aiBudget.ts';

const BATCH_SCHEMA = JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS.batch.schema}`, 'utf8'));

const M = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const USER = 7, P = 5;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  const f = aiBudgetFixture();
  f.db.exec(['525_ai_reservation_idempotency.sql', '632_ai_hold_context.sql'].map(M).join('\n'));
  f.db.exec('CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, slides TEXT, title TEXT, is_current INTEGER)');
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (50, ${P}, 1, '[]', 'A', 1), (51, ${P + 1}, 1, '[]', 'B', 1)`);
  f.db.exec(M('716_deck_area_batches.sql'));
  f.db.exec(M('752_deck_area_batches_seen.sql'));
  f.db.exec(M('202611022120_deck_batch_runtime.sql'));
  f.db.exec(M('202611040743_deck_batch_stop_reason.sql'));
  setFixtureAllowance(f.db, 0);
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(USER, 50_000_000);
  return f;
}
const lines = (n: number): PlanLine[] => Array.from({ length: n }, (_, i) => ({ card_uid: `c${i}`, area_id: `a${i}`, element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 1000 }));
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
const balance = (f: any) => (f.db.prepare('SELECT balance_microusd AS n FROM ai_topup_accounts WHERE user_id = ?').get(USER) as any).n;

/** A run admitted under its hold, then left by its driver: step 0 done, step 1 died mid-call after charging, step 2 never started. */
async function stuckRun(f: any, deckId = 50, idem = 'sweep-stuck-1', age = STUCK_AFTER_MS + 60_000) {
  const rt = new D1GenRuntime({ DB: f.DB } as any, async () => ({ ok: true, charged_microusd: 0 }));
  const a = await rt.admit({ deckId, projectId: P, userId: USER, cls: 'deck_build', idemKey: idem, lines: lines(3) });
  assert.equal(a.ok, true, JSON.stringify(a));
  if (!a.ok) throw new Error('not admitted');
  const t = ago(age);
  f.db.prepare("UPDATE deck_area_batches SET state = 'running', created_at = ?2, started_at = ?2 WHERE uid = ?1").run(a.uid, t);
  f.db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = 400, started_at = ?2, ended_at = ?2 WHERE batch_uid = ?1 AND seq = 0").run(a.uid, t);
  f.db.prepare("UPDATE deck_area_batch_steps SET state = 'running', started_at = ?2 WHERE batch_uid = ?1 AND seq = 1").run(a.uid, t);
  // Step 1 charged before its driver died: its usage row is under the run's hold, with the step's ref.
  f.db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, ?, ?, ?, ?, ?)')
    .run(USER, 'rail_write', MODEL, 300, a.reservation_uid, stepRecordRef(a.uid, 1));
  return { uid: a.uid, reservation: a.reservation_uid!, rt };
}

test('1. a stuck run is swept: steps end by rebuild\'s rule, the run stops timed out, the hold settles at what was placed', async () => {
  // Mutation checked: the running step marked stopped without reading its usage row → it charges 0 and the hold settles at 400.
  const f = world();
  try {
    const before = balance(f);
    const r = await stuckRun(f);
    const out = await sweepStuckBatches({ DB: f.DB } as any);
    assert.deepEqual([out.found, out.swept, out.settled, out.already_released, out.steps_done, out.steps_stopped], [1, 1, 1, 0, 1, 1]);
    assert.equal(out.charged_microusd, 700);
    const steps = f.db.prepare('SELECT seq, state, charged_microusd, error_code FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(r.uid) as any[];
    assert.deepEqual(steps.map((s) => [s.seq, s.state, s.charged_microusd]), [[0, 'done', 400], [1, 'done', 300], [2, 'stopped', 0]]);
    assert.equal(steps[2].error_code, 'timed_out');
    const b = f.db.prepare('SELECT state, stop_reason, charged_microusd, settled_at FROM deck_area_batches WHERE uid = ?').get(r.uid) as any;
    assert.deepEqual([b.state, b.stop_reason, b.charged_microusd], ['cancelled', 'timed_out', 700]);
    assert.ok(b.settled_at);
    const hold = f.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid = ?').get(r.reservation) as any;
    assert.equal(hold.status, 'settled');
    assert.equal(before - balance(f), 700, 'the member paid what was placed, and the rest of the hold was released');
    // The deck is free again: a new run is admitted.
    const again = await r.rt.admit({ deckId: 50, projectId: P, userId: USER, cls: 'areas', idemKey: 'sweep-after-1', lines: lines(1) });
    assert.equal(again.ok, true, JSON.stringify(again));
  } finally { f.db.close(); }
});

test('2. a live run is left alone: a step that started inside the window keeps it running', async () => {
  // Mutation checked: the NOT EXISTS clause on recent steps removed → the live run is swept.
  const f = world();
  try {
    const r = await stuckRun(f);
    f.db.prepare('UPDATE deck_area_batch_steps SET started_at = ?2 WHERE batch_uid = ?1 AND seq = 1').run(r.uid, ago(5 * 60_000));
    const fresh = await stuckRun(f, 51, 'sweep-fresh-1', 60_000);
    const out = await sweepStuckBatches({ DB: f.DB } as any);
    assert.deepEqual([out.found, out.swept], [0, 0]);
    for (const uid of [r.uid, fresh.uid]) {
      assert.equal((f.db.prepare('SELECT state FROM deck_area_batches WHERE uid = ?').get(uid) as any).state, 'running');
    }
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status = 'pending'").get() as any).n, 2, 'no hold was touched');
  } finally { f.db.close(); }
});

test('3. the hold settles exactly once, a second sweep and a late close included', async () => {
  // Mutation checked: the close without its `state IN (…)` guard → the second sweep settles again (and throws, or charges twice).
  const f = world();
  try {
    const before = balance(f);
    const r = await stuckRun(f);
    const first = await sweepStuckBatches({ DB: f.DB } as any);
    const second = await sweepStuckBatches({ DB: f.DB } as any);
    assert.deepEqual([first.swept, second.found, second.swept, second.settled], [1, 0, 0, 0]);
    assert.equal(before - balance(f), 700, 'charged once');
    const spends = f.db.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE reservation_uid = ? AND kind IN ('spend', 'release')").get(r.reservation) as any;
    assert.ok(spends.n >= 1);
    const settledTwice = f.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE uid = ? AND status = 'settled'").get(r.reservation) as any;
    assert.equal(settledTwice.n, 1);
  } finally { f.db.close(); }
});

test('3b. two sweeps at once: only one closes the run, and the hold settles once', async () => {
  // Mutation checked: the close without its `state IN (…)` guard → both sweeps count it swept.
  const f = world();
  try {
    const before = balance(f);
    await stuckRun(f);
    const [a, b] = await Promise.all([sweepStuckBatches({ DB: f.DB } as any), sweepStuckBatches({ DB: f.DB } as any)]);
    assert.equal(a.swept + b.swept, 1, `swept ${a.swept} + ${b.swept}`);
    assert.equal(a.settled + b.settled + a.already_released + b.already_released, 1);
    assert.equal(before - balance(f), 700, 'charged once');
  } finally { f.db.close(); }
});

test('4. the batch read says "Stopped · timed out", never "Running", and keeps its contract', async () => {
  const f = world();
  try {
    const r = await stuckRun(f);
    const live = runView((await r.rt.status(r.uid))!);
    assert.equal(live.state_line, 'Running');
    await sweepStuckBatches({ DB: f.DB } as any);
    const view = runView((await r.rt.status(r.uid))!);
    assert.deepEqual([view.state, view.stop_reason, view.state_line], ['cancelled', 'timed_out', 'Stopped · timed out']);
    assert.deepEqual(contractErrors(BATCH_SCHEMA, view), []);
    assert.equal(stateLine('cancelled', null), 'Stopped', 'a run its owner stopped');
  } finally { f.db.close(); }
});

test('5. one audit row per sweep with its counts; a hold already released is counted, not settled', async () => {
  // Mutation checked: settling without reading the hold's status → the released hold throws or is charged.
  const f = world();
  try {
    const before = balance(f);
    const r = await stuckRun(f);
    // The hold expired and a budget read released it in full before the sweep came round.
    await settleAiReservation({ DB: f.DB } as any, { uid: r.reservation, userId: USER }, 0, true);
    const out = await sweepStuckBatches({ DB: f.DB } as any);
    assert.deepEqual([out.swept, out.settled, out.already_released], [1, 0, 1]);
    assert.equal(balance(f), before, 'nothing charged against a released hold');
    await sweepStuckBatches({ DB: f.DB } as any);
    const rows = f.db.prepare("SELECT actor, details FROM activity_logs WHERE action = 'deck.batch_sweep' ORDER BY id").all() as any[];
    assert.equal(rows.length, 2, 'one row per sweep, an empty one included');
    assert.equal(rows[0].actor, 'system');
    const d = JSON.parse(rows[0].details);
    assert.deepEqual([d.found, d.swept, d.already_released, d.stuck_after_minutes], [1, 1, 1, 30]);
  } finally { f.db.close(); }
});

test('the daily cleanup runs the sweep, and its own failure stops nothing else', () => {
  const jobs = readFileSync('cloudflare-worker/src/models/jobs.ts', 'utf8');
  const at = jobs.indexOf("import('../services/decks/batchSweep')");
  assert.ok(at > 0);
  assert.match(jobs.slice(at - 120, at + 220), /try \{[\s\S]*sweepStuckBatches\(env\)[\s\S]*\} catch \{/);
  assert.equal(STUCK_AFTER_MS, 30 * 60_000);
});
