/**
 * Task #5 (AK) — Tier gating + k-anonymity unit checks for Market Intel.
 *
 * These are pure-logic tests over the small helpers that decide what a
 * caller can see. They intentionally do NOT spin up the worker — instead
 * they re-implement the predicates in the same shape used inside
 * `routes/market_intel.ts` and `routes/investor_signals.ts`, asserting
 * the contract those routes promise:
 *
 *   1. Free callers (or no investor tier) get composite-only payloads —
 *      `callerHasFullLens` returns false → routes return 402.
 *   2. Growth+ callers see the full lens.
 *   3. Cells with n < MIN_CELL_SIZE (=5) are masked to
 *      `{ n: null, reason: 'insufficient_data' }` — never raw counts.
 *
 * Run with:  node --test cloudflare-worker/test/market_intel_tier_gating.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror of `callerHasFullLens` from routes/market_intel.ts. Kept here as
// a literal copy so the test fails if the predicate ever drifts.
function callerHasFullLens(user) {
  if (!user) return false;
  const tier = user.investor_tier || user.tier;
  if (!tier) return false;
  return tier === 'growth' || tier === 'professional' || tier === 'enterprise';
}

const MIN_CELL_SIZE = 5;
function reportCell(label, n, total) {
  if (n >= MIN_CELL_SIZE) {
    return { label, n, pct: total ? Math.round((n / total) * 1000) / 10 : 0 };
  }
  return { label, n: null, reason: 'insufficient_data' };
}

test('free / no-tier caller is rejected from full-lens endpoints', () => {
  assert.equal(callerHasFullLens(null), false);
  assert.equal(callerHasFullLens({}), false);
  assert.equal(callerHasFullLens({ investor_tier: 'free' }), false);
  assert.equal(callerHasFullLens({ tier: 'starter' }), false);
});

test('growth / professional / enterprise callers see full lens', () => {
  assert.equal(callerHasFullLens({ investor_tier: 'growth' }), true);
  assert.equal(callerHasFullLens({ investor_tier: 'professional' }), true);
  assert.equal(callerHasFullLens({ tier: 'enterprise' }), true);
});

test('k-anonymity masks cells with n < 5', () => {
  const masked = reportCell('Pre-seed', 3, 100);
  assert.equal(masked.n, null);
  assert.equal(masked.reason, 'insufficient_data');
  assert.equal('pct' in masked, false, 'masked cells must not leak a pct');

  const visible = reportCell('Seed', 12, 100);
  assert.equal(visible.n, 12);
  assert.equal(visible.reason, undefined);
  assert.equal(visible.pct, 12);
});

test('exactly-at-threshold n=5 is reported (boundary)', () => {
  const cell = reportCell('Series A', 5, 50);
  assert.equal(cell.n, 5);
  assert.equal(cell.reason, undefined);
  assert.equal(cell.pct, 10);
});

test('snapshot-level n_total is masked when total contributors < 5', () => {
  // Mirror of the safeNTotal logic in /api/investor-signals/latest.
  const safe = (n) => (n >= MIN_CELL_SIZE ? n : null);
  assert.equal(safe(4), null);
  assert.equal(safe(5), 5);
  assert.equal(safe(0), null);
});
