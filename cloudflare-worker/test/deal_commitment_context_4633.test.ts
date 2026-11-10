/**
 * D4633 (#4633) — an investor's commitment read is one firm's, and names it.
 *
 * The REAL `deals` router over real SQLite. One deal (71), one investor (IVO)
 * who sits in two firms (ALDER 501, BIRCH 502) and has a commitment under each,
 * plus one recorded before commitments named a firm (company_id NULL). SOLO
 * sits in ALDER only; LONE in no firm.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_commitment_context_4633.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';

const app = new Hono();
app.onError((err: any, c: any) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : err?.message === 'Forbidden' ? 403 : 500));
app.route('/api/deals', deals);

const JWT_SECRET = 'unit-test-jwt-secret-4633-0123456789abcdef';
const IVO = 40, SOLO = 41, LONE = 42, ADMIN = 1;
const ALDER = 501, BIRCH = 502;
const DEAL = 71;

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, investor_tier TEXT, partner_id INTEGER, founder_id INTEGER, kyc_status TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, status TEXT, amount REAL, target_raise REAL,
      capital_committed REAL DEFAULT 0, currency TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, status TEXT, company_id INTEGER, created_at TEXT);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, deal_id INTEGER, investor_user_id INTEGER, company_id INTEGER,
      amount REAL, status TEXT, notes TEXT, created_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT, archived_at TEXT);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    INSERT INTO users (id, role, name) VALUES (${IVO}, 'investor', 'Ivo'), (${SOLO}, 'investor', 'Sol'), (${LONE}, 'investor', 'Lou'), (${ADMIN}, 'admin', 'Ada');
    INSERT INTO company_profiles (id, company_name) VALUES (${ALDER}, 'Alder Ventures'), (${BIRCH}, 'Birch Capital');
    INSERT INTO user_company_links (user_id, company_id) VALUES (${IVO}, ${ALDER}), (${IVO}, ${BIRCH}), (${SOLO}, ${ALDER});
    INSERT INTO projects (id, name) VALUES (7, 'Alpha');
    INSERT INTO deals (id, uid, project_id, status, amount, target_raise, currency) VALUES (${DEAL}, 'd-a', 7, 'active', 500000, 2000000, 'USD');
    INSERT INTO deal_invitations (deal_id, investor_user_id, status, company_id) VALUES (${DEAL}, ${IVO}, 'invited', NULL), (${DEAL}, ${SOLO}, 'invited', ${ALDER}), (${DEAL}, ${LONE}, 'invited', NULL);
    INSERT INTO commitments (uid, deal_id, investor_user_id, company_id, amount, status, created_at) VALUES
      ('c-alder', ${DEAL}, ${IVO}, ${ALDER}, 25000, 'pending', '2026-10-01 00:00:00'),
      ('c-birch', ${DEAL}, ${IVO}, ${BIRCH}, 90000, 'confirmed', '2026-10-02 00:00:00'),
      ('c-legacy', ${DEAL}, ${IVO}, NULL, 5000, 'pending', '2026-09-01 00:00:00'),
      ('c-lone', ${DEAL}, ${LONE}, NULL, 7000, 'pending', '2026-09-02 00:00:00');
  `);
  return db;
}

async function read(db: InstanceType<typeof DatabaseSync>, user: number, company?: number, role = 'investor') {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (company) headers['X-Company-Id'] = String(company);
  const res = await app.request(`/api/deals/${DEAL}/commitments`, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const shape = (rows: any[]) => rows.map((r) => [r.uid, r.company_id, r.company_name, r.in_context, r.legacy]);

test('D5355 two firms: each selected firm reads only its own commitment; a no-firm row is not borrowed', async () => {
  const db = freshDb();
  const alder = await read(db, IVO, ALDER);
  assert.equal(alder.status, 200, JSON.stringify(alder.body));
  assert.deepEqual(shape(alder.body), [
    ['c-alder', ALDER, 'Alder Ventures', true, false],
  ], 'neither Birch nor a no-firm commitment is Alder\'s to see or act on');
  assert.ok(alder.body.every((r: any) => r.firm_context === ALDER));
  const birch = await read(db, IVO, BIRCH);
  assert.deepEqual(shape(birch.body), [
    ['c-birch', BIRCH, 'Birch Capital', true, false],
  ]);
});

test('an investor in two firms who chose none is asked to choose, never guessed for', async () => {
  const db = freshDb();
  const r = await read(db, IVO);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'firm_required');
  assert.ok(!JSON.stringify(r.body).includes('c-'), 'no commitment in the refusal');
});

test('one firm is the context without a choice; no firm reads the no-firm rows as its own', async () => {
  const db = freshDb();
  const solo = await read(db, SOLO);
  assert.deepEqual([solo.status, solo.body], [200, []]);
  const lone = await read(db, LONE);
  assert.deepEqual(shape(lone.body), [['c-lone', null, null, true, false]], 'held in their own name, and theirs to act on');
});

test('the staff read names each commitment\'s firm', async () => {
  const db = freshDb();
  const r = await read(db, ADMIN, undefined, 'admin');
  assert.equal(r.status, 200);
  const byUid = Object.fromEntries(r.body.map((x: any) => [x.uid, x.company_name]));
  assert.deepEqual(byUid, { 'c-alder': 'Alder Ventures', 'c-birch': 'Birch Capital', 'c-legacy': null, 'c-lone': null });
});
