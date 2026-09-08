/**
 * `GET|POST /api/admin/partners/links` — the attach the gap card promises.
 *
 * WHAT THESE ARE FOR. Every partner surface resolves the caller through
 * `users.partner_id` and nothing else (D57), so an account without one gets the
 * same card on every zone: "this account is not linked to a firm yet — an admin
 * can attach it." Nothing could, until these two endpoints. Measured against
 * production D1 on 2026-09-07: 8 of 26 partner accounts were attached, 18 were
 * not, and 0 resolved by the email fallback that D57 removed.
 *
 * THE ASSERTIONS ARE MOSTLY ABOUT WHAT IT REFUSES, for the reason
 * `partner_user_firm_link.test.mjs` gives about migration 210: a write that
 * attaches the wrong account to a firm does not fail loudly. It hands one party
 * another party's quotes, engagements and clients, silently, with a 200. So the
 * cases below are the ones where a helpful-looking implementation would guess:
 * a firm id that does not exist, an account that is not a partner, an admin's
 * own sign-in, and a request naming nothing at all.
 *
 * ADMIN SELF-ATTACH IS REFUSED, AND THAT IS THE LOAD-BEARING ONE. An admin
 * reading a firm's book is impersonation — it names whose book and writes an
 * `impersonation_sessions` row. Letting them point their own `partner_id` at a
 * firm here would be the same access with neither a subject nor an audit trail,
 * and it is the one shortcut this endpoint would otherwise be perfect for.
 *
 * Real SQLite rather than a stub, for the reason `_d1_sqlite.mjs` gives: the
 * route's own query with its own binds decides which rows come back, so a
 * scoping regression fails because the wrong rows appear, not because a
 * substring moved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import adminPartners from '../src/routes/admin_partners.ts';

/**
 * The sub-app under the SAME error mapping production gives it.
 *
 * `requireAdmin` refuses by `throw new Error('Admin required')`, and the status
 * comes from `app.onError` in `index.ts` — which is not in the chain when a
 * sub-app is dispatched directly, so a refusal arrives here as a 500 and an
 * authorization test would be asserting the harness rather than the route. The
 * two entries this file needs are replicated below, and the last test in the
 * file proves `index.ts` still declares them, so the copy cannot drift into
 * asserting a status production does not send.
 */
const app = new Hono<any>();
app.route('/', adminPartners);
app.onError((err: any, c) => {
  const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[
    String(err?.message || '')
  ];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const LINKED = 10;      // a partner already attached to firm 9
const ORPHAN = 11;      // a partner attached to nothing — the case this is for
const NAMESAKE = 12;    // a partner whose EMAIL is firm 3's, and who is still unattached
const FOUNDER = 13;

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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      company TEXT, email TEXT UNIQUE NOT NULL,
      directory_listed INTEGER NOT NULL DEFAULT 0,
      directory_featured INTEGER NOT NULL DEFAULT 0,
      directory_decided_at TEXT, directory_decided_by INTEGER
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER
    );
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT, filters_json TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example');
  u.run(LINKED, 'partner', 9, 'Linked', 'linked@oblivira.example');
  u.run(ORPHAN, 'partner', null, 'Orphan', 'orphan@nowhere.example');
  // The account whose address IS a firm's. Before D57 the resolver attached it
  // silently; here it must stay unattached until somebody says otherwise.
  u.run(NAMESAKE, 'partner', null, 'Namesake', 'ops@algosize.example');
  u.run(FOUNDER, 'founder', null, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, company, email) VALUES (?,?,?,?,?)');
  p.run(9, 'p-9', 'Oblivira', 'Oblivira Ltd', 'hello@oblivira.example');
  p.run(3, 'p-3', 'Algo Size', 'Algo Size GmbH', 'ops@algosize.example');
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
  e: any, method: string, path: string, who: { user: number; role: string } | null, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await token(who.user, who.role)}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const admin = { user: ADMIN, role: 'admin' };
const linkOf = (db: any, id: number) =>
  db.prepare('SELECT partner_id FROM users WHERE id = ?').get(id).partner_id;

test('the list is the work queue: unattached accounts first, with both counts', async () => {
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/links', admin)).body;

  assert.equal(r.attached, 1);
  assert.equal(r.unattached, 2);
  // Order matters here rather than being incidental: an admin opening this tab
  // is looking for the rows that need a decision, so the two unattached
  // accounts sort above the attached one — and within each group, by email.
  assert.deepEqual(r.accounts.map((a: any) => a.id), [NAMESAKE, ORPHAN, LINKED]);
  assert.equal(r.accounts.find((a: any) => a.id === LINKED).firm_company, 'Oblivira Ltd');
  assert.equal(r.accounts.find((a: any) => a.id === ORPHAN).firm_name, null);
  // A founder is not a partner account and must not appear at all.
  assert.ok(!r.accounts.some((a: any) => a.id === FOUNDER));
});

test('a firm reports how many sign-ins point at it, including none', async () => {
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/links', admin)).body;
  const by = Object.fromEntries(r.firms.map((f: any) => [f.id, f.accounts]));
  assert.equal(by[9], 1);
  // Firm 3 has no account pointing at it even though one user carries its
  // email — the whole reason the fallback went. It is recorded, not deleted.
  assert.equal(by[3], 0);
});

test('an admin attaches one named account to one named firm', async () => {
  const db = freshDb();
  const e = env(db);
  const r = await call(e, 'POST', '/links', admin, { user_id: ORPHAN, partner_id: 9 });
  assert.equal(r.status, 200);
  assert.equal(r.body.firm_name, 'Oblivira');
  assert.equal(linkOf(db, ORPHAN), 9);
  // And it is written down. An attach nobody can trace afterwards is the thing
  // impersonation exists to avoid.
  const logged = db.prepare(
    "SELECT filters_json FROM admin_audit_log WHERE action = 'partner_firm_link_set'").all();
  assert.equal(logged.length, 1);
  const details = JSON.parse((logged[0] as any).filters_json);
  assert.deepEqual([details.user_id, details.from, details.to], [ORPHAN, null, 9]);
});

test('detaching is a real answer, and is recorded as one', async () => {
  // A firm record that turns out to belong to somebody else has to be
  // removable without inventing a replacement.
  const db = freshDb();
  const r = await call(env(db), 'POST', '/links', admin, { user_id: LINKED, partner_id: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.partner_id, null);
  assert.equal(linkOf(db, LINKED), null);
  const details = JSON.parse((db.prepare(
    "SELECT filters_json FROM admin_audit_log WHERE action = 'partner_firm_link_set'")
    .get() as any).filters_json);
  assert.deepEqual([details.from, details.to], [9, null]);
});

test('a matching email is not a link — the admin still has to say so', async () => {
  // NAMESAKE carries firm 3's address. Nothing about this endpoint notices, and
  // that is the point: D57 removed exactly this inference from the read side.
  const db = freshDb();
  const r = (await call(env(db), 'GET', '/links', admin)).body;
  assert.equal(r.accounts.find((a: any) => a.id === NAMESAKE).partner_id, null);
  assert.equal(linkOf(db, NAMESAKE), null);
});

test('a firm that does not exist is a 404, not a null link', async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/links', admin, { user_id: ORPHAN, partner_id: 404 });
  assert.equal(r.status, 404);
  assert.equal(linkOf(db, ORPHAN), null, 'a failed attach must not clear the existing link');
});

test('an admin cannot attach their own sign-in to a firm', async () => {
  // The load-bearing refusal. Reading a firm's book as an admin is
  // impersonation, which names whose book and records it; a self-attach here
  // would be the same access with neither.
  const db = freshDb();
  const r = await call(env(db), 'POST', '/links', admin, { user_id: ADMIN, partner_id: 9 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /impersonat/);
  assert.equal(linkOf(db, ADMIN), null);
});

test('a founder cannot be given a firm', async () => {
  const db = freshDb();
  const r = await call(env(db), 'POST', '/links', admin, { user_id: FOUNDER, partner_id: 9 });
  assert.equal(r.status, 400);
  assert.equal(linkOf(db, FOUNDER), null);
});

test('a request naming nothing changes nothing', async () => {
  const db = freshDb();
  for (const body of [{}, { user_id: 0 }, { user_id: 'x' }, { user_id: ORPHAN, partner_id: -1 }]) {
    const r = await call(env(db), 'POST', '/links', admin, body);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  const r = await call(env(db), 'POST', '/links', admin, { user_id: 9999, partner_id: 9 });
  assert.equal(r.status, 404);
  assert.equal(linkOf(db, ORPHAN), null);
});

test('a partner cannot reach either endpoint', async () => {
  // `requireAdmin` is the gate, and it is asserted rather than assumed: this
  // endpoint can rewrite which firm an account reads.
  const db = freshDb();
  const e = env(db);
  const partner = { user: LINKED, role: 'partner' };
  assert.equal((await call(e, 'GET', '/links', partner)).status, 403);
  assert.equal((await call(e, 'POST', '/links', partner, { user_id: ORPHAN, partner_id: 9 })).status, 403);
  assert.equal((await call(e, 'GET', '/links', null)).status, 401);
  assert.equal(linkOf(db, ORPHAN), null);
});

test('the statuses this file asserts are the ones index.ts actually sends', () => {
  // The harness above replicates two rows of `AUTH_ERROR_STATUSES`, which is a
  // private const rather than an export. Replicating a mapping is fine; letting
  // the copy outlive the original is not — the authorization tests would then
  // pass against a status nothing produces.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const index = readFileSync(resolve(HERE, '../src/index.ts'), 'utf8');
  const at = index.indexOf('const AUTH_ERROR_STATUSES');
  assert.ok(at > 0, 'index.ts no longer declares AUTH_ERROR_STATUSES');
  const table = index.slice(at, index.indexOf('};', at));
  assert.match(table, /Unauthorized:\s*401/);
  assert.match(table, /'Admin required':\s*403/);
  assert.match(index, /app\.onError/, 'nothing maps the auth throws to a status any more');
});
