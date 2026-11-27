/**
 * D603 (#1286) — the Help Center's weekly guide views and yes/no answers
 * (migration 408, routes/help_center.ts).
 *
 * Pinned: a bad anchor is a 400 before any write; a second view by the same
 * member on the same day is not counted; marks older than two days go; the
 * popular window and its order; the last answer wins; `missing` is refused
 * with yes and trimmed; the admin read refuses a non-admin with 403; no
 * member identity in the counts table or in the admin reply; a failed read is
 * an error, never an empty list.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/help_center_d603.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import help, { adminHelpCenter, guideAnchor, utcDay, MISSING_MAX } from '../src/routes/help_center.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const M408 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/408_help_guide_views_feedback.sql'), 'utf8');
const ROLE: Record<number, string> = { 1: 'founder', 2: 'investor', 3: 'admin' };

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  for (const [id, role] of Object.entries(ROLE)) db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(Number(id), role, `Member ${id}`, `m${id}@example.test`);
  db.exec(M408);
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
const plain = (rows: unknown[]) => rows.map((r) => ({ ...(r as object) }));
const views = (db: DatabaseSync) => plain(db.prepare('SELECT anchor, day, views FROM help_guide_views ORDER BY anchor, day').all()) as any[];

test('D603: an anchor is <area>/<guide> in lower-case letters, digits and hyphens; anything else is a 400 before any write', async () => {
  assert.equal(guideAnchor('capital', 'cap-table'), 'capital/cap-table');
  for (const [a, g] of [['Capital', 'x'], ['cap_ital', 'x'], ['a', ''], ['a', 'b c'], ['a'.repeat(60), 'b'.repeat(60)], ['a', "x'--"]]) {
    assert.equal(guideAnchor(a, g), null, `${a}/${g}`);
  }
  const db = freshDb();
  for (const path of ['/help/guides/Capital/cap-table/view', '/help/guides/cap_ital/x/view', `/help/guides/${'a'.repeat(60)}/${'b'.repeat(60)}/view`]) {
    const r = await call(db, 'POST', path);
    assert.equal(r.status, 400, path);
    assert.equal(r.body.error, 'invalid_anchor');
  }
  assert.equal((await call(db, 'PUT', '/help/guides/Bad/x/feedback', 1, { answer: 'yes' })).status, 400);
  assert.equal((await call(db, 'GET', '/help/guides/Bad/x/feedback')).status, 400);
  assert.deepEqual(views(db), []);
  assert.throws(() => db.prepare(`INSERT INTO help_guide_views (anchor, day, views) VALUES ('Bad/Anchor', '2026-10-06', 1)`).run(), /CHECK/,
    'the table holds the shape too');
});

test('D603: a second view by the same member on the same day is not counted; another member\'s is', async () => {
  const db = freshDb();
  const today = utcDay(new Date());
  const first = await call(db, 'POST', '/help/guides/capital/cap-table/view', 1);
  assert.deepEqual([first.status, first.body.counted, first.body.day], [200, true, today]);
  const again = await call(db, 'POST', '/help/guides/capital/cap-table/view', 1);
  assert.deepEqual([again.status, again.body.counted], [200, false]);
  await call(db, 'POST', '/help/guides/capital/cap-table/view', 2);
  assert.deepEqual(views(db), [{ anchor: 'capital/cap-table', day: today, views: 2 }]);
});

test('D603: a view write drops marks older than two days, so no identity is kept past that', async () => {
  const db = freshDb();
  const now = new Date();
  const m = db.prepare('INSERT INTO help_guide_view_marks (user_id, anchor, day) VALUES (?, ?, ?)');
  m.run(1, 'capital/cap-table', utcDay(now, -2));
  m.run(1, 'capital/cap-table', utcDay(now, -5));
  m.run(2, 'capital/cap-table', utcDay(now, -1));
  await call(db, 'POST', '/help/guides/raise/data-room/view', 1);
  const days = (db.prepare('SELECT day FROM help_guide_view_marks ORDER BY day').all() as any[]).map((r) => r.day);
  assert.deepEqual(days, [utcDay(now, -1), utcDay(now)]);
});

test('D603: popular sums the window, most views first then the anchor, and caps the limit', async () => {
  const db = freshDb();
  const now = new Date();
  const v = db.prepare('INSERT INTO help_guide_views (anchor, day, views) VALUES (?, ?, ?)');
  v.run('capital/cap-table', utcDay(now), 3);
  v.run('capital/cap-table', utcDay(now, -6), 2);   // inside 7 days
  v.run('raise/data-room', utcDay(now, -1), 5);
  v.run('team/hiring', utcDay(now, -2), 5);
  v.run('old/guide', utcDay(now, -7), 50);          // outside 7 days
  v.run('zero/guide', utcDay(now), 0);
  const r = await call(db, 'GET', '/help/popular?days=7&limit=4');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { window_days: 7, guides: [
    { anchor: 'capital/cap-table', views: 5 }, { anchor: 'raise/data-room', views: 5 }, { anchor: 'team/hiring', views: 5 },
  ] });
  assert.deepEqual((await call(db, 'GET', '/help/popular?days=1')).body.guides.map((g: any) => g.anchor), ['capital/cap-table']);
  assert.deepEqual((await call(db, 'GET', '/help/popular?days=30&limit=1')).body.guides, [{ anchor: 'old/guide', views: 50 }]);
  for (const bad of ['days=0', 'days=31', 'limit=11', 'limit=0', 'days=x']) {
    assert.equal((await call(db, 'GET', `/help/popular?${bad}`)).status, 400, bad);
  }
  assert.deepEqual((await call(db, 'GET', '/help/popular')).body.window_days, 7);
});

test('D603: a failed popular read is an error, never an empty list', async () => {
  const db = freshDb();
  db.exec('DROP TABLE help_guide_views');
  const r = await call(db, 'GET', '/help/popular');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'popular_guides_unreadable');
  assert.equal('guides' in r.body, false);
});

test('D603: feedback — the last answer wins, missing is trimmed, refused with yes, and capped', async () => {
  const db = freshDb();
  const path = '/help/guides/capital/cap-table/feedback';
  assert.deepEqual((await call(db, 'GET', path)).body, { anchor: 'capital/cap-table', feedback: null });
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'no', missing: '  The 409A part  ' })).status, 200);
  assert.deepEqual([(await call(db, 'GET', path)).body.feedback.answer, (await call(db, 'GET', path)).body.feedback.missing], ['no', 'The 409A part']);
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'yes' })).status, 200);
  const rows = plain(db.prepare('SELECT answer, missing FROM help_guide_feedback').all()) as any[];
  assert.deepEqual(rows, [{ answer: 'yes', missing: null }], 'one row per member per guide, the last one wins');
  const yesWith = await call(db, 'PUT', path, 1, { answer: 'yes', missing: 'x' });
  assert.deepEqual([yesWith.status, yesWith.body.error], [400, 'missing_with_yes']);
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'yes', missing: '   ' })).status, 200, 'blank missing is no missing');
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'no', missing: 'x'.repeat(MISSING_MAX + 1) })).body.error, 'missing_too_long');
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'no', missing: 'x'.repeat(MISSING_MAX) })).status, 200);
  assert.equal((await call(db, 'PUT', path, 1, { answer: 'maybe' })).body.error, 'invalid_answer');
  assert.equal((await call(db, 'GET', path, 2)).body.feedback, null, 'another member does not see this answer');
});

test('D603: the admin read refuses a non-admin, and returns counts and texts with no member identity', async () => {
  const db = freshDb();
  await call(db, 'PUT', '/help/guides/capital/cap-table/feedback', 1, { answer: 'no', missing: 'Needs an example' });
  await call(db, 'PUT', '/help/guides/capital/cap-table/feedback', 2, { answer: 'yes' });
  await call(db, 'PUT', '/help/guides/raise/data-room/feedback', 2, { answer: 'yes' });
  for (const who of [1, 2]) assert.equal((await call(db, 'GET', '/admin/help/feedback', who)).status, 403);
  const r = await call(db, 'GET', '/admin/help/feedback', 3);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.guides, [{ anchor: 'capital/cap-table', yes: 1, no: 1 }, { anchor: 'raise/data-room', yes: 1, no: 0 }]);
  assert.deepEqual(r.body.missing.map((m: any) => [m.anchor, m.text]), [['capital/cap-table', 'Needs an example']]);
  assert.doesNotMatch(r.text, /user_id|Member \d|example\.test|"id"/, 'a member identity left the admin read');
});

test('D603: the counts table has no reader identity', () => {
  const db = freshDb();
  const cols = (db.prepare('PRAGMA table_info(help_guide_views)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['anchor', 'day', 'views']);
});
