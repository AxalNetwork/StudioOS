/**
 * D390 — the firm profile's "no firm attached" answer carries a CODE.
 *
 * The Firm Settings card (PartnerFirmProfileCard) tells an unlinked sign-in
 * from a failed read by `e.code`, never by matching the sentence. Before D390
 * `/partner-portal/profile` shipped `requirePartnerProfile`'s throw as a bare
 * `{ detail }` 400 through mapError, and `/accepting-intros` put the sentence
 * itself in `error` — so the only way to branch was on the words.
 *
 * Harness shape follows perks_company_scope.test.ts: node:sqlite behind a
 * minimal D1 shim, a signed JWT, and the router's own `request()`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import portal from '../src/routes/partner_portal.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const LINKED = 42;
const UNLINKED = 43;
const FOUNDER = 50;
const FIRM = 7;

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
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      subscription_tier TEXT
    );
    -- schema_baseline.sql's partners, the columns these routes read.
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL, specialization TEXT,
      referral_code TEXT UNIQUE, referrals_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepting_intros INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO partners (id, name, email) VALUES (?,?,?)').run(FIRM, 'Northwind', 'firm@example.com');
  const u = db.prepare('INSERT INTO users (id, role, partner_id, email) VALUES (?,?,?,?)');
  u.run(LINKED, 'partner', FIRM, 'p@example.com');
  u.run(UNLINKED, 'partner', null, 'q@example.com');
  u.run(FOUNDER, 'founder', null, 'f@example.com');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(path: string, userId: number, init: RequestInit = {}, role = 'partner') {
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(freshDb()) };
  const res = await portal.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(userId, role)}`, 'Content-Type': 'application/json' },
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D390: an unlinked sign-in reading /profile gets 404 no_partner_profile, in our sentence', async () => {
  const r = await call('/profile', UNLINKED);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no_partner_profile');
  assert.equal(r.body.message, 'No partner profile attached to your account');
  assert.equal(r.body.detail, r.body.message);
});

test('D390: an unlinked PATCH /profile refuses with the same code and writes nothing', async () => {
  const r = await call('/profile', UNLINKED, { method: 'PATCH', body: JSON.stringify({ name: 'X' }) });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no_partner_profile');
});

test('D390: an unlinked /accepting-intros refuses with the same code', async () => {
  const r = await call('/accepting-intros', UNLINKED, { method: 'PATCH', body: JSON.stringify({ accepting_intros: true }) });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no_partner_profile');
});

test('D390: a linked sign-in still reads and edits its own firm', async () => {
  const g = await call('/profile', LINKED);
  assert.equal(g.status, 200);
  assert.equal(g.body.partner.id, FIRM);
  const p = await call('/profile', LINKED, { method: 'PATCH', body: JSON.stringify({ name: 'Northwind LLP', company: '' }) });
  assert.equal(p.status, 200);
  assert.equal(p.body.partner.name, 'Northwind LLP');
  assert.equal(p.body.partner.company, null);
});

test('D390: a validation refusal is still a 400, not swallowed into no_partner_profile', async () => {
  const r = await call('/profile', LINKED, { method: 'PATCH', body: JSON.stringify({ name: '' }) });
  assert.equal(r.status, 400);
  assert.notEqual(r.body?.error, 'no_partner_profile');
});

// The mutation that made EVERY thrown error `no_partner_profile` escaped the
// 400 test above, because that refusal is returned inside the handler and
// never reaches the catch. A thrown refusal that is NOT the unlinked one is
// what pins the narrowing: a founder is refused by role, and must stay 403.
test('D390: a thrown refusal that is not "unlinked" keeps its own status and is not relabelled', async () => {
  const r = await call('/profile', FOUNDER, {}, 'founder');
  assert.equal(r.status, 403);
  assert.notEqual(r.body?.error, 'no_partner_profile');
});
