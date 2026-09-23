/**
 * D148 — what HQ is allowed to publish a median of, and what it must withhold.
 *
 * WHAT THIS GUARDS. `branch_benchmarks` was created by migration 256 and has had
 * neither a writer nor a reader since (#252). The risk in giving it one is not
 * an arithmetic slip — it is publishing a "median" that names a branch. HQ's own
 * migration header says the row is withheld below a k-threshold and does not say
 * what k is; these assertions pin it at three and pin the reason:
 *
 *   n = 1  the median IS that branch's figure, under a name that hides whose;
 *   n = 2  a branch subtracts its own value and reads the other's exactly;
 *   n = 3  the smallest n at which no single branch is recoverable.
 *
 * The second thing guarded is the denominator. `fanOut` has three states and a
 * branch that did not answer must contribute NOTHING — not a zero, which would
 * drag every median toward the floor and make the platform look worse the
 * flakier its network is.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_benchmarks_d148.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  publishBenchmarks, median, MIN_BRANCHES, METRICS, currentPeriod,
} from '../src/services/branchBenchmarks.ts';
import { applyBenchmarks } from '../src/rpc/branchOps.ts';
import { weekAxis } from '../src/services/activeAccounts.ts';
import branchInsights from '../src/routes/branch_insights.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

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
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/** Migration 256's DDL, sliced rather than retyped — a narrow fixture would make the route claim the table is missing. */
function benchmarksDdl(): string {
  const sql = readFileSync(new URL('../sql/migrations/256_branch_local_copies.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS branch_benchmarks');
  assert.ok(start > 0, 'migration 256 must still create branch_benchmarks');
  const end = sql.indexOf(');', start);
  assert.ok(end > start);
  return sql.slice(start, end + 2);
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  ${benchmarksDdl()}
`;

function db(withBenchmarks = true, seedUsers: Array<[number, string]> = [[ADMIN, 'admin']]) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(withBenchmarks ? SCHEMA : `
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  for (const [id, role] of seedUsers) {
    d.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
      .run(id, role, `u${id}`, `u${id}@axal.example`);
  }
  return d;
}

const base = { JWT_SECRET, ENVIRONMENT: 'development' };
const FR = { ...base, BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU', APP_URL: 'https://fr.axal.vc' };
const HQ = { ...base, APP_URL: 'https://axal.vc' };

/** A fake branch binding, so the fan-out has something real to call. */
function binding(overview: unknown, applied?: any[]) {
  return {
    async overview() {
      if (overview instanceof Error) throw overview;
      return overview;
    },
    async applyBenchmarks(p: any) { applied?.push(p); return { ok: true }; },
  };
}
/**
 * One branch's overview, in the shape `branchOverview()` RETURNS.
 *
 * D210 — this fixture used to write `backlog` as an array of lanes, which is
 * not what the producer returns (`{ count, oldest_at } | null`). The metric
 * reader was written to the same wrong shape, so the test passed while
 * `approvals_backlog` could never be published against a real branch.
 * `analytics_d210.test.ts` now feeds the real producer's output to the same
 * readers, so the two cannot drift apart again.
 */
const WEEK = weekAxis(new Date().toISOString(), 2).last_complete;
const OV = (accounts: number, seats: number, backlog: number, active: number | null = null) => ({
  accounts: { total: accounts }, seats_used: seats, backlog: { count: backlog, oldest_at: null },
  active_accounts_week: active, active_accounts_week_of: WEEK,
});

const app = new Hono<any>();
app.route('/branch', branchInsights);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function get(env: Record<string, unknown>) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/branch/insights', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('the threshold is three, and the reason is that one and two both name a branch', () => {
  assert.equal(MIN_BRANCHES, 3);
});

test('median sorts NUMERICALLY, which a default sort does not', () => {
  // The defect this pins only appears once a value crosses a digit boundary:
  // `[9, 10, 11].sort()` is `[10, 11, 9]` and the median comes back 11.
  assert.equal(median([9, 10, 11]), 10);
  assert.equal(median([2, 4]), 3);
  assert.equal(median([5]), 5);
});

test('ONE branch publishes nothing, because the median would be that branch', async () => {
  const env = { ...HQ, BRANCH_FR: binding(OV(10, 6, 2)) } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  assert.equal(r.answered, 1);
  assert.equal(r.published, 0);
  assert.deepEqual(r.rows, []);
  assert.match(String(r.withheld_reason), /IS that branch/);
});

test('TWO branches publish nothing, because each can subtract itself', async () => {
  const env = { ...HQ, BRANCH_FR: binding(OV(10, 6, 2)), BRANCH_DE: binding(OV(20, 12, 4)) } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  assert.equal(r.answered, 2);
  assert.equal(r.published, 0);
  assert.match(String(r.withheld_reason), /subtracts its own/);
});

test('THREE branches publish, and every row carries the n it was computed over', async () => {
  const pushed: any[] = [];
  const env = {
    ...HQ,
    BRANCH_FR: binding(OV(10, 6, 2, 5), pushed),
    BRANCH_DE: binding(OV(20, 12, 4, 9), pushed),
    BRANCH_ES: binding(OV(30, 18, 9, 14), pushed),
  } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  assert.equal(r.answered, 3);
  assert.equal(r.published, METRICS.length, 'every metric with a source is published');
  assert.ok(!r.withheld_reason);
  const byKey = Object.fromEntries(r.rows.map((x) => [x.metric_key, x]));
  assert.equal(byKey.accounts_total.median_value, 20);
  assert.equal(byKey.seats_used.median_value, 12);
  assert.equal(byKey.approvals_backlog.median_value, 4);
  assert.equal(byKey.active_accounts_week.median_value, 9);
  for (const row of r.rows) {
    assert.equal(row.n_branches, 3, 'a median with no denominator implies a population it does not know');
    // A weekly metric is stamped with the Monday it measured; the rest with
    // the quarter.
    assert.equal(row.period, row.metric_key === 'active_accounts_week' ? WEEK : '2026-Q3');
  }
  // AND IT REACHED EVERY BRANCH. A computation with no push is the #252 defect
  // in a new place.
  assert.equal(pushed.length, 3);
  assert.equal(r.pushed.filter((p) => p.status === 'ok').length, 3);
});

test('an UNREADABLE branch is excluded from n, never counted as a zero', async () => {
  const env = {
    ...HQ,
    BRANCH_FR: binding(OV(10, 6, 2)),
    BRANCH_DE: binding(OV(20, 12, 4)),
    BRANCH_ES: binding(OV(30, 18, 9)),
    BRANCH_IT: binding(new Error('binding is mid-deploy')),
  } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  assert.equal(r.total, 4);
  assert.equal(r.answered, 3, 'the branch that did not answer is not an answer');
  const accounts = r.rows.find((x) => x.metric_key === 'accounts_total')!;
  assert.equal(accounts.n_branches, 3);
  // A ZERO WOULD HAVE MOVED THE MEDIAN. With [0,10,20,30] it is 15, not 20 —
  // so this assertion fails the moment an unreadable branch is counted.
  assert.equal(accounts.median_value, 20);
});

test('a branch with NO weekly figure is left out of that median, never counted as a zero', async () => {
  // `active_accounts_week` is null when a branch's log began inside the week
  // (D210): four days are not a week's figure. `Number(null)` is 0, so a reader
  // that coerced before checking would count that branch as having nobody
  // active — and with [0,5,9,14] the median is 7, not 9. The branch names the
  // right Monday, so only the reader stands between it and the median.
  const env = {
    ...HQ,
    BRANCH_FR: binding(OV(10, 6, 2, 5)),
    BRANCH_DE: binding(OV(20, 12, 4, 9)),
    BRANCH_ES: binding(OV(30, 18, 9, 14)),
    BRANCH_IT: binding(OV(40, 24, 1, null)),
  } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  const weekly = r.rows.find((x) => x.metric_key === 'active_accounts_week')!;
  assert.equal(weekly.n_branches, 3, 'the branch with no figure is not in the denominator');
  assert.equal(weekly.median_value, 9);
});

test('the threshold is applied PER METRIC, not once per fan-out', async () => {
  // Three branches answer, but only two have a readable backlog. Accounts and
  // seats publish; the backlog median would be over two and does not.
  const env = {
    ...HQ,
    BRANCH_FR: binding(OV(10, 6, 2)),
    BRANCH_DE: binding(OV(20, 12, 4)),
    BRANCH_ES: binding({ accounts: { total: 30 }, seats_used: 18, backlog: null }),
  } as any;
  const r = await publishBenchmarks(env, '2026-Q3');
  assert.equal(r.answered, 3);
  const keys = r.rows.map((x) => x.metric_key).sort();
  assert.deepEqual(keys, ['accounts_total', 'seats_used']);
});

test('revenue is NOT a published metric, because no branch returns one', () => {
  const keys = METRICS.map((m) => m.key);
  assert.ok(!keys.some((k) => /revenue|money|cents/i.test(k)),
    'branchOverview returns revenue_mtd_cents null by construction; a median of it would be a median of nothing');
  assert.deepEqual(keys.sort(), ['accounts_total', 'active_accounts_week', 'approvals_backlog', 'seats_used']);
});

test('the publisher refuses to run on a branch', async () => {
  await assert.rejects(
    () => publishBenchmarks({ ...FR, BRANCH_FR: binding(OV(1, 1, 1)) } as any, '2026-Q3'),
    /only live on HQ/,
    'a branch has no branches to fan out to, so the gate and the function must agree',
  );
});

test('the period is the UTC quarter, in the shape revenueSummary parses', () => {
  assert.equal(currentPeriod(new Date('2026-01-15T00:00:00Z')), '2026-Q1');
  assert.equal(currentPeriod(new Date('2026-03-31T23:59:59Z')), '2026-Q1');
  assert.equal(currentPeriod(new Date('2026-04-01T00:00:00Z')), '2026-Q2');
  assert.equal(currentPeriod(new Date('2026-12-31T00:00:00Z')), '2026-Q4');
});

test('the branch stores what HQ pushed, stamped with HQ\'s time', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  const out = await applyBenchmarks(env, {
    rows: [{ metric_key: 'accounts_total', label: 'Active accounts', median_value: 20, unit: 'count', n_branches: 3, period: '2026-Q3' }],
    period: '2026-Q3',
    pushed_at: '2026-09-17T04:55:00Z',
  });
  assert.deepEqual(out, { ok: true, stored: 1 });
  const row = d.prepare('SELECT * FROM branch_benchmarks WHERE metric_key = ?').get('accounts_total') as any;
  assert.equal(row.median_value, 20);
  assert.equal(row.n_branches, 3);
  assert.equal(row.pushed_at, '2026-09-17T04:55:00Z');
  assert.notEqual(row.updated_at, row.pushed_at, 'the write time is not the age of the computation');
});

test('a metric HQ stops publishing DISAPPEARS rather than lingering at its last value', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  const row = (k: string, v: number) => ({ metric_key: k, label: k, median_value: v, unit: 'count', n_branches: 3, period: '2026-Q3' });
  await applyBenchmarks(env, { rows: [row('accounts_total', 20), row('seats_used', 12)], period: '2026-Q3', pushed_at: '2026-09-17T04:55:00Z' });
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM branch_benchmarks').get() as any).n, 2);

  // HQ withholds `seats_used` next quarter because it fell below k.
  await applyBenchmarks(env, { rows: [row('accounts_total', 22)], period: '2026-Q4', pushed_at: '2026-12-17T04:55:00Z' });
  const keys = (d.prepare('SELECT metric_key FROM branch_benchmarks').all() as any[]).map((r) => r.metric_key);
  assert.deepEqual(keys, ['accounts_total'],
    'a withheld metric must vanish — leaving it is the screen asserting a median HQ no longer stands behind');
});

test('a median that arrives without its n is dropped, not stored as a bare number', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  const out = await applyBenchmarks(env, {
    rows: [
      { metric_key: 'good', label: 'g', median_value: 5, unit: 'count', n_branches: 3, period: '2026-Q3' },
      { metric_key: 'no_n', label: 'n', median_value: 5, unit: 'count', n_branches: 0, period: '2026-Q3' },
      { metric_key: 'no_value', label: 'v', median_value: 'x', unit: 'count', n_branches: 3, period: '2026-Q3' },
    ],
    period: '2026-Q3',
    pushed_at: '2026-09-17T04:55:00Z',
  });
  assert.equal(out.stored, 1);
  const keys = (d.prepare('SELECT metric_key FROM branch_benchmarks').all() as any[]).map((r) => r.metric_key);
  assert.deepEqual(keys, ['good']);
});

test('the branch write refuses to run on HQ', async () => {
  const d = db();
  await assert.rejects(
    () => applyBenchmarks({ ...HQ, DB: makeD1(d) } as any, { rows: [], period: '2026-Q3', pushed_at: 'x' }),
    /only live on a branch/,
  );
});

test('the route serves this branch\'s own figures beside the pushed median', async () => {
  const d = db(true, [[ADMIN, 'admin'], [8, 'founder'], [9, 'investor'], [10, 'exploring']]);
  await applyBenchmarks({ ...FR, DB: makeD1(d) } as any, {
    rows: [{ metric_key: 'accounts_total', label: 'Active accounts', median_value: 20, unit: 'count', n_branches: 3, period: '2026-Q3' }],
    period: '2026-Q3', pushed_at: '2026-09-17T04:55:00Z',
  });
  const { status, body } = await get({ ...FR, DB: makeD1(d) });
  assert.equal(status, 200);
  assert.equal(body.branch, 'fr');
  assert.equal(body.stats.accounts, 4, 'every active account, whatever its role');
  assert.equal(body.stats.seats_used, 2, 'only the roles a licence sells a seat for — admin and exploring hold none');
  assert.match(String(body.stats.seats_used_basis), /Role is not the same thing as a licensed seat/);
  assert.equal(body.benchmarks.length, 1);
  assert.equal(body.benchmarks[0].n_branches, 3);
  assert.ok(!('benchmarks_empty_reason' in body), 'a published benchmark must not claim none was published');
});

test('NO BENCHMARK and AN UNREADABLE ONE are different sentences', async () => {
  {
    const { body } = await get({ ...FR, DB: makeD1(db()) });
    assert.equal(body.benchmarks_available, true, 'the table is readable');
    assert.deepEqual(body.benchmarks, []);
    assert.match(String(body.benchmarks_empty_reason), /withholds the row/);
    assert.match(String(body.benchmarks_empty_reason), /IS that branch/);
  }
  {
    const { status, body } = await get({ ...FR, DB: makeD1(db(false)) });
    assert.equal(status, 200, 'the page still renders; only this block is unknown');
    assert.equal(body.benchmarks_available, false);
    assert.match(String(body.benchmarks_reason), /not the same as HQ having published nothing/);
  }
});

test('the three stats S6 draws and this cannot compute travel with their reasons', async () => {
  const { body } = await get({ ...FR, DB: makeD1(db()) });
  const stats = (body.unavailable || []).map((u: any) => u.stat);
  assert.deepEqual(stats, ['Activation', 'Programme throughput', 'Revenue share for the quarter']);
  const revenue = body.unavailable.find((u: any) => /Revenue/.test(u.stat));
  assert.match(String(revenue.reason), /null by construction/,
    'the revenue absence must name WHY, or it reads as an oversight rather than a measurement');
});

test('the route refuses on HQ', async () => {
  const { status, body } = await get({ ...HQ, DB: makeD1(db()) });
  assert.equal(status, 403);
  assert.match(String(body.detail), /branch/i);
});
