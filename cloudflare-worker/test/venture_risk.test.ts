/**
 * Task #9 — Venture Risk scoring + route regression tests.
 *
 * Two layers, mirroring portfolio_coverage.test.ts:
 *
 *   (A) Pure-helper unit tests for the exact scoring rules (band thresholds,
 *       band colors, graceful empty inputs, analyst-override precedence, overall
 *       mean), independent of auth + D1.
 *   (B) Route-level integration tests driving the real Hono app via
 *       venture.request() with a minted JWT and an in-memory D1 stub: the
 *       internal-deal-team read gate (admin/partner/investor allowed, founder
 *       forbidden), the analyst-write gate (admin/partner only), invalid
 *       project_id / layer_key / score validation, the 404 path, and the
 *       analyst-override upsert end-to-end.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/venture_risk.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import venture from '../src/routes/venture_risk.ts';
import {
  LAYERS,
  LAYER_KEYS,
  isLayerKey,
  scoreToBand,
  bandColor,
  computeAutoLayers,
  mergeLayers,
  overallFromLayers,
  parseHeadcount,
  LOW_RISK_MIN,
  MED_RISK_MIN,
  type LayerKey,
  type OverrideInput,
} from '../src/services/ventureRisk.ts';

// ---------------------------------------------------------------------------
// (A) Pure scoring-rule unit tests.
// ---------------------------------------------------------------------------

test('LAYERS: exactly the 10 named layers, keys unique and stable', () => {
  assert.equal(LAYERS.length, 10);
  assert.deepEqual(
    LAYER_KEYS.slice(),
    ['founder', 'market', 'competition', 'timing', 'financing',
     'marketing', 'distribution', 'technology', 'product', 'hiring'],
  );
  assert.equal(new Set(LAYER_KEYS).size, 10);
  for (const l of LAYERS) {
    assert.ok(l.label && l.thesis && l.proof_signal, `${l.key} has full metadata`);
  }
});

test('isLayerKey: only the 10 keys pass', () => {
  assert.equal(isLayerKey('founder'), true);
  assert.equal(isLayerKey('hiring'), true);
  assert.equal(isLayerKey('nope'), false);
  assert.equal(isLayerKey(''), false);
  assert.equal(isLayerKey(42 as unknown), false);
});

test('scoreToBand: high score = LOW risk; thresholds are inclusive at the floor', () => {
  assert.equal(LOW_RISK_MIN, 67);
  assert.equal(MED_RISK_MIN, 34);
  assert.equal(scoreToBand(100), 'low');
  assert.equal(scoreToBand(67), 'low');
  assert.equal(scoreToBand(66.9), 'medium');
  assert.equal(scoreToBand(34), 'medium');
  assert.equal(scoreToBand(33.9), 'high');
  assert.equal(scoreToBand(0), 'high');
  // Out-of-range / non-finite clamps to a high risk band, never throws.
  assert.equal(scoreToBand(-10), 'high');
  assert.equal(scoreToBand(NaN), 'high');
});

test('bandColor: low->emerald, medium->amber, high->red', () => {
  assert.equal(bandColor('low'), 'emerald');
  assert.equal(bandColor('medium'), 'amber');
  assert.equal(bandColor('high'), 'red');
});

test('parseHeadcount: pulls the leading integer out of free text', () => {
  assert.equal(parseHeadcount('11-50'), 11);
  assert.equal(parseHeadcount('5'), 5);
  assert.equal(parseHeadcount('Solo'), null);
  assert.equal(parseHeadcount(null), null);
  assert.equal(parseHeadcount(undefined), null);
});

test('computeAutoLayers: empty inputs -> all 10 layers, score 0, has_data false', () => {
  const auto = computeAutoLayers({ snapshot: null, project: null });
  assert.equal(Object.keys(auto).length, 10);
  for (const key of LAYER_KEYS) {
    assert.equal(auto[key].score, 0, `${key} score is 0`);
    assert.equal(auto[key].has_data, false, `${key} has_data is false`);
    assert.deepEqual(auto[key].signals, [], `${key} has no signals`);
  }
});

test('computeAutoLayers: a strong snapshot produces de-risked layers with data', () => {
  const auto = computeAutoLayers({
    snapshot: {
      market_total: 25, team_total: 20, product_total: 15, capital_total: 15,
      fit_total: 15, distribution_total: 10, market_trend: 5, market_urgency: 10,
    },
    project: { revenue: 100000, users_count: 20000, growth_signals: 'MoM 30%', why_now: 'AI shift' },
  });
  // Full sub-scores normalize to 100 for the snapshot-backed layers.
  assert.equal(auto.founder.score, 100);
  assert.equal(auto.competition.score, 100);
  assert.equal(auto.technology.score, 100);
  assert.equal(auto.distribution.score, 100);
  assert.ok(auto.market.has_data && auto.market.score > 0);
  assert.ok(auto.product.has_data && auto.product.score > 0);
  assert.ok(auto.timing.has_data && auto.timing.signals.includes('Why-now narrative'));
});

test('computeAutoLayers: clamps so no layer can exceed 100', () => {
  const auto = computeAutoLayers({
    snapshot: {
      market_total: 999, team_total: 999, product_total: 999, capital_total: 999,
      fit_total: 999, distribution_total: 999, market_trend: 999, market_urgency: 999,
    },
    project: { revenue: 9_000_000, users_count: 9_000_000, growth_signals: 'x', why_now: 'y' },
  });
  for (const key of LAYER_KEYS) {
    assert.ok(auto[key].score <= 100, `${key} <= 100`);
    assert.ok(auto[key].score >= 0, `${key} >= 0`);
  }
});

test('mergeLayers: analyst score override wins over the auto score', () => {
  const auto = computeAutoLayers({ snapshot: null, project: null }); // all 0/high
  const overrides = new Map<LayerKey, OverrideInput>([
    ['founder', { layer_key: 'founder', analyst_score: 90, analyst_note: 'Repeat founder' }],
  ]);
  const merged = mergeLayers(auto, overrides);
  const founder = merged.find((l) => l.key === 'founder')!;
  assert.equal(founder.auto_score, 0);
  assert.equal(founder.auto_band, 'high');
  assert.equal(founder.score, 90); // effective = override
  assert.equal(founder.band, 'low');
  assert.equal(founder.color, 'emerald');
  assert.equal(founder.is_overridden, true);
  assert.equal(founder.analyst_score, 90);
  // A non-overridden layer keeps its auto values.
  const market = merged.find((l) => l.key === 'market')!;
  assert.equal(market.is_overridden, false);
  assert.equal(market.score, market.auto_score);
});

test('mergeLayers: an explicit analyst_band overrides the derived band', () => {
  const auto = computeAutoLayers({
    snapshot: { team_total: 20 }, project: null, // founder auto = 100 -> low
  });
  const overrides = new Map<LayerKey, OverrideInput>([
    ['founder', { layer_key: 'founder', analyst_band: 'high' }],
  ]);
  const founder = mergeLayers(auto, overrides).find((l) => l.key === 'founder')!;
  assert.equal(founder.auto_band, 'low');
  assert.equal(founder.band, 'high'); // explicit band wins
  assert.equal(founder.is_overridden, true);
});

test('mergeLayers: a bare status=open row is NOT treated as an override', () => {
  const auto = computeAutoLayers({ snapshot: null, project: null });
  const overrides = new Map<LayerKey, OverrideInput>([
    ['market', { layer_key: 'market', status: 'open', analyst_score: null }],
  ]);
  const market = mergeLayers(auto, overrides).find((l) => l.key === 'market')!;
  assert.equal(market.is_overridden, false);
});

test('overallFromLayers: overall is the mean of the effective per-layer scores', () => {
  const auto = computeAutoLayers({ snapshot: null, project: null }); // all 0
  const overrides = new Map<LayerKey, OverrideInput>([
    ['founder', { layer_key: 'founder', analyst_score: 100 }],
    ['market', { layer_key: 'market', analyst_score: 50 }],
  ]);
  const merged = mergeLayers(auto, overrides);
  const overall = overallFromLayers(merged);
  // (100 + 50 + eight zeros) / 10 = 15
  assert.equal(overall.score, 15);
  assert.equal(overall.band, scoreToBand(15));
});

test('overallFromLayers: empty layer list yields a safe high-risk zero', () => {
  const overall = overallFromLayers([]);
  assert.equal(overall.score, 0);
  assert.equal(overall.band, 'high');
  assert.equal(overall.color, 'red');
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

/** In-memory D1 stub. Resolves the auth user lookup, the project + snapshot
 *  reads, the overrides list, and records writes (upsert / delete) for assertion. */
function makeEnv(opts: {
  user: any;
  project?: any;
  snapshot?: any;
  overrides?: any[];
  projects?: any[];
}): { env: any; writes: Array<{ sql: string; bound: any[] }> } {
  const { user, project = null, snapshot = null, overrides = [], projects = [] } = opts;
  const writes: Array<{ sql: string; bound: any[] }> = [];
  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) return { results: user ? [user] : [] };
        if (s.includes('from venture_risk_overrides')) return { results: overrides };
        if (s.includes('from projects')) return { results: projects };
        return { results: [] };
      },
      async first() {
        if (s.includes('from projects') && s.includes('where id')) return project;
        if (s.includes('from score_snapshots')) return snapshot;
        return null;
      },
      async run() {
        writes.push({ sql: s, bound });
        return { meta: { changes: 1 } };
      },
    };
    return api;
  };
  const env = {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
  return { env, writes };
}

const SAMPLE_PROJECT = {
  id: 1, name: 'Acme', sector: 'AI', stage: 'seed', revenue: 0, users_count: 0,
  growth_signals: null, why_now: null, funding_needed: null, total_funding: null,
  cost_to_mvp: null, employee_count: null,
};

function req(env: any, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return venture.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } }, env);
}

test('by-project: founder and guest roles are forbidden (403)', async () => {
  for (const role of ['founder', 'guest']) {
    const token = await mintToken(1, role);
    const { env } = makeEnv({ user: { id: 1, role, is_active: 1 }, project: SAMPLE_PROJECT });
    const res = await req(env, token, '/by-project/1');
    assert.equal(res.status, 403, `role ${role} should be forbidden`);
  }
});

test('by-project: admin/partner/investor are allowed and get 10 layers + overall', async () => {
  for (const role of ['admin', 'partner', 'investor']) {
    const token = await mintToken(7, role);
    const { env } = makeEnv({ user: { id: 7, role, is_active: 1 }, project: SAMPLE_PROJECT });
    const res = await req(env, token, '/by-project/1');
    assert.equal(res.status, 200, `role ${role} should be allowed`);
    const body = (await res.json()) as any;
    assert.equal(body.project_id, 1);
    assert.equal(body.layers.length, 10);
    assert.ok(typeof body.overall_score === 'number');
    assert.ok(['low', 'medium', 'high'].includes(body.overall_band));
  }
});

test('by-project: invalid project_id is a client error (400)', async () => {
  const token = await mintToken(7, 'admin');
  const { env } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 } });
  const res = await req(env, token, '/by-project/not-a-number');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { detail?: string };
  assert.match(body.detail || '', /project_id/);
});

test('by-project: a missing project is a 404', async () => {
  const token = await mintToken(7, 'admin');
  const { env } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, project: null });
  const res = await req(env, token, '/by-project/999');
  assert.equal(res.status, 404);
});

test('PUT layer: founder is forbidden (403)', async () => {
  const token = await mintToken(2, 'founder');
  const { env } = makeEnv({ user: { id: 2, role: 'founder', is_active: 1 }, project: SAMPLE_PROJECT });
  const res = await req(env, token, '/1/layers/founder', {
    method: 'PUT',
    body: JSON.stringify({ analyst_score: 80 }),
  });
  assert.equal(res.status, 403);
});

test('PUT layer: investor cannot write (analyst write is admin/partner only)', async () => {
  const token = await mintToken(2, 'investor');
  const { env } = makeEnv({ user: { id: 2, role: 'investor', is_active: 1 }, project: SAMPLE_PROJECT });
  const res = await req(env, token, '/1/layers/founder', {
    method: 'PUT',
    body: JSON.stringify({ analyst_score: 80 }),
  });
  assert.equal(res.status, 403);
});

test('PUT layer: admin upserts an analyst override (200, write recorded)', async () => {
  const token = await mintToken(7, 'admin');
  const { env, writes } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, project: SAMPLE_PROJECT });
  const res = await req(env, token, '/1/layers/founder', {
    method: 'PUT',
    body: JSON.stringify({ analyst_score: 88, analyst_note: 'Repeat founder', status: 'mitigating' }),
  });
  assert.equal(res.status, 200);
  const upserts = writes.filter((w) => w.sql.includes('insert into venture_risk_overrides'));
  assert.equal(upserts.length, 1);
  assert.ok(upserts[0].sql.includes('on conflict'));
  // bound: projectId, layerKey, score, band, note, status, userId
  assert.deepEqual(upserts[0].bound.slice(0, 3), [1, 'founder', 88]);
});

test('PUT layer: an unknown layer key is rejected (400)', async () => {
  const token = await mintToken(7, 'admin');
  const { env } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, project: SAMPLE_PROJECT });
  const res = await req(env, token, '/1/layers/bogus', {
    method: 'PUT',
    body: JSON.stringify({ analyst_score: 50 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { detail?: string };
  assert.match(body.detail || '', /layer_key/);
});

test('PUT layer: an out-of-range analyst_score is rejected (400)', async () => {
  const token = await mintToken(7, 'admin');
  const { env } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, project: SAMPLE_PROJECT });
  for (const bad of [101, -5, 'abc']) {
    const res = await req(env, token, '/1/layers/market', {
      method: 'PUT',
      body: JSON.stringify({ analyst_score: bad }),
    });
    assert.equal(res.status, 400, `score ${bad} should be rejected`);
  }
});

test('DELETE layer: admin clears an override (200, delete recorded)', async () => {
  const token = await mintToken(7, 'admin');
  const { env, writes } = makeEnv({ user: { id: 7, role: 'admin', is_active: 1 }, project: SAMPLE_PROJECT });
  const res = await req(env, token, '/1/layers/founder', { method: 'DELETE' });
  assert.equal(res.status, 200);
  const deletes = writes.filter((w) => w.sql.includes('delete from venture_risk_overrides'));
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].bound, [1, 'founder']);
});

test('matrix: forbidden for founder, allowed for admin with company rows', async () => {
  const founderToken = await mintToken(2, 'founder');
  const { env: fEnv } = makeEnv({ user: { id: 2, role: 'founder', is_active: 1 } });
  assert.equal((await req(fEnv, founderToken, '/matrix')).status, 403);

  const adminToken = await mintToken(7, 'admin');
  const { env } = makeEnv({
    user: { id: 7, role: 'admin', is_active: 1 },
    projects: [SAMPLE_PROJECT, { ...SAMPLE_PROJECT, id: 2, name: 'Beta' }],
  });
  const res = await req(env, adminToken, '/matrix');
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.company_count, 2);
  assert.equal(body.layers.length, 10);
  assert.equal(Object.keys(body.companies[0].layers).length, 10);
});
