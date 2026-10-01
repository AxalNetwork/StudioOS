/**
 * D431 — a member's carry is served to that member and to an editor, and to
 * nobody else: the field is ABSENT for a refused reader, never null.
 *
 * Before D431 `detailDto` put `carry_bps` on every member row for every
 * member of the company (and every platform admin), so an Analyst could read
 * every partner's carry from the settings page's own payload. The rule that
 * decides who may WRITE carry — `canEdit`: a platform admin, the primary
 * admin, or an Owner, Admin or Founder — now decides who may read it, plus
 * the member themselves.
 *
 * Absent, not null: `null` already means "not recorded" (team_authority's
 * pin), and a reader must not be able to mistake "withheld from you" for
 * "this person holds no carry".
 *
 * Driven through the real router against in-memory SQLite (the
 * company_invitations harness), so a scoping regression fails because the
 * wrong bytes come back, not because a substring moved.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/carry_bps_gate_d431.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import company from '../src/routes/company.ts';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d431-0123456789-abcdef';
const OWNER = 601;      // Owner, primary admin — an editor
const FOUNDER = 602;    // role Founder — an editor by role, not primary
const ANALYST = 603;    // role Analyst — a member, not an editor
const ASSOCIATE = 604;  // role Associate — a member, not an editor
const OUTSIDER = 605;   // not a member
const PLATFORM_ADMIN = 606;
const CO_UID = 'co-uid-d431';
const ROUTE_SRC = codeOnly(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/company.ts'), 'utf8'));

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
  u.run(OWNER, 'founder', 'Owner Person', 'owner@example.test');
  u.run(FOUNDER, 'founder', 'Founder Person', 'founder@example.test');
  u.run(ANALYST, 'founder', 'Analyst Person', 'analyst@example.test');
  u.run(ASSOCIATE, 'founder', 'Associate Person', 'associate@example.test');
  u.run(OUTSIDER, 'founder', 'Outsider', 'outsider@example.test');
  u.run(PLATFORM_ADMIN, 'admin', 'Platform Admin', 'admin@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, ?, 'Halyard')").run(CO_UID);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, carry_bps) VALUES (?, 1, ?, ?, ?, ?)');
  l.run('l-owner', OWNER, 'Owner', 1, 1500);
  l.run('l-founder', FOUNDER, 'Founder', 0, 1200);
  l.run('l-analyst', ANALYST, 'Analyst', 0, 25);
  l.run('l-associate', ASSOCIATE, 'Associate', 0, null);
  return db;
}

async function call(db: any, userId: number, role: string, path: string, init: RequestInit = {}) {
  const jwt = await new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await company.fetch(
    new Request(`http://x${path}`, { ...init, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const rowOf = (body: any, userId: number) => (body.members as any[]).find((m) => m.user_id === userId);
const has = (row: any) => Object.prototype.hasOwnProperty.call(row, 'carry_bps');

test('D431: an editor reads every member’s carry, null included', async () => {
  const db = freshDb();
  for (const [who, role] of [[OWNER, 'founder'], [FOUNDER, 'founder'], [PLATFORM_ADMIN, 'admin']] as const) {
    const r = await call(db, who, role, `/company/${CO_UID}`);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.body)}`);
    assert.equal(rowOf(r.body, OWNER).carry_bps, 1500);
    assert.equal(rowOf(r.body, FOUNDER).carry_bps, 1200);
    assert.equal(rowOf(r.body, ANALYST).carry_bps, 25);
    const assoc = rowOf(r.body, ASSOCIATE);
    assert.equal(has(assoc), true, `${who}: an editor lost the not-recorded row`);
    assert.equal(assoc.carry_bps, null, 'null still means not recorded for an editor');
  }
});

test('D431: a non-editor reads their own carry and nobody else’s — the field is absent, not null', async () => {
  const db = freshDb();
  const r = await call(db, ANALYST, 'founder', `/company/${CO_UID}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.viewer_is_member, true);
  assert.equal(rowOf(r.body, ANALYST).carry_bps, 25, 'a member cannot see their own carry');
  for (const other of [OWNER, FOUNDER, ASSOCIATE]) {
    const row = rowOf(r.body, other);
    assert.ok(row, `member ${other} disappeared from the roster`);
    assert.equal(has(row), false, `member ${other}'s carry_bps was served to a non-editor (value ${JSON.stringify(row.carry_bps)})`);
  }
  // The rest of the row is intact: withholding one figure hides nobody.
  assert.equal(rowOf(r.body, OWNER).role_in_company, 'Owner');
  assert.equal(rowOf(r.body, OWNER).email, 'owner@example.test');
});

test('D431: the not-recorded member sees their own null, not an absent field', async () => {
  // Their own row must say "not recorded" (null), never "locked" (absent):
  // the lock is for OTHER people's economics.
  const db = freshDb();
  const r = await call(db, ASSOCIATE, 'founder', `/company/${CO_UID}`);
  assert.equal(r.status, 200);
  const me = rowOf(r.body, ASSOCIATE);
  assert.equal(has(me), true, 'a member with no carry recorded was shown a lock on their own row');
  assert.equal(me.carry_bps, null);
  assert.equal(has(rowOf(r.body, ANALYST)), false);
});

test('D431: every payload that carries members applies the same gate', async () => {
  const db = freshDb();
  const me = await call(db, ANALYST, 'founder', '/company/me');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(has(rowOf(me.body, OWNER)), false, '/company/me served another member’s carry');
  assert.equal(rowOf(me.body, ANALYST).carry_bps, 25);
  const list = await call(db, ANALYST, 'founder', '/company/memberships');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const first = (list.body as any[])[0];
  assert.equal(has(rowOf(first, FOUNDER)), false, '/company/memberships served another member’s carry');
  assert.equal(rowOf(first, ANALYST).carry_bps, 25);
});

test('D431: reading your own carry is not writing it — the write stays the editor’s', async () => {
  const db = freshDb();
  const r = await call(db, ANALYST, 'founder', `/company/${CO_UID}/members/${ANALYST}`, {
    method: 'PATCH', body: JSON.stringify({ carry_bps: 9000 }),
  });
  assert.equal(r.status, 403, `a non-editor changed their own carry: ${JSON.stringify(r.body)}`);
  const stored = db.prepare('SELECT carry_bps FROM user_company_links WHERE user_id = ?').get(ANALYST) as any;
  assert.equal(stored.carry_bps, 25);
  // And an editor's write answers with the gated payload it always did.
  const ok = await call(db, OWNER, 'founder', `/company/${CO_UID}/members/${ANALYST}`, {
    method: 'PATCH', body: JSON.stringify({ carry_bps: 50 }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(rowOf(ok.body, ANALYST).carry_bps, 50);
});

test('D431: the gate is the write gate, applied once per payload, and omits rather than nulls', () => {
  const dto = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function detailDto('), ROUTE_SRC.indexOf('async function getCompanyOr404('));
  assert.ok(dto.length > 200, 'detailDto could not be sliced');
  assert.match(dto, /const editor = await canEdit\(env, c, viewer\);/, 'the read gate is not canEdit — the write gate');
  assert.match(dto, /\.\.\.\(editor \|\| lnk\.user_id === viewer\.id\s*\? \{ carry_bps: \(lnk as any\)\.carry_bps \?\? null \}\s*: \{\}\)/,
    'carry_bps is not spread in conditionally — a refused reader must get no field, not null');
  assert.doesNotMatch(dto, /^\s*carry_bps:/m, 'carry_bps is still an unconditional member field');
});
