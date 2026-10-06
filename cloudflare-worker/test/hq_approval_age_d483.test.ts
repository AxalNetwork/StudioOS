/**
 * D483 (#1025) — H15's median approval age, across HQ and every branch.
 *
 * Real SQLite on both tiers. A branch answers `approvalAges()` with
 * `branchApprovalAges` run over its own database; HQ's route fans out to a
 * stand-in binding that calls exactly that function, so what HQ prints is
 * what the branch computed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_approval_age_d483.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { branchApprovalAges } from '../src/rpc/branchOps.ts';
import {
  APPROVAL_AGE_NOT_RECORDED, DECISION_HOURS_CAP, referralAges,
} from '../src/services/approvalAge.ts';
import branchInsights from '../src/routes/branch_insights.ts';
import hq from '../src/routes/admin_hq.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };
const stamp = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

async function token(id: number) {
  return new SignJWT({ user_id: id, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Referral tables, with one decided referral per `[submittedHoursAgo, decidedHoursAgo]`. */
function withReferrals(db: InstanceType<typeof DatabaseSync>, decided: Array<[number, number]>) {
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'referral_submissions')));
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'referral_submission_events')));
  const sub = db.prepare(
    `INSERT INTO referral_submissions (id, uid, referrer_user_id, referred_name, status, created_at)
     VALUES (?, ?, 8, 'Private Name Ltd', 'qualified', ?)`,
  );
  const ev = db.prepare(`INSERT INTO referral_submission_events (submission_id, label, status, created_at) VALUES (?, 'x', ?, ?)`);
  decided.forEach(([from, to], i) => {
    const id = 9000 + i;
    sub.run(id, `ref-secret-${id}`, stamp(from));
    ev.run(id, 'submitted', stamp(from));
    ev.run(id, 'qualified', stamp(to));
  });
  return db;
}

function branchDb(decided: Array<[number, number]>) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (7, 'admin', 'Ada', 'ada@axal.example')`).run();
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'activity_logs')));
  exec(db, migration('261_branch_escalations.sql'));
  return withReferrals(db, decided);
}

const branchEnv = (db: InstanceType<typeof DatabaseSync>, code = 'fr') =>
  ({ DB: d1Over(db), BRANCH_CODE: code, JWT_SECRET, ENVIRONMENT: 'development' }) as any;

/** A binding that answers `approvalAges()` exactly as the branch's entrypoint would. */
const binding = (db: InstanceType<typeof DatabaseSync>, code: string) =>
  ({ approvalAges: () => branchApprovalAges(branchEnv(db, code)) });

function hqDb(opts: { decided?: Array<[number, number]>; escalations?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    INSERT INTO users (id, role, name, email) VALUES (1, 'admin', 'Sue', 'sue@axal.example'), (2, 'admin', 'Pat', 'pat@axal.example');
    INSERT INTO super_admins (user_id) VALUES (1);
  `);
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'territory_licences')));
  exec(db, migration('258_licence_deployments.sql'));
  const lic = db.prepare(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, ?, ?, ?, 'active')`);
  lic.run('lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run('lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH');
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?, ?, ?, ?, ?, 'live')`);
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  if (opts.escalations !== false) exec(db, migration('259_hq_escalations.sql'));
  return withReferrals(db, opts.decided || []);
}

const hqApp = new Hono<any>();
hqApp.route('/', hq);
hqApp.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function h15(db: InstanceType<typeof DatabaseSync>, bindings: Record<string, unknown>, as = 1) {
  const res = await hqApp.request('/analytics', { headers: { Authorization: `Bearer ${await token(as)}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db), ...bindings });
  return { status: res.status, body: await res.json() as any };
}

const row = (body: any, code: string) => body.approval_age.referrals.rows.find((r: any) => r.code === code);

// ───────────────────────────────────────────────────────────── the branch ──

test('a branch answers its referral ages with durations only: no id, uid or name leaves it', async () => {
  const db = branchDb([[60, 50], [40, 36], [30, 29]]); // 10h, 4h, 1h
  const ans = await branchApprovalAges(branchEnv(db));
  assert.equal(ans.branch, 'fr');
  assert.equal(ans.window_days, 30);
  assert.equal(ans.referrals.available, true);
  assert.equal(ans.referrals.n, 3);
  assert.equal(ans.referrals.median_hours, 4);
  assert.deepEqual(ans.referrals.hours, [1, 4, 10], 'sorted, so the order of arrival is not sent either');
  assert.deepEqual(Object.keys(ans.referrals).sort(), ['available', 'hours', 'median_hours', 'n', 'truncated'],
    'the referral answer carries exactly these fields');
  const sent = JSON.stringify(ans);
  assert.doesNotMatch(sent, /ref-secret|Private Name|9000|submission/i, 'a record left the branch');
});

test('the branch tells HQ the same median its own Analytics page prints', async () => {
  const db = branchDb([[60, 50], [40, 36], [30, 29], [100, 20]]);
  const app = new Hono<any>();
  app.route('/', branchInsights);
  const res = await app.request('/analytics', { headers: { Authorization: `Bearer ${await token(7)}` } }, branchEnv(db));
  const page = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(page));
  const rpc = await branchApprovalAges(branchEnv(db));
  assert.equal(rpc.referrals.median_hours, page.decision_age.median_hours);
  assert.equal(rpc.referrals.n, page.decision_age.n);
  assert.equal(page.decision_age.median_hours, 7, 'four decisions of 1, 4, 10 and 80 hours');
});

test('past the cap the list is cut and marked, and the branch\'s own median still counts every decision', async () => {
  const many: Array<[number, number]> = Array.from({ length: DECISION_HOURS_CAP + 3 }, (_, i) => [50, 50 - (i % 5) - 1]);
  const ans = await referralAges({ DB: d1Over(branchDb(many)) } as any, Date.now());
  assert.equal(ans.available, true);
  assert.equal(ans.n, DECISION_HOURS_CAP + 3);
  assert.equal(ans.hours.length, DECISION_HOURS_CAP);
  assert.equal(ans.truncated, true);
  const under = await referralAges({ DB: d1Over(branchDb(many.slice(0, DECISION_HOURS_CAP))) } as any, Date.now());
  assert.equal(under.truncated, false, 'exactly the cap is not cut');
});

test('HQ\'s tier refuses to answer as a branch', async () => {
  const db = branchDb([]);
  await assert.rejects(() => branchApprovalAges({ DB: d1Over(db) } as any), /only live on a branch/);
});

test('an unreadable referral log is unreadable, not "no decisions"', async () => {
  const db = branchDb([[10, 5]]);
  db.exec('DROP TABLE referral_submission_events');
  const ans = await referralAges({ DB: d1Over(db) } as any, Date.now());
  assert.equal(ans.available, false);
  assert.equal((ans as any).unreadable, true);
  assert.equal(ans.median_hours, null);
  assert.match((ans as any).reason, /could not be read/);
});

// ──────────────────────────────────────────────────────────────── HQ ──

test('H15 names every line: HQ\'s own, each branch that answered, and one that did not, with its reason', async () => {
  const fr = branchDb([[60, 50], [40, 36]]); // 10h, 4h
  const { status, body } = await h15(hqDb({ decided: [[30, 28]] }), {
    BRANCH_FR: binding(fr, 'fr'),
    BRANCH_DE: { approvalAges: async () => { throw new Error('connection reset'); } },
  });
  assert.equal(status, 200);
  const age = body.approval_age;
  assert.equal(age.window_days, 30);
  assert.deepEqual(age.referrals.rows.map((r: any) => r.code), ['hq', 'de', 'fr']);
  assert.deepEqual(row(body, 'hq'), { code: 'hq', label: 'HQ-held', kind: 'hq', available: true, median_hours: 2, n: 1 });
  assert.equal(row(body, 'fr').label, 'Axal VC France');
  assert.equal(row(body, 'fr').median_hours, 7);
  assert.equal(row(body, 'fr').n, 2);
  assert.equal(row(body, 'de').available, false);
  assert.equal(row(body, 'de').unreadable, true);
  assert.match(row(body, 'de').reason, /connection reset/);
  assert.deepEqual(age.referrals.coverage, { total: 2, answered: 1, complete: false, unreadable: ['de'] });
  assert.equal(age.referrals.all.lines_counted, 2);
  assert.equal(age.referrals.all.lines_total, 3);
  assert.doesNotMatch(JSON.stringify(body), /ref-secret|Private Name/, 'a branch record reached HQ\'s payload');
});

test('the figure across lines is one median over every decision, not a median of medians', async () => {
  // HQ: one decision of 1h. FR: three of 10h. Medians of 1 and 10 average to
  // 5.5; pooled, three of the four decisions took 10 hours.
  const fr = branchDb([[30, 20], [40, 30], [50, 40]]);
  const { body } = await h15(hqDb({ decided: [[5, 4]] }), { BRANCH_FR: binding(fr, 'fr') });
  assert.equal(body.approval_age.referrals.all.median_hours, 10);
  assert.equal(body.approval_age.referrals.all.n, 4);
  assert.equal(body.approval_age.referrals.all.reason, undefined);
});

test('a line that sent a cut list stops the median across lines, and says why', async () => {
  const hours = Array.from({ length: DECISION_HOURS_CAP }, () => 3);
  const { body } = await h15(hqDb({ decided: [[5, 4]] }), {
    BRANCH_FR: {
      approvalAges: async () => ({
        branch: 'fr', as_of: new Date().toISOString(), window_days: 30,
        referrals: { available: true, median_hours: 3, n: DECISION_HOURS_CAP + 5, hours, truncated: true },
      }),
    },
  });
  assert.equal(body.approval_age.referrals.all.median_hours, null);
  assert.match(body.approval_age.referrals.all.reason, /cut list/);
  assert.equal(row(body, 'fr').median_hours, 3, 'the branch\'s own median still stands');
});

test('no decision anywhere is said, not drawn as zero', async () => {
  const { body } = await h15(hqDb(), { BRANCH_FR: binding(branchDb([]), 'fr') });
  assert.equal(body.approval_age.referrals.all.median_hours, null);
  assert.match(body.approval_age.referrals.all.reason, /No referral was decided on any line that answered/);
  assert.match(row(body, 'fr').reason, /No referral was decided in the last 30 days/);
  assert.equal(row(body, 'fr').available, true, 'read and empty is not unreadable');
});

test('escalations are timed on HQ\'s own clock, inside the window, per branch', async () => {
  const db = hqDb();
  const esc = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, created_at, answered_at) VALUES (?, ?, 'content', 's', ?, ?, ?)`,
  );
  const iso = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  esc.run('e1', 'fr', 'answered', iso(30), iso(24)); // 6h
  esc.run('e2', 'fr', 'answered', iso(20), iso(18)); // 2h
  esc.run('e3', 'de', 'answered', iso(50), iso(40)); // 10h
  esc.run('e4', 'de', 'answered', iso(40 * 24), iso(35 * 24)); // answered before the window
  esc.run('e5', 'de', 'answered', iso(5), iso(9)); // answered before it was raised
  esc.run('e6', 'fr', 'open', iso(3), null);
  const { body } = await h15(db, {});
  const e = body.approval_age.escalations;
  assert.equal(e.available, true);
  assert.equal(e.n, 3);
  assert.equal(e.median_hours, 6);
  assert.deepEqual(e.by_branch.map((b: any) => [b.code, b.median_hours, b.n]), [['de', 10, 1], ['fr', 4, 2]]);
  assert.equal(e.by_branch.find((b: any) => b.code === 'fr').label, 'Axal VC France');
  assert.match(e.clock, /HQ's at both ends/);
});

test('an unreadable escalation log is unreadable, beside referral lines it did read', async () => {
  const { body } = await h15(hqDb({ escalations: false, decided: [[5, 4]] }), {});
  assert.equal(body.approval_age.escalations.available, false);
  assert.equal(body.approval_age.escalations.unreadable, true);
  assert.match(body.approval_age.escalations.reason, /migration 259/);
  assert.equal(row(body, 'hq').available, true);
});

test('median approval age leaves the not-recorded list; the two untimeable queues travel with their reasons', async () => {
  const { body } = await h15(hqDb(), {});
  assert.deepEqual(body.not_recorded.map((n: any) => n.key), ['activation', 'token_spend', 'revenue_by_stream']);
  assert.deepEqual(body.approval_age.not_recorded, APPROVAL_AGE_NOT_RECORDED.map((q) => ({ ...q })));
  assert.deepEqual(body.approval_age.not_recorded.map((n: any) => n.key), ['lp_applications', 'cohort_applications']);
});

test('only a Super Admin reads it', async () => {
  const { status } = await h15(hqDb(), {}, 2);
  assert.equal(status, 403);
});
