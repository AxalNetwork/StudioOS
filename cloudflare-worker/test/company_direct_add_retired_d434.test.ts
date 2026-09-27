/**
 * D434 — the direct add is retired: POST /company/:uid/members is not mounted.
 *
 * It joined an EXISTING account to a company on an editor's say-so — no
 * invitation, no consent, a 404 for anyone who had never signed up. Task #121
 * built the invitation the invitee accepts (D69), and D434 retires the one
 * surface that still called the direct add, so on D304's rule the route goes
 * with its client method. This pins the worker side: the retired path answers
 * 404 to an editor who could once use it, membership is unchanged, and the
 * two member mutations that were never the defect (role change, removal)
 * stay mounted, as does the invitation.
 *
 * Real SQLite through the real router; the harness is company_invitations'.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import company from '../src/routes/company.ts';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d434-0123456789-abcdef';
const OWNER = 601;
const EXISTING = 602;   // has an account, is not a member — the direct add's target
const CO_UID = 'co-uid-d434';
const WORKER = codeOnly(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/company.ts'), 'utf8'));

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
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER DEFAULT 1,
      jwt_min_iat INTEGER, founder_id INTEGER, partner_id INTEGER, name TEXT, email TEXT);
    CREATE TABLE company_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL,
      stage TEXT, revenue_range TEXT, employee_count INTEGER, current_products TEXT,
      international_presence TEXT, expansion_goals TEXT, logo_url TEXT, website TEXT,
      linkedin_url TEXT, description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role_in_company TEXT NOT NULL DEFAULT 'Member',
      is_primary_admin INTEGER NOT NULL DEFAULT 0, title TEXT, authority TEXT, carry_bps INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (company_id, user_id));
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(OWNER, 'founder', 'Owner Person', 'owner.d434@example.test');
  u.run(EXISTING, 'founder', 'Existing Account', 'existing.d434@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, ?, 'Halyard')").run(CO_UID);
  db.prepare(
    "INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l1', 1, ?, 'Owner', 1)",
  ).run(OWNER);
  return db;
}

async function call(db: any, userId: number, path: string, init: RequestInit = {}) {
  const jwt = await new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await company.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const links = (db: any) => db.prepare('SELECT user_id FROM user_company_links WHERE company_id = 1 ORDER BY user_id').all().map((r: any) => r.user_id);

test('D434: an editor can no longer join an existing account by email — 404, and no link is written', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/members`, {
    method: 'POST', body: JSON.stringify({ email: 'existing.d434@example.test', role_in_company: 'Founder' }),
  });
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.deepEqual(links(db), [OWNER], 'the direct add wrote a membership');
});

test('D434: nor by user id', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/members`, {
    method: 'POST', body: JSON.stringify({ user_id: EXISTING }),
  });
  assert.equal(r.status, 404);
  assert.deepEqual(links(db), [OWNER]);
});

test('D434: the member mutations that were never the defect still answer', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company) VALUES ('l2', 1, ?, 'Member')").run(EXISTING);
  const patched = await call(db, OWNER, `/company/${CO_UID}/members/${EXISTING}`, {
    method: 'PATCH', body: JSON.stringify({ role_in_company: 'Advisor' }),
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(db.prepare('SELECT role_in_company FROM user_company_links WHERE user_id = ?').get(EXISTING)?.role_in_company, 'Advisor');
  const removed = await call(db, OWNER, `/company/${CO_UID}/members/${EXISTING}`, { method: 'DELETE' });
  assert.ok(removed.status < 300, JSON.stringify(removed.body));
  assert.deepEqual(links(db), [OWNER]);
});

test('D434: the route is gone from the source, the invitation and the two survivors are not', () => {
  assert.doesNotMatch(WORKER, /r\.post\('\/company\/:uid\/members'/);
  assert.match(WORKER, /r\.patch\('\/company\/:uid\/members\/:userId'/);
  assert.match(WORKER, /r\.delete\('\/company\/:uid\/members\/:userId'/);
  assert.match(WORKER, /r\.post\('\/company\/:uid\/invitations'/);
  assert.match(WORKER, /r\.post\('\/company\/invitations\/accept'/);
});
