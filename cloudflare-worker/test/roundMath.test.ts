/**
 * Build queue #129 — round mechanics tests.
 *
 * Pins the funnel arithmetic and the pro-rata reconciliation rules. The
 * pro-rata cases matter most: the naive "prior stake × round size"
 * formula routinely over-allocates a reserve, and how the engine cuts
 * back is a policy decision that must not drift silently.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/roundMath.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRoundProgress,
  rollUpTranches,
  computeProRata,
  postRoundStake,
  type Allocation,
} from '../src/services/roundMath.ts';

// ---------- round progress ----------

const ALLOCS: Allocation[] = [
  { amount: 500000, status: 'wired', close_id: 1 },
  { amount: 250000, status: 'wired', close_id: 1 },
  { amount: 300000, status: 'signed', close_id: 2 },
  { amount: 200000, status: 'soft', close_id: 2 },
  { amount: 150000, status: 'soft', close_id: null },
];

test('computeRoundProgress separates wired, signed and soft', () => {
  const p = computeRoundProgress(ALLOCS, 2000000);
  assert.equal(p.wired, 750000);
  assert.equal(p.signed, 300000);
  assert.equal(p.soft, 350000);
  assert.equal(p.committed, 1050000, 'committed = wired + signed only');
  assert.equal(p.pipeline, 1400000, 'pipeline adds soft on top');
});

test('committed excludes soft commitments — a soft circle is not money', () => {
  const p = computeRoundProgress([{ amount: 999999, status: 'soft' }], 1000000);
  assert.equal(p.committed, 0);
  assert.equal(p.committed_pct, 0);
  assert.equal(p.pipeline, 999999);
});

test('computeRoundProgress reports progress against target', () => {
  const p = computeRoundProgress(ALLOCS, 2000000);
  assert.equal(p.committed_pct, 52.5);
  assert.equal(p.remaining, 950000);
  assert.equal(p.oversubscribed, false);
});

test('computeRoundProgress flags oversubscription and never returns negative remaining', () => {
  const p = computeRoundProgress([{ amount: 1200000, status: 'wired' }], 1000000);
  assert.equal(p.oversubscribed, true);
  assert.equal(p.remaining, 0, 'clamped, not -200000');
  assert.equal(p.committed_pct, 120);
});

test('computeRoundProgress is null-safe without a target', () => {
  const p = computeRoundProgress(ALLOCS, null);
  assert.equal(p.target, null);
  assert.equal(p.committed_pct, null, 'no target → no percentage, not 0');
  assert.equal(p.remaining, null);
  assert.equal(p.oversubscribed, false);
  assert.equal(p.committed, 1050000, 'subtotals still work');
});

test('computeRoundProgress ignores malformed and non-positive amounts', () => {
  const p = computeRoundProgress([
    { amount: 100, status: 'wired' },
    { amount: 0, status: 'wired' },
    { amount: -50, status: 'wired' },
    { amount: NaN, status: 'wired' },
  ], null);
  assert.equal(p.wired, 100);
});

// ---------- tranches ----------

test('rollUpTranches subtotals each close and surfaces unassigned money', () => {
  const { tranches, unassigned } = rollUpTranches(
    [
      { id: 1, name: 'First close', state: 'closed', closed_date: '2026-03-01' },
      { id: 2, name: 'Second close', state: 'open', target_date: '2026-09-01' },
      { id: 3, name: 'Final close', state: 'planned' },
    ],
    ALLOCS,
  );
  assert.equal(tranches.length, 3);
  assert.equal(tranches[0].committed, 750000);
  assert.equal(tranches[0].allocation_count, 2);
  assert.equal(tranches[1].committed, 300000);
  assert.equal(tranches[1].soft, 200000, 'soft money still shows on the tranche');
  assert.equal(tranches[2].committed, 0);
  assert.equal(tranches[2].allocation_count, 0);
  // Unassigned allocations are returned, never dropped.
  assert.equal(unassigned.soft, 150000);
});

test('tranche pct_of_round sums to 100 across committed capital', () => {
  const { tranches } = rollUpTranches(
    [{ id: 1, name: 'A', state: 'closed' }, { id: 2, name: 'B', state: 'open' }],
    ALLOCS,
  );
  const total = tranches.reduce((a, t) => a + (t.pct_of_round || 0), 0);
  assert.ok(Math.abs(total - 100) < 0.2, `expected ~100, got ${total}`);
});

test('rollUpTranches is null-safe with no committed capital', () => {
  const { tranches } = rollUpTranches(
    [{ id: 1, name: 'A', state: 'planned' }],
    [{ amount: 100, status: 'soft', close_id: 1 }],
  );
  assert.equal(tranches[0].pct_of_round, null, 'no committed capital → null, not 0/0');
});

// ---------- pro-rata ----------

const HOLDERS = [
  { key: 'a', prior_stake_pct: 10 },
  { key: 'b', prior_stake_pct: 5 },
  { key: 'c', prior_stake_pct: 2.5 },
];

test('computeProRata gives the naive right when no reserve is set', () => {
  const r = computeProRata(HOLDERS, 4000000, null);
  assert.equal(r.rule, 'raw');
  assert.equal(r.rows[0].entitlement, 400000, '10% of a $4M round');
  assert.equal(r.rows[1].entitlement, 200000);
  assert.equal(r.rows[2].entitlement, 100000);
  assert.equal(r.entitlement_total, 700000);
  assert.equal(r.reserve_remaining, null);
});

test('computeProRata leaves entitlements whole when the reserve covers them', () => {
  const r = computeProRata(HOLDERS, 4000000, 1000000);
  assert.equal(r.rule, 'fits');
  assert.equal(r.rows[0].entitlement, 400000);
  assert.ok(r.rows.every(x => !x.scaled));
});

test('computeProRata scales entitlements pro rata when the reserve is short', () => {
  // Rights total 700k against a 350k reserve → everyone halves.
  const r = computeProRata(HOLDERS, 4000000, 350000);
  assert.equal(r.rule, 'scaled');
  assert.equal(r.rows[0].entitlement, 200000);
  assert.equal(r.rows[1].entitlement, 100000);
  assert.equal(r.rows[2].entitlement, 50000);
  assert.ok(r.rows.every(x => x.scaled));
  const sum = r.rows.reduce((a, x) => a + x.entitlement, 0);
  assert.ok(Math.abs(sum - 350000) < 1, 'scaled entitlements exhaust the reserve exactly');
});

test('scaling preserves the ratio between holders — no first-come advantage', () => {
  const r = computeProRata(HOLDERS, 4000000, 350000);
  const ratioBefore = HOLDERS[0].prior_stake_pct / HOLDERS[1].prior_stake_pct;
  const ratioAfter = r.rows[0].entitlement / r.rows[1].entitlement;
  assert.ok(Math.abs(ratioBefore - ratioAfter) < 1e-9);
});

test('waived and expired holders free their allocation but stay visible', () => {
  const r = computeProRata([
    { key: 'a', prior_stake_pct: 10 },
    { key: 'b', prior_stake_pct: 5, state: 'waived' },
    { key: 'c', prior_stake_pct: 2.5, state: 'expired' },
  ], 4000000, null);
  assert.equal(r.rows.length, 3, 'waived holders still appear in the table');
  assert.equal(r.rows[1].entitlement, 0, 'but claim nothing');
  assert.equal(r.rows[2].entitlement, 0);
  assert.equal(r.entitlement_total, 400000, 'only the eligible holder counts');
});

test('computeProRata tracks what holders are actually taking against the reserve', () => {
  const r = computeProRata([
    { key: 'a', prior_stake_pct: 10, taking: 400000, state: 'taking' },
    { key: 'b', prior_stake_pct: 5, state: 'waived' },
  ], 4000000, 1000000);
  assert.equal(r.taking_total, 400000);
  assert.equal(r.reserve_remaining, 600000);
});

test('computeProRata clamps nonsense stakes instead of trusting them', () => {
  const r = computeProRata([
    { key: 'a', prior_stake_pct: 150 },
    { key: 'b', prior_stake_pct: -20 },
  ], 1000000, null);
  assert.equal(r.rows[0].entitlement, 1000000, '150% clamps to 100%');
  assert.equal(r.rows[1].entitlement, 0, 'negative clamps to 0');
});

test('computeProRata survives a zero-size round', () => {
  const r = computeProRata(HOLDERS, 0, 100000);
  assert.equal(r.entitlement_total, 0);
  assert.equal(r.rule, 'fits');
});

// ---------- post-round stake ----------

test('postRoundStake dilutes a non-participating holder', () => {
  // 10% of an $8M pre; $2M round → post $10M. Prior value $800k / $10M.
  const s = postRoundStake(10, 0, 8000000, 2000000);
  assert.equal(s, 8);
});

test('postRoundStake holds a fully-participating holder at their stake', () => {
  // Taking exactly their pro-rata (10% of $2M) keeps them whole.
  const s = postRoundStake(10, 200000, 8000000, 2000000);
  assert.equal(s, 10);
});

test('postRoundStake returns null rather than a misleading zero', () => {
  assert.equal(postRoundStake(10, 0, 0, 0), null, 'no post-money → no answer');
});
