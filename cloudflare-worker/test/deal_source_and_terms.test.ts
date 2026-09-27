/**
 * D463 — a deal's source is recorded, and its terms are editable after the
 * draft.
 *
 * Two defects, one store. `deals` had no column for where a deal came from,
 * so the ID1 tile counted on-platform deals and the stage-analytics route
 * denied the field existed. And `PUT /:id` wrote only status, partner, notes
 * and amount — the terms were frozen at whatever the draft first said.
 *
 * The source is FREE TEXT on purpose: the taxonomy (which sources exist, and
 * which count as the Lab) is the owner's call, and a CHECK written before it
 * would enshrine a guess. The refusal that narrows the old reason is pinned
 * in dealPassTaxonomy.test.ts.
 *
 * Harness: the real router against in-memory SQLite, with the app's onError
 * mapping replicated so a role refusal reads as the status production
 * returns.
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
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Partner');
  u.run(ADMIN, 'admin', 'Ada Admin');
  u.run(INVESTOR, 'investor', 'Ingrid Investor');
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(PROJ, 'Alpha');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, target_raise) VALUES (?, 'd-alpha', ?, 'applied', 1000000)`)
    .run(DEAL, PROJ);
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

test('the draft records the source, trimmed', async () => {
  // The draft is admin-only (deals.post('/draft')), so the admin writes it.
  const r = await call({ user: ADMIN, role: 'admin' }, '/draft', {
    method: 'POST',
    body: { project_id: PROJ, status: 'applied', source: '  the Lab  ' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.source, 'the Lab', 'the source is trimmed at write');
});

test('the terms are editable after the draft, and a partial edit blanks nothing it did not send', async () => {
  const db = freshDb();
  const r = await call({ user: PARTNER, role: 'partner' }, `/${DEAL}`, {
    method: 'PUT',
    body: { target_raise: 2000000, instrument: 'SAFE', source: 'referral' },
  }, db);
  assert.equal(r.status, 200);
  assert.equal(Number(r.body.target_raise), 2000000);
  assert.equal(r.body.instrument, 'SAFE');
  assert.equal(r.body.source, 'referral');

  // A second edit that does not send source must leave it alone.
  const again = await call({ user: PARTNER, role: 'partner' }, `/${DEAL}`, {
    method: 'PUT',
    body: { minimum_check: 50000 },
  }, db);
  assert.equal(again.status, 200);
  assert.equal(again.body.source, 'referral', 'a partial edit blanked the source it never sent');
  assert.equal(Number(again.body.target_raise), 2000000, 'a partial edit blanked the target it never sent');
  assert.equal(Number(again.body.minimum_check), 50000);
});

test('an investor may not edit the terms', async () => {
  const r = await call({ user: INVESTOR, role: 'investor' }, `/${DEAL}`, {
    method: 'PUT', body: { target_raise: 1 },
  });
  assert.equal(r.status, 403);
});

test('the founder-facing create records the source too', async () => {
  const db = freshDb();
  // The founder owns the project: founder_id 9 on the project, user 99 with it.
  db.prepare(`INSERT INTO users (id, role, name, founder_id) VALUES (99, 'founder', 'Fred', 9)`).run();
  db.prepare(`UPDATE projects SET founder_id = 9 WHERE id = ?`).run(PROJ);
  const r = await call({ user: 99, role: 'founder' }, '', {
    method: 'POST',
    body: { project_id: PROJ, source: 'inbound' },
  }, db);
  assert.equal(r.status, 201);
  assert.equal(r.body.source, 'inbound');
});
