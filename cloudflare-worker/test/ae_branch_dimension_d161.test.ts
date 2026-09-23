/**
 * D161 — the branch dimension AE never carried, and the dataset name nothing read.
 *
 * WHAT D105 CLAIMED AND WHAT WAS BUILT. D105 kept the Analytics Engine dataset
 * SHARED across branches — against the per-branch physical isolation the whole
 * design rests on — on the stated grounds that "One dataset indexed by
 * BRANCH_CODE is what makes those two numbers possible without a cross-branch
 * read." It was never indexed by branch. The repo's only `writeDataPoint`
 * wrote `indexes: [path]` and no branch code in any index, blob or double, and
 * the reader hardcoded `FROM studioos_metrics` with no branch dimension at
 * all. So the write-side half of D105's own justification did not exist, and
 * any per-branch AE query returned nothing.
 *
 * WHY THE BRANCH IS A BLOB AND NOT AN INDEX, asserted rather than asserted-in-
 * prose. The first index is the SAMPLING KEY. Making the branch an index would
 * change the sampling key for every request on the platform, so samples either
 * side of the change stop being comparable and route-level sampling fairness —
 * the reason `path` is the key — is lost. It could not even be verified from
 * here: `AnalyticsEngineDataPoint.indexes` is typed as an UNBOUNDED array, so a
 * second index typechecks, and the write site swallows failures with a
 * `console.warn`. A silent runtime rejection is the one failure mode a metrics
 * write must not have. The first test below pins the indexes array whole, so
 * the tidy-it-into-an-index edit fails rather than passing quietly.
 *
 * WHY THE SPLIT IS SUPER-ADMIN AND THE AGGREGATE IS UNCHANGED — the assertion
 * this whole change exists for. `/monitoring/analytics/technical` and
 * `/management` are `requireAdmin`, and on this platform's tier model a plain
 * admin IS a branch admin. Today they return platform-wide aggregates with no
 * branch attribution, which a branch admin may defensibly see. Letting the
 * branch dimension through them would turn an aggregate into per-branch
 * attribution — every branch admin reading every other branch's traffic, the
 * exact isolation the branch programme exists to create. So the split is its
 * own `requireSuperAdmin` route and the existing aggregate does not move; both
 * halves are asserted through the REAL router with a real JWT, because a gate
 * asserted by reading source text is a gate asserted by spelling.
 *
 * WHERE THE INJECTION RISK WENT. The AE SQL API takes `text/plain` and has no
 * binding mechanism at all — every value in these queries is interpolated. An
 * optional caller-supplied branch predicate was written first and had no
 * reader, so it was removed, and with it the only path by which a request value
 * could reach that SQL. What remains is asserted two ways: the interpolation
 * surface is enumerated below, and `BRANCH_CODE_RE` is shown to REFUSE a
 * quote-bearing value rather than escape it — which is what makes a malformed
 * branch a dropped metric instead of a row.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/ae_branch_dimension_d161.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { observabilityMiddleware } from '../src/middleware/observability.ts';
import {
  loadTrafficByBranch, loadTechnical, parseRange, loadActiveAccountsByBranchWeek,
} from '../src/services/analyticsReports.ts';
import { aeLoggedRequestPredicate, SKIP_ACTIVITY_LOG_PATHS, weekAxis } from '../src/services/activeAccounts.ts';
import { BRANCH_CODE_RE } from '../src/util/branch.ts';
import monitoringAnalytics from '../src/routes/monitoring_analytics.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORTS_SRC = readFileSync(resolve(root, 'cloudflare-worker/src/services/analyticsReports.ts'), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7; // an admin WITH a super_admins row
const PLAIN = 9;  // an admin without one

const AE_CREDS = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_AE_API_TOKEN: 'unit-test-ae-token',
};

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

/**
 * Stub `fetch` and record the SQL text each call carried. Restored in a
 * `finally` by every caller — a leaked stub would make a later test pass
 * against this one's answer.
 */
function stubFetch(handler: (url: string, init: any) => Response | Promise<Response>) {
  const real = globalThis.fetch;
  const seen: Array<{ url: string; body: string }> = [];
  (globalThis as any).fetch = async (url: any, init: any) => {
    seen.push({ url: String(url), body: String(init?.body ?? '') });
    return handler(String(url), init);
  };
  return {
    seen,
    sql: () => seen.map(s => s.body),
    restore: () => { (globalThis as any).fetch = real; },
  };
}

const aeOk = (data: unknown[]) => () => new Response(JSON.stringify({ data }), { status: 200 });

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The write site — what every request now carries, and where it carries it
// ─────────────────────────────────────────────────────────────────────────────

const METRICS_SCHEMA = `
  CREATE TABLE system_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_name TEXT NOT NULL,
    value REAL, labels TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
    actor TEXT, user_id INTEGER, endpoint TEXT, method TEXT, status_code INTEGER, latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT,
    method TEXT, status_code INTEGER, message TEXT, stack_snippet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

interface DataPoint { indexes?: unknown[]; blobs?: unknown[]; doubles?: unknown[] }

/** One real request through the real middleware, returning what AE was handed. */
async function oneRequest(vars: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(METRICS_SCHEMA);
  const points: DataPoint[] = [];
  const warned: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };

  const env: any = {
    ...vars,
    DB: makeD1(db),
    ANALYTICS: { writeDataPoint: (p: DataPoint) => { points.push(p); } },
  };
  const app = new Hono<any>();
  app.use('*', observabilityMiddleware());
  // The user is resolved by the rate-limit middleware in production and cached
  // on the context; `null` is the anonymous case and keeps this test off D1's
  // subscription hop, which is not what is under test here.
  app.use('*', async (c, next) => { (c as any).set('currentUser', null); await next(); });
  app.get('/api/projects', (c) => c.text('ok'));

  const pending: Promise<unknown>[] = [];
  const res = await app.request(
    '/api/projects',
    { method: 'GET' },
    env,
    { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as any,
  );
  await Promise.all(pending);
  console.warn = realWarn;

  const metrics = db.prepare('SELECT * FROM system_metrics').all() as any[];
  return { status: res.status, points, metrics, warned };
}

test('the branch rides on every row as blob6, and the sampling key is untouched', async () => {
  const { status, points } = await oneRequest({ BRANCH_CODE: 'fr' });
  assert.equal(status, 200);
  assert.equal(points.length, 1, 'exactly one data point per request');

  // THE SAMPLING-KEY ASSERTION. The whole array, not a membership check: a
  // second index would typecheck, would be silently rejected at runtime, and
  // would change the sampling key for every request on the platform. Moving
  // the branch here — or appending it — must fail.
  assert.deepEqual(points[0].indexes, ['/api/projects'],
    'the route is the only index. The branch belongs in a blob: the first index is the sampling '
    + 'key, and changing it makes samples either side of the change incomparable.');

  // THE SLOT CONTRACT, whole. blob1..blob5 are what the reader's SQL already
  // names (blob1 AS endpoint); blob6 is a NEW slot appended after the last one
  // any reader contracts for. Writing the branch into an existing slot would
  // pass a membership check and break the reader.
  assert.deepEqual(points[0].blobs, ['/api/projects', 'GET', 'anon', '200', 'free', 'fr'],
    'slot order is the contract: route, method, role, status, tier, branch');
});

test('with no branch provisioned every row still carries a branch, and it is hq', async () => {
  // The case that is true TODAY, and the one a multi-branch fixture cannot see:
  // zero branches are provisioned, so every row on the platform carries 'hq'
  // and the split below renders exactly one group.
  const { points } = await oneRequest({});
  assert.deepEqual(points[0].blobs, ['/api/projects', 'GET', 'anon', '200', 'free', 'hq'],
    "an absent BRANCH_CODE is HQ, written as 'hq' rather than left empty — an empty dimension "
    + 'would group HQ\'s own traffic under a nameless bucket');
  // And HQ's row is otherwise unchanged, which is the no-behaviour-change claim
  // made assertable rather than asserted.
  assert.deepEqual(points[0].indexes, ['/api/projects']);
  assert.deepEqual(points[0].doubles?.slice(1), [200, 0]);
});

test('a malformed BRANCH_CODE costs a dropped metric, not a failed request', async () => {
  // `branchOf` THROWS on a value that fails BRANCH_CODE_RE rather than reading
  // as "not a branch" (util/branch.ts). That throw is on the hot path, so it
  // has to be reasoned about: it lands inside the AE block's own try/catch, so
  // the request completes and D1 still gets its row. Correct, because such a
  // deployment already fails loudly at boot and on every authed path.
  const { status, points, metrics, warned } = await oneRequest({ BRANCH_CODE: "fr'; DROP TABLE x --" });
  assert.equal(status, 200, 'a misconfigured branch must not fail the request');
  assert.equal(points.length, 0, 'and must not write a row carrying the malformed value');
  assert.equal(metrics.length, 1, 'while D1 still records the request');
  assert.ok(warned.some(w => w.includes('analytics engine write failed')),
    'the drop is logged, so it is a known state rather than a silence');
});

test('the branch value is REFUSED by the regex, never escaped', () => {
  // The interpolation risk, closed at the source rather than at the SQL. There
  // is no escaping step to get wrong because a value that could need one never
  // becomes a branch code in the first place.
  assert.ok(BRANCH_CODE_RE.test('fr'), 'a real code passes');
  assert.ok(BRANCH_CODE_RE.test('dach'));
  for (const bad of ["fr'", "fr' OR 1=1 --", 'fr"', 'FR', 'f', 'fr;', 'fr fr', "'", 'a-very-long-branch-code']) {
    assert.ok(!BRANCH_CODE_RE.test(bad), `${JSON.stringify(bad)} must be refused, not escaped`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The reader — the dataset it names, and the two ways an answer can be empty
// ─────────────────────────────────────────────────────────────────────────────

const RANGE = parseRange('2026-09-01', '2026-09-18');

test('the split groups by the branch dimension and names the configured dataset', async () => {
  const s = stubFetch(aeOk([
    { branch: 'fr', hits: 400, avg_latency_ms: 40.4, p95: 120.6, errors_5xx: 8 },
    { branch: 'hq', hits: 100, avg_latency_ms: 20, p95: 60, errors_5xx: 0 },
  ]));
  try {
    const out = await loadTrafficByBranch({ ...AE_CREDS } as any, RANGE);
    const [sql] = s.sql();
    assert.match(sql, /blob6 AS branch/, 'the dimension is read from the slot the write site fills');
    assert.match(sql, /GROUP BY blob6/, 'and grouped by it — this is the split');
    assert.match(sql, /FROM\s+studioos_metrics\b/, 'unset AE_DATASET falls back to the shared dataset');

    assert.equal(out.available, true);
    assert.equal(out.reason, undefined);
    assert.deepEqual(out.rows, [
      { branch: 'fr', hits: 400, avg_latency_ms: 40, p95_ms: 121, errors_5xx: 8, error_rate_pct: 2 },
      { branch: 'hq', hits: 100, avg_latency_ms: 20, p95_ms: 60, errors_5xx: 0, error_rate_pct: 0 },
    ]);
    assert.match(out.as_of, /^\d{4}-\d{2}-\d{2}T/, 'a read carries the time it was taken');
  } finally { s.restore(); }
});

test('a preview deployment reads the dataset it writes', async () => {
  // The live defect AE_DATASET was written for and nothing read. `[env.preview]`
  // writes `studioos_metrics_preview` (wrangler.toml) while the reader queried
  // `studioos_metrics`, so a preview deployment's reads could not see its own
  // writes — invisible, because a failed read returns null and falls back to D1.
  const s = stubFetch(aeOk([{ branch: 'hq', hits: 1, avg_latency_ms: 1, p95: 1, errors_5xx: 0 }]));
  try {
    const env: any = { ...AE_CREDS, AE_DATASET: 'studioos_metrics_preview' };
    await loadTrafficByBranch(env, RANGE);
    await loadTechnical({ ...env, DB: technicalDb() } as any, RANGE);
    for (const sql of s.sql()) {
      assert.match(sql, /FROM\s+studioos_metrics_preview\b/,
        'both AE queries must read the dataset this deployment writes');
      assert.ok(!/FROM\s+studioos_metrics\b/.test(sql),
        'and must not carry the hardcoded name the reader used to have');
    }
  } finally { s.restore(); }
});

test('an unreadable metrics store is not a count of zero', async () => {
  // Three ways the read fails, all of which used to be indistinguishable from
  // "no traffic". They are one state now, and it carries a reason.
  const unreadable = async (env: Record<string, unknown>, handler?: Parameters<typeof stubFetch>[0]) => {
    const s = stubFetch(handler ?? (() => new Response('nope', { status: 500 })));
    try {
      const out = await loadTrafficByBranch(env as any, RANGE);
      assert.equal(out.available, false);
      assert.deepEqual(out.rows, []);
      assert.match(String(out.reason), /could not be read/);
      assert.match(String(out.reason), /not a count of zero/,
        'the reason must say what the empty list is NOT, or a surface will render it as 0');
      return s.seen.length;
    } finally { s.restore(); }
  };

  // No credentials — and no request is attempted at all.
  assert.equal(await unreadable({}), 0);
  // A non-OK answer.
  assert.equal(await unreadable({ ...AE_CREDS }), 1);
  // A throw.
  assert.equal(await unreadable({ ...AE_CREDS }, () => { throw new Error('socket hang up'); }), 1);
});

test('no traffic is a different answer from could not read', async () => {
  const s = stubFetch(aeOk([]));
  try {
    const out = await loadTrafficByBranch({ ...AE_CREDS } as any, RANGE);
    assert.equal(out.available, true, 'the store answered — it just had nothing in the window');
    assert.equal(out.reason, undefined);
    assert.deepEqual(out.rows, []);
  } finally { s.restore(); }
});

test('with zero branches provisioned the split is one group, and it is hq', async () => {
  // The state of the platform today. A fixture carrying four branches would
  // never exercise it, and this is the shape the surface actually renders.
  const s = stubFetch(aeOk([{ branch: 'hq', hits: 12, avg_latency_ms: 31, p95: 90, errors_5xx: 1 }]));
  try {
    const out = await loadTrafficByBranch({ ...AE_CREDS } as any, RANGE);
    assert.equal(out.available, true);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].branch, 'hq');
    assert.equal(out.rows[0].error_rate_pct, 8.33);
  } finally { s.restore(); }
});

test('a row with an empty branch reads as hq rather than as a nameless bucket', async () => {
  // Rows written before D161 carry no blob6 at all. They are HQ's — that is
  // the only deployment that existed — and must not group under ''.
  const s = stubFetch(aeOk([{ branch: '', hits: 5, avg_latency_ms: 10, p95: 20, errors_5xx: 0 }]));
  try {
    const out = await loadTrafficByBranch({ ...AE_CREDS } as any, RANGE);
    assert.equal(out.rows[0].branch, 'hq');
  } finally { s.restore(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The aggregate that does NOT move
// ─────────────────────────────────────────────────────────────────────────────

const TECHNICAL_SCHEMA = `
  CREATE TABLE system_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_name TEXT NOT NULL,
    value REAL, labels TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE queue_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL);
  CREATE TABLE dead_letter_queue (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT, status_code INTEGER,
    message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function technicalDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(TECHNICAL_SCHEMA);
  return makeD1(db);
}

test('the platform-wide aggregate gains no branch attribution', async () => {
  // THE NO-BEHAVIOUR-CHANGE CLAIM, proved rather than asserted. `/technical`
  // and `/management` are requireAdmin, so a branch dimension reaching them
  // would hand every branch admin every other branch's traffic. The query must
  // carry no branch dimension anywhere: not in the projection, not in the
  // grouping, not in a predicate.
  const s = stubFetch(aeOk([
    { endpoint: '/api/projects', hits: 200, avg_latency_ms: 30, p50: 20, p95: 80, p99: 200, errors_5xx: 4 },
  ]));
  try {
    const out = await loadTechnical({ ...AE_CREDS, DB: technicalDb() } as any, RANGE);
    const [sql] = s.sql();
    assert.ok(!/blob6/.test(sql),
      'the requireAdmin aggregate must not read the branch dimension — that is the isolation this '
      + 'change exists to keep. The split lives on its own super-admin route.');
    assert.ok(!/branch/i.test(sql), 'and carries no branch predicate under any spelling');
    assert.match(sql, /blob1 AS endpoint/, 'while still reading slot 1 as the route, unchanged');
    assert.match(sql, /GROUP BY blob1\b/);

    // And what it RETURNS is what it returned before the branch existed.
    assert.deepEqual(out.by_route, [{
      endpoint: '/api/projects', hits: 200, avg_latency_ms: 30,
      p50_ms: 20, p95_ms: 80, p99_ms: 200, errors_5xx: 4, error_rate_pct: 2,
    }]);
  } finally { s.restore(); }
});

test('nothing a caller supplies reaches the text/plain SQL', async () => {
  // The AE SQL API takes `text/plain` and has no binding mechanism, so every
  // value in these queries is interpolated. Enumerate the interpolation surface
  // and pin it: only the dataset name (a config var, not a request value), the
  // parsed range, the week bounds the server's own clock builds, and module
  // constants reach it. An optional branch predicate was written here first,
  // had no caller, and was removed — this keeps it from coming back as a
  // request-fed one.
  //
  // The scan is scoped to what actually leaves as `text/plain`: the literals
  // assigned to `sqlText` and handed to `aeSql`. It deliberately does NOT read
  // the D1 queries in this same file — those are tagged templates whose
  // `${...}` become BOUND parameters, and flagging them would be the guard
  // misreading a safe idiom as the unsafe one.
  const literals = [...REPORTS_SRC.matchAll(/const sqlText = `([^`]*)`/g)].map(m => m[1]);
  // FOUR SINCE D210 — the count doing its job for the second time. It was
  // pinned at two, and D163's action-mirror reader moved it to three by failing
  // it first. D210's weekly active-accounts reader failed it again, before any
  // other check noticed the new query: that is the guard working, not a number
  // to bump. What the fourth query adds to the surface is four names, and each
  // is PROVED below to be out of a caller's reach rather than merely listed.
  assert.equal(literals.length, 4,
    'four AE queries: the platform aggregate, the branch split, the action mirror and the weekly '
    + 'active accounts. A fifth would have to be read by this rule, so the count stays pinned.');
  assert.equal((REPORTS_SRC.match(/aeSql\(env, sqlText\)/g) || []).length, 4,
    'and all four go through the one fetch helper, so there is a single place where SQL text is sent');

  const interpolations = new Set<string>();
  for (const lit of literals) {
    for (const m of lit.matchAll(/\$\{([^}]*)\}/g)) interpolations.add(m[1].trim());
  }
  assert.deepEqual([...interpolations].sort(),
    [
      'AE_ACTIVE_ROW_CAP', 'HTTP_ROWS_ONLY', 'MIRROR_KIND', 'aeDataset(env)', 'aeLoggedRequestPredicate()',
      'axis.from', 'axis.to', 'range.fromIso', 'range.toIso',
    ],
    'only the configured dataset name, the parsed range, the server-built week bounds and module '
    + 'constants may be interpolated into AE SQL');
  // An allowlist entry a request could influence would be the hole this whole
  // rule exists to keep shut, so each entry is proved, not named.
  assert.match(
    readFileSync(resolve(root, 'cloudflare-worker/src/services/auditMirror.ts'), 'utf8'),
    /export const MIRROR_KIND = '[a-z:_]+';/,
    'MIRROR_KIND is a fixed literal, so interpolating it cannot carry a request value',
  );
  assert.match(REPORTS_SRC, /const HTTP_ROWS_ONLY = "blob1 LIKE '\/%'";/,
    'HTTP_ROWS_ONLY is a fixed literal predicate, not built from anything');
  assert.match(REPORTS_SRC, /export const AE_ACTIVE_ROW_CAP = \d+;/,
    'the row cap is a fixed number, not a limit a caller chooses');

  // The activity predicate takes no argument, and every value it quotes is one
  // of the module's own skip paths — so what it interpolates is a constant list,
  // checked against a LIKE-safe shape before it is ever joined.
  const ACTIVE_SRC = readFileSync(resolve(root, 'cloudflare-worker/src/services/activeAccounts.ts'), 'utf8');
  assert.match(ACTIVE_SRC, /export function aeLoggedRequestPredicate\(\): string \{/,
    'the predicate has no parameter a caller could fill');
  assert.deepEqual(
    [...aeLoggedRequestPredicate().matchAll(/'([^']*)'/g)].map((m) => m[1]),
    ['/api/%', ...SKIP_ACTIVITY_LOG_PATHS.map((p) => `${p}%`)],
    'every quoted value in the predicate is the module\'s own path prefix or skip list',
  );

  // The week bounds come from `weekAxis`, which builds them off the server's
  // clock. The reader re-checks their shape anyway, so a caller that passes
  // anything else is refused BEFORE a byte of SQL leaves — proved here by a
  // fetch that fails the test if it is ever reached.
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const env = { ...AE_CREDS } as any;
    const good = weekAxis('2026-09-23T12:00:00Z', 8);
    await assert.rejects(
      loadActiveAccountsByBranchWeek(env, { ...good, from: "2026-08-03 00:00:00' OR 1=1 --" }),
      /takes the bounds weekAxis builds/,
      'a bound that is not the axis shape is refused, not quoted',
    );
    await assert.rejects(
      loadActiveAccountsByBranchWeek(env, { ...good, to: '2026-09-28T00:00:00Z' }),
      /takes the bounds weekAxis builds/,
      'the check is on both bounds, and on the exact SQL-stamp shape',
    );
    assert.equal(fetched, 0, 'a refused bound never reaches the SQL API');
    const read = await loadActiveAccountsByBranchWeek(env, good);
    assert.equal(fetched, 1, 'the bounds weekAxis builds pass the same check');
    assert.equal(read.available, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · The gate — the assertion this whole change exists for
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
`;

/** The router mounted where index.ts mounts it, with index.ts's error map. */
function monitoringApp(extraEnv: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(AUTH_SCHEMA + TECHNICAL_SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);

  const env: any = {
    ...extraEnv, DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development',
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
  };
  const app = new Hono<any>();
  app.route('/api/monitoring/analytics', monitoringAnalytics);
  app.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });

  const call = async (path: string, userId: number) => {
    const token = await new SignJWT({ user_id: userId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(
      `/api/monitoring/analytics${path}`,
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    return { status: res.status, body: await res.json() as any };
  };
  return { call };
}

test('the per-branch split is super-admin only', async () => {
  // A plain admin IS a branch admin here. If this route ever answers one, every
  // branch admin can read every other branch's traffic — which is the isolation
  // the branch programme exists to create, and the one thing this change must
  // not get wrong.
  const { call } = monitoringApp(AE_CREDS);
  const s = stubFetch(aeOk([{ branch: 'hq', hits: 3, avg_latency_ms: 5, p95: 9, errors_5xx: 0 }]));
  try {
    const denied = await call('/traffic-by-branch?from=2026-09-01&to=2026-09-18', PLAIN);
    assert.equal(denied.status, 403, 'a plain admin must not read the branch split');
    assert.equal(denied.body.detail, 'Super admin required');
    assert.equal(s.seen.length, 0, 'and the refusal happens before the metrics store is even asked');

    const allowed = await call('/traffic-by-branch?from=2026-09-01&to=2026-09-18', HOLDER);
    assert.equal(allowed.status, 200, 'the holder reads it — without this half, a route that '
      + 'refused everyone would pass the assertion above');
    assert.equal(allowed.body.available, true);
    assert.deepEqual(allowed.body.rows.map((r: any) => r.branch), ['hq']);
  } finally { s.restore(); }
});

test('the platform-wide aggregate still answers a plain admin, exactly as before', async () => {
  // Zero behaviour change for every admin who is not the holder is the property
  // that makes this safe to ship ahead of the first branch being provisioned.
  const { call } = monitoringApp(AE_CREDS);
  const s = stubFetch(aeOk([
    { endpoint: '/api/projects', hits: 9, avg_latency_ms: 11, p50: 10, p95: 20, p99: 30, errors_5xx: 0 },
  ]));
  try {
    const r = await call('/technical?from=2026-09-01&to=2026-09-18', PLAIN);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.by_route.map((x: any) => x.endpoint), ['/api/projects']);
    assert.ok(!JSON.stringify(r.body).includes('branch'),
      'and what it returns names no branch — an aggregate, not an attribution');
  } finally { s.restore(); }
});
