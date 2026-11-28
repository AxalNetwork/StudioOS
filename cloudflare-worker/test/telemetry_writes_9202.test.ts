/**
 * D9202 (#9202) — the telemetry each signed-in `/api` request writes to D1.
 *
 * Before: every metered request ran, after the response, an INSERT into
 * `system_metrics`, a SELECT on `mi_pro_subscriptions` for the Analytics
 * Engine tier label, and an INSERT into `activity_logs`. Now:
 *
 *   · `system_metrics` 'request' rows are sampled one in
 *     REQUEST_METRIC_SAMPLE_EVERY, a 5xx or 429 always kept; the row's
 *     `value` is the number of requests it stands for, and every reader counts
 *     SUM(value) and weights its averages and percentiles by it.
 *   · the tier label is the `mi_subscription_plan` auth already hydrated.
 *   · a read (GET/HEAD) writes at most one `activity_logs` row per account,
 *     endpoint and UTC minute (per isolate); a write is logged every time.
 *
 * The first test is the acceptance test and fails on main: main reads
 * `mi_pro_subscriptions` and inserts into `system_metrics` on every request,
 * and writes an `activity_logs` row for each of two identical GETs.
 *
 * The rest hold each reader of the rows to what it still needs.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/telemetry_writes_9202.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  observabilityMiddleware, requestMetricWeight, resetActivityLogDedupe, REQUEST_METRIC_SAMPLE_EVERY,
} from '../src/middleware/observability.ts';
import { loadTechnical, parseRange, weightedPercentile, weightedLatencies } from '../src/services/analyticsReports.ts';
import { loadBranchWeeklyActives, activeAccountsInWeek, firstLoggedDay, weekAxis } from '../src/services/activeAccounts.ts';
import { readWebhookDeliveries, STRIPE_WEBHOOK_PATH } from '../src/services/stripeWebhookDeliveries.ts';
import monitoring from '../src/routes/monitoring.ts';

const SCHEMA = `
  CREATE TABLE system_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_name TEXT NOT NULL,
    value REAL, labels TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
    actor TEXT, user_id INTEGER, endpoint TEXT, method TEXT, status_code INTEGER, latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT,
    method TEXT, status_code INTEGER, message TEXT, stack_snippet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
    plan TEXT, period_end TEXT, stripe_customer_id TEXT);
  CREATE TABLE queue_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL);
  CREATE TABLE dead_letter_queue (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE rate_limit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT,
    requests_in_window INTEGER, bucket TEXT, blocked INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, name TEXT, email TEXT);
`;

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));

/** A D1 over node:sqlite that records every statement it is handed. */
function countingD1() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(SCHEMA);
  const seen: string[] = [];
  const DB = {
    prepare(sql: string) {
      seen.push(sql);
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
  const count = (re: RegExp) => seen.filter((s) => re.test(s)).length;
  return { db, DB, seen, count };
}

const SIGNED_IN = { id: 42, email: 'founder@axal.example', role: 'founder', mi_subscription_plan: 'pro_annual' };

/** The middleware in front of a few routes, with the user auth would have cached. */
function harness(opts: { random?: () => number; user?: any } = {}) {
  resetActivityLogDedupe();
  const d1 = countingD1();
  const points: any[] = [];
  const env: any = { DB: d1.DB, ANALYTICS: { writeDataPoint: (p: any) => points.push(p) } };
  const app = new Hono<any>();
  app.use('*', observabilityMiddleware({ random: opts.random ?? (() => 0.99) }));
  let user = 'user' in opts ? opts.user : SIGNED_IN;
  app.use('*', async (c, next) => { (c as any).set('currentUser', user); await next(); });
  app.get('/api/projects', (c) => c.json([]));
  app.get('/api/projects/:id', (c) => c.json({}));
  app.post('/api/projects', (c) => c.json({ ok: true }, 201));
  app.post(STRIPE_WEBHOOK_PATH, (c) => c.json({ received: true }));
  app.get('/api/boom', (c) => c.json({ detail: 'down' }, 503));
  app.get('/api/slow-down', (c) => c.json({ detail: 'rate' }, 429));
  const send = async (method: string, path: string) => {
    const pending: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {}, props: {} };
    const res = await app.request(path, { method }, env, ctx);
    await Promise.all(pending);
    return res.status;
  };
  const activity = () => d1.db.prepare('SELECT user_id, endpoint, method, status_code FROM activity_logs ORDER BY id').all().map((r) => ({ ...r })) as any[];
  const metrics = () => d1.db.prepare("SELECT value, labels FROM system_metrics WHERE metric_name = 'request' ORDER BY id").all() as any[];
  return { ...d1, env, points, send, activity, metrics, signInAs: (u: any) => { user = u; } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The write path
// ─────────────────────────────────────────────────────────────────────────────

test('a signed-in GET reads no subscription, writes no unsampled metric, and logs once a minute', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 27, 10, 15, 5) });
  const h = harness();

  assert.equal(await h.send('GET', '/api/projects'), 200);
  assert.equal(await h.send('GET', '/api/projects'), 200);

  assert.equal(h.count(/mi_pro_subscriptions/), 0,
    'the tier label is what auth already loaded; the middleware must not SELECT it again per request');
  assert.equal(h.count(/INSERT INTO system_metrics/), 0, 'an unsampled request writes no system_metrics row');
  assert.equal(h.count(/INSERT INTO activity_logs/), 1,
    'two identical reads in one minute write one activity_logs row, not two');
  assert.deepEqual(h.activity(), [{ user_id: 42, endpoint: '/api/projects', method: 'GET', status_code: 200 }]);

  // Analytics Engine still sees every request, with the tier label.
  assert.equal(h.points.length, 2, 'every request still reaches Analytics Engine');
  for (const p of h.points) {
    assert.deepEqual(p.blobs.slice(0, 5), ['/api/projects', 'GET', 'founder', '200', 'pro_annual'],
      'blob5 is the plan auth hydrated from mi_pro_subscriptions');
    assert.equal(p.doubles[2], 42);
  }

  // A different endpoint is its own key; the next minute logs the same read again.
  await h.send('GET', '/api/projects/7');
  assert.equal(h.activity().length, 2, 'another endpoint in the same minute is logged');
  t.mock.timers.tick(60_000);
  await h.send('GET', '/api/projects');
  assert.equal(h.activity().length, 3, 'the same read in the next minute is logged again');
  assert.equal(h.count(/mi_pro_subscriptions/), 0);
});

test('a write is logged every time; an account without a plan is tier free', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 27, 10, 15, 5) });
  const h = harness({ user: { id: 5, email: 'x@axal.example', role: 'founder', mi_subscription_plan: null } });
  await h.send('POST', '/api/projects');
  await h.send('POST', '/api/projects');
  assert.equal(h.activity().filter((r) => r.method === 'POST').length, 2, 'a write is never collapsed');
  assert.equal(h.points[0].blobs[4], 'free');

  // Two accounts reading the same endpoint in the same minute are two rows.
  h.signInAs({ id: 1, email: 'a@axal.example', role: 'founder' });
  await h.send('GET', '/api/projects');
  await h.send('GET', '/api/projects');
  h.signInAs({ id: 2, email: 'b@axal.example', role: 'founder' });
  await h.send('GET', '/api/projects');
  assert.deepEqual(h.activity().filter((r) => r.method === 'GET').map((r) => r.user_id), [1, 2],
    'the minute key is per account');
});

test('the sample: one in N kept at weight N, and every 5xx and 429 kept at weight 1', async () => {
  assert.equal(REQUEST_METRIC_SAMPLE_EVERY, 10);
  assert.equal(requestMetricWeight(200, 0), 10);
  assert.equal(requestMetricWeight(200, 0.0999), 10);
  assert.equal(requestMetricWeight(200, 0.1), 0);
  assert.equal(requestMetricWeight(404, 0.5), 0);
  assert.equal(requestMetricWeight(500, 0.99), 1);
  assert.equal(requestMetricWeight(503, 0.99), 1);
  assert.equal(requestMetricWeight(429, 0.99), 1);
  assert.equal(requestMetricWeight(499, 0.99), 0);

  const kept = harness({ random: () => 0 });
  await kept.send('GET', '/api/projects');
  const [row] = kept.metrics();
  assert.equal(row.value, 10, 'a sampled row stands for N requests');
  assert.deepEqual(JSON.parse(row.labels).endpoint, '/api/projects');

  const errs = harness({ random: () => 0.99 });
  await errs.send('GET', '/api/boom');
  await errs.send('GET', '/api/slow-down');
  assert.deepEqual(errs.metrics().map((r) => [r.value, JSON.parse(r.labels).status]), [[1, 503], [1, 429]],
    'errors and rate refusals are always recorded, whole');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The activity_logs readers, over rows the middleware wrote
// ─────────────────────────────────────────────────────────────────────────────

test('weekly actives, the week count and the first logged day still see an account that only reads', async () => {
  // created_at defaults to SQLite's real clock, so the axis is built from now.
  const h = harness();
  h.signInAs({ id: 77, email: 'reader@axal.example', role: 'investor' });
  for (let i = 0; i < 5; i += 1) await h.send('GET', '/api/projects');
  h.signInAs(SIGNED_IN);
  await h.send('GET', '/api/projects');
  // The minute can turn between two sends, so at most one extra row each.
  assert.ok(h.activity().length >= 2 && h.activity().length <= 4, 'five reads by one account in a minute collapse');

  const axis = weekAxis(new Date().toISOString(), 2);
  const weekly = await loadBranchWeeklyActives(h.env, axis);
  assert.equal(weekly.available, true);
  if (weekly.available) assert.equal(weekly.values[weekly.values.length - 1], 2, 'both accounts are active this week');
  // A week the log began inside is not offered (partialWeekReason); when it is, it counts both.
  const thisWeek = await activeAccountsInWeek(h.env, axis.current);
  if (thisWeek.value != null) assert.equal(thisWeek.value, 2);
  assert.equal(await firstLoggedDay(h.env), new Date().toISOString().slice(0, 10));
});

test('Stripe webhook deliveries are POSTs and every one is still a row', async () => {
  const h = harness({ user: null });
  await h.send('POST', STRIPE_WEBHOOK_PATH);
  await h.send('POST', STRIPE_WEBHOOK_PATH);
  await h.send('POST', STRIPE_WEBHOOK_PATH);
  assert.equal(h.activity().filter((r) => r.endpoint === STRIPE_WEBHOOK_PATH).length, 3);
  const out = await readWebhookDeliveries(h.env);
  assert.equal(out.available, true);
  if (out.available) {
    assert.equal(out.deliveries, 3, 'three deliveries in a minute are three deliveries');
    assert.equal(out.last?.status_code, 200);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The system_metrics readers, over sampled rows
// ─────────────────────────────────────────────────────────────────────────────

const sqlNow = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);

/** Nine sampled successes (weight 10 each) and one whole 5xx: 91 requests. */
function seedSampled(db: InstanceType<typeof DatabaseSync>, at: string) {
  const ins = db.prepare("INSERT INTO system_metrics (metric_name, value, labels, timestamp) VALUES ('request', ?, ?, ?)");
  for (let i = 0; i < 9; i += 1) {
    ins.run(10, JSON.stringify({ endpoint: '/api/projects', method: 'GET', status: 200, latency_ms: 10 }), at);
  }
  ins.run(1, JSON.stringify({ endpoint: '/api/projects', method: 'GET', status: 500, latency_ms: 1000 }), at);
}

test('the D1 technical fallback counts requests, not rows, and weights latency', async () => {
  const d1 = countingD1();
  seedSampled(d1.db, '2026-09-10 12:00:00');
  const out: any = await loadTechnical({ DB: d1.DB } as any, parseRange('2026-09-01', '2026-09-18'));
  const [route] = out.by_route;
  assert.equal(route.endpoint, '/api/projects');
  assert.equal(route.hits, 91, 'nine rows of weight 10 and one of weight 1 are 91 requests');
  assert.equal(route.errors_5xx, 1);
  assert.equal(route.error_rate_pct, Number(((1 / 91) * 100).toFixed(2)));
  assert.equal(route.avg_latency_ms, Math.round((90 * 10 + 1000) / 91), 'the average is weighted by value');
  assert.equal(route.p50_ms, 10);
  assert.equal(route.p95_ms, 10, 'the slow request is one of 91, so p95 is still a fast one — unweighted it would be 1 of 10');
  assert.equal(route.p99_ms, 1000, 'the one slow request is the top 1.1% of 91, so it is p99');
});

test('weighted percentiles equal the old unweighted ones when every weight is 1', () => {
  const ls = [5, 1, 9, 3, 7, 2, 8].map((l) => ({ l, w: 1 }));
  const arr = weightedLatencies(ls);
  const plain = ls.map((x) => x.l).sort((a, b) => a - b);
  for (const p of [0, 0.25, 0.5, 0.95, 0.99, 1]) {
    assert.equal(weightedPercentile(arr, p), plain[Math.min(plain.length - 1, Math.floor(plain.length * p))], `p${p}`);
  }
  // n × p landing on a whole number is where an off-by-one would show.
  const four = weightedLatencies([40, 10, 30, 20].map((l) => ({ l, w: 1 })));
  assert.deepEqual([0.25, 0.5, 0.75].map((p) => weightedPercentile(four, p)), [20, 30, 40]);
  assert.equal(weightedPercentile([], 0.5), 0);
  assert.deepEqual(weightedLatencies([{ l: 4 }, { l: 0, w: 3 }]), [{ l: 4, w: 1 }], 'a pre-D9202 row with no weight counts 1');
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

async function monitoringCall(path: string, seed: (db: InstanceType<typeof DatabaseSync>) => void) {
  const d1 = countingD1();
  d1.db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(1, 'admin', 'Ada', 'ada@axal.example');
  seed(d1.db);
  const env: any = { DB: d1.DB, JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc' };
  const app = new Hono<any>();
  app.route('/api/monitoring', monitoring);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));
  const token = await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/monitoring${path}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('the monitoring dashboard sums value, so a sampled minute reads as its requests', async () => {
  const r = await monitoringCall('/metrics?minutes=60', (db) => seedSampled(db, sqlNow(60_000)));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.summary.total_requests, 91);
  assert.equal(r.body.summary.errors_5xx, 1);
  assert.equal(r.body.summary.avg_latency_ms, Math.round((90 * 10 + 1000) / 91));
  assert.equal(r.body.summary.error_rate_pct, Number(((1 / 91) * 100).toFixed(2)));
  assert.equal(Number(r.body.requests_per_minute[0].count), 91);
  assert.equal(Number(r.body.top_endpoints[0].hits), 91);
});

test('the throughput figure is requests, not rows', async () => {
  const r = await monitoringCall('/throughput', (db) => seedSampled(db, sqlNow(60_000)));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.requests, 91);
});
