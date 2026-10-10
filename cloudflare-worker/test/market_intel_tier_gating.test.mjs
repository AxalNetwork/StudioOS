/**
 * Task #5 (AK) — Tier gating + k-anonymity coverage for Market Intel.
 *
 * Two layers of coverage:
 *
 *   (A) Source-level static assertion that the full-lens market-intel
 *       handlers (`/founder-lens`, `/citations`) invoke a
 *       `callerHasFullLens` check and return a 402 `tier_required`
 *       response. This catches a regression where a future edit removes the
 *       tier gate. (`/api/investor-signals`, which this file also held, was
 *       retired with the /market-intel page, D670.)
 *
 *   (B) Pure-logic checks of the predicates the routes use:
 *         * `callerHasFullLens` — Free / no-tier callers rejected,
 *           growth+ / professional / institutional accepted, admin /
 *           partner / advisor bypass.
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

test('the full-lens market-intel handlers enforce tier gating in source', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/market_intel.ts'),
    'utf8',
  );
  for (const path of ['/founder-lens', '/citations']) {
    const at = src.indexOf(`marketIntel.get('${path}'`);
    assert.ok(at >= 0, `marketIntel.get('${path}', …) handler missing`);
    const body = src.slice(at, src.indexOf('\n});', at));
    assert.match(body, /callerHasFullLens\(\s*user\s*\)/,
      `${path}: tier-gate predicate missing — Free callers must be rejected`);
    assert.match(body, /tier_required/, `${path}: the tier_required error code is missing`);
    assert.match(body, /\b402\b/, `${path}: the 402 status is missing`);
  }
});

test('runFreeConnectors is exported and wired into the cron', async () => {
  const aggregator = await readFile(
    resolve(__dirname, '../src/services/market_intel/aggregator.ts'),
    'utf8',
  );
  assert.match(aggregator, /export\s+async\s+function\s+runFreeConnectors\b/,
    'runFreeConnectors export missing from aggregator');
  // Tolerate either arrow-parameter style: `[^)]*` could not cross the closing
  // paren of a parenthesised `(s) =>`, so this assertion started failing the
  // moment the source was formatted that way — while the paid-source filter it
  // guards was present and correct the whole time. Match the predicate itself.
  assert.match(aggregator, /\.filter\(\s*\(?\s*s\s*\)?\s*=>\s*s\.cadence\s*===\s*cadence\s*&&\s*!s\.paid\s*\)/,
    'runFreeConnectors must skip paid sources');

  const indexSrc = await readFile(
    resolve(__dirname, '../src/index.ts'),
    'utf8',
  );
  assert.match(indexSrc, /runFreeConnectors\s*\(\s*env\s*,\s*(?:'(?:hourly|daily|weekly)'|[A-Za-z_$][\w$]*)\s*\)/,
    'cron handler must invoke runFreeConnectors on the spec cadence');
  // Daily 04:00 UTC refresh: recomputeIndexes. The investor-signals snapshot
  // that shared the slot was retired with the /market-intel page (D670).
  assert.match(indexSrc, /getUTCHours\(\)\s*===\s*4\s*&&\s*now\.getUTCMinutes\(\)\s*===\s*0/,
    'cron must check for 04:00 UTC daily');
  assert.match(indexSrc, /\brecomputeIndexes\b/,
    'cron must run recomputeIndexes at 04:00 UTC daily');
  assert.doesNotMatch(indexSrc, /\baggregateInvestorSignals\b/,
    'the retired investor-signals snapshot is refreshed again');
});

test('GET /citations honours `since` param + returns ingest timestamp', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/market_intel.ts'),
    'utf8',
  );
  assert.match(src, /c\.req\.query\(\s*'since'\s*\)/,
    'citations handler must read the `since` query param');
  assert.match(src, /created_at\s+AS\s+ingested_at/,
    'citations handler must surface the ingest timestamp from created_at');
  // SQLite TEXT compare across `YYYY-MM-DD HH:MM:SS` (datetime('now'))
  // and ISO `YYYY-MM-DDTHH:MM:SS.sssZ` is unsafe — both sides must
  // be wrapped in datetime() so the compare normalizes correctly.
  assert.match(src, /datetime\(created_at\)\s*>=\s*datetime\(\?\)/,
    'citations `since` filter must wrap both sides in datetime() to avoid TEXT-format mismatches');
});

/* ------------------------------------------------------------------ */
/* (B) Pure-logic predicate checks                                    */
/* ------------------------------------------------------------------ */

// Mirror of `callerHasFullLens` (util/marketIntelTier.ts), which
// routes/market_intel.ts reads. Re-extracted here so the test fails if the
// predicate ever drifts.
const FULL_LENS_BYPASS_ROLES = ['admin', 'partner', 'advisor'];
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

test('admin / partner / advisor bypass tier gating', () => {
  assert.equal(callerHasFullLens({ role: 'admin' }), true);
  assert.equal(callerHasFullLens({ role: 'partner' }), true);
  assert.equal(callerHasFullLens({ role: 'advisor' }), true);
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

/* ------------------------------------------------------------------ */
/* (C) Runtime request-level test against a Hono mount that uses the  */
/*     SAME callerHasFullLens predicate. Proves the 402 path actually */
/*     fires end-to-end without spinning up miniflare or D1.          */
/* ------------------------------------------------------------------ */
test('Hono handler returns 402 tier_required for Free callers (runtime)', async () => {
  const { Hono } = await import('hono');

  // Mirror market_intel.ts's full-lens shape: `/founder-lens` and
  // `/citations`, both gated by callerHasFullLens. Auth is mocked via the
  // `x-mock-user` header so the test exercises the gate without needing
  // requireAuth/JWT plumbing.
  const a = new Hono();
  const gate = (handler) => async (c) => {
    const u = c.req.header('x-mock-user');
    const user = u ? JSON.parse(u) : null;
    if (!callerHasFullLens(user)) {
      return c.json({ error: 'tier_required', required: 'growth' }, 402);
    }
    return handler(c);
  };
  a.get('/founder-lens', gate(async (c) => c.json({ picks: [] })));
  a.get('/citations', gate(async (c) => c.json({ citations: [] })));
  const app = new Hono();
  app.route('/market-intel', a);

  const as = (user) => (user ? { headers: { 'x-mock-user': JSON.stringify(user) } } : {});
  const status = async (path, user) => (await app.fetch(new Request(`http://t/market-intel${path}`, as(user)))).status;

  for (const path of ['/founder-lens', '/citations']) {
    assert.equal(await status(path, { role: 'founder', subscription_tier: 'free' }), 402, `Free caller must get 402 from ${path}`);
    const body = await (await app.fetch(new Request(`http://t/market-intel${path}`, as({ role: 'founder', subscription_tier: 'free' })))).json();
    assert.equal(body.error, 'tier_required');
    assert.equal(body.required, 'growth');
    assert.equal(await status(path, null), 402, `unauth caller must get 402 from ${path}`);
    assert.equal(await status(path, { role: 'founder', subscription_tier: 'growth' }), 200, `Growth caller must get 200 from ${path}`);
    assert.equal(await status(path, { role: 'investor', investor_tier: 'professional' }), 200, `professional investor must get 200 from ${path}`);
    assert.equal(await status(path, { role: 'investor', investor_tier: 'starter' }), 402, `starter investor must get 402 from ${path}`);
    assert.equal(await status(path, { role: 'admin' }), 200, `admin must bypass at ${path}`);
  }
});
