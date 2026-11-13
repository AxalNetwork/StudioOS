/**
 * `/api/admin/users`: the search that did not exist, and the totals that were
 * a page (D128).
 *
 * TWO DEFECTS, AND THE SECOND WAS LIVE ON A SHIPPED SCREEN.
 *
 *   1. Nobody could look an account up by name or email on either tier. The
 *      Admin Console's Users panel filtered by ROLE and nothing else
 *      (`AdminPage.jsx`), so S0's second wall rule — "search says what it
 *      searches" — had no route behind it for a branch to honour.
 *   2. The panel's role tiles were `users.filter(...).length` over whatever
 *      this route returned, and it returns the newest 100 by default. Past a
 *      hundred accounts the "All Users" tile read **100** as the total. A
 *      plausible number standing in for an unmeasured one is what this repo
 *      has an `<Unrecorded/>` primitive to prevent.
 *
 * THE FIXTURE SEEDS MORE ROWS THAN THE PAGE, which is the whole point. An
 * assertion against a handful of users cannot tell a total from a page count —
 * they are equal — so it would have passed against the broken code. That is
 * exactly how this shipped, and the `LIMIT`-crossing test below is the one
 * that matters.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_user_search_d128.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import admin from '../src/routes/admin.ts';
import { likeNeedle, likeNeedleLower } from '../src/util/likeSearch.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;

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
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1, email_verified INTEGER NOT NULL DEFAULT 0,
    kyc_status TEXT, access_level TEXT, jwt_min_iat INTEGER, created_at TEXT);
`;

/** One admin plus `n` founders, so the seeded directory crosses the page size. */
function db(extra = 0, seed: Array<[string, string, string]> = []) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  const ins = d.prepare('INSERT INTO users (id, uid, email, name, role, created_at) VALUES (?,?,?,?,?,?)');
  ins.run(ADMIN, 'u1', 'root@axal.test', 'Root Admin', 'admin', '2026-01-01T00:00:00Z');
  for (let i = 0; i < extra; i++) {
    ins.run(100 + i, `u${100 + i}`, `f${i}@axal.test`, `Founder ${i}`, 'founder', `2026-02-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z`);
  }
  let next = 9000;
  for (const [name, email, role] of seed) ins.run(next++, `x${next}`, email, name, role, '2026-03-01T00:00:00Z');
  return d;
}

const app = new Hono<any>();
app.route('/admin', admin);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function get(path: string, d: InstanceType<typeof DatabaseSync>) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(d) });
  return { status: res.status, body: await res.json() as any };
}

// ── the helper, on its own ─────────────────────────────────────────────────

test('the LIKE needle escapes the wildcards and refuses what is too short', () => {
  // D108's finding on this repo was that the escaping assertion could not
  // fail, because it was written against one of three identical copies. There
  // is one implementation now, and this is the test it owes.
  assert.equal(likeNeedle('a_b'), '%a\\_b%', 'an underscore must match itself, not any character');
  assert.equal(likeNeedle('50%'), '%50\\%%', 'a percent must match itself, not everything');
  assert.equal(likeNeedle('ab'), '%ab%');
  assert.equal(likeNeedle('  ab  '), '%ab%', 'the needle is trimmed');
  assert.equal(likeNeedle('a'), null, 'one character is too short to search on');
  assert.equal(likeNeedle(''), null);
  assert.equal(likeNeedle(undefined), null);
  // `null`, not `%%` — the refusal must be something a caller has to branch
  // on. `%%` matches every row, so falling through would turn a search into
  // the whole table.
  assert.notEqual(likeNeedle('a'), '%%');
  assert.equal(likeNeedleLower('A_B', 1), '%a\\_b%', 'lower-cased for the directory searches, escaping intact');
  assert.equal(likeNeedleLower('a', 1), '%a%', 'the two directory searches still accept one character');
});

// ── the route ──────────────────────────────────────────────────────────────

test('the flat array still answers, because a live caller reads it', async () => {
  // `SuperAdminHolders.jsx` calls this with no arguments. The envelope is
  // opt-in for exactly that reason, and this is the assertion that keeps it so.
  const { status, body } = await get('/admin/users', db(3));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body), 'the default response stopped being a flat array');
  assert.equal(body.length, 4);
});

test('the tiles count the table, not the page', async () => {
  // THE ONE THAT MATTERS. 140 founders + 1 admin against a default page of
  // 100: a fixture smaller than the limit cannot tell a total from a page,
  // which is how the defect shipped.
  const { body } = await get('/admin/users?envelope=1', db(140));
  assert.equal(body.results.length, 100, 'the page is still a page');
  assert.equal(body.showing, 100);
  assert.equal(body.limit, 100);
  assert.equal(body.total, 141, 'the total counts every account, not the ones returned');
  assert.equal(body.by_role.founder, 140);
  assert.equal(body.by_role.admin, 1);
  assert.notEqual(body.total, body.results.length, 'total and page size must be able to differ');
});

test('a search finds an account nobody could have scrolled to', async () => {
  // The seeded account is the OLDEST row, so `ORDER BY created_at DESC LIMIT
  // 100` puts it off the end of the page: before the search existed it was
  // unreachable from this console.
  const d = db(140);
  d.prepare('INSERT INTO users (id, uid, email, name, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(5000, 'ux', 'quiet@axal.test', 'Quiet Person', 'advisor', '2020-01-01T00:00:00Z');
  const plain = await get('/admin/users?envelope=1', d);
  assert.ok(!plain.body.results.some((r: any) => r.email === 'quiet@axal.test'),
    'the fixture must put this account off the first page, or the test proves nothing');

  const byName = await get('/admin/users?envelope=1&q=Quiet', d);
  assert.deepEqual(byName.body.results.map((r: any) => r.email), ['quiet@axal.test']);
  assert.equal(byName.body.searched, true);
  const byEmail = await get('/admin/users?envelope=1&q=quiet%40axal', d);
  assert.deepEqual(byEmail.body.results.map((r: any) => r.email), ['quiet@axal.test'], 'email must be searchable too');
  // And the tiles do not move: they count the directory, not the result set.
  assert.equal(byName.body.total, 142);
});

test('a wildcard in the query matches itself', async () => {
  const d = db(0, [['Ada_Lovelace', 'ada@axal.test', 'founder'], ['AdaXLovelace', 'adax@axal.test', 'founder']]);
  const { body } = await get('/admin/users?envelope=1&q=Ada_Love', d);
  assert.deepEqual(body.results.map((r: any) => r.email), ['ada@axal.test'],
    'the underscore matched any character, so the escaping is not reaching the query');
});

test('a one-character search is refused rather than answered with everyone', async () => {
  // The trap the helper's `null` exists for: `%%` matches every row, so a
  // fall-through would hand back the whole directory dressed as a result.
  const { status, body } = await get('/admin/users?envelope=1&q=a', db(140));
  assert.equal(status, 400);
  assert.equal(body.error, 'query_too_short');
  assert.match(String(body.message), /two characters/);
});

test('a search that matches nothing says so, rather than falling back to the list', async () => {
  const { status, body } = await get('/admin/users?envelope=1&q=zzzznobody', db(140));
  assert.equal(status, 200);
  assert.deepEqual(body.results, []);
  assert.equal(body.searched, true);
  // The totals still answer, because the directory is still readable — an
  // empty result is not an unreadable one.
  assert.equal(body.total, 141);
});
