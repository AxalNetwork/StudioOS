/**
 * D6277 (#6277): each restatement of a benchmark is kept.
 *
 * Real SQLite: the benchmark tables are cut from migrations 217 and 303, with
 * D6278's and this issue's migrations applied over them, so the route's own
 * SQL decides every outcome.
 *
 * - Editing a value adds exactly one history row, holding the row as it was.
 * - A save that changes nothing adds none.
 * - History is owner-scoped on read, on write and on delete.
 * - The snapshot and the update land together or not at all.
 * - A history that cannot be read is null, and the rest of the detail still loads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import research from '../src/routes/research.ts';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 1;
const OTHER = 2;

function tableFrom(prefix: string, table: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string;
  const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `migration ${prefix} no longer declares ${table}`);
  return stripForeignKeys(sql.slice(start, sql.indexOf('\n);', start) + 3));
}
const migration = (name: string) => stripForeignKeys(readFileSync(resolve(MIGRATIONS, name), 'utf8'));

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
  );`);
  db.exec(tableFrom('217', 'research_benchmarks'));
  db.exec(tableFrom('303', 'research_benchmark_constituents'));
  db.exec(migration('202611180253_6278_research_benchmark_fund.sql'));
  db.exec(migration('202611270437_6277_research_benchmark_history.sql'));
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(OWNER, 'investor');
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(OTHER, 'investor');
  const b = db.prepare(
    `INSERT INTO research_benchmarks (id, uid, owner_user_id, metric, our_value, peer_value, peer_source, peer_sample_size, peer_as_of, reading, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z')`,
  );
  b.run(1, 'b-mine', OWNER, 'Months of runway at close', '20 months', '18 months', 'Peer survey B', 6, '2026 Q2', 'Early read');
  b.run(2, 'b-also-mine', OWNER, 'TVPI', '1.4x', null, null, null, null, null);
  b.run(3, 'b-theirs', OTHER, 'DPI', '0.3x', '0.5x', 'Private set', 5, null, null);
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, userId: number, method: string, path: string, body?: any, d1?: any) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(userId)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await research.fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1 || d1Over(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const history = (db: any, benchmarkId?: number) => (benchmarkId === undefined
  ? db.prepare('SELECT * FROM research_benchmark_history ORDER BY id').all()
  : db.prepare('SELECT * FROM research_benchmark_history WHERE benchmark_id = ? ORDER BY id').all(benchmarkId))
  .map((r: any) => ({ ...r }));

test('editing a value adds exactly one history row, holding the row as it was', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { our_value: '22 months', peer_sample_size: 8 });
  assert.equal(r.status, 200);
  const rows = history(db);
  assert.equal(rows.length, 1);
  const [h] = rows;
  assert.equal(h.benchmark_id, 1);
  assert.equal(h.owner_user_id, OWNER);
  assert.deepEqual(
    [h.metric, h.our_value, h.peer_value, h.peer_source, h.peer_sample_size, h.peer_as_of, h.reading],
    ['Months of runway at close', '20 months', '18 months', 'Peer survey B', 6, '2026 Q2', 'Early read'],
  );
  assert.match(h.changed_at, /^\d{4}-\d{2}-\d{2}T/);
  // The row itself carries the new values, and the change is the update's own moment.
  const now: any = db.prepare('SELECT our_value, peer_sample_size, updated_at FROM research_benchmarks WHERE id = 1').get();
  assert.equal(now.our_value, '22 months');
  assert.equal(now.peer_sample_size, 8);
  assert.equal(h.changed_at, now.updated_at);
  // The response carries it.
  assert.equal(r.body.history.length, 1);
  assert.equal(r.body.history[0].our_value, '20 months');
  assert.equal(r.body.history[0].peer_sample_size, 6);
  assert.equal(r.body.history[0].changed_at, h.changed_at);
});

test('a save that changes nothing adds no history row', async () => {
  const db = freshDb();
  const same = {
    metric: 'Months of runway at close', our_value: '20 months', peer_value: '18 months',
    peer_source: 'Peer survey B', peer_sample_size: 6, peer_as_of: '2026 Q2', reading: 'Early read',
  };
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', same)).status, 200);
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', {})).status, 200);
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { reading: 'Early read' })).status, 200);
  // A blank sent for a field already blank is no change either.
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-also-mine', { peer_value: '', reading: null })).status, 200);
  assert.deepEqual(history(db), []);
});

test('each change of any of the six fields or the reading is its own row, read newest first', async () => {
  const db = freshDb();
  const edits = [
    { metric: 'Runway at close' },
    { peer_value: '17 months' },
    { peer_source: 'Peer survey C' },
    { peer_as_of: '2026 Q3' },
    { reading: 'Later read' },
  ];
  for (const e of edits) assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', e)).status, 200);
  assert.equal(history(db, 1).length, edits.length);
  const r = await call(db, OWNER, 'GET', '/benchmarks/b-mine');
  assert.equal(r.status, 200);
  const h = r.body.history;
  assert.equal(h.length, edits.length);
  // Newest first: the last snapshot is the row just before the reading changed.
  assert.equal(h[0].reading, 'Early read');
  assert.equal(h[0].peer_as_of, '2026 Q3');
  assert.equal(h[h.length - 1].metric, 'Months of runway at close');
  for (let i = 1; i < h.length; i += 1) assert.ok(h[i - 1].changed_at >= h[i].changed_at);
  assert.deepEqual(Object.keys(h[0]).sort(), [
    'changed_at', 'metric', 'our_value', 'peer_as_of', 'peer_sample_size', 'peer_source', 'peer_value', 'reading',
  ]);
});

test('a refused edit keeps nothing, and another owner’s benchmark is not found and gains no history', async () => {
  const db = freshDb();
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { peer_source: null })).status, 400);
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-theirs', { our_value: '9x' })).status, 404);
  assert.deepEqual(history(db), []);
});

test('history is read owner-scoped: a row filed under another owner is never shown', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO research_benchmark_history (benchmark_id, owner_user_id, metric, our_value, changed_at)
              VALUES (1, ?, 'Forged', '99x', '2026-10-01T00:00:00.000Z')`).run(OTHER);
  const r = await call(db, OWNER, 'GET', '/benchmarks/b-mine');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.history, []);
  await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { our_value: '21 months' });
  const again = await call(db, OWNER, 'GET', '/benchmarks/b-mine');
  assert.deepEqual(again.body.history.map((h: any) => h.our_value), ['20 months']);
});

test('deleting a benchmark removes its own history and no other', async () => {
  const db = freshDb();
  await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { our_value: '21 months' });
  await call(db, OWNER, 'PATCH', '/benchmarks/b-also-mine', { our_value: '1.5x' });
  await call(db, OTHER, 'PATCH', '/benchmarks/b-theirs', { our_value: '0.4x' });
  // A row another owner filed under this benchmark's id is not the caller's to remove.
  db.prepare(`INSERT INTO research_benchmark_history (benchmark_id, owner_user_id, metric, changed_at)
              VALUES (1, ?, 'Forged', '2026-10-01T00:00:00.000Z')`).run(OTHER);
  assert.equal((await call(db, OWNER, 'DELETE', '/benchmarks/b-mine')).status, 200);
  assert.deepEqual(history(db).map((h: any) => [h.benchmark_id, h.owner_user_id]), [[2, OWNER], [3, OTHER], [1, OTHER]]);
});

test('the snapshot and the update land together: an update that fails keeps no history', async () => {
  const db = freshDb();
  db.exec(`CREATE TRIGGER refuse_update BEFORE UPDATE ON research_benchmarks
           BEGIN SELECT RAISE(ABORT, 'fixture: update refused'); END;`);
  const r = await call(db, OWNER, 'PATCH', '/benchmarks/b-mine', { our_value: '22 months' });
  assert.equal(r.status, 500);
  assert.deepEqual(history(db), []);
});

test('a history that cannot be read is null, and the benchmark and its constituents still load', async () => {
  const db = freshDb();
  const d1: any = d1Over(db);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => {
    if (/FROM research_benchmark_history/.test(sql)) throw new Error('fixture: history unreadable');
    return prepare(sql);
  };
  const r = await call(db, OWNER, 'GET', '/benchmarks/b-mine', undefined, d1);
  assert.equal(r.status, 200);
  assert.equal(r.body.history, null);
  assert.equal(r.body.item.metric, 'Months of runway at close');
  assert.deepEqual(r.body.constituents, []);
});
