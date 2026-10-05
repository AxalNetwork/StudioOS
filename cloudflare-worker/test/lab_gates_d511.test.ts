/**
 * D511 — two of the three Spin-Out Lab gaps #992 names.
 *
 *   1. `getCohortSizeSettings` answered the product defaults when its read
 *      FAILED, and its callers acted on that number: the cron postponed or
 *      activated cycles against a minimum nobody read, the admin overview
 *      judged every cycle against it, and `/brief` printed the places. It now
 *      throws `CohortSettingsUnreadable`; the cron checks no capacity and
 *      activates nothing, and the overview says unreadable. (`/brief` is pinned
 *      in spinout_brief_d141.test.ts.)
 *   2. The certificate admin writes never called `requireBranchNotSuspended`,
 *      so a suspended branch could still issue, revoke and backfill (D135).
 *
 * The tick, the admin overview and the certificate routes run for real over
 * node:sqlite, their tables taken from `schema_baseline.sql`. A failed read is
 * injected at the adapter for the one SELECT on `cohort_settings`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_gates_d511.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  getCohortSizeSettings, readCohortSizeSettings, runCohortApplicationsTick, CohortSettingsUnreadable,
} from '../src/services/cohortApplications.ts';
import adminCohort from '../src/routes/admin_cohort.ts';
import certificates from '../src/routes/spinout_certificates.ts';
import { BRANCH_SUSPENDED } from '../src/util/branch.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 900, FOUNDER = 117;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'week_windows', 'cohort_applicants', 'cohort_cycle_events',
    'cohort_app_notification_ledger', 'cohort_settings', 'scheduled_jobs_audit', 'user_spinout_flags',
    'spinout_applications', 'activity_logs', 'spinout_lab_milestones', 'projects', 'spinout_certificates']) db.exec(ddl(t));
  db.exec(`CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN, 'admin', 'Admin One', 'admin@example.test');
  u.run(FOUNDER, 'founder', 'Ada Graduate', 'ada@example.test');
  return db;
}

/** D1 over `db`; with `failSettings`, the read of cohort_settings throws. */
function makeD1(db: InstanceType<typeof DatabaseSync>, failSettings = false) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() {
          if (failSettings && /FROM cohort_settings/.test(sql)) throw new Error('D1_ERROR: disk I/O error');
          return { results: db.prepare(sql).all(...b) };
        },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; }
};

/** A cycle already in review whose start has passed, with one approved applicant. */
function dueCycle(db: any) {
  const cyc = Number(db.prepare(`INSERT INTO cohort_cycles (year, month, start_at, end_at, app_status)
    VALUES (2026, 9, '2026-09-01T04:00:00.000Z', '2026-09-29T04:00:00.000Z', 'reviewing')`).run().lastInsertRowid);
  const app = Number(db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea, status) VALUES (?, 'Acme', 'An idea', 'pending')`).run(FOUNDER).lastInsertRowid);
  db.prepare(`INSERT INTO cohort_applicants (application_id, user_id, cohort_cycle_id, status) VALUES (?, ?, ?, 'approved')`).run(app, FOUNDER, cyc);
  return cyc;
}
const NOW = new Date('2026-09-02T12:00:00.000Z');

// ---- 1. the settings read ----------------------------------------------------

test('a settings read that fails throws; a key nobody set is the product default', async () => {
  const db = freshDb();
  await assert.rejects(quiet(() => getCohortSizeSettings({ DB: makeD1(db, true) } as any)), CohortSettingsUnreadable);
  assert.equal(await quiet(() => readCohortSizeSettings({ DB: makeD1(db, true) } as any)), null);
  const unset = await getCohortSizeSettings({ DB: makeD1(db) } as any);
  assert.ok(unset.min > 0 && unset.max > 0, 'an unset key answers the operative default');
  db.prepare(`INSERT INTO cohort_settings (key, value) VALUES ('min_cohort_size', '3'), ('max_cohort_size', '12')`).run();
  assert.deepEqual(await getCohortSizeSettings({ DB: makeD1(db) } as any), { min: 3, max: 12 });
});

test('the tick checks no capacity and activates nothing when the minimum cannot be read', async () => {
  const db = freshDb();
  const cyc = dueCycle(db);
  await quiet(() => runCohortApplicationsTick({ DB: makeD1(db, true) } as any, NOW));
  const row = db.prepare('SELECT app_status FROM cohort_cycles WHERE id = ?').get(cyc) as any;
  assert.equal(row.app_status, 'reviewing', 'the cycle was postponed or moved on a minimum nobody read');
  assert.equal((db.prepare('SELECT status FROM cohort_applicants WHERE cohort_cycle_id = ?').get(cyc) as any).status, 'approved',
    'an applicant was activated into a cycle whose capacity was never checked');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_spinout_flags').get().n, 0, 'nobody was admitted');
  const ev = db.prepare(`SELECT event_type, details FROM cohort_cycle_events WHERE cohort_cycle_id = ?`).all(cyc) as any[];
  assert.ok(ev.some((e) => e.event_type === 'capacity_unreadable' && /could not be read/.test(e.details)),
    'the cycle\'s history does not say why it did not move');
});

test('an outage that lasts many ticks is one line in the cycle\'s history, and a new outage is another', async () => {
  const db = freshDb();
  const cyc = dueCycle(db);
  const unreadable = () => (db.prepare(`SELECT COUNT(*) AS n FROM cohort_cycle_events WHERE cohort_cycle_id = ? AND event_type = 'capacity_unreadable'`).get(cyc) as any).n;
  for (let i = 0; i < 3; i++) await quiet(() => runCohortApplicationsTick({ DB: makeD1(db, true) } as any, NOW));
  assert.equal(unreadable(), 1, 'every retry appended the same line');
  // Something else happens to the cycle in between: the outage that follows is a new one.
  db.prepare(`INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details) VALUES (?, 'note', 'x')`).run(cyc);
  await quiet(() => runCohortApplicationsTick({ DB: makeD1(db, true) } as any, NOW));
  assert.equal(unreadable(), 2, 'a later outage went unrecorded');
});

test('with the minimum readable, the same tick checks capacity and activates', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO cohort_settings (key, value) VALUES ('min_cohort_size', '1')`).run();
  const cyc = dueCycle(db);
  await quiet(() => runCohortApplicationsTick({ DB: makeD1(db) } as any, NOW));
  assert.equal((db.prepare('SELECT status FROM cohort_applicants WHERE cohort_cycle_id = ?').get(cyc) as any).status, 'activated');
  const ev = db.prepare(`SELECT event_type FROM cohort_cycle_events WHERE cohort_cycle_id = ?`).all(cyc).map((e: any) => e.event_type);
  assert.ok(ev.includes('capacity_ok'));
  assert.ok(!ev.includes('capacity_unreadable'));
});

async function tok(who: number) {
  return new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

test('the admin overview says the settings are unreadable and judges no cycle against them', async () => {
  const db = freshDb();
  dueCycle(db);
  const call = async (fail: boolean) => {
    const res = await adminCohort.request('/applications', { headers: { Authorization: `Bearer ${await tok(ADMIN)}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, fail) } as any);
    return { status: res.status, body: (await res.json()) as any };
  };
  const bad = await quiet(() => call(true));
  assert.equal(bad.status, 200, JSON.stringify(bad.body));
  assert.equal(bad.body.settings, null);
  assert.equal(bad.body.settings_unreadable, true);
  assert.ok(bad.body.cycles.length > 0);
  for (const cy of bad.body.cycles) assert.equal(cy.meets_minimum, null, `cycle ${cy.id} was judged against an unread minimum`);
  const ok = await quiet(() => call(false));
  assert.equal(ok.body.settings_unreadable, false);
  assert.ok(ok.body.settings.min > 0);
  assert.ok(ok.body.cycles.every((cy: any) => typeof cy.meets_minimum === 'boolean'));
});

// ---- 2. the freeze reaches certificates ----------------------------------------

/** The certificate router behind the global handler's mapping of the freeze. */
function frozenApp() {
  const app = new Hono();
  app.route('/', certificates as any);
  app.onError((e) => (e.message === BRANCH_SUSPENDED
    ? new Response(JSON.stringify({ error: 'branch_suspended' }), { status: 423 })
    : new Response(String(e.message), { status: 500 })));
  return app;
}

function branchDb(status: string) {
  const db = freshDb();
  db.exec(`CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT, suspended_at TEXT, suspended_note TEXT);`);
  db.prepare(`INSERT INTO branch_licence (id, status) VALUES (1, ?)`).run(status);
  db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, 4, 'incorporation_completed', '2026-07-31 14:00:00')`).run(FOUNDER);
  return db;
}

async function post(db: any, path: string, body: unknown) {
  const res = await frozenApp().request(path, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok(ADMIN)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', BRANCH_CODE: 'NO', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('a suspended branch can neither issue, revoke nor backfill a certificate', async () => {
  const db = branchDb('suspended');
  db.prepare(`INSERT INTO spinout_certificates (credential_id, user_id, public_name, public_issued_on) VALUES ('AXL-1', ?, 'Ada', '2026-07-31')`).run(FOUNDER);
  const issue = await quiet(() => post(db, '/certificates', { user_id: FOUNDER }));
  assert.equal(issue.status, 423);
  const manual = await quiet(() => post(db, '/certificates', { user_id: FOUNDER, public_name: 'Ada', conferred_at: '2026-08-01' }));
  assert.equal(manual.status, 423);
  const revoke = await quiet(() => post(db, '/certificates/1/revoke', { reason: 'Issued to the wrong account' }));
  assert.equal(revoke.status, 423);
  const backfill = await quiet(() => post(db, '/certificates/backfill', {}));
  assert.equal(backfill.status, 423);
  const rows = db.prepare('SELECT credential_id, status FROM spinout_certificates').all().map((r: any) => ({ ...r }));
  assert.deepEqual(rows, [{ credential_id: 'AXL-1', status: 'issued' }], 'a frozen branch changed the registry');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM activity_logs`).get().n, 0);
});

test('an active branch still issues and revokes', async () => {
  const db = branchDb('active');
  const issued = await quiet(() => post(db, '/certificates', { user_id: FOUNDER }));
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const id = issued.body.certificate.id;
  const revoked = await quiet(() => post(db, `/certificates/${id}/revoke`, { reason: 'Issued to the wrong account' }));
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.certificate.status, 'revoked');
});
