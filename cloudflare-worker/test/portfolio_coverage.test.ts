/**
 * Task #30 — Portfolio Coverage scoring + aggregate regression tests.
 *
 * The /api/portfolio/coverage endpoint computes per-company axis scores, gap
 * detection (score < 60), the >=3-gap "flagged" rule, and the portfolio
 * aggregate (mean per axis). None of this was covered, so a future change to
 * the radar service or thresholds could silently break the heatmap. This locks
 * in two layers:
 *
 *   (A) Pure-helper unit tests for the exact rules (gap / flag / aggregate /
 *       fund_id validation), independent of auth + D1 + the radar service.
 *   (B) Route-level integration tests driving the real Hono app via
 *       app.request() with a minted JWT and an in-memory D1 stub: admin/partner
 *       gating (403 for others), invalid fund_id (400), and the empty / teamless
 *       portfolio paths (zeros, all-gap, flagged) end-to-end.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_coverage.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import portfolio, {
  coverageGapAxes,
  isFlagged,
  aggregateAxes,
  validateFundId,
  GAP_THRESHOLD,
  MIN_GAP_AXES_TO_FLAG,
} from '../src/routes/portfolio.ts';

// ---------------------------------------------------------------------------
// (A) Pure scoring-rule unit tests.
// ---------------------------------------------------------------------------

test('coverageGapAxes: a gap is strictly below the threshold (60 is NOT a gap)', () => {
  const axes = { product: 59, engineering: 60, design: 100, gtm_sales: 0 };
  assert.deepEqual(coverageGapAxes(axes, GAP_THRESHOLD), ['product', 'gtm_sales']);
});

test('coverageGapAxes: defaults to GAP_THRESHOLD and preserves insertion order', () => {
  assert.equal(GAP_THRESHOLD, 60);
  const axes = { a: 10, b: 80, c: 30 };
  assert.deepEqual(coverageGapAxes(axes), ['a', 'c']);
});

test('isFlagged: flagged when gap count reaches MIN_GAP_AXES_TO_FLAG (3)', () => {
  assert.equal(MIN_GAP_AXES_TO_FLAG, 3);
  assert.equal(isFlagged(0), false);
  assert.equal(isFlagged(2), false);
  assert.equal(isFlagged(3), true);
  assert.equal(isFlagged(8), true);
});

test('aggregateAxes: each axis equals the mean of the companies\' axis scores', () => {
  const companies = [
    { x: 80, y: 40 },
    { x: 40, y: 0 },
    { x: 90, y: 50 },
  ];
  const agg = aggregateAxes(companies, ['x', 'y']);
  // Independent mean computation (the task's stated sanity check).
  const mean = (vals: number[]) => Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  assert.equal(agg.x, mean([80, 40, 90]));
  assert.equal(agg.y, mean([40, 0, 50]));
});

test('aggregateAxes: rounds the mean to 2 decimal places', () => {
  // 152 / 3 = 50.666... -> 50.67
  assert.equal(aggregateAxes([{ x: 50 }, { x: 51 }, { x: 51 }], ['x']).x, 50.67);
});

test('aggregateAxes: empty portfolio yields zeros (no divide-by-zero)', () => {
  assert.deepEqual(aggregateAxes([], ['x', 'y']), { x: 0, y: 0 });
});

test('validateFundId: empty/undefined means unscoped (fundId 0)', () => {
  assert.deepEqual(validateFundId(undefined), { ok: true, fundId: 0 });
  assert.deepEqual(validateFundId(''), { ok: true, fundId: 0 });
});

test('validateFundId: positive integers parse; non-numeric is rejected', () => {
  assert.deepEqual(validateFundId('5'), { ok: true, fundId: 5 });
  assert.deepEqual(validateFundId('0'), { ok: true, fundId: 0 });
  assert.deepEqual(validateFundId('abc'), { ok: false });
  assert.deepEqual(validateFundId('1.5'), { ok: false });
  assert.deepEqual(validateFundId('-1'), { ok: false });
});

// ---------------------------------------------------------------------------
// (B) Route-level integration tests (real Hono app + minted JWT + D1 stub).
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** In-memory D1 stub. Resolves only the statements the coverage path runs:
 *  the user lookup (auth), the skills load (radar), the projects list, and the
 *  fund lookup. The ensure-schema batches are accepted as no-ops. */
function makeEnv(opts: { user: any; projects?: any[]; fund?: any }): any {
  const { user, projects = [], fund = null } = opts;
  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    const api: any = {
      bind: (..._a: any[]) => api,
      async all() {
        if (s.includes('from users where id')) return { results: user ? [user] : [] };
        if (s.includes('from skills')) return { results: [] };
        if (s.includes('from projects')) return { results: projects };
        if (s.includes('from vc_funds')) return { results: fund ? [fund] : [] };
        return { results: [] };
      },
      async first() {
        if (s.includes('from vc_funds')) return fund;
        return null;
      },
      async run() { return { meta: { changes: 0 } }; },
    };
    return api;
  };
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
}

function getCoverage(env: any, token: string, query = ''): Promise<Response> {
  return portfolio.request(
    '/coverage' + query,
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
}

test('coverage: non-admin/partner roles are forbidden (403)', async () => {
  for (const role of ['founder', 'investor', 'advisor', 'guest']) {
    const token = await mintToken(1, role);
    const env = makeEnv({ user: { id: 1, role, is_active: 1 } });
    const res = await getCoverage(env, token);
    assert.equal(res.status, 403, `role ${role} should be forbidden`);
  }
});

test('coverage: admin and partner are allowed (200)', async () => {
  for (const role of ['admin', 'partner']) {
    const token = await mintToken(7, role);
    const env = makeEnv({ user: { id: 7, role, is_active: 1 }, projects: [] });
    const res = await getCoverage(env, token);
    assert.equal(res.status, 200, `role ${role} should be allowed`);
  }
});

test('coverage: invalid fund_id is a client error (400)', async () => {
  const token = await mintToken(7, 'admin');
  const env = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 } });
  const res = await getCoverage(env, token, '?fund_id=not-a-number');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { detail?: string };
  assert.match(body.detail || '', /fund_id/);
});

test('coverage: empty portfolio returns zeros gracefully', async () => {
  const token = await mintToken(7, 'admin');
  const env = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, projects: [] });
  const res = await getCoverage(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.company_count, 0);
  assert.equal(body.flagged_count, 0);
  assert.deepEqual(body.companies, []);
  // Every axis aggregate is 0 (not NaN / undefined).
  assert.ok(body.axes.length > 0);
  for (const ax of body.axes) {
    assert.equal(body.aggregate[ax.slug], 0);
  }
});

test('coverage: a teamless company scores zero on every axis -> all-gap + flagged', async () => {
  const token = await mintToken(7, 'admin');
  const project = {
    id: 1, uid: 'p1', name: 'Acme', sector: 'AI', stage: 'seed', founder_id: null,
  };
  const env = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, projects: [project] });
  const res = await getCoverage(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.company_count, 1);
  const company = body.companies[0];
  assert.equal(company.team_size, 0);
  // No team -> every axis is 0, so every axis is a gap (0 < 60) and the
  // company trips the >=3-gap flag.
  assert.equal(company.gap_count, body.axes.length);
  assert.ok(company.gap_count >= MIN_GAP_AXES_TO_FLAG);
  assert.equal(company.flagged, true);
  assert.equal(body.flagged_count, 1);
  for (const ax of body.axes) {
    assert.equal(company.axes[ax.slug], 0);
    assert.equal(body.aggregate[ax.slug], 0);
  }
});
