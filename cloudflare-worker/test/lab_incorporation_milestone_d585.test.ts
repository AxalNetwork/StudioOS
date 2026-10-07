/**
 * D585 (#1212) — `incorporation_completed` is recorded by the Worker at
 * payment (the owner's answer A), from the server's own order status.
 *
 * The real Lab router, the payment recorders and the sync run over node:sqlite
 * with the baseline's Lab, certificate and ledger tables and migration 381's
 * rules. What is pinned:
 *   - the payment webhook records the milestone, issues the certificate and
 *     pays both credits, exactly once; a replayed webhook records nothing new;
 *   - an order not yet paid records nothing, by any path;
 *   - a client call alone cannot record it: POST /milestone refuses without a
 *     paid order, and with one only syncs from it;
 *   - the state read catches up a paid order that was not yet recorded;
 *   - Eadwyn's entity answer and the Incorporate page no longer record it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_incorporation_milestone_d585.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import spinoutLab from '../src/routes/spinout_lab.ts';
import { recordPaidIncorporation, recordPaidIncorporationFromPaymentIntent } from '../src/services/incorporations.ts';
import { syncIncorporationMilestone } from '../src/services/labIncorporationMilestone.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 101, OUTSIDER = 102, GRAD = 103, OLD_GRAD = 104, ADMIN = 900;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG381 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/381_credit_reward_rules.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb({ rules = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'spinout_lab_milestones', 'activity_logs', 'spinout_applications', 'projects',
    'user_spinout_flags', 'spinout_certificates', 'perk_credit_ledger']) db.exec(ddl(t));
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ledger_idem ON perk_credit_ledger(user_id, kind, source_ref);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  if (rules) db.exec(MIG381);
  else db.exec('ALTER TABLE perk_credit_ledger ADD COLUMN rule_key TEXT');
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active, spinout_lab_week) VALUES (?, ?, ?, ?, 1, ?, ?)`);
  u.run(MEMBER, 'founder', 'Ada Member', 'ada@example.test', 1, 4);
  u.run(OUTSIDER, 'founder', 'Bo Outsider', 'bo@example.test', 1, 4);
  u.run(GRAD, 'founder', 'Cy Graduate', 'cy@example.test', 0, 4);
  u.run(OLD_GRAD, 'founder', 'Di Before', 'di@example.test', 0, 4);
  u.run(ADMIN, 'admin', 'Admin One', 'admin@example.test', 0, 1);
  const f = db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, ?, 'Cohort 4')`);
  f.run(MEMBER, 1); f.run(GRAD, 1); f.run(OLD_GRAD, 1); f.run(OUTSIDER, 0);
  const m = db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)`);
  m.run(GRAD, 4, 'incorporation_completed', '2026-10-04 09:00:00');
  m.run(OLD_GRAD, 4, 'incorporation_completed', '2026-08-01 09:00:00');
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
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
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}
const QUEUED: any[] = [];
const envOf = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), USE_CF_QUEUE: 'true', JOB_QUEUE: { send: async (m: any) => { QUEUED.push(m); } } }) as any;

async function call(router: any, db: InstanceType<typeof DatabaseSync>, method: string, path: string, who: number, body?: unknown) {
  const role = who === ADMIN ? 'admin' : 'founder';
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await router.request(path, init, envOf(db));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const record = (db: any, who: number, key: string) => call(spinoutLab, db, 'POST', '/milestone', who, { milestone_key: key });
const grants = (db: any, who: number) =>
  db.prepare(`SELECT delta, source_ref, rule_key FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' ORDER BY id`).all(who).map((x: any) => ({ ...x }));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};


const ORDER = (db: any, who: number, status = 'pending_payment') => {
  db.exec(`CREATE TABLE IF NOT EXISTS incorporations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
    jurisdiction_id TEXT NOT NULL, company_name TEXT NOT NULL, registered_agent_name TEXT, registered_agent_address TEXT,
    amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP)`);
  return Number(db.prepare(`INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, status) VALUES (?, 1, 'us_de_ccorp', 'Acme, Inc.', 50000, ?)`)
    .run(who, status).lastInsertRowid);
};
const milestone = (db: any, who: number) => db.prepare(`SELECT COUNT(*) AS n FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = 'incorporation_completed'`).get(who).n;
const certs = (db: any, who: number) => db.prepare(`SELECT COUNT(*) AS n FROM spinout_certificates WHERE user_id = ? AND status = 'issued'`).get(who).n;
const paidWebhook = (env: any, id: number) => recordPaidIncorporation(env, { id: `cs_${id}`, metadata: { incorporation_id: String(id) }, payment_status: 'paid', amount_total: 50000, currency: 'usd' });

test('the payment webhook records the milestone, the certificate and both credits, once; a replay records nothing', async () => {
  const db = freshDb();
  const env = envOf(db);
  const id = ORDER(db, MEMBER);
  await quiet(() => paidWebhook(env, id));
  assert.equal(milestone(db, MEMBER), 1, 'payment did not record incorporation_completed');
  assert.equal(certs(db, MEMBER), 1, 'the certificate was not issued');
  assert.deepEqual(grants(db, MEMBER).map((g: any) => g.rule_key).sort(), ['lab:graduation', 'lab:incorporation_completed']);
  // A replayed webhook (the row is no longer pending_payment) records nothing new.
  await quiet(() => paidWebhook(env, id));
  db.prepare(`UPDATE incorporations SET status = 'pending_payment' WHERE id = ?`).run(id);
  await quiet(() => paidWebhook(env, id));
  assert.equal(milestone(db, MEMBER), 1);
  assert.equal(certs(db, MEMBER), 1);
  assert.equal(grants(db, MEMBER).length, 2, 'a replay paid twice');
});

test('the PaymentIntent path records it the same way', async () => {
  const db = freshDb();
  const env = envOf(db);
  const id = ORDER(db, MEMBER);
  await quiet(() => recordPaidIncorporationFromPaymentIntent(env, { id: 'pi_1', metadata: { incorporation_id: String(id) }, amount_received: 50000, currency: 'usd' }));
  assert.equal(milestone(db, MEMBER), 1);
  assert.equal(certs(db, MEMBER), 1);
});

test('an order that is not paid records nothing, by any path', async () => {
  const db = freshDb();
  const env = envOf(db);
  ORDER(db, MEMBER, 'pending_payment');
  // A webhook whose session is not paid.
  await quiet(() => recordPaidIncorporation(env, { id: 'cs_x', metadata: { incorporation_id: '1' }, payment_status: 'unpaid' }));
  const r = await quiet(() => record(db, MEMBER, 'incorporation_completed'));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'incorporation_not_paid');
  await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.deepEqual(await quiet(() => syncIncorporationMilestone(env, MEMBER)), { recorded: false, reason: 'not_paid' });
  assert.equal(milestone(db, MEMBER), 0, 'a client call or a read recorded the milestone without a paid order');
  assert.equal(certs(db, MEMBER), 0);
});

test('with a paid order, the state read catches up, and the client call only syncs', async () => {
  const db = freshDb();
  ORDER(db, MEMBER, 'packet_processing'); // paid before this change, never recorded
  const s = await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.equal(s.status, 200);
  assert.equal(milestone(db, MEMBER), 1, 'the state read did not catch up a paid order');
  const again = await quiet(() => record(db, MEMBER, 'incorporation_completed'));
  assert.equal(again.status, 200);
  assert.equal(again.body.graduation_credit, null, 'a second call paid again');
  assert.equal(certs(db, MEMBER), 1);
  assert.equal(grants(db, MEMBER).filter((g: any) => g.rule_key === 'lab:graduation').length, 1);
});

test('someone else\'s paid order records nothing for this member', async () => {
  const db = freshDb();
  ORDER(db, OUTSIDER, 'paid');
  const r = await quiet(() => record(db, MEMBER, 'incorporation_completed'));
  assert.equal(r.status, 409);
  assert.equal(milestone(db, MEMBER), 0);
});

test('Eadwyn\'s entity answer and the Incorporate page no longer record it themselves', () => {
  const wr = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/advisor/writeRouter.ts'), 'utf8');
  assert.doesNotMatch(wr, /recordSpinoutMilestoneAndAdvance\(env, user\.id, 'incorporation_completed'/, 'Eadwyn graduates a founder without a paid order again');
  assert.match(wr, /questionId === 'founder\.captable\.entity'\) \{[\s\S]{0,600}syncIncorporationMilestone\(env, user\.id\)/);
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/SpinoutLabIncorporatePage.jsx'), 'utf8');
  assert.doesNotMatch(page, /markMilestone\([^)]*'incorporation_completed'\)/, 'the page records the milestone again');
  assert.match(page, /graduates you: the certificate is issued when the payment is confirmed/);
});
