/**
 * D6687 (#6687) — an order's subject may be a company: `incorporations` rebuilt with a nullable project and a subject
 * company, the two order routes taking a company the caller administers, the filing filling that company only, and the
 * company reading "in formation" from a paid order placed for it. Synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/incorporations_company_subject_6687.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legal from '../src/routes/legal.ts';
import { companyFormations } from '../src/services/formationState.ts';
import { markFiled } from '../src/services/incorporationFiling.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

const MIGRATION = '202611161616_6687_incorporations_company_subject.sql';
const REBUILD = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', MIGRATION), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-6687-0123456789-abcdef';
const ADMIN = 1, FOUNDER = 10, COMPANY_ADMIN = 11, MEMBER = 12;
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...(a as any[])); return r ? { ...(r as any) } : r; };
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

// Mutation checked: a column dropped from the copy (fails); ids renumbered (fails); the CHECK missing (fails); project_id
// still NOT NULL (fails); the UNIQUE on stripe_session_id or the user/status index not recreated (fails).
test('the rebuild keeps every row, sum and session, and lets an order have a company and no project', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db, { below: 202611161616 });
  const ins = db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, currency, stripe_session_id, status, paid_at, filed_on, company_id)
    VALUES (?, ?, ?, 'us_de_ccorp', ?, ?, 'usd', ?, ?, ?, ?, ?)`);
  ins.run(3, FOUNDER, 1, 'Co 3', 50000, 'cs_3', 'pending_payment', null, null, null);
  ins.run(7, FOUNDER, 2, 'Co 7', 34900, null, 'paid', '2026-10-01 09:00:00', null, null);
  ins.run(9, FOUNDER, 1, 'Co 9', 50000, 'cs_9', 'filed', '2026-10-02 09:00:00', '2026-10-05', 40);
  const before = all(db, 'SELECT * FROM incorporations ORDER BY id');
  db.exec(REBUILD);
  const after = all(db, 'SELECT * FROM incorporations ORDER BY id');
  assert.deepEqual(after.map(({ subject_company_id, ...r }) => r), before, 'every row, column and id as it was');
  assert.ok(after.every((r) => r.subject_company_id === null));
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_incorporations_rebuild_6687'").n, 0, 'the check table is gone');
  const cols = Object.fromEntries(all(db, "SELECT name, \"notnull\" FROM pragma_table_info('incorporations')").map((c) => [c.name, c.notnull]));
  assert.equal(cols.project_id, 0, 'project_id is nullable');
  assert.equal(cols.subject_company_id, 0);
  db.prepare("INSERT INTO incorporations (user_id, project_id, subject_company_id, jurisdiction_id, company_name, amount_cents) VALUES (?, NULL, 40, 'uk_ltd', 'Co', 1)").run(FOUNDER);
  assert.throws(() => db.prepare("INSERT INTO incorporations (user_id, project_id, subject_company_id, jurisdiction_id, company_name, amount_cents) VALUES (?, NULL, NULL, 'uk_ltd', 'Co', 1)").run(FOUNDER), /CHECK/,
    'neither a project nor a subject company is refused');
  assert.throws(() => db.prepare("INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, stripe_session_id) VALUES (?, 1, 'uk_ltd', 'Co', 1, 'cs_9')").run(FOUNDER), /UNIQUE/);
  assert.ok(all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'incorporations'").some((i) => i.name === 'idx_incorporations_user_status'));
});

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(COMPANY_ADMIN, 'founder', 'Cam Admin', 'cam@example.test', 2002);
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 3003);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (40, 'co-forty', 'Forty Labs'), (41, 'co-archived', 'Gone Ltd');
    UPDATE company_profiles SET archived_at = '2026-10-01' WHERE id = 41;
    INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES
      ('l1', 40, ${COMPANY_ADMIN}, 'Admin', 1), ('l2', 40, ${MEMBER}, 'Member', 0), ('l3', 41, ${COMPANY_ADMIN}, 'Admin', 1);`);
  return db;
}
const app = new Hono<any>();
app.route('/legal', legal);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; };
async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const role = (one(db, 'SELECT role FROM users WHERE id = ?', who) as any).role;
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: kv() } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const ORDER = { jurisdiction_id: 'uk_ltd', company_name: 'Forty Labs Ltd' };

// Mutation checked: the Admin gate dropped (fails); an archived company ordered (fails); both subjects accepted (fails);
// the subject not stored (fails); company_uid on the status read set before filing (fails); subject_company_uid missing (fails).
test('the order routes take a company its Admin orders for; anyone else is refused before any write', async () => {
  const db = fixture();
  for (const path of ['/legal/incorporation/order', '/legal/incorporate/checkout']) {
    const n = () => one(db, 'SELECT COUNT(*) AS n FROM incorporations').n;
    const before = n();
    assert.equal((await quiet(() => call(db, MEMBER, 'POST', path, { ...ORDER, company_uid: 'co-forty' }))).status, 403, `${path}: a member who is not an Admin`);
    assert.equal((await quiet(() => call(db, COMPANY_ADMIN, 'POST', path, { ...ORDER, company_uid: 'co-archived' }))).status, 404, `${path}: archived`);
    assert.equal((await quiet(() => call(db, COMPANY_ADMIN, 'POST', path, { ...ORDER, company_uid: 'co-nope' }))).status, 404, `${path}: no such company`);
    assert.equal((await quiet(() => call(db, COMPANY_ADMIN, 'POST', path, { ...ORDER, company_uid: 'co-forty', project_id: 1 }))).status, 400, `${path}: both`);
    assert.equal(n(), before, `${path}: no row on a refusal`);
  }
  const r = await quiet(() => call(db, COMPANY_ADMIN, 'POST', '/legal/incorporation/order', { ...ORDER, company_uid: 'co-forty' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = one(db, 'SELECT project_id, subject_company_id, company_id, user_id FROM incorporations WHERE id = ?', r.body.incorporation_id);
  assert.deepEqual(row, { project_id: null, subject_company_id: 40, company_id: null, user_id: COMPANY_ADMIN });
  const status = await call(db, COMPANY_ADMIN, 'GET', `/legal/incorporate/status?id=${r.body.incorporation_id}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.company_uid, null, 'null until filed');
  assert.equal(status.body.subject_company_uid, 'co-forty');
  const orders = await call(db, COMPANY_ADMIN, 'GET', '/legal/incorporate/orders');
  assert.deepEqual(orders.body.orders.map((o: any) => [o.company_uid, o.subject_company_uid]), [[null, 'co-forty']]);
  // The checkout route stores the same subject (its dev path, with no Stripe key).
  const k = await quiet(() => call(db, COMPANY_ADMIN, 'POST', '/legal/incorporate/checkout', { ...ORDER, company_uid: 'co-forty' }));
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.deepEqual(one(db, 'SELECT project_id, subject_company_id FROM incorporations WHERE id = ?', k.body.incorporation_id), { project_id: null, subject_company_id: 40 });
  // A venture's order is as before.
  const v = await quiet(() => call(db, FOUNDER, 'POST', '/legal/incorporation/order', { ...ORDER, project_id: 1 }));
  assert.equal(v.status, 200);
  assert.deepEqual(one(db, 'SELECT project_id, subject_company_id FROM incorporations WHERE id = ?', v.body.incorporation_id), { project_id: 1, subject_company_id: null });
});

// Mutation checked: the formation join without the subject (fails); the filing filling the venture path for a company
// order (fails); a filled field overwritten (fails); company_id not set to the subject (fails).
test('a paid company order reads in formation; filing it fills only the company\'s empty legal fields', async () => {
  const db = fixture();
  db.exec("UPDATE company_profiles SET legal_name = 'Forty Labs Holdings Ltd' WHERE id = 40");
  const r = await quiet(() => call(db, COMPANY_ADMIN, 'POST', '/legal/incorporation/order', { ...ORDER, company_uid: 'co-forty' }));
  const id = r.body.incorporation_id;
  const env: any = { DB: d1Over(db) };
  assert.equal((await companyFormations(env, [40]))(40).formation_state, 'in_formation');
  db.prepare("UPDATE incorporations SET status = 'packet_ready', paid_at = '2026-10-02 09:00:00', packet_ready_at = '2026-10-03 09:00:00', packet_ready_by = ? WHERE id = ?").run(ADMIN, id);
  const filed = await quiet(() => markFiled(env, id, '2026-10-04', ADMIN, '2026-11-16', 'hq@axal.example'));
  assert.equal(filed.ok, true, JSON.stringify(filed));
  assert.deepEqual(one(db, 'SELECT status, company_id, project_id FROM incorporations WHERE id = ?', id), { status: 'filed', company_id: 40, project_id: null });
  const co = one(db, 'SELECT legal_name, legal_form, jurisdiction, incorporation_date FROM company_profiles WHERE id = 40');
  assert.deepEqual(co, { legal_name: 'Forty Labs Holdings Ltd', legal_form: 'ltd', jurisdiction: 'GB', incorporation_date: '2026-10-04' }, 'the recorded name is kept; empty fields are filled');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM company_profiles').n, 2, 'no new company');
  assert.equal((await companyFormations(env, [40]))(40).formation_state, 'incorporated');
});
