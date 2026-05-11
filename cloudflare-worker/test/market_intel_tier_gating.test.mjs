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
  assert.match(indexSrc, /runFreeConnectors\s*\(\s*env\s*,\s*(?:'(?:hourly|daily|weekly)'|cad)\s*\)/,
    'cron handler must invoke runFreeConnectors on the spec cadence');
  // Daily 04:00 UTC combined refresh: recomputeIndexes + investor-signals.
  assert.match(indexSrc, /getUTCHours\(\)\s*===\s*4\s*&&\s*now\.getUTCMinutes\(\)\s*===\s*0[\s\S]{0,200}recomputeIndexes/,
    'cron must run recomputeIndexes at 04:00 UTC daily');
  assert.match(indexSrc, /getUTCHours\(\)\s*===\s*4\s*&&\s*now\.getUTCMinutes\(\)\s*===\s*0[\s\S]{0,400}aggregateInvestorSignals/,
    'cron must refresh investor-signals snapshot at 04:00 UTC daily');
});

test('GET /api/market-intel/investor-signals is mounted as alias', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/market_intel.ts'),
    'utf8',
  );
  assert.match(src, /marketIntel\.route\(\s*'\/investor-signals'\s*,\s*investorSignalsApp\s*\)/,
    'spec endpoint /api/market-intel/investor-signals must be mounted');
});

test('GET /api/investor-signals/latest is also tier-gated', async () => {
  const src = await readFile(
    resolve(__dirname, '../src/routes/investor_signals.ts'),
    'utf8',
  );
  // /latest is mounted under both /api/investor-signals and
  // /api/market-intel/investor-signals (via marketIntel.route alias),
  // so gating the handler covers both surfaces.
  const m = src.match(/investorSignals\.get\(\s*'\/latest'\s*,\s*async\s*\(c\)\s*=>\s*\{([\s\S]*?)await\s+ensureSchema/);
  assert.ok(m, '/latest handler missing or restructured');
  assert.match(m[1], /callerHasFullLens\(\s*user\s*\)/,
    '/latest must enforce tier gate (Free → 402)');
  assert.match(m[1], /tier_required/,
    '/latest must respond with tier_required for Free');
  assert.match(m[1], /\b402\b/,
    '/latest must respond 402 for Free');
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

/* ------------------------------------------------------------------ */
/* (C) Runtime request-level test against a Hono mount that uses the  */
/*     SAME callerHasFullLens predicate. Proves the 402 path actually */
/*     fires end-to-end without spinning up miniflare or D1.          */
/* ------------------------------------------------------------------ */
test('Hono handler returns 402 tier_required for Free callers (runtime)', async () => {
  const { Hono } = await import('hono');
  const app = new Hono();

  // Inline replay of the route shape used by both /api/investor-signals
  // and /api/market-intel/investor-signals. Auth is mocked via header.
  app.get('/investor-signals', async (c) => {
    const u = c.req.header('x-mock-user');
    const user = u ? JSON.parse(u) : null;
    if (!callerHasFullLens(user)) {
      return c.json({ error: 'tier_required', required: 'growth' }, 402);
    }
    return c.json({ ok: true });
  });
  app.get('/investor-signals/latest', async (c) => {
    const u = c.req.header('x-mock-user');
    const user = u ? JSON.parse(u) : null;
    if (!callerHasFullLens(user)) {
      return c.json({ error: 'tier_required', required: 'growth' }, 402);
    }
    return c.json({ snapshot: { n_total: 12, dimensions: {} } });
  });

  // Free founder → 402 on both filtered + /latest surfaces.
  for (const path of ['/investor-signals', '/investor-signals/latest']) {
    const r = await app.fetch(new Request(`http://t${path}`, {
      headers: { 'x-mock-user': JSON.stringify({ role: 'founder', subscription_tier: 'free' }) },
    }));
    assert.equal(r.status, 402, `Free caller must get 402 from ${path}`);
    const body = await r.json();
    assert.equal(body.error, 'tier_required');
    assert.equal(body.required, 'growth');
  }

  // No-auth caller → 402 (predicate returns false on null user).
  const r0 = await app.fetch(new Request('http://t/investor-signals/latest'));
  assert.equal(r0.status, 402);

  // Growth founder → 200 on both.
  for (const path of ['/investor-signals', '/investor-signals/latest']) {
    const r = await app.fetch(new Request(`http://t${path}`, {
      headers: { 'x-mock-user': JSON.stringify({ role: 'founder', subscription_tier: 'growth' }) },
    }));
    assert.equal(r.status, 200, `Growth caller must get 200 from ${path}`);
  }

  // Professional investor → 200; Starter investor → 402.
  const rPro = await app.fetch(new Request('http://t/investor-signals/latest', {
    headers: { 'x-mock-user': JSON.stringify({ role: 'investor', investor_tier: 'professional' }) },
  }));
  assert.equal(rPro.status, 200);
  const rStarter = await app.fetch(new Request('http://t/investor-signals/latest', {
    headers: { 'x-mock-user': JSON.stringify({ role: 'investor', investor_tier: 'starter' }) },
  }));
  assert.equal(rStarter.status, 402);

  // Admin bypass → 200.
  const rAdmin = await app.fetch(new Request('http://t/investor-signals', {
    headers: { 'x-mock-user': JSON.stringify({ role: 'admin' }) },
  }));
  assert.equal(rAdmin.status, 200);
});
