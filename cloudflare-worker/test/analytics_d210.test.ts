/**
 * D210 — H15 + S15, the two Analytics pages, and the one definition of an
 * active account they share.
 *
 * WHAT THIS HOLDS, AND WHY EACH IS HERE RATHER THAN IN A PAGE TEST:
 *
 *   · the Analytics Engine predicate and `activityLogged()` agree path by path.
 *     The predicate is run in SQLite over the same rows the rule is asked
 *     about, so a skip path added to one and not the other fails here — the
 *     two Analytics pages would otherwise count different requests and
 *     neither could say why;
 *   · a missing week is never a zero. Every gap reason is exercised, and the
 *     one place a zero IS right — a week after the first recorded request —
 *     is exercised beside it;
 *   · both routes answer from real SQLite. HQ's read of Analytics Engine is a
 *     stubbed `fetch`, so what the page draws is decided by the route's own
 *     fold over rows in the store's shape, and the SQL text it sends is read
 *     back and checked for the constructs it must not use;
 *   · the benchmark readers are fed what `branchOverview()` actually returns.
 *     `branch_benchmarks_d148` once pinned a fixture shape the producer never
 *     emitted, and `approvals_backlog` could not be published because of it.
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/analytics_d210.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  activityLogged, aeLoggedRequestPredicate, SKIP_ACTIVITY_LOG_PATHS, parseAnalyticsRange,
  ANALYTICS_RANGES, weekAxis, foldDailyActives, seriesValues, weeklyKpi, GAP_SENTENCES,
  ACTIVE_ACCOUNT_BASIS, activeAccountsInWeek,
} from '../src/services/activeAccounts.ts';
import { weekStartOf } from '../src/services/okrWeeks.ts';
import { AE_ACTIVE_ROW_CAP } from '../src/services/analyticsReports.ts';
import { METRICS } from '../src/services/branchBenchmarks.ts';
import { branchOverview } from '../src/rpc/branchOps.ts';
import branchInsights from '../src/routes/branch_insights.ts';
import hq from '../src/routes/admin_hq.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (name: string) =>
  readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

function exec(db: InstanceType<typeof DatabaseSync>, sql: string) {
  for (const st of splitStatements(sql)) db.exec(st);
}

// ─────────────────────────────────────────────────────────────── the rule ──

test('the Analytics Engine predicate counts exactly the requests activityLogged() logs', () => {
  const paths = [
    '/api/projects', '/api/auth/me', '/api/health', '/api/healthz', '/api/activity',
    '/api/activity/recent', '/api/monitoring', '/api/monitoring/', '/api/monitoring/alerts',
    '/api/dashboard/stats', '/api/dashboard/stats2', '/api/dashboard', '/assets/app.js', '/',
    '/apix', 'hq:branch_action',
  ];
  const statuses = [200, 302, 404, 428, 429, 430, 500];
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE ae (blob1 TEXT, double2 REAL)');
  const ins = db.prepare('INSERT INTO ae (blob1, double2) VALUES (?, ?)');
  const expected = new Set<string>();
  for (const p of paths) {
    for (const s of statuses) {
      ins.run(p, s);
      if (activityLogged(p, s)) expected.add(`${p}|${s}`);
    }
  }
  const got = new Set(
    (db.prepare(`SELECT blob1, double2 FROM ae WHERE ${aeLoggedRequestPredicate()}`).all() as any[])
      .map((r) => `${r.blob1}|${r.double2}`),
  );
  assert.deepEqual([...got].sort(), [...expected].sort(),
    'the two tiers would count different requests as activity');
  // Non-vacuous: both kinds of answer occur, and the skip list is exercised.
  assert.ok(expected.size > 10 && expected.size < paths.length * statuses.length);
  for (const p of SKIP_ACTIVITY_LOG_PATHS) {
    assert.equal(activityLogged(p, 200), false, `${p} must not write an activity row`);
  }
  assert.equal(activityLogged('/api/projects', 429), false, 'a rate refusal is not the account doing anything');
});

test('the predicate uses only constructs the Analytics Engine docs show', () => {
  const p = aeLoggedRequestPredicate();
  assert.ok(!p.includes('!='), '`!=` could not be confirmed from the documentation');
  assert.ok(!/\bIN\s*\(/i.test(p));
  assert.ok(p.includes("blob1 LIKE '/api/%'"), 'the audit mirror rows must be excluded by the path shape');
});

test('a skip path carrying a LIKE wildcard refuses to build rather than guessing an escape', () => {
  const list = SKIP_ACTIVITY_LOG_PATHS as string[];
  list.push('/api/under_score');
  try {
    assert.throws(() => aeLoggedRequestPredicate(), /wildcard/);
  } finally {
    list.pop();
  }
  assert.doesNotThrow(() => aeLoggedRequestPredicate());
});

test('the range vocabulary: absent is eight weeks, unknown is refused, prototype names are unknown', () => {
  assert.equal(parseAnalyticsRange(undefined), '8w');
  assert.equal(parseAnalyticsRange(''), '8w');
  assert.equal(parseAnalyticsRange('quarter'), 'quarter');
  assert.equal(parseAnalyticsRange('year'), 'year');
  for (const bad of ['12w', 'YEAR', '__proto__', 'constructor', 'toString']) {
    assert.equal(parseAnalyticsRange(bad), null, `${bad} must be refused`);
  }
  assert.deepEqual(ANALYTICS_RANGES, { '8w': 8, quarter: 13, year: 52 });
});

test('the week axis is Mondays in SQLite\'s own format, oldest first, and a Sunday belongs to its week', () => {
  const sunday = weekAxis('2026-09-27T23:59:30Z', 8);
  assert.equal(sunday.current, '2026-09-21', 'Sunday 27 September belongs to the week of Monday 21');
  assert.equal(sunday.weeks.length, 8);
  assert.equal(sunday.weeks[0], '2026-08-03');
  assert.equal(sunday.last_complete, '2026-09-14');
  assert.equal(sunday.from, '2026-08-03 00:00:00');
  assert.equal(sunday.to, '2026-09-28 00:00:00');
  assert.ok(!sunday.from.includes('T') && !sunday.to.includes('T'),
    'an ISO bound would drop every row dated on the bound\'s own day (D162)');
  const monday = weekAxis('2026-09-28T00:00:01Z', 8);
  assert.equal(monday.current, '2026-09-28');
  assert.throws(() => weekAxis('2026-09-28T00:00:01Z', 1));
});

// ─────────────────────────────────────────── the fold and its gap reasons ──

const AXIS = weekAxis('2026-09-23T12:00:00Z', 8);
// weeks: 08-03 08-10 08-17 08-24 08-31 09-07 09-14 09-21(current)

test('the fold counts distinct signed-in accounts per branch per week, and anonymity dates history only', () => {
  const fold = foldDailyActives([
    { day: '2026-08-18 00:00:00', branch: 'fr', uid: 0, n: 3, weight: 3 },   // anonymous — dates fr from 08-18
    { day: '2026-08-25', branch: 'fr', uid: 11, n: 2, weight: 2 },
    { day: '2026-08-26', branch: 'fr', uid: 11, n: 1, weight: 1 },            // same account, same week
    { day: '2026-08-27', branch: 'fr', uid: 12, n: 1, weight: 1 },
    { day: '2026-09-08', branch: '', uid: 5, n: 1, weight: 1 },               // HQ's own rows carry ''
    { day: '2026-06-01', branch: 'fr', uid: 99, n: 1, weight: 1 },            // outside the axis
  ], AXIS)!;
  assert.ok(fold);
  assert.equal(fold.byBranch.get('fr')!.get('2026-08-24')!.size, 2, 'one account twice in a week is one');
  assert.equal(fold.byBranch.get('fr')!.has('2026-08-17'), false, 'an anonymous request counts nobody');
  assert.equal(fold.firstDay.get('fr'), '2026-08-18', '…but it does say when the history begins');
  assert.equal(fold.firstDay.get('hq'), '2026-09-08');
  assert.equal(fold.floorDay, '2026-08-18', 'a row outside the axis is not read as history');
  assert.equal(fold.sampled, false);
  // The store's earliest row is a Tuesday, so its own week may have begun
  // before what the store keeps: that week is blank too, not a short count.
  const v = seriesValues(fold, AXIS, 'fr', null);
  assert.deepEqual(v.values, [null, null, null, 2, 0, 0, 0, 0],
    'weeks the store may not fully hold are blank; after them, a week with nobody is a measured 0');
  assert.equal(v.gap, 'before_store');
});

test('a row standing for more than one request marks the read as sampled', () => {
  const fold = foldDailyActives([{ day: '2026-09-15', branch: 'fr', uid: 1, n: 2, weight: 20 }], AXIS)!;
  assert.equal(fold.sampled, true);
});

test('a day the fold cannot read refuses the whole read rather than drawing around a hole', () => {
  assert.equal(foldDailyActives([{ day: 'not-a-day', branch: 'fr', uid: 1, n: 1, weight: 1 }], AXIS), null);
});

test('every gap reason is its own claim, and each has a sentence', () => {
  const fold = foldDailyActives([
    { day: '2026-08-03', branch: 'hq', uid: 1, n: 1, weight: 1 },   // the store's history reaches the window's first day
    { day: '2026-08-20', branch: 'fr', uid: 2, n: 1, weight: 1 },
  ], AXIS)!;
  const fr = seriesValues(fold, AXIS, 'fr', null);
  assert.deepEqual(fr.values, [null, null, 1, 0, 0, 0, 0, 0]);
  assert.equal(fr.gap, 'before_series');
  const de = seriesValues(fold, AXIS, 'de', null);
  assert.ok(de.values.every((x) => x === null), 'a branch with no rows has no zeros');
  assert.equal(de.gap, 'no_rows');
  const capped = seriesValues(fold, AXIS, 'fr', '2026-08-26');
  assert.deepEqual(capped.values, [null, null, null, null, 0, 0, 0, 0],
    'weeks at or before the day the read stopped are blank, not short');
  assert.equal(capped.gap, 'cap');
  for (const g of ['cap', 'before_store', 'no_rows', 'before_series'] as const) {
    assert.ok(GAP_SENTENCES[g] && GAP_SENTENCES[g].length > 30, `${g} needs its own sentence`);
  }
  assert.ok(AE_ACTIVE_ROW_CAP >= 1000);
});

test('the KPI reads the last complete week and refuses a delta across a change in who is counted', () => {
  const kpi = weeklyKpi(AXIS, [
    { values: [null, null, 3, 4, 5, 6, 7, 1] },
    { values: [null, 1, 1, 1, 1, 1, 2, 9] },
  ]);
  assert.equal(kpi.week, '2026-09-14', 'the current week has not ended and is not the headline');
  assert.equal(kpi.value, 9);
  assert.equal(kpi.compare_week, '2026-08-17');
  assert.equal(kpi.delta, 9 - 4);
  const shifted = weeklyKpi(AXIS, [
    { values: [null, null, null, 4, 5, 6, 7, 1] },
    { values: [null, 1, 1, 1, 1, 1, 2, 9] },
  ]);
  assert.equal(shifted.value, 9);
  assert.equal(shifted.delta, null, 'a series that appears would arrive as growth');
  assert.ok(shifted.delta_reason && /populations/.test(shifted.delta_reason));
  const empty = weeklyKpi(AXIS, [{ values: Array(8).fill(null) }]);
  assert.equal(empty.value, null);
  assert.ok(empty.reason);
});

// ──────────────────────────────────────────────────────── branch fixture ──

const FR = {
  JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://fr.axal.vc',
  BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU',
};

function branchDb(opts: { log?: boolean; escalations?: boolean; licence?: boolean; benchmarks?: boolean } = {}) {
  const { log = true, escalations = true, licence = true, benchmarks = true } = opts;
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  if (log) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'activity_logs')));
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'referral_submissions')));
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'referral_submission_events')));
  if (escalations) exec(db, migration('261_branch_escalations.sql'));
  if (licence || benchmarks) {
    exec(db, migration('256_branch_local_copies.sql'));
    exec(db, migration('257_branch_licence_ref.sql'));
    exec(db, migration('265_branch_licence_entity.sql'));
    exec(db, migration('284_branch_licence_kind.sql'));
    if (!benchmarks) db.exec('DROP TABLE branch_benchmarks');
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example');
  u.run(8, 'founder', 'Ben', 'ben@axal.example');
  u.run(9, 'investor', 'Cy', 'cy@axal.example');
  u.run(10, 'exploring', 'Di', 'di@axal.example');
  if (licence) {
    db.prepare(
      `INSERT INTO branch_licence (id, licence_uid, licence_ref, legal_entity, brand_name, territory, status,
                                   seats_json, revenue_share_bps, currency, pushed_at, updated_at)
       VALUES (1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'FR,BE,LU', ?,
               '{"founder":5,"investor":3}', 3500, 'EUR', '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z')`,
    ).run('active');
  }
  return db;
}

async function token(userId: number, role = 'admin') {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const branchApp = new Hono<any>();
branchApp.route('/branch', branchInsights);

async function branchGet(db: InstanceType<typeof DatabaseSync>, path = '/branch/analytics', env: Record<string, unknown> = FR, as = ADMIN) {
  const res = await branchApp.request(path, { headers: { Authorization: `Bearer ${await token(as)}` } },
    { ...env, DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

/** A middleware-shaped request row, stamped in the column default's own format. */
function logged(db: InstanceType<typeof DatabaseSync>, userId: number | null, at: string, endpoint: string | null = '/api/projects') {
  db.prepare(
    `INSERT INTO activity_logs (user_id, action, endpoint, method, status_code, created_at)
     VALUES (?, 'http_get', ?, 'GET', 200, ?)`,
  ).run(userId, endpoint, at);
}

// ──────────────────────────────────────────────────────── branch route ──

test('S15 refuses a range it does not draw, rather than drawing eight weeks under its name', async () => {
  const { status, body } = await branchGet(branchDb(), '/branch/analytics?range=fortnight');
  assert.equal(status, 400);
  assert.equal(body.error, 'bad_range');
  assert.match(body.message, /8w, quarter, year/);
});

test('S15 draws this branch\'s own weeks: blank before its log began, a measured zero after', async () => {
  const db = branchDb();
  const axis = weekAxis(new Date().toISOString(), 8);
  const at = (i: number) => `${axis.weeks[i]} 12:00:00`;
  logged(db, 7, at(2));                        // the log begins in week 2
  logged(db, 7, at(3)); logged(db, 8, at(3));
  logged(db, 9, at(3), null);                  // a non-middleware row filed under account 9
  logged(db, null, at(3));                     // an anonymous request
  logged(db, 8, at(5)); logged(db, 8, at(5));
  const { status, body } = await branchGet(db);
  assert.equal(status, 200);
  const a = body.active_accounts;
  assert.equal(a.available, true);
  assert.deepEqual(a.values, [null, null, 1, 2, 0, 1, 0, 0],
    'account 9\'s row has no endpoint, so it is not a request this rule counts');
  assert.equal(a.gap, 'before_series');
  assert.equal(a.gap_reason, GAP_SENTENCES.before_series);
  assert.equal(a.kpi.week, axis.last_complete);
  assert.equal(a.kpi.value, 0);
  assert.equal(a.kpi.delta, 0 - 1);
  assert.equal(body.basis, ACTIVE_ACCOUNT_BASIS, 'one sentence for the figure on both tiers');
  assert.deepEqual(body.weeks, axis.weeks);
  assert.equal(body.range, '8w');
});

test('S15 reads an unreadable log as unreadable, never as a line of zeros', async () => {
  const { body } = await branchGet(branchDb({ log: false }));
  assert.equal(body.active_accounts.available, false);
  assert.match(body.active_accounts.reason, /not counts of zero/);
  assert.equal(body.active_accounts.values, undefined);
});

test('S15 takes seats and the revenue rate from the licence copy, and says whose share it is', async () => {
  const { body } = await branchGet(branchDb());
  assert.equal(body.seats.available, true);
  assert.equal(body.seats.licensed, 8);
  assert.equal(body.seats.used, 2, 'the founder and the investor hold seat roles; admin and exploring do not');
  assert.ok(body.seats.basis);
  assert.equal(body.revenue.share_bps, 3500);
  assert.equal(body.revenue.keeps_bps, 6500, 'the rate is HQ\'s cut; the branch keeps the complement');
  assert.ok(body.revenue.streams.length >= 2);
  assert.ok(body.revenue.streams.every((s: any) => s.gross_cents === null), 'no stream is invented an amount');
  assert.match(body.revenue.note, /programme fees and perks/);
});

test('S15 with no licence copy says so on the seats and leaves the rate unknown', async () => {
  const { body } = await branchGet(branchDb({ licence: false, benchmarks: false }));
  assert.equal(body.seats.available, false);
  assert.match(body.seats.reason, /HQ has not pushed/);
  assert.equal(body.revenue.share_bps, null);
  assert.equal(body.revenue.keeps_bps, null);
});

test('S15 times a referral from submission to its FIRST verdict, inside the window only', async () => {
  const db = branchDb();
  const sub = db.prepare(
    `INSERT INTO referral_submissions (id, uid, referrer_user_id, referred_name, status, created_at)
     VALUES (?, ?, 8, 'Acme', ?, datetime('now', ?))`,
  );
  const ev = db.prepare(
    `INSERT INTO referral_submission_events (submission_id, label, status, created_at)
     VALUES (?, 'x', ?, datetime('now', ?))`,
  );
  sub.run(1, 'r1', 'qualified', '-60 hours');
  ev.run(1, 'submitted', '-60 hours'); ev.run(1, 'qualified', '-50 hours');          // 10 hours
  sub.run(2, 'r2', 'rejected', '-5 days');
  ev.run(2, 'rejected', '-90 hours');                                                 // 30 hours
  sub.run(3, 'r3', 'converted', '-80 days');
  ev.run(3, 'qualified', '-79 days'); ev.run(3, 'converted', '-2 days');             // decided long ago
  sub.run(4, 'r4', 'under_review', '-3 days');
  ev.run(4, 'under_review', '-2 days');                                               // not decided
  const { body } = await branchGet(db);
  const d = body.decision_age;
  assert.equal(d.queue, 'referrals');
  assert.equal(d.available, true);
  assert.equal(d.n, 2, 'a referral converted this week but decided in July is not a decision this window');
  assert.equal(d.median_hours, 20);
  assert.equal(d.window_days, 30);
  assert.equal(d.hq.available, false, 'HQ publishes no median of this, and the page must not draw one');
});

test('S15 times content sent to HQ from raise to HQ\'s answer, and names whose clock ends it', async () => {
  const db = branchDb();
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const H = 3_600_000;
  const esc = db.prepare(
    `INSERT INTO branch_escalations (hq_uid, kind, subject, status, created_at, updated_at, answered_at)
     VALUES (?, ?, 'S', ?, ?, ?, ?)`,
  );
  esc.run('h1', 'content', 'answered', iso(20 * H), iso(20 * H), iso(15 * H));      // 5h
  esc.run('h2', 'content', 'answered', iso(30 * H), iso(30 * H), iso(23 * H));      // 7h
  esc.run('h3', 'moderation', 'answered', iso(30 * H), iso(30 * H), iso(29 * H));   // another kind
  esc.run('h4', 'content', 'open', iso(10 * H), iso(10 * H), null);                 // unanswered
  esc.run('h5', 'content', 'answered', iso(60 * 24 * H), iso(60 * 24 * H), iso(50 * 24 * H)); // long ago
  const { body } = await branchGet(db);
  const lanes = body.approval_age;
  assert.deepEqual(lanes.map((l: any) => l.key), ['lp_applications', 'cohort_applications', 'referrals', 'content_to_hq']);
  const content = lanes.find((l: any) => l.key === 'content_to_hq');
  assert.equal(content.available, true);
  assert.equal(content.n, 2);
  assert.equal(content.median_hours, 6);
  assert.match(content.clock, /HQ/);
  for (const key of ['lp_applications', 'cohort_applications']) {
    const lane = lanes.find((l: any) => l.key === key);
    assert.equal(lane.available, false, `${key} has no decision timestamp that survives a second move`);
    assert.ok(lane.reason.length > 40);
    assert.equal(lane.median_hours, undefined);
  }
});

test('S15 without the escalation mirror says the log is unreadable, not that HQ answered nothing', async () => {
  const { body } = await branchGet(branchDb({ escalations: false }));
  const content = body.approval_age.find((l: any) => l.key === 'content_to_hq');
  assert.equal(content.available, false);
  assert.match(content.reason, /migration 261/);
});

test('S15 sets its own week beside HQ\'s median, and keeps withheld apart from unreadable', async () => {
  const db = branchDb();
  const axis = weekAxis(new Date().toISOString(), 8);
  logged(db, 8, `${axis.weeks[1]} 09:00:00`);
  logged(db, 8, `${axis.last_complete} 09:00:00`); logged(db, 9, `${axis.last_complete} 10:00:00`);
  db.prepare(
    `INSERT INTO branch_benchmarks (metric_key, label, median_value, unit, n_branches, period, pushed_at)
     VALUES ('active_accounts_week', 'Active accounts · last week', 4, 'count', 3, ?, '2026-09-21T09:00:00Z')`,
  ).run(axis.last_complete);
  let { body } = await branchGet(db);
  assert.equal(body.benchmark.available, true);
  assert.equal(body.benchmark.median_value, 4);
  assert.equal(body.benchmark.n_branches, 3);
  assert.equal(body.benchmark.own_value, 2);
  assert.equal(body.benchmark.pushed_at, '2026-09-21T09:00:00Z');

  db.exec('DELETE FROM branch_benchmarks');
  ({ body } = await branchGet(db));
  assert.equal(body.benchmark.available, false);
  assert.match(body.benchmark.reason, /published no median/);

  ({ body } = await branchGet(branchDb({ benchmarks: false })));
  assert.equal(body.benchmark.available, false);
  assert.match(body.benchmark.reason, /not the same/);
});

test('activation is one sentence on both branch pages, and the footer never says "cannot"', async () => {
  const db = branchDb();
  const a = await branchGet(db);
  const i = await branchGet(db, '/branch/insights');
  assert.equal(a.body.activation.available, false);
  const onInsights = i.body.unavailable.find((u: any) => u.stat === 'Activation');
  assert.equal(onInsights.reason, a.body.activation.reason);
  assert.ok(!/cannot/i.test(a.body.footer), 'a branch that has not been given a credential is not one that cannot');
  assert.match(a.body.footer, /does not read the platform's metrics dataset/);
});

test('S15 answers a suspended branch, and refuses a non-admin and the HQ deployment', async () => {
  const db = branchDb();
  db.exec("UPDATE branch_licence SET status = 'suspended', suspended_at = '2026-09-20T00:00:00Z'");
  const frozen = await branchGet(db);
  assert.equal(frozen.status, 200, 'the freeze guards approval writes, and a frozen branch still reads');
  const founder = await branchApp.request('/branch/analytics',
    { headers: { Authorization: `Bearer ${await token(8, 'founder')}` } }, { ...FR, DB: d1Over(db) });
  assert.notEqual(founder.status, 200);
  const onHq = await branchApp.request('/branch/analytics',
    { headers: { Authorization: `Bearer ${await token(ADMIN)}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) });
  assert.notEqual(onHq.status, 200);
  const src = readFileSync(new URL('../src/routes/branch_insights.ts', import.meta.url), 'utf8');
  assert.ok(!src.includes('requireBranchNotSuspended'));
});

// ─────────────────────────────────────── benchmark readers vs the producer ──

test('the benchmark readers read what branchOverview() actually returns', async () => {
  const db = branchDb();
  db.exec(`
    CREATE TABLE lp_applications (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
    CREATE TABLE cohort_applicants (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
    CREATE TABLE spinout_moderation_cases (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
    INSERT INTO lp_applications (status, created_at) VALUES ('pending', datetime('now','-2 days'));
    INSERT INTO cohort_applicants (status, created_at) VALUES ('pending', datetime('now','-1 days'));
  `);
  const axis = weekAxis(new Date().toISOString(), 8);
  logged(db, 7, `${axis.weeks[0]} 09:00:00`);
  logged(db, 8, `${axis.last_complete} 09:00:00`);
  const ov = await branchOverview({ ...FR, DB: d1Over(db) } as any);
  const read = Object.fromEntries(METRICS.map((m) => [m.key, m.of(ov as any)]));
  assert.equal(read.accounts_total, 4);
  assert.equal(read.seats_used, 2);
  assert.equal(read.approvals_backlog, 2,
    'the backlog metric must read the object the producer returns, not the array a fixture once invented');
  assert.equal(read.active_accounts_week, 1);
  const weekly = METRICS.find((m) => m.key === 'active_accounts_week')!;
  assert.equal(weekly.weekOf!(ov as any), axis.last_complete);

  // A FIELD THE BRANCH REPORTS AS NULL IS NO FIGURE, NEVER A ZERO. D210's
  // mutation run found nothing asserting it: `Number(null)` is 0, so a reader
  // that coerced before checking would turn "this branch has no figure" into
  // "this branch has none", and the median would move. Every reader, including
  // one added later, is held to it.
  const blank = {
    accounts: { total: null }, seats_used: null,
    backlog: { count: null, oldest_at: null },
    active_accounts_week: null, active_accounts_week_of: axis.last_complete,
  };
  for (const m of METRICS) {
    assert.equal(m.of(blank as any), null, `${m.key} must read a reported null as no figure, not as 0`);
  }
});

test('a benchmark week the log began inside, or before the log began, is two different refusals', async () => {
  // Monday 2026-09-07; the log's first row is that Wednesday.
  const db = branchDb();
  logged(db, 7, '2026-09-09 10:00:00');
  const env = { ...FR, DB: d1Over(db) } as any;

  const inside = await activeAccountsInWeek(env, '2026-09-07');
  assert.equal(inside.value, null, 'four days are not a week, so the week is not offered to the median');
  assert.match(inside.reason ?? '', /inside that week/);

  const before = await activeAccountsInWeek(env, '2026-08-31');
  assert.equal(before.value, null);
  assert.ok(!(before.reason ?? '').includes('inside that week'),
    'a week that ended before the log began has no days in it to call partial');
  assert.match(before.reason ?? '', /after that week had ended/);

  const after = await activeAccountsInWeek(env, '2026-09-14');
  assert.equal(after.value, 0, 'a whole week after the log began, with nobody in it, is a measured zero');
  assert.equal(after.reason, undefined);
});

// ──────────────────────────────────────────────────────────── HQ route ──

const SUPER = 1;
const PLAIN = 2;

function hqDb(opts: { registry?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    INSERT INTO users (id, role, name, email) VALUES (1, 'admin', 'Sue', 'sue@axal.example'), (2, 'admin', 'Pat', 'pat@axal.example');
    INSERT INTO super_admins (user_id) VALUES (1);
  `);
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'territory_licences')));
  if (opts.registry !== false) exec(db, migration('258_licence_deployments.sql'));
  const lic = db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, suspended_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  lic.run('lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'suspended', '2026-09-01T00:00:00Z');
  lic.run('lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH', 'active', null);
  if (opts.registry !== false) {
    const dep = db.prepare(
      `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
       VALUES (?, ?, ?, ?, ?, 'live')`,
    );
    dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
    dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  }
  return db;
}

const hqApp = new Hono<any>();
hqApp.route('/', hq);
hqApp.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

const HQ_ENV = { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc' };
const AE_ENV = { ...HQ_ENV, CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AE_API_TOKEN: 'tok' };

async function withAe<T>(answer: (sql: string) => Response, run: (sent: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(String(init?.body ?? ''));
    return answer(String(init?.body ?? ''));
  }) as any;
  try { return await run(sent); } finally { globalThis.fetch = real; }
}

async function hqGet(db: InstanceType<typeof DatabaseSync>, env: Record<string, unknown>, path = '/analytics', as = SUPER) {
  const res = await hqApp.request(path, { headers: { Authorization: `Bearer ${await token(as)}` } },
    { ...env, DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

test('H15 without a read credential says the dataset is unreadable, and draws no line', async () => {
  const { status, body } = await hqGet(hqDb(), HQ_ENV);
  assert.equal(status, 200);
  assert.equal(body.active_accounts.available, false);
  assert.match(body.active_accounts.reason, /not a count of zero/);
  assert.equal(body.active_accounts.series, undefined);
  assert.deepEqual(body.not_recorded.map((n: any) => n.key),
    ['activation', 'approval_age', 'token_spend', 'revenue_by_stream']);
  assert.equal(body.foot, 'Aggregates, never records.');
});

test('H15 draws one line per registered branch and one for HQ, from the store\'s own rows', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const day = (i: number) => `${axis.weeks[i]} 00:00:00`;
  const rows = [
    { day: day(1), branch: 'fr', uid: 0, n: 4, weight: 4 },
    { day: day(3), branch: 'fr', uid: 424242, n: 2, weight: 2 },
    { day: day(3), branch: 'fr', uid: 424243, n: 1, weight: 1 },
    { day: day(6), branch: 'fr', uid: 424242, n: 1, weight: 1 },
    { day: day(0), branch: '', uid: 31337, n: 1, weight: 1 },
    { day: day(6), branch: 'xx', uid: 5, n: 1, weight: 1 },
  ];
  const { body } = await withAe(
    () => new Response(JSON.stringify({ data: rows }), { status: 200 }),
    async (sent) => {
      const r = await hqGet(hqDb(), AE_ENV);
      assert.equal(sent.length, 1);
      const sql = sent[0];
      assert.ok(sql.includes(aeLoggedRequestPredicate()), 'HQ counts by the same rule the branch does');
      assert.ok(sql.includes(`toDateTime('${axis.from}')`) && sql.includes(`toDateTime('${axis.to}')`));
      assert.ok(sql.includes('toStartOfDay('), 'the week is folded from days, not from an undocumented week start');
      assert.ok(!/toStartOfWeek/i.test(sql) && !sql.includes('!=') && !/count\s*\(\s*distinct/i.test(sql));
      assert.ok(sql.includes(`LIMIT ${AE_ACTIVE_ROW_CAP}`));
      return r;
    },
  );
  const a = body.active_accounts;
  assert.equal(a.available, true);
  assert.deepEqual(a.series.map((s: any) => [s.code, s.kind]),
    [['hq', 'hq'], ['de', 'branch'], ['fr', 'branch'], ['xx', 'unregistered']]);
  const by = Object.fromEntries(a.series.map((s: any) => [s.code, s]));
  assert.deepEqual(by.fr.values, [null, 0, 0, 2, 0, 0, 1, 0]);
  assert.equal(by.fr.label, 'Axal VC France');
  assert.equal(by.fr.status, 'suspended', 'a suspended branch keeps its line: reads are not gated');
  assert.ok(by.de.values.every((v: any) => v === null));
  assert.equal(by.de.gap, 'no_rows');
  assert.equal(by.de.gap_reason, GAP_SENTENCES.no_rows);
  assert.deepEqual(by.hq.values, [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(by.xx.note, /registry has no row/);
  assert.equal(a.sampled, false);
  assert.equal(a.complete, true);
  const json = JSON.stringify(body);
  for (const id of ['424242', '424243', '31337']) {
    assert.ok(!json.includes(id), 'no account identifier leaves the read');
  }
});

test('H15 marks a sampled read as a floor', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const { body } = await withAe(
    () => new Response(JSON.stringify({ data: [{ day: `${axis.weeks[4]} 00:00:00`, branch: 'fr', uid: 3, n: 1, weight: 10 }] })),
    () => hqGet(hqDb(), AE_ENV),
  );
  assert.equal(body.active_accounts.sampled, true);
  assert.match(body.active_accounts.sampled_note, /floor/);
});

test('H15 reads a failed, malformed or unreadable answer from the store as unreadable, never as empty', async () => {
  for (const answer of [
    () => new Response('boom', { status: 500 }),
    () => new Response(JSON.stringify({ meta: [] }), { status: 200 }),
    () => new Response(JSON.stringify({ data: [{ day: 'soon', branch: 'fr', uid: 1, n: 1, weight: 1 }] })),
  ]) {
    const { body } = await withAe(answer, () => hqGet(hqDb(), AE_ENV));
    assert.equal(body.active_accounts.available, false);
    assert.ok(body.active_accounts.reason);
    assert.equal(body.active_accounts.series, undefined);
  }
});

test('H15 with the registry unreadable says so, and does not call a recorded code unregistered', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const { body } = await withAe(
    () => new Response(JSON.stringify({ data: [{ day: `${axis.weeks[5]} 00:00:00`, branch: 'fr', uid: 3, n: 1, weight: 1 }] })),
    () => hqGet(hqDb({ registry: false }), AE_ENV),
  );
  assert.equal(body.registry.readable, false);
  assert.match(body.registry.reason, /migration 258/);
  const fr = body.active_accounts.series.find((s: any) => s.code === 'fr');
  assert.equal(fr.kind, 'branch', 'nobody read the registry, so nobody can say fr is missing from it');
  assert.equal(fr.note, undefined);
});

test('H15 is the super admin\'s, refuses an unknown range, and uses the same range vocabulary', async () => {
  const plain = await hqGet(hqDb(), HQ_ENV, '/analytics', PLAIN);
  assert.equal(plain.status, 403);
  const bad = await hqGet(hqDb(), HQ_ENV, '/analytics?range=12w');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_range');
  const year = await hqGet(hqDb(), HQ_ENV, '/analytics?range=year');
  assert.equal(year.body.weeks.length, 52);
  assert.equal(year.body.weeks[51], weekStartOf(new Date().toISOString().slice(0, 10)));
});
