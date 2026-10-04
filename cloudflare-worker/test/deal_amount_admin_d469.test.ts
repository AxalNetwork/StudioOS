/**
 * D469 — only an admin changes a deal's amount through PUT /deals/:id.
 *
 * `requireRole('partner')` admits partners and admins, and both could rewrite
 * `deals.amount`. A partner's `amount` is now refused (403
 * `deal_amount_admin_only`) before anything in the request is written; an
 * admin's is written, and an admin's edit to a deal whose lead partner is not
 * them is recorded through `logAdminAction`. Status, partner and notes keep
 * the partner gate.
 *
 * The REAL `deals` router against real SQLite; the fixture is
 * deal_source_and_terms.test.ts's (D463), with logAdminAction's table.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_amount_admin_d469.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import deals from '../src/routes/deals.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono();
// The production mapping (index.ts's AUTH_ERROR_STATUSES), replicated: the
// auth helpers refuse by throwing, and the status lives in the app's onError.
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const PARTNER = 20;
const ADMIN = 21;
const INVESTOR = 42;
const PROJ = 7;
const DEAL = 71;
const OWN_ADMIN = 22;   // an admin who is the lead partner on OWN_DEAL
const OWN_DEAL = 72;

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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      investor_tier TEXT, partner_id INTEGER, founder_id INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER,
      company_id INTEGER, deleted_at TEXT
    );
    -- The real columns the routes touch, including migration 336's source.
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      lead_partner_id INTEGER, status TEXT NOT NULL DEFAULT 'applied', notes TEXT,
      description TEXT, website TEXT, amount REAL, target_raise REAL,
      minimum_check REAL, valuation_cap REAL, carry_pct REAL,
      management_fee_pct REAL, instrument TEXT, spv_jurisdiction TEXT,
      closing_deadline TEXT, capital_committed REAL DEFAULT 0, source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      stage_changed_at TEXT
    );
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE deal_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      from_stage TEXT, from_stage_changed_at TEXT, to_stage TEXT, kind TEXT,
      actor_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- logAdminAction's table (services/adminAudit.ts).
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Partner');
  u.run(ADMIN, 'admin', 'Ada Admin');
  u.run(OWN_ADMIN, 'admin', 'Oli Own');
  u.run(INVESTOR, 'investor', 'Ingrid Investor');
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(PROJ, 'Alpha');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, target_raise) VALUES (?, 'd-alpha', ?, 'applied', 1000000)`)
    .run(DEAL, PROJ);
  db.prepare(`UPDATE deals SET amount = 500000, notes = 'old', lead_partner_id = ? WHERE id = ?`).run(PARTNER, DEAL);
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, amount, lead_partner_id) VALUES (?, 'd-own', ?, 'applied', 300000, ?)`)
    .run(OWN_DEAL, PROJ, OWN_ADMIN);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function call(
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(`/api/deals${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}


const partner = { user: PARTNER, role: 'partner' };
const admin = { user: ADMIN, role: 'admin' };
const ownAdmin = { user: OWN_ADMIN, role: 'admin' };
const put = (who: any, dealId: number, body: any, db: InstanceType<typeof DatabaseSync>) =>
  call(who, `/${dealId}`, { method: 'PUT', body }, db);
const deal = (db: InstanceType<typeof DatabaseSync>, id = DEAL) =>
  db.prepare('SELECT amount, status, notes, partner_id FROM deals WHERE id = ?').get(id) as any;
const audits = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare('SELECT action, details, user_id FROM activity_logs ORDER BY id').all() as any[])
    .map((r) => ({ action: r.action, user_id: r.user_id, details: JSON.parse(r.details) }));

test('a partner\'s amount change is refused with its code and not written', async () => {
  const db = freshDb();
  const r = await put(partner, DEAL, { amount: 999999 }, db);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'deal_amount_admin_only');
  assert.match(r.body.message, /Only an admin/);
  assert.equal(deal(db).amount, 500000);
});

test('the refusal comes before anything else in the request is written', async () => {
  const db = freshDb();
  const r = await put(partner, DEAL, { amount: 1, notes: 'sneaked in', status: 'scored' }, db);
  assert.equal(r.status, 403);
  const d = deal(db);
  assert.equal(d.amount, 500000);
  assert.equal(d.notes, 'old', 'notes untouched');
  assert.equal(d.status, 'applied', 'status untouched');
  const ev = (db.prepare('SELECT COUNT(*) AS n FROM deal_stage_events').get() as any).n;
  assert.equal(ev, 0, 'no stage event recorded');
});

test('status, partner and notes still work for a partner, with no audit row', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO partners (id, name) VALUES (9, ?)').run('Northwind');
  const r = await put(partner, DEAL, { status: 'scored', partner_id: 9, notes: 'call booked' }, db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = deal(db);
  assert.equal(d.status, 'scored');
  assert.equal(d.partner_id, 9);
  assert.equal(d.notes, 'call booked');
  assert.equal(d.amount, 500000);
  assert.deepEqual(audits(db), [], 'a partner\'s edit is not an admin action');
});

test('an admin\'s amount change is written, and audited when the deal is not theirs', async () => {
  const db = freshDb();
  const r = await put(admin, DEAL, { amount: 750000 }, db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(deal(db).amount, 750000);
  const a = audits(db);
  assert.equal(a.length, 1);
  assert.equal(a[0].action, 'deal_update_by_admin');
  assert.equal(a[0].user_id, ADMIN);
  assert.deepEqual(a[0].details, { deal_id: DEAL, lead_partner_id: PARTNER, fields: ['amount'], amount_from: 500000, amount_to: 750000 });
});

test('any admin edit to someone else\'s deal is audited, not only the amount', async () => {
  const db = freshDb();
  const r = await put(admin, DEAL, { notes: 'admin note' }, db);
  assert.equal(r.status, 200);
  const a = audits(db);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].details, { deal_id: DEAL, lead_partner_id: PARTNER, fields: ['notes'] });
});

test('an admin editing their own deal (they are its lead partner) leaves no audit row', async () => {
  const db = freshDb();
  const r = await put(ownAdmin, OWN_DEAL, { amount: 310000 }, db);
  assert.equal(r.status, 200);
  assert.equal(deal(db, OWN_DEAL).amount, 310000);
  assert.deepEqual(audits(db), []);
});
