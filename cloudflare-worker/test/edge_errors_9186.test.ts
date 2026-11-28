// D9186 (#9186): the global error handler answers the errors it understands
// with their own status, and its log line names the route without private data.
//
//   · an oversized body answers 413 (RL-05): the Meta deletion callback through
//     the real Worker, and a bodyLimit with no onError through the fallback;
//   · a Super Admin setting consent for an unknown user id answers 404 (RL-10);
//   · a UNIQUE or FOREIGN KEY failure answers 409 with no SQL text (RL-12);
//   · `edge_unhandled` carries method, route pattern and a fixed D1 class,
//     never the message or a path id;
//   · every `bodyLimit(` in src/routes passes `onError`.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/edge_errors_9186.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { edgeFallback } from '../src/util/edgeError.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd9186-edge-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const SUPER = 30;
const UNKNOWN = 999999999;

let db: any, env: any, superToken = '';

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active,subscription_tier,subscription_status) VALUES
    (${SUPER},'u-super','Super','super@example.invalid','admin',1,'studio','active');
    INSERT INTO super_admins(user_id) VALUES (${SUPER});`);
  env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() };
  superToken = await new SignJWT({ user_id: SUPER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));
});
after(() => { db?.close(); removeMigratedDatabases(); });

function capture() {
  const original = console.error, records: unknown[][] = [];
  console.error = (...args: unknown[]) => { records.push(args); };
  return { records, restore: () => { console.error = original; } };
}

test('a 20 KB POST to the public Meta data-deletion callback answers 413, not 500', async () => {
  const res = await worker.fetch(new Request('https://unit.test/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `signed_request=${'a'.repeat(20 * 1024)}`,
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  assert.equal(res.status, 413);
  const body: any = await res.json();
  assert.equal(body.error, 'payload_too_large');
});

test('a Super Admin setting consent for an unknown user id gets 404 and no row is written', async () => {
  const put = (uid: number) => worker.fetch(new Request(`https://unit.test/api/admin/telegram/consent/${uid}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ consented: true }),
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  const missing = await put(UNKNOWN);
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as any).error, 'user_not_found');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_promotion_consent WHERE user_id = ?').get(UNKNOWN).n, 0);
  // The Super Admin still reaches a real user: the check refuses only the unknown id.
  const known = await put(SUPER);
  assert.equal(known.status, 200);
  assert.equal(db.prepare('SELECT consented FROM user_promotion_consent WHERE user_id = ?').get(SUPER).consented, 1);
});

/** Real SQLite failures, so the fallback reads the text D1 actually produces. */
function sqliteError(kind: 'unique' | 'foreign'): Error {
  const s = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  s.exec('CREATE TABLE parent_9186 (id INTEGER PRIMARY KEY, secret_col_9186 TEXT UNIQUE); CREATE TABLE child_9186 (pid INTEGER REFERENCES parent_9186(id));');
  s.exec("INSERT INTO parent_9186 VALUES (1, 'x')");
  try {
    s.exec(kind === 'unique' ? "INSERT INTO parent_9186 VALUES (2, 'x')" : 'INSERT INTO child_9186 VALUES (424242)');
  } catch (e) { return e as Error; } finally { s.close(); }
  throw new Error('the statement did not fail');
}

function fallbackApp(thrown: () => unknown) {
  const sub = new Hono();
  sub.get('/things/:id', () => { throw thrown(); });
  sub.post('/upload', bodyLimit({ maxSize: 10 }), c => c.json({ ok: true }));
  const app = new Hono();
  app.route('/api/fixture', sub);
  app.onError((err, c) => edgeFallback(c, err));
  return app;
}

test('a handler that throws a UNIQUE or FOREIGN KEY failure answers 409 with no SQL text', async () => {
  for (const [kind, code] of [['unique', 'already_exists'], ['foreign', 'related_record_conflict']] as const) {
    const err = sqliteError(kind);
    const log = capture();
    let res: Response;
    try { res = await fallbackApp(() => err).request('/api/fixture/things/12345'); } finally { log.restore(); }
    assert.equal(res.status, 409, kind);
    const text = await res.text();
    assert.equal(JSON.parse(text).error, code);
    assert.doesNotMatch(text, /constraint|parent_9186|child_9186|secret_col_9186|SQLITE|INSERT/i, kind);
  }
  const plain = capture();
  let res: Response;
  try { res = await fallbackApp(() => new Error('synthetic failure 9186')).request('/api/fixture/things/12345'); } finally { plain.restore(); }
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { detail: 'Internal server error' });
});

test('an HTTPException is its own answer: a bodyLimit with no onError answers 413 through the fallback', async () => {
  const res = await fallbackApp(() => new Error('unused')).request('/api/fixture/upload', { method: 'POST', body: 'x'.repeat(64) });
  assert.equal(res.status, 413);
});

test('the edge_unhandled line carries method, route pattern and D1 class, never the message or a path id', async () => {
  const err = sqliteError('unique');
  err.message = `${err.message} synthetic-private-9186`;
  const log = capture();
  try { await fallbackApp(() => err).request('/api/fixture/things/12345'); } finally { log.restore(); }
  assert.equal(log.records.length, 1);
  const line = String(log.records[0][1]);
  assert.deepEqual(JSON.parse(line), { event: 'edge_unhandled', method: 'GET', route: '/api/fixture/things/:id', kind: 'error', code: 'sqlite_constraint_unique' });
  assert.doesNotMatch(line, /12345|synthetic-private-9186|secret_col_9186|parent_9186/);
});

test('every bodyLimit( call in src/routes passes onError', () => {
  const dir = fileURLToPath(new URL('../src/routes', import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p); } };
  walk(dir);
  const missing: string[] = [];
  let calls = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bbodyLimit\(/g)) {
      // The call's own argument text, up to its closing parenthesis.
      let depth = 0, end = m.index! + m[0].length - 1;
      for (; end < src.length; end++) { if (src[end] === '(') depth++; else if (src[end] === ')' && --depth === 0) break; }
      calls++;
      if (!/\bonError\s*:/.test(src.slice(m.index!, end))) missing.push(`${file.slice(dir.length + 1)}:${src.slice(0, m.index!).split('\n').length}`);
    }
  }
  assert.ok(calls >= 8, `only ${calls} bodyLimit calls were read`);
  assert.deepEqual(missing, [], 'a bodyLimit without onError lets Hono throw HTTPException(413)');
});
