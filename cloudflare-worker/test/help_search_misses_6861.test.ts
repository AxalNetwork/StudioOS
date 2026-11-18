/**
 * D6861 (#6861) — Help Center v2: the store of searches that found nothing
 * (migration 202611161142_6861, routes/help_center.ts).
 *
 * Pinned: the query is normalised and its shape refused before any write; a
 * query that looks like an email address or an account number is withheld,
 * never stored; one member's repeat of a query on one day counts once, and a
 * member counts at most 20 a day; marks older than two days and days older
 * than 90 go on every write; the admin read is most searched first over its
 * window, refuses a non-admin, names no member, and a failed read is an
 * error, never an empty list.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/help_search_misses_6861.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import help, {
  adminHelpCenter, searchMissQuery, utcDay, SEARCH_MISSES_PER_DAY, SEARCH_QUERY_MAX,
} from '../src/routes/help_center.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611161142_6861_help_search_misses.sql'), 'utf8');
const ROLE: Record<number, string> = { 1: 'founder', 2: 'investor', 3: 'admin' };
const NOW = new Date(); // clock-ok: relative

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  for (const [id, role] of Object.entries(ROLE)) db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(Number(id), role, `Member ${id}`, `m${id}@example.test`);
  db.exec(MIGRATION);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/help', help as any);
  a.route('/api/admin/help', adminHelpCenter as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, method: string, path: string, as = 1, body?: unknown) {
  const tok = await new SignJWT({ user_id: as, role: ROLE[as] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const rows = (db: DatabaseSync) => (db.prepare('SELECT query, day, searches FROM help_search_misses ORDER BY query, day').all() as any[]).map((r) => ({ ...r }));
const miss = (db: DatabaseSync, query: unknown, as = 1) => call(db, 'POST', '/help/search-misses', as, { query });

test('D6861: a query is normalised, and a bad one is refused before any write', async () => {
  assert.deepEqual(searchMissQuery('  Export\tINVOICES  '), { query: 'export invoices' });
  assert.deepEqual(searchMissQuery('x'), { code: 'invalid_query' });
  assert.deepEqual(searchMissQuery(42), { code: 'invalid_query' });
  assert.deepEqual(searchMissQuery('a'.repeat(SEARCH_QUERY_MAX + 1)), { code: 'query_too_long' });
  assert.deepEqual(searchMissQuery('a'.repeat(SEARCH_QUERY_MAX)), { query: 'a'.repeat(SEARCH_QUERY_MAX) });
  const db = freshDb();
  for (const [q, code] of [['x', 'invalid_query'], [null, 'invalid_query'], ['b'.repeat(81), 'query_too_long']] as const) {
    const r = await miss(db, q);
    assert.equal(r.status, 400, String(q));
    assert.equal(r.body.error, code);
  }
  assert.deepEqual(rows(db), []);
  assert.throws(() => db.prepare(`INSERT INTO help_search_misses (query, day, searches) VALUES ('Upper', '2026-11-16', 1)`).run(), /CHECK/,
    'the table holds the lower-case shape too');
});

test('D6861: a query that looks like an email address or an account number is withheld, never stored', async () => {
  const db = freshDb();
  for (const q of ['reset maya@example.com', 'invoice 1234567', 'acct 12-34-56', 'card 4242 4242']) {
    const r = await miss(db, q);
    assert.deepEqual([r.status, r.body], [200, { recorded: false, withheld: true }], q);
  }
  assert.deepEqual(rows(db), []);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM help_search_miss_marks').get() as any).n, 0, 'no mark either');
  assert.deepEqual(searchMissQuery('q3 2026 export'), { query: 'q3 2026 export' }, 'a year is not an account number');
});

test('D6861: one member repeating a query on a day counts once; another member counts; the day is capped', async () => {
  const db = freshDb();
  const today = utcDay(NOW);
  assert.deepEqual((await miss(db, 'Export invoices')).body, { recorded: true });
  assert.deepEqual((await miss(db, 'export   invoices')).body, { recorded: false }, 'the same query, normalised');
  assert.deepEqual((await miss(db, 'export invoices', 2)).body, { recorded: true });
  assert.deepEqual(rows(db), [{ query: 'export invoices', day: today, searches: 2 }]);

  for (let i = 1; i < SEARCH_MISSES_PER_DAY; i += 1) assert.equal((await miss(db, `query number ${String.fromCharCode(96 + i)}`)).body.recorded, true, `query ${i}`);
  const over = await miss(db, 'one too many');
  assert.deepEqual([over.status, over.body], [200, { recorded: false }], 'past the day\'s cap nothing is counted');
  assert.equal(rows(db).some((r) => r.query === 'one too many'), false);
});

test('D6861: a write drops marks older than two days and counts older than 90 days', async () => {
  const db = freshDb();
  const m = db.prepare('INSERT INTO help_search_miss_marks (user_id, query, day) VALUES (?, ?, ?)');
  m.run(1, 'old query', utcDay(NOW, -2));
  m.run(2, 'kept query', utcDay(NOW, -1));
  const v = db.prepare('INSERT INTO help_search_misses (query, day, searches) VALUES (?, ?, ?)');
  v.run('ancient', utcDay(NOW, -90), 4);
  v.run('recent', utcDay(NOW, -89), 3);
  await miss(db, 'fresh query');
  const days = (db.prepare('SELECT day FROM help_search_miss_marks ORDER BY day').all() as any[]).map((r) => r.day);
  assert.deepEqual(days, [utcDay(NOW, -1), utcDay(NOW)]);
  assert.deepEqual(rows(db).map((r) => r.query), ['fresh query', 'recent']);
});

test('D6861: the admin read is most searched first over its window, and names no member', async () => {
  const db = freshDb();
  const v = db.prepare('INSERT INTO help_search_misses (query, day, searches) VALUES (?, ?, ?)');
  v.run('export invoices', utcDay(NOW), 2);
  v.run('export invoices', utcDay(NOW, -29), 3);
  v.run('vat receipts', utcDay(NOW, -1), 6);
  v.run('alpha', utcDay(NOW, -1), 5);
  v.run('outside window', utcDay(NOW, -30), 50);
  v.run('nothing', utcDay(NOW), 0);
  const r = await call(db, 'GET', '/admin/help/search-misses', 3);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { window_days: 30, searches: [
    { query: 'vat receipts', searches: 6 }, { query: 'alpha', searches: 5 }, { query: 'export invoices', searches: 5 },
  ] });
  assert.deepEqual((await call(db, 'GET', '/admin/help/search-misses?days=1', 3)).body.searches, [{ query: 'export invoices', searches: 2 }]);
  for (const bad of ['days=0', 'days=91', 'days=x']) assert.equal((await call(db, 'GET', `/admin/help/search-misses?${bad}`, 3)).status, 400, bad);
  assert.doesNotMatch(r.text, /user_id|m\d@example|Member \d/);
  assert.equal((await call(db, 'GET', '/admin/help/search-misses', 1)).status, 403, 'a founder may not read it');
  assert.equal((await call(db, 'GET', '/admin/help/search-misses', 2)).status, 403, 'an investor may not read it');
});

test('D6861: a failed read is an error, never an empty list; a failed write says so', async () => {
  const db = freshDb();
  db.exec('DROP TABLE help_search_misses');
  const r = await call(db, 'GET', '/admin/help/search-misses', 3);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'search_misses_unreadable');
  assert.equal('searches' in r.body, false);
  const w = await miss(db, 'export invoices');
  assert.equal(w.status, 503);
  assert.equal(w.body.error, 'search_miss_not_recorded');
});
