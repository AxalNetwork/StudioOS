/**
 * Task #108 — a company's KYB, beside the account's rather than instead of it.
 *
 * THE QUESTION WAS "SHOULD KYB BE PER-COMPANY RATHER THAN PER-USER", and the
 * answer this implements is BESIDE, because D40 and D42 had already argued it
 * twice: "The account's entity is who signs your contracts; the company's is
 * who the workspace belongs to. They must not drift into each other."
 * `corporate_profiles` is untouched — `user_id` is its PRIMARY KEY, one row per
 * account, structurally — and migration 220 adds a second object.
 *
 * TWO THINGS THESE TESTS EXIST TO PIN.
 *
 * 1. MEMBERSHIP IS THE ONLY KEY. `company_kyb_records.company_id` is NOT NULL
 *    and UNIQUE, so unlike `icDecisionScope` there is no author fallback and no
 *    NULL branch to get backwards. A KYB record is readable by the company's
 *    members and by nobody else — including the person who typed it, if they
 *    have since left. That last one is easy to get wrong by copying
 *    `esignEnvelopeScope`, which admits its creator.
 *
 * 2. THE COMPANY COMES FROM THE VERIFIED HEADER. `resolveActiveCompany` refuses
 *    anything that is not 1-15 digits and then checks `user_company_links`, so
 *    a forged `X-Company-Id` reaches nothing. A company id taken from the
 *    request body would be an ownership claim the caller makes about itself,
 *    and that is the shape this must never grow.
 *
 * Real SQLite, per `_d1_sqlite.mjs`: the route's own query with its own binds
 * decides which rows come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import trust from '../src/routes/trust.ts';
import { companyKybScope } from '../src/services/tenancyScope.ts';

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
const ALICE = 1;     // member of companies 1 and 2
const BOB = 2;       // member of company 3 only
const LONER = 3;     // member of nothing
const ADMIN = 9;

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
    CREATE TABLE corporate_profiles (
      user_id INTEGER PRIMARY KEY, entity_name TEXT, registration_number TEXT,
      registered_country TEXT, updated_at TEXT
    );
  `);
  // `company_kyb_records` IS CREATED FROM THE MIGRATION ITSELF, not hand-copied.
  // Found by mutation: with a hand-written copy, breaking the migration's
  // `UNIQUE (company_id)` changed nothing any behavioural test could see,
  // because the test's own table still had it. A schema the test writes for
  // itself is a schema the test cannot check.
  db.exec(readFileSync(resolve(process.cwd(), MIGRATION_220), 'utf8'));

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(ALICE, 'founder', 'Alice', 'alice@example.com');
  u.run(BOB, 'founder', 'Bob', 'bob@example.com');
  u.run(LONER, 'founder', 'Loner', 'loner@example.com');
  u.run(ADMIN, 'admin', 'Ada', 'ada@example.com');

  const cp = db.prepare('INSERT INTO company_profiles (id, uid, company_name) VALUES (?,?,?)');
  cp.run(1, 'c-1', 'Anvil');
  cp.run(2, 'c-2', 'Bellows');
  cp.run(3, 'c-3', "Bob's Forge");

  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id, role_in_company, is_primary_admin) VALUES (?,?,?,?)');
  l.run(1, ALICE, 'Admin', 1);
  l.run(2, ALICE, 'Member', 0);
  l.run(3, BOB, 'Admin', 1);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string,
  who: { user: number; role: string } | null, body?: any, companyHeader?: string,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await token(who.user, who.role)}`;
  if (companyHeader !== undefined) headers['X-Company-Id'] = companyHeader;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const alice = { user: ALICE, role: 'founder' };
const bob = { user: BOB, role: 'founder' };
const kybRows = (db: any) => db.prepare('SELECT * FROM company_kyb_records').all();

test('the list shows every company you belong to, and only those', async () => {
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/companies/kyb', alice)).body;
  assert.deepEqual(r.items.map((i: any) => i.company_name), ['Anvil', 'Bellows']);
  assert.ok(!r.items.some((i: any) => i.company_name === "Bob's Forge"));
});

test('a company with no record yet is listed as not started, not omitted', async () => {
  // The reason `companyKybScope` is deliberately NOT applied to this query: the
  // LEFT JOIN leaves `k.company_id` NULL, so the scope's EXISTS would drop
  // exactly the rows the card exists to show.
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/companies/kyb', alice)).body;
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].kyb, null);
});

test('someone in no company gets an empty list rather than everyone else\'s', async () => {
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/companies/kyb', { user: LONER, role: 'founder' })).body;
  assert.deepEqual(r.items, []);
});

test('starting a KYB writes one row for the company in the header', async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/companies/kyb', alice,
    { entity_name: 'Anvil Ltd', jurisdiction: 'GB', registration_number: '12345678' }, '1');

  assert.equal(r.status, 201);
  const all = kybRows(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].company_id, 1);
  assert.equal(all[0].started_by_user_id, ALICE);
  assert.equal(all[0].entity_name, 'Anvil Ltd');
  assert.equal(all[0].status, 'in_review');
});

test('the account record is not touched — D40/D42, two objects', async () => {
  // The whole shape of the answer to #108. If this ever writes a
  // `corporate_profiles` row, the two entities have started to drift into each
  // other, which is exactly what those decisions forbid.
  const db = freshDb();
  await call(env(db), 'POST', '/companies/kyb', alice, { entity_name: 'Anvil Ltd' }, '1');
  assert.deepEqual(db.prepare('SELECT * FROM corporate_profiles').all(), []);
});

test('no company selected is refused, not guessed', async () => {
  // Alice belongs to two. Picking one for her would be the platform deciding
  // which legal entity she meant.
  const db = freshDb();
  const r = await call(env(db), 'POST', '/companies/kyb', alice, { entity_name: 'Anvil Ltd' });
  assert.equal(r.status, 400);
  assert.match(String(r.body?.detail), /No company selected/);
  assert.equal(kybRows(db).length, 0);
});

test('a company you do not belong to is refused, however real it is', async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/companies/kyb', alice, { entity_name: 'Sneak' }, '3');
  assert.equal(r.status, 400, 'the header resolves to null, so no company is selected');
  assert.equal(kybRows(db).length, 0);
});

test('a header that is not a plain number reaches nothing', async () => {
  const db = freshDb();
  // `resolveActiveCompany`'s docblock lists the values `Number()` would have
  // accepted. `' 12 '` is on that list and is NOT tested here: the Headers spec
  // trims header values, so a padded id never arrives padded — asserting it is
  // refused would be asserting something HTTP already prevents, and the test
  // would be describing a world the route never sees. The rest do arrive.
  for (const forged of ['0x1', '1e0', 'Infinity', '1; DROP TABLE users', '', '-1', '9'.repeat(16)]) {
    const r = await call(env(db), 'POST', '/companies/kyb', alice, { entity_name: 'X' }, forged);
    assert.equal(r.status, 400, `header ${JSON.stringify(forged)} must not select a company`);
  }
  assert.equal(kybRows(db).length, 0);
});

test('a padded header is trimmed by HTTP and then resolves normally', async () => {
  // The other half of the note above, stated as behaviour rather than left as a
  // gap in the list: `' 1 '` reaches the route as `'1'`.
  const db = freshDb();
  const r = await call(env(db), 'POST', '/companies/kyb', alice, { entity_name: 'Anvil Ltd' }, ' 1 ');
  assert.equal(r.status, 201);
  assert.equal(kybRows(db)[0].company_id, 1);
});

test('starting twice updates the one row rather than making a second', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/companies/kyb', alice, { entity_name: 'Anvil Ltd', jurisdiction: 'GB' }, '1');
  await call(e, 'POST', '/companies/kyb', alice, { registration_number: '999' }, '1');

  const all = kybRows(db);
  assert.equal(all.length, 1, 'UNIQUE(company_id) — one company, one KYB');
  assert.equal(all[0].registration_number, '999');
  // COALESCE, so a later partial submit does not blank what an earlier one said.
  assert.equal(all[0].entity_name, 'Anvil Ltd');
  assert.equal(all[0].jurisdiction, 'GB');
});

test('a colleague sees the record, and a stranger does not', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', '/companies/kyb', alice, { entity_name: 'Anvil Ltd' }, '1');
  db.prepare('INSERT INTO user_company_links (company_id, user_id, role_in_company) VALUES (?,?,?)')
    .run(1, BOB, 'Member');

  const seen = (await call(e, 'GET', '/companies/kyb', bob)).body;
  const anvil = seen.items.find((i: any) => i.company_name === 'Anvil');
  assert.equal(anvil?.kyb?.entity_name, 'Anvil Ltd', 'a colleague reads it');

  const loner = (await call(e, 'GET', '/companies/kyb', { user: LONER, role: 'founder' })).body;
  assert.deepEqual(loner.items, [], 'a stranger reads nothing');
});

test('the author who leaves stops reading — the column says who to ask, not who may look', () => {
  // The branch it would be easy to add by copying `esignEnvelopeScope`, which
  // admits its creator. A KYB record is about the COMPANY: whoever typed it did
  // so on the company's behalf.
  const scope = companyKybScope({ id: ALICE, role: 'founder' } as any, 'k');
  assert.doesNotMatch(scope.sql, /started_by_user_id/,
    'membership is the only key — no author fallback');
  assert.equal(scope.binds.length, 1, 'one bind: the caller');
});

test('an unidentified caller gets no rows, never all rows', () => {
  // The module's deny-by-default. `{role:'admin'}` with no id was every row once.
  assert.equal(companyKybScope(null, 'k').sql, '1=0');
  assert.equal(companyKybScope({ role: 'admin' } as any, 'k').sql, '1=0');
  assert.equal(companyKybScope({ id: ADMIN, role: 'admin' } as any, 'k').sql, '1=1');
});

test('the migration references company_profiles, because `companies` does not exist', () => {
  // Migration 034 creates a `companies` table, `schema_migrations` records it as
  // applied, and it is absent from production AND from schema_baseline.sql, with
  // zero references anywhere in the worker. `REFERENCES companies(id)` would
  // have shipped a foreign key pointing at nothing, and SQLite would not have
  // said so — it does not verify the target until the constraint is enforced.
  // COMMENTS STRIPPED FIRST. The migration's header explains at length why it
  // does NOT write `REFERENCES companies(id)`, so a naive read of the file finds
  // the very string the assertion forbids — the same trap `advisor_client_grants`
  // documents about quoting the symbols a file must never call.
  const raw = readFileSync(resolve(process.cwd(), MIGRATION_220), 'utf8');
  const sql = raw.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /REFERENCES company_profiles\(id\)/);
  assert.doesNotMatch(sql, /REFERENCES companies\(id\)/);
  const baseline = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
  assert.doesNotMatch(baseline, /CREATE TABLE companies\b/,
    'if `companies` ever lands in the baseline, this FK target should be reconsidered');
});

test('company_id is NOT NULL, because a KYB owned by nobody is readable by anybody', () => {
  // Comments stripped, as above: the header argues for both of these in prose,
  // so an unstripped read finds them whether or not the DDL still does.
  const sql = readFileSync(resolve(process.cwd(), MIGRATION_220), 'utf8').replace(/^\s*--.*$/gm, '');
  assert.match(sql, /company_id INTEGER NOT NULL/);
  assert.match(sql, /UNIQUE \(company_id\)/);
});

test('a company_id in the BODY is ignored — the header is the only claim', async () => {
  // FOUND BY MUTATION, and it is the one that matters. Reading `company_id`
  // from the request body passed every test here, because no test sent one.
  // The header goes through `resolveActiveCompany`, which verifies membership;
  // a body field is an ownership claim the caller makes about itself.
  const db = freshDb();
  const e = env(db);

  // Bob's company, named in the body, with no header at all.
  const sneak = await call(e, 'POST', '/companies/kyb', alice, { company_id: 3, entity_name: 'Sneak' });
  assert.equal(sneak.status, 400, 'a body field must not select a company');
  assert.equal(kybRows(db).length, 0);

  // And when a valid header IS present, the body must not override it.
  const ok = await call(e, 'POST', '/companies/kyb', alice, { company_id: 3, entity_name: 'Anvil Ltd' }, '1');
  assert.equal(ok.status, 201);
  const all = kybRows(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].company_id, 1, "the header's company, never the body's");
});
