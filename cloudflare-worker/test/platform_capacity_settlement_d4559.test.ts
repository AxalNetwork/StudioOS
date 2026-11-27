/**
 * D4559 (#4559), D4569 §1 fact 2 — settled AI charges without a usage row, in
 * the capacity read, its snapshot and its alert episodes. The rules held here:
 *
 *   1. The count is settled `surface = 'ai'` holds with a non-zero charge, taken
 *      in the last 24 hours and settled at least 5 minutes before the read,
 *      that no `ai_usage_logs` row names by `reservation_uid`. A zero charge,
 *      an unsettled or refunded hold, a hold just outside the window, one
 *      settled inside the grace, an MCP or flow hold, and a hold that has its
 *      usage row (one or several) are not counted.
 *   2. The signal carries its source, window, sampling, unit, scope and
 *      `last_success_at`; it names no member, company, agent or hold.
 *   3. A source that throws, hangs, answers without a count or lacks the
 *      binding is `unavailable` with `value: null`, never 0.
 *   4. Any non-zero count is a warning (approved 2026-11-21); a measured 0 clears it; an
 *      outage after a recent measurement is a freshness gap, a stale one opens
 *      nothing. The snapshot keeps the key.
 *   5. The statement is answered from two indexes, with no table scan.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/platform_capacity_settlement_d4559.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSettlementSignal, readOperationalSignals, sqlStamp, SETTLED_WITHOUT_USAGE_SQL,
  SETTLEMENT_WITHOUT_USAGE_THRESHOLDS, SETTLEMENT_WINDOW_S, SETTLEMENT_GRACE_S,
} from '../src/services/platformCapacitySignals.ts';
import type { Metric } from '../src/services/platformCapacity.ts';
import { evaluateAlerts, snapshotRows, SNAPSHOT_KEY, FRESHNESS_GAP_MS } from '../src/services/platformCapacityHistory.ts';
import { migratedDatabase, migratedTemplate, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';

afterAll(() => removeMigratedDatabases());
const NOW = new Date('2026-11-15T12:00:00Z');
const KEY = 'ai.settlement.without_usage_row';
const ago = (s: number) => sqlStamp(new Date(NOW.getTime() - s * 1000));

type Hold = { uid: string; status?: 'settled' | 'pending' | 'refunded'; surface?: string | null; included?: number; topup?: number; createdS?: number; settledS?: number; rows?: number };
/** One hold, and `rows` usage rows naming it, in a fresh copy of the migrated schema. */
function world(holds: Hold[]) {
  const db = migratedDatabase();
  for (const h of holds) {
    const status = h.status ?? 'settled';
    const done = status !== 'pending';
    const inc = status === 'refunded' ? 0 : (h.included ?? 300);
    const top = status === 'refunded' ? 0 : (h.topup ?? 0);
    db.prepare(`INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, status,
        settlement_uid, actual_included_microusd, actual_topup_microusd, expires_at, created_at, updated_at, surface)
      VALUES (?, 7, '2026-11-15', '2026-11', 1000, 1000, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      h.uid, status, done ? `set-${h.uid}` : null, done ? inc : null, done ? top : null,
      ago(-600), ago(h.createdS ?? 2 * 3_600), ago(h.settledS ?? 3_600), h.surface === undefined ? 'ai' : h.surface,
    );
    for (let i = 0; i < (h.rows ?? 0); i++) {
      db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, created_at) VALUES (7, 'synthetic', 'stub', 100, ?, ?)`)
        .run(h.uid, ago(h.settledS ?? 3_600));
    }
  }
  return { db, env: { DB: d1Over(db) } as any };
}
async function count(holds: Hold[]) {
  const w = world(holds);
  try { return await readSettlementSignal(w.env, NOW); } finally { w.db.close(); }
}

// 1, 2 ────────────────────────────────────────────────────────────────────────
test('a settled AI charge with no usage row is counted, with its provenance, and is a warning', async () => {
  // Mutations checked: the NOT EXISTS dropped (counts the hold with its row); last_success_at left null; the level not from the thresholds.
  const m = await count([{ uid: 'orphan' }, { uid: 'attributed', rows: 1 }, { uid: 'topup-only', included: 0, topup: 50 }]);
  assert.deepEqual([m.key, m.availability, m.value, m.level, m.unit, m.scope], [KEY, 'measured', 2, 'warning', 'count', 'deployment']);
  assert.equal(m.last_success_at, NOW.toISOString(), 'the read itself is the source of the count');
  assert.deepEqual(m.thresholds, SETTLEMENT_WITHOUT_USAGE_THRESHOLDS);
  assert.match(m.thresholds!.basis, /Approved by the owner on 2026-11-21/);
  assert.match(m.source, /ai_budget_reservations.*ai_usage_logs\.reservation_uid/);
  assert.match(m.window!, /last 24 hours.*5 minutes/);
  assert.ok(m.sampling);
  assert.doesNotMatch(JSON.stringify(m), /orphan|topup-only|user_id|company|agent_id|SELECT/, 'no hold, member or statement leaves');

  const clean = await count([{ uid: 'attributed', rows: 1 }]);
  assert.deepEqual([clean.availability, clean.value, clean.level], ['measured', 0, 'ok'], 'none missing is a measured zero');
});

test('the boundaries: zero charge, unsettled, refunded, outside the window, inside the grace, other surfaces, a deck run', async () => {
  // Mutations checked: `>= ?` made `> ?` (the hold at exactly 24 h); the grace bind made `now`; the surface filter dropped; the charge filter dropped.
  const cases: Array<[string, Hold, number]> = [
    ['a zero charge', { uid: 'z', included: 0, topup: 0 }, 0],
    ['an unsettled hold', { uid: 'p', status: 'pending' }, 0],
    ['a refunded hold', { uid: 'r', status: 'refunded' }, 0],
    ['taken just outside the window', { uid: 'old', createdS: SETTLEMENT_WINDOW_S + 1, settledS: SETTLEMENT_WINDOW_S }, 0],
    ['taken exactly at the window start', { uid: 'edge', createdS: SETTLEMENT_WINDOW_S, settledS: SETTLEMENT_WINDOW_S - 60 }, 1],
    ['settled inside the grace', { uid: 'fresh', createdS: 120, settledS: SETTLEMENT_GRACE_S - 1 }, 0],
    ['settled just past the grace', { uid: 'grace', createdS: 900, settledS: SETTLEMENT_GRACE_S }, 1],
    ['an MCP hold (its use is in api_usage_events)', { uid: 'mcp', surface: 'mcp' }, 0],
    ['a hold that names no surface', { uid: 'none', surface: null }, 0],
    ['a deck run: several usage rows under one hold', { uid: 'deck', rows: 3 }, 0],
    ['a hold that does have its usage row', { uid: 'ok', rows: 1 }, 0],
  ];
  for (const [name, hold, want] of cases) {
    const m = await count([hold]);
    assert.equal(m.availability, 'measured', name);
    assert.equal(m.value, want, name);
  }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a throwing, hanging, silent or absent source is unavailable, never 0', async () => {
  // Mutations checked: the catch returning a measured 0; a null row read as 0.
  const stub = (first: () => Promise<unknown>) => ({ DB: { prepare: () => ({ bind: () => ({ first }) }) } }) as any;
  const pre632 = migratedDatabase();
  pre632.exec('ALTER TABLE ai_budget_reservations DROP COLUMN surface');
  const cases: Array<[string, any, RegExp]> = [
    ['throws', stub(async () => { throw new Error('D1_ERROR: no such table: ai_budget_reservations'); }), /could not be read/],
    ['hangs', stub(() => new Promise(() => {})), /did not answer in time/],
    ['no row', stub(async () => null), /without a count/],
    ['a non-number', stub(async () => ({ n: 'many' })), /without a count/],
    ['no binding', {}, /DB binding/],
    ['a schema without the surface column', { DB: d1Over(pre632) }, /could not be read/],
  ];
  try {
    for (const [name, env, reason] of cases) {
      const m = await readSettlementSignal(env, NOW, 20);
      assert.deepEqual([m.availability, m.value, m.level], ['unavailable', null, 'unknown'], name);
      assert.equal(m.last_success_at, null, name);
      assert.match(m.reason!, reason, name);
      assert.doesNotMatch(m.reason!, /D1_ERROR|no such|surface/, `${name}: the driver text does not leave`);
    }
  } finally { pre632.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('alerts: a count opens a warning, a measured 0 clears it, an outage is a freshness gap only while the last count is recent', async () => {
  // Mutations checked: the key left out of SNAPSHOT_KEY; a hysteresis that holds the warning at 0.
  const found = await count([{ uid: 'orphan' }]);
  assert.deepEqual(evaluateAlerts([], [found], {}, NOW), [{ kind: 'open', key: KEY, severity: 'warning', value: 1 }]);
  const open = [{ id: 9, metric_key: KEY, severity: 'warning' as const, muted_until: null }];
  assert.deepEqual(evaluateAlerts(open, [found], {}, NOW).map((a) => a.kind), ['touch'], 'one episode, not one per sweep');
  const many = { ...found, value: 40 };
  assert.deepEqual(evaluateAlerts(open, [many], {}, NOW).map((a) => a.kind), ['touch'], 'there is no critical level');
  const zero = await count([]);
  assert.deepEqual(evaluateAlerts(open, [zero], {}, NOW).map((a) => a.kind), ['clear']);

  const down = await readSettlementSignal({} as any, NOW);
  assert.deepEqual(evaluateAlerts(open, [down], {}, NOW).map((a) => a.kind), ['touch'], 'an outage is not a recovery');
  const recent = { [KEY]: new Date(NOW.getTime() - 3_600_000).toISOString() };
  assert.deepEqual(evaluateAlerts([], [down], recent, NOW), [{ kind: 'open', key: KEY, severity: 'unavailable', value: null }],
    'a count that was readable an hour ago and stopped answering opens a freshness gap');
  const stale = { [KEY]: new Date(NOW.getTime() - FRESHNESS_GAP_MS - 60_000).toISOString() };
  assert.deepEqual(evaluateAlerts([], [down], stale, NOW), [], 'a last count older than 48 hours stays listed as unavailable only');

  assert.ok(SNAPSHOT_KEY.test(KEY));
  assert.ok(!SNAPSHOT_KEY.test(`${KEY}.acme`));
  const rows = snapshotRows({ observed_at: NOW.toISOString(), scope: 'hq', metrics: [found, down] as Metric[] });
  assert.deepEqual(rows.map((r) => [r.metric_key, r.value, r.availability, r.level]), [[KEY, 1, 'measured', 'warning'], [KEY, null, 'unavailable', 'unknown']]);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the statement is answered from the status/created_at index and the reservation index, with no scan', () => {
  // Mutation checked: the window written on updated_at (unindexed) → a SCAN of the reservations.
  const db = migratedTemplate();
  try {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${SETTLED_WITHOUT_USAGE_SQL}`).all('a', 'b', 'c') as any[]).map((r) => String(r.detail));
    assert.ok(plan.some((d) => /SEARCH r USING INDEX idx_ai_reservations_review_created \(status=\? AND created_at>\? AND created_at<\?\)/.test(d)), plan.join(' | '));
    assert.ok(plan.some((d) => /SEARCH u USING (COVERING )?INDEX idx_ai_usage_logs_reservation_ref \(reservation_uid=\?\)/.test(d)), plan.join(' | '));
    assert.ok(!plan.some((d) => /^SCAN /.test(d)), plan.join(' | '));
  } finally { db.close(); }
});

test('the part 3 read carries the signal', async () => {
  const w = world([{ uid: 'orphan' }]);
  try {
    const ms = await readOperationalSignals(w.env, NOW);
    const m = ms.find((x) => x.key === KEY);
    assert.equal(m?.value, 1);
  } finally { w.db.close(); }
});
