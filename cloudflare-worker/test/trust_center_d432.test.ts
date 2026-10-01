/**
 * D432 — the Trust Center says who the other party is, and says when it
 * could not read.
 *
 * TWO WORKER-SIDE FACTS THIS PINS.
 *
 * 1. GET /trust/pairwise-ndas SERVES BOTH PARTIES' NAMES. The page used to
 *    title a pairwise row by the envelope's document type and, at best, an
 *    email — the canvas titles it "Novacraft Labs, Inc. ↔ Marisol Vega" for an
 *    admin and "Dev Raman · Latitude Seed" for a member. The route already
 *    joined `users` twice for the emails; it now selects `name` from the same
 *    joins, on BOTH the admin branch and the self branch, and a party whose
 *    account is gone is served as NULL (the LEFT JOIN), never dropped.
 *
 * 2. GET /trust/companies/kyb REFUSES WHEN IT CANNOT READ. It used to catch
 *    every error into an empty list, so a member of three companies whose
 *    read failed was told they belonged to none. It now answers 503 with a
 *    D278 refusal body — `error` is the code, `message` and `detail` are our
 *    sentence, and the raw SQLite text is in the log, not the body.
 *
 * Real SQLite, per `_d1_sqlite.mjs`'s argument: the route's own SQL with its
 * own binds decides what comes back. The harness is `company_kyb.test.ts`'s,
 * extended with the tables the pairwise route reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import trust from '../src/routes/trust.ts';

const app = new Hono<any>();
app.route('/', trust);
app.onError((err: any, c) => {
  const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[
    String(err?.message || '')
  ];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

const MIGRATION_220 = 'cloudflare-worker/sql/migrations/220_company_kyb.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1;   // party_a of the one pairwise NDA
const INVESTOR = 2;  // party_b
const STRANGER = 3;  // party to nothing
const ADMIN = 9;
const GONE = 77;     // a party_b whose users row no longer exists

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE company_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role_in_company TEXT NOT NULL DEFAULT 'Member',
      is_primary_admin INTEGER NOT NULL DEFAULT 0, UNIQUE (company_id, user_id)
    );
    CREATE TABLE pairwise_ndas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_a_user_id INTEGER NOT NULL, party_b_user_id INTEGER NOT NULL,
      intermediary TEXT NOT NULL DEFAULT 'axal', nda_envelope_uuid TEXT,
      status TEXT NOT NULL DEFAULT 'pending', valid_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      signers_json TEXT NOT NULL DEFAULT '[]', voided_at TIMESTAMP, voided_reason TEXT,
      UNIQUE(party_a_user_id, party_b_user_id)
    );
    CREATE TABLE esign_envelopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, envelope_uuid TEXT NOT NULL UNIQUE, status TEXT
    );
    CREATE TABLE esign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, envelope_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL, recipient_name TEXT, status TEXT, signed_at TIMESTAMP
    );
  `);
  db.exec(readFileSync(resolve(process.cwd(), MIGRATION_220), 'utf8'));

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(FOUNDER, 'founder', 'Marisol Vega', 'marisol@example.com');
  u.run(INVESTOR, 'investor', 'Dev Raman', 'dev@example.com');
  u.run(STRANGER, 'founder', 'Nobody Here', 'nobody@example.com');
  u.run(ADMIN, 'admin', 'Ada', 'ada@example.com');

  const cp = db.prepare('INSERT INTO company_profiles (id, uid, company_name) VALUES (?,?,?)');
  cp.run(1, 'c-1', 'Novacraft Labs, Inc.');
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id, role_in_company, is_primary_admin) VALUES (?,?,?,?)');
  l.run(1, FOUNDER, 'Admin', 1);

  const p = db.prepare('INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, nda_envelope_uuid, status) VALUES (?,?,?,?)');
  p.run(FOUNDER, INVESTOR, 'env-1', 'pending');
  p.run(FOUNDER, GONE, null, 'active');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function get(e: any, path: string, who: { user: number; role: string }) {
  const res = await app.request(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${await token(who.user, who.role)}` },
  }, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const founder = { user: FOUNDER, role: 'founder' };
const investor = { user: INVESTOR, role: 'investor' };
const admin = { user: ADMIN, role: 'admin' };

const WORKER = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/trust.ts'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Names on pairwise rows.
// ---------------------------------------------------------------------------

test('a member sees both parties named on their own pairwise row', async () => {
  const db = freshDb();
  const r = await get(env(db), '/pairwise-ndas', investor);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  const row = r.body.items[0];
  assert.equal(row.party_a_name, 'Marisol Vega');
  assert.equal(row.party_b_name, 'Dev Raman');
  // The emails the page fell back on before are still there — the name is
  // added beside them, not in their place.
  assert.equal(row.party_a_email, 'marisol@example.com');
  assert.equal(row.party_b_email, 'dev@example.com');
});

test('an admin sees the names on every row, through the other SELECT', async () => {
  const db = freshDb();
  const r = await get(env(db), '/pairwise-ndas', admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  const byB = Object.fromEntries(r.body.items.map((i: any) => [i.party_b_user_id, i]));
  assert.equal(byB[INVESTOR].party_a_name, 'Marisol Vega');
  assert.equal(byB[INVESTOR].party_b_name, 'Dev Raman');
  assert.equal(byB[GONE].party_a_name, 'Marisol Vega');
});

test('a party whose account is gone is served as null, and the row is not dropped', async () => {
  const db = freshDb();
  const r = await get(env(db), '/pairwise-ndas', founder);
  assert.equal(r.status, 200);
  const gone = r.body.items.find((i: any) => i.party_b_user_id === GONE);
  assert.ok(gone, 'the row whose counterparty left is still listed');
  assert.equal(gone.party_b_name, null);
  assert.equal(gone.party_b_email, null);
  // The page labels this arm "account #77 · removed"; a name the join could
  // not find must not arrive as anything a renderer would print as a name.
  assert.ok(!('party_b_name' in gone) || gone.party_b_name === null);
});

test('the name columns are selected on both branches, from the joins that already existed', () => {
  const route = WORKER.slice(WORKER.indexOf("trust.get('/pairwise-ndas'"), WORKER.indexOf("trust.post('/pairwise-ndas/:id/resend'"));
  assert.ok(route.length > 500, 'the route could not be sliced');
  const hits = route.match(/ua\.name AS party_a_name, ub\.name AS party_b_name/g) || [];
  assert.equal(hits.length, 2, 'one SELECT per caller kind, each serving both names');
  assert.equal((route.match(/LEFT JOIN users ua ON ua\.id = p\.party_a_user_id/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// 2. The company-KYB read refuses rather than lying.
// ---------------------------------------------------------------------------

test('a read that fails answers 503 with a refusal body, not an empty list', async () => {
  const db = freshDb();
  // Take the table away after the schema is built: the route's own SELECT
  // throws, which is the case the old catch turned into `items: []`.
  db.exec('DROP TABLE company_kyb_records');
  const muted = console.error;
  console.error = () => {};
  try {
    const r = await get(env(db), '/companies/kyb', founder);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'company_kyb_unreadable');
    assert.equal(typeof r.body.message, 'string');
    assert.match(r.body.message, /could not be read/);
    assert.equal(r.body.detail, r.body.message, 'D258: detail carries the same sentence');
    assert.ok(!('items' in r.body), 'no items key — an empty list is exactly the lie this replaces');
    // The raw SQLite text stays in the log (D278). A member is not an owner.
    const flat = JSON.stringify(r.body);
    assert.doesNotMatch(flat, /no such table/i);
    assert.ok(!('upstream' in r.body));
  } finally {
    console.error = muted;
  }
});

test('a read that succeeds is unchanged — the list, with not-started companies kept', async () => {
  const db = freshDb();
  const r = await get(env(db), '/companies/kyb', founder);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => i.company_name), ['Novacraft Labs, Inc.']);
  assert.equal(r.body.items[0].kyb, null);
});

test('the empty case is still an honest empty list, never a refusal', async () => {
  const db = freshDb();
  const r = await get(env(db), '/companies/kyb', { user: STRANGER, role: 'founder' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
});

// ---------------------------------------------------------------------------
// 3. The two routes nothing called are gone (D304).
// ---------------------------------------------------------------------------

test('GET /trust/summary and POST /trust/kyb/start are not mounted', async () => {
  const db = freshDb();
  assert.doesNotMatch(WORKER, /trust\.get\('\/summary'/);
  assert.doesNotMatch(WORKER, /trust\.post\('\/kyb\/start'/);
  const s = await get(env(db), '/summary', founder);
  assert.equal(s.status, 404);
  const k = await app.request('/kyb/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(FOUNDER, 'founder')}`, 'Content-Type': 'application/json' },
    body: '{}',
  }, env(db));
  assert.equal(k.status, 404);
});
