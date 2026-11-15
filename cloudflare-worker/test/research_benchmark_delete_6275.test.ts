/**
 * D6275 — what `DELETE /api/research/benchmarks/:uid` does, checked before a
 * screen was given a button for it (#6275 said it had not been checked).
 * Real SQLite: both tables are cut from their migrations, and the route's own
 * SQL decides every outcome.
 *
 * - It is owner-scoped: another owner's uid answers 404 and nothing of theirs
 *   is removed.
 * - It removes the benchmark's named constituents, and does so BEFORE the row.
 * - It touches no other benchmark's constituents.
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
    `INSERT INTO research_benchmarks (id, uid, owner_user_id, metric, peer_value, peer_source, peer_sample_size, updated_at)
     VALUES (?, ?, ?, ?, '1.2x', 'Cohort table', 40, '2026-09-01T00:00:00.000Z')`,
  );
  b.run(1, 'b-mine', OWNER, 'TVPI');
  b.run(2, 'b-also-mine', OWNER, 'IRR');
  b.run(3, 'b-theirs', OTHER, 'DPI');
  const c = db.prepare(
    `INSERT INTO research_benchmark_constituents (uid, benchmark_id, owner_user_id, name) VALUES (?, ?, ?, ?)`,
  );
  c.run('c1', 1, OWNER, 'Fund One');
  c.run('c2', 1, OWNER, 'Fund Two');
  c.run('c3', 2, OWNER, 'Fund Three');
  c.run('c4', 3, OTHER, 'Their Fund');
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Calls the router; every statement the route prepares is recorded in `seen`. */
async function call(db: any, userId: number, method: string, path: string, seen: string[] = []) {
  const d1: any = d1Over(db);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => { seen.push(sql.replace(/\s+/g, ' ').trim()); return prepare(sql); };
  const res = await research.fetch(
    new Request(`http://x${path}`, { method, headers: { Authorization: `Bearer ${await token(userId)}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1 } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const benchmarks = (db: any) => db.prepare('SELECT uid FROM research_benchmarks ORDER BY id').all().map((r: any) => r.uid);
const named = (db: any) => db.prepare('SELECT uid FROM research_benchmark_constituents ORDER BY id').all().map((r: any) => r.uid);

test('another owner’s benchmark answers 404 and nothing of theirs is removed', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, 'DELETE', '/benchmarks/b-theirs');
  assert.equal(r.status, 404);
  assert.deepEqual(benchmarks(db), ['b-mine', 'b-also-mine', 'b-theirs']);
  assert.deepEqual(named(db), ['c1', 'c2', 'c3', 'c4']);
  assert.equal((await call(db, OWNER, 'DELETE', '/benchmarks/b-nothing')).status, 404);
});

test('the owner’s delete removes the row and its own constituents, constituents first, and no others', async () => {
  const db = freshDb();
  const seen: string[] = [];
  const r = await call(db, OWNER, 'DELETE', '/benchmarks/b-mine', seen);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(benchmarks(db), ['b-also-mine', 'b-theirs']);
  assert.deepEqual(named(db), ['c3', 'c4'], 'only b-mine’s constituents go');
  const deletes = seen.filter((s) => /^DELETE /.test(s));
  assert.equal(deletes.length, 2);
  assert.match(deletes[0], /^DELETE FROM research_benchmark_constituents WHERE .*owner_user_id = \?/);
  assert.match(deletes[1], /^DELETE FROM research_benchmarks WHERE .*owner_user_id = \?/);
});
