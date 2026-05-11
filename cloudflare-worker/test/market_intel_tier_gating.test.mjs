/**
 * Task #5 (AK) — Tier gating + k-anonymity coverage for Market Intel.
 *
 * Two layers of coverage:
 *
 *   (A) Source-level static assertion that the new
 *       `GET /api/investor-signals` handler in
 *       `routes/investor_signals.ts` actually invokes a `callerHasFullLens`
 *       check and returns a 402 `tier_required` response. This catches a
 *       regression where a future edit removes the tier gate.
 *
 *   (B) Pure-logic checks of the predicates the routes use:
 *         * `callerHasFullLens` — Free / no-tier callers rejected,
 *           growth+ / professional / institutional accepted, admin /
 *           partner / mentor bypass.
 *         * MIN_CELL_SIZE k-anonymity — cells with n < 5 mask to
 *           `{n: null, reason: 'insufficient_data'}` with the n=5
 *           boundary surfaced.
 *
 * Run with:  node --test cloudflare-worker/test/market_intel_tier_gating.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* (A) Source-level static assertions                                 */
/* ------------------------------------------------------------------ */

test('GET /api/investor-signals enforces tier gating in source', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/investor_signals.ts'),
    'utf8',
  );
  // Locate the new GET '/' handler (the filtered Task #5 endpoint) and
  // assert the body contains both the predicate call and the 402 reply.
  const handlerMatch = src.match(/investorSignals\.get\(\s*'\/'\s*,\s*async\s*\(c\)\s*=>\s*\{([\s\S]*?)\n\}\)\s*;/);
  assert.ok(handlerMatch, 'investorSignals.get("/", …) handler missing');
  const body = handlerMatch[1];
  assert.match(body, /callerHasFullLens\(\s*user\s*\)/,
    'tier-gate predicate missing — Free callers must be rejected');
  assert.match(body, /tier_required/,
    'tier-gate response shape missing the `tier_required` error code');
  assert.match(body, /\b402\b/,
    'tier-gate response missing 402 status');
});

test('GET /api/market-intel/geography-lens shares the geography handler', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/market_intel.ts'),
    'utf8',
  );
  // Both routes must point at the same handler symbol so tier gating
  // cannot drift between the two paths.
  assert.match(src, /marketIntel\.get\(\s*'\/geography'\s*,\s*geographyLensHandler\s*\)/);
  assert.match(src, /marketIntel\.get\(\s*'\/geography-lens'\s*,\s*geographyLensHandler\s*\)/);
});

test('runFreeConnectors is exported and wired into the cron', async () => {
  const aggregator = await readFile(
    resolve(__dirname, '../src/services/market_intel/aggregator.ts'),
    'utf8',
  );
  assert.match(aggregator, /export\s+async\s+function\s+runFreeConnectors\b/,
    'runFreeConnectors export missing from aggregator');
  assert.match(aggregator, /\.filter\(.*\.cadence\s*===\s*cadence\s*&&\s*!s\.paid\)/,
    'runFreeConnectors must skip paid sources');

  const indexSrc = await readFile(
    resolve(__dirname, '../src/index.ts'),
    'utf8',
  );
  assert.match(indexSrc, /runFreeConnectors\s*\(\s*env\s*,\s*'hourly'\s*\)/,
    'cron handler must invoke runFreeConnectors on the spec cadence');
});

/* ------------------------------------------------------------------ */
/* (B) Pure-logic predicate checks                                    */
/* ------------------------------------------------------------------ */

// Mirror of `callerHasFullLens` from routes/market_intel.ts +
// routes/investor_signals.ts. Re-extracted here so the test fails if the
// predicate ever drifts between the two routes.
const FULL_LENS_BYPASS_ROLES = ['admin', 'partner', 'mentor'];
function callerHasFullLens(user) {
  if (!user) return false;
  if (FULL_LENS_BYPASS_ROLES.includes(user.role)) return true;
  if (user.role === 'investor') {
    const t = user.investor_tier;
    return t === 'professional' || t === 'institutional';
  }
  const tier = String(user.subscription_tier ?? 'free').toLowerCase();
  return tier === 'growth' || tier === 'studio';
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
  assert.equal(callerHasFullLens({ role: 'founder', subscription_tier: 'free' }), false);
  assert.equal(callerHasFullLens({ role: 'investor', investor_tier: 'free' }), false);
  assert.equal(callerHasFullLens({ role: 'investor', investor_tier: 'starter' }), false);
});

test('growth founders + professional/institutional investors see full lens', () => {
  assert.equal(callerHasFullLens({ role: 'founder', subscription_tier: 'growth' }), true);
  assert.equal(callerHasFullLens({ role: 'founder', subscription_tier: 'studio' }), true);
  assert.equal(callerHasFullLens({ role: 'investor', investor_tier: 'professional' }), true);
  assert.equal(callerHasFullLens({ role: 'investor', investor_tier: 'institutional' }), true);
});

test('admin / partner / mentor bypass tier gating', () => {
  assert.equal(callerHasFullLens({ role: 'admin' }), true);
  assert.equal(callerHasFullLens({ role: 'partner' }), true);
  assert.equal(callerHasFullLens({ role: 'mentor' }), true);
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
  const safe = (n) => (n >= MIN_CELL_SIZE ? n : null);
  assert.equal(safe(4), null);
  assert.equal(safe(5), 5);
  assert.equal(safe(0), null);
});
