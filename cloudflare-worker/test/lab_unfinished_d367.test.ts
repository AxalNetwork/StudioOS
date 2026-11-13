/**
 * D367 — two of the four Lab-tools pieces D360–D365 filed, on the Worker:
 *
 *   - `POST /progress/metrics/:projectId` defaulted a missing `snapshot_date`
 *     to today, and stored any string as the date. A snapshot's date is the
 *     period its figures describe, so a missing or unreal one is now refused
 *     and nothing is written.
 *   - `POST /decks/:id/share` did not return the link's row id, so the Lab
 *     share sheet could not withdraw the link it was replacing. It now does,
 *     and that id is the one `DELETE /decks/:id/shares/:shareId` withdraws.
 *
 * The real routers run against real SQLite (node:sqlite via _d1_sqlite.mjs),
 * with migration 249 executed for the metrics store.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_unfinished_d367.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import progress, { calendarDate } from '../src/routes/progress.ts';
import decks from '../src/routes/decks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/249_project_metrics.sql'), 'utf8');
const FOUNDER = 10, PROJECT = 1;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, spinout_lab_active INTEGER,
      subscription_tier TEXT, subscription_status TEXT, subscription_renews_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    -- D691 (#1700): a new link logs its raise.pitch-deck row.
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, action TEXT NOT NULL,
      details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (id, role, email, founder_id, subscription_tier, subscription_status)
      VALUES (10, 'founder', 'f@example.com', 1001, 'studio', 'active'); -- D683: deck share is on Raise + Grow
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001);
  `);
  for (const stmt of MIGRATION.split(';')) {
    const sql = stmt.replace(/--[^\n]*/g, '').trim();
    if (sql) db.exec(sql);
  }
  return db;
}

async function call(router: any, method: string, path: string, DB: unknown, body?: unknown) {
  const tok = await new SignJWT({ user_id: FOUNDER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await router.request(path, init, { JWT_SECRET, ENVIRONMENT: 'development', DB });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const rows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT snapshot_date, mrr FROM project_metrics WHERE project_id = ?').all(PROJECT) as any[];

// ---- metrics snapshot_date -------------------------------------------------

test('metrics: a snapshot with no date is refused and nothing is written — never stamped today', async () => {
  const db = freshDb();
  for (const body of [{ mrr: 1200 }, { mrr: 1200, snapshot_date: '' }, { mrr: 1200, snapshot_date: '   ' }, { mrr: 1200, snapshot_date: null }]) {
    const r = await call(progress, 'POST', `/metrics/${PROJECT}`, d1Over(db), body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.detail.code, 'snapshot_date_required');
    assert.match(r.body.detail.message, /Nothing was saved/);
  }
  assert.deepEqual(rows(db), [], 'no row was written');
});

test('metrics: a date that is not a real YYYY-MM-DD day is refused', async () => {
  const db = freshDb();
  for (const d of ['2026-02-30', '2026-13-01', '10/04/2026', '2026-1-5', 'yesterday']) {
    const r = await call(progress, 'POST', `/metrics/${PROJECT}`, d1Over(db), { mrr: 5, snapshot_date: d });
    assert.equal(r.status, 400, d);
    assert.equal(r.body.detail.code, 'snapshot_date_invalid', d);
  }
  assert.deepEqual(rows(db), []);
});

test('metrics: the caller\'s date is the one stored', async () => {
  const db = freshDb();
  const r = await call(progress, 'POST', `/metrics/${PROJECT}`, d1Over(db), { mrr: 900, snapshot_date: '2024-02-29' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.snapshot_date, '2024-02-29');
  assert.deepEqual(rows(db).map((x) => ({ ...x })), [{ snapshot_date: '2024-02-29', mrr: 900 }]);
});

test('calendarDate accepts only a real calendar day', () => {
  assert.equal(calendarDate('2024-02-29'), '2024-02-29');
  assert.equal(calendarDate('2023-02-29'), null);
  assert.equal(calendarDate('2026-04-31'), null);
  assert.equal(calendarDate(' 2026-04-01'), null);
});

// ---- deck share id -----------------------------------------------------------

async function deckWithShare() {
  const db = freshDb();
  const DB = d1Over(db);
  // Let the router build its own tables, then seed a deck.
  await call(decks, 'GET', `/by-project/${PROJECT}`, DB);
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ?, 1, '[]')`).run(PROJECT);
  const r = await call(decks, 'POST', '/5/share', DB, { expires_in_hours: 24 });
  return { db, DB, r };
}

test('deck share: minting returns the link\'s row id', async () => {
  const { db, r } = await deckWithShare();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Number.isInteger(r.body.id), 'an integer id comes back');
  const row = db.prepare('SELECT id, deck_id FROM pitch_deck_share_tokens WHERE id = ?').get(r.body.id) as any;
  assert.equal(row?.deck_id, 5, 'the id is the row just written for this deck');
});

test('deck share: that id is the one DELETE withdraws', async () => {
  const { db, DB, r } = await deckWithShare();
  const second = await call(decks, 'POST', '/5/share', DB, { expires_in_hours: 72 });
  assert.notEqual(second.body.id, r.body.id);
  const del = await call(decks, 'DELETE', `/5/shares/${r.body.id}`, DB);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const live = db.prepare('SELECT id FROM pitch_deck_share_tokens WHERE revoked_at IS NULL ORDER BY id').all() as any[];
  assert.deepEqual(live.map((x) => x.id), [second.body.id], 'only the replacement is still live');
});
