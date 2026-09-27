/**
 * D314 — one benchmark by uid, its edit re-validated against migration 217's
 * CHECK, and its named constituents (migration 303). Real SQLite: both tables
 * are cut from their migrations, so the route's own SQL — and the schema's own
 * constraints — decide every outcome.
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 1;
const OTHER = 2;

/** The CREATE TABLE for `table`, cut from the migration numbered `prefix`. */
function tableFrom(prefix: string, table: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string;
  const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `migration ${prefix} no longer declares ${table}`);
  return stripForeignKeys(sql.slice(start, sql.indexOf('\n);', start) + 3));
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
  );`);
  db.exec(tableFrom('217', 'research_benchmarks'));
  db.exec(tableFrom('303', 'research_benchmark_constituents'));
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(OWNER, 'investor');
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(OTHER, 'investor');
  const b = db.prepare(
    `INSERT INTO research_benchmarks (id, uid, owner_user_id, metric, our_value, peer_value, peer_source, peer_sample_size, peer_as_of, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z')`,
  );
  b.run(1, 'b-thin', OWNER, 'TVPI', '1.4x', '1.2x', 'Four funds, internal set', 4, '2026 Q2');
  b.run(2, 'b-tracked', OWNER, 'Time to first close', null, null, null, null, null);
  b.run(3, 'b-theirs', OTHER, 'DPI', '0.3x', '0.5x', 'Private set', 5, null);
  b.run(4, 'b-wide', OWNER, 'IRR', '24%', '19%', 'Published cohort table', 400, '2026 Q1');
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, userId: number, method: string, path: string, body?: any) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(userId)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await research.fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const row = (db: any, uid: string) => ({ ...(db.prepare('SELECT * FROM research_benchmarks WHERE uid = ?').get(uid) as any) });
const constituents = (db: any, id: number) =>
  db.prepare('SELECT name, value, as_of, position FROM research_benchmark_constituents WHERE benchmark_id = ? ORDER BY position').all(id)
    .map((r: any) => ({ ...r }));

test('one benchmark reads by uid, and another owner’s answers exactly like a missing one', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, 'GET', '/benchmarks/b-thin');
  assert.equal(r.status, 200);
  assert.equal(r.body.item.metric, 'TVPI');
  assert.equal(r.body.item.is_comparison, true);
  assert.equal(r.body.item.updated_at, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(r.body.constituents, []);

  const theirs = await call(db, OWNER, 'GET', '/benchmarks/b-theirs');
  const missing = await call(db, OWNER, 'GET', '/benchmarks/b-nothing');
  assert.equal(theirs.status, 404);
  assert.deepEqual(theirs.body, missing.body, 'another owner’s benchmark was distinguishable from a missing one');
  assert.equal(theirs.body.error, 'benchmark_not_found');
});

test('the thin-base note is this row’s own n, and a wide or tracked row has none', async () => {
  const db = freshDb();
  const thin = (await call(db, OWNER, 'GET', '/benchmarks/b-thin')).body;
  assert.equal(thin.thin, true);
  assert.match(thin.sample_note, /smallest peer set behind this comparison is 4/);
  const wide = (await call(db, OWNER, 'GET', '/benchmarks/b-wide')).body;
  assert.equal(wide.thin, false);
  assert.equal(wide.sample_note, null);
  const tracked = (await call(db, OWNER, 'GET', '/benchmarks/b-tracked')).body;
  assert.equal(tracked.item.is_comparison, false);
  assert.equal(tracked.thin, false);
});

test('an edit is merged onto the row and the merged row must carry its base', async () => {
  const db = freshDb();
  // A peer figure arriving alone on a tracked row: refused, row untouched.
  const alone = await call(db, OWNER, 'PATCH', '/benchmarks/b-tracked', { peer_value: '0.5x' });
  assert.equal(alone.status, 400);
  assert.equal(alone.body.error, 'peer_base_required');
  assert.equal(row(db, 'b-tracked').peer_value, null);
  // Removing the source from a comparison: the merged row would break 217's CHECK.
  const stripped = await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { peer_source: '' });
  assert.equal(stripped.status, 400);
  assert.equal(row(db, 'b-thin').peer_source, 'Four funds, internal set');
  // A full base is accepted, and only the fields sent change.
  const ok = await call(db, OWNER, 'PATCH', '/benchmarks/b-tracked',
    { peer_value: '45 days', peer_source: 'Eight funds I spoke to', peer_sample_size: 8 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.item.is_comparison, true);
  assert.equal(row(db, 'b-tracked').metric, 'Time to first close');
  assert.notEqual(row(db, 'b-tracked').updated_at, '2026-09-01T00:00:00.000Z');
  // A reading is written by itself.
  await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { reading: 'One re-mark carries it.' });
  assert.equal(row(db, 'b-thin').reading, 'One re-mark carries it.');
  assert.equal(row(db, 'b-thin').peer_value, '1.2x');
  // And an edit that does not send the reading leaves it where it was — the
  // editor saves the six fields without it.
  await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { our_value: '1.5x' });
  assert.equal(row(db, 'b-thin').reading, 'One re-mark carries it.', 'an edit that did not send the reading erased it');
  assert.equal(row(db, 'b-thin').our_value, '1.5x');
});

test('an edit refuses a blank metric, a sample under 1, and a row that is not the caller’s', async () => {
  const db = freshDb();
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { metric: '  ' })).body.error, 'metric_required');
  assert.equal((await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { peer_sample_size: 0 })).body.error, 'sample_size_invalid');
  const theirs = await call(db, OWNER, 'PATCH', '/benchmarks/b-theirs', { reading: 'mine now' });
  assert.equal(theirs.status, 404);
  assert.equal(row(db, 'b-theirs').reading, null);
});

test('a constituent joins a comparison in order, never a tracked row, and needs a name', async () => {
  const db = freshDb();
  const tracked = await call(db, OWNER, 'POST', '/benchmarks/b-tracked/constituents', { name: 'Fund A' });
  assert.equal(tracked.status, 409);
  assert.equal(tracked.body.error, 'not_a_comparison');
  assert.equal((await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: '  ' })).body.error,
    'constituent_name_required');
  await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'Fund A', value: '0.6x', as_of: '2026 Q1' });
  const r = await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'Fund B' });
  assert.equal(r.status, 201);
  assert.deepEqual(constituents(db, 1), [
    { name: 'Fund A', value: '0.6x', as_of: '2026 Q1', position: 0 },
    { name: 'Fund B', value: null, as_of: null, position: 1 },
  ]);
  assert.equal((await call(db, OWNER, 'POST', '/benchmarks/b-theirs/constituents', { name: 'X' })).status, 404);
  assert.equal(constituents(db, 3).length, 0);
});

test('a count that disagrees with n is stated and the stored sample is left alone', async () => {
  const db = freshDb();
  for (const name of ['A', 'B', 'C']) await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name });
  const r = (await call(db, OWNER, 'GET', '/benchmarks/b-thin')).body;
  assert.equal(r.count_mismatch, true);
  assert.equal(r.mismatch_note, '3 constituents are named against a stored sample of 4.');
  assert.equal(row(db, 'b-thin').peer_sample_size, 4, 'the sample was rewritten to match the list');
  await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'D' });
  assert.equal((await call(db, OWNER, 'GET', '/benchmarks/b-thin')).body.count_mismatch, false);
});

test('the peer figure cannot be cleared under named constituents', async () => {
  const db = freshDb();
  await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'Fund A' });
  const r = await call(db, OWNER, 'PATCH', '/benchmarks/b-thin', { peer_value: '', peer_source: '', peer_sample_size: null });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'constituents_exist');
  assert.equal(row(db, 'b-thin').peer_value, '1.2x');
  // With none named, clearing is allowed and the row goes back to tracked.
  const wide = await call(db, OWNER, 'PATCH', '/benchmarks/b-wide', { peer_value: '', peer_source: '', peer_sample_size: null });
  assert.equal(wide.status, 200);
  assert.equal(wide.body.item.is_comparison, false);
});

test('a constituent is removed only from its own benchmark, and a deleted benchmark takes its constituents', async () => {
  const db = freshDb();
  const added = (await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'Fund A' })).body;
  const cuid = added.constituents[0].uid;
  assert.equal((await call(db, OWNER, 'DELETE', `/benchmarks/b-wide/constituents/${cuid}`)).status, 404);
  assert.equal((await call(db, OTHER, 'DELETE', `/benchmarks/b-thin/constituents/${cuid}`)).status, 404);
  assert.equal(constituents(db, 1).length, 1);
  const removed = await call(db, OWNER, 'DELETE', `/benchmarks/b-thin/constituents/${cuid}`);
  assert.equal(removed.status, 200);
  assert.equal(constituents(db, 1).length, 0);

  await call(db, OWNER, 'POST', '/benchmarks/b-thin/constituents', { name: 'Fund B' });
  assert.equal((await call(db, OWNER, 'DELETE', '/benchmarks/b-thin')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_benchmark_constituents').get().n, 0,
    'the benchmark’s constituents outlived it');
});

test('the schema itself refuses a constituent with no name', () => {
  const db = freshDb();
  assert.throws(() => db.prepare(
    `INSERT INTO research_benchmark_constituents (uid, benchmark_id, owner_user_id, name) VALUES ('c', 1, 1, '   ')`,
  ).run(), /CHECK/);
});
