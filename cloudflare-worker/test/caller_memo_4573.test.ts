/**
 * #4573 H1 — the caller is resolved once per request (auth.ts `getCurrentUser`).
 *
 * A route over the real migrated schema (node:sqlite) asks for its caller
 * several times in one request, through `getCurrentUser`, `requireAuth` and
 * `requireAdmin`, and every statement is counted:
 *   1. one request reads the caller's rows once, however many times it asks;
 *   2. each caller gets its own copy: editing one changes no other;
 *   3. the memo lives for one request only: a session deactivated between two
 *      requests is refused on the next one;
 *   4. a null answer is not kept: the next call in the same request resolves again;
 *   5. `forgetCurrentUser` makes the next call in the request read the caller again.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/caller_memo_4573.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { forgetCurrentUser, getCurrentUser, requireAdmin, requireAuth } from '../src/auth.ts';

const JWT_SECRET = 'synthetic-4573-h1-only-not-a-real-credential'.repeat(2);
const USER_READ = 'SELECT * FROM users WHERE id = ?';

let scratch: string;
let db: DatabaseSync;
let log: string[] = [];
let env: any;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'caller-memo-4573-'));
  db = new DatabaseSync(join(scratch, 'case.sqlite'), { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  loadSchema(db);
  db.prepare('INSERT INTO users(id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(1, 'admin', 'Synthetic admin', 'synthetic-h1-1@example.invalid');
  db.prepare('INSERT INTO users(id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(2, 'founder', 'Synthetic founder', 'synthetic-h1-2@example.invalid');
  const real: any = d1Over(db);
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...a: any[]) => wrap(stmt.bind(...a), sql),
    first: (...a: any[]) => { log.push(sql.replace(/\s+/g, ' ').trim()); return stmt.first(...a); },
    all: (...a: any[]) => { log.push(sql.replace(/\s+/g, ' ').trim()); return stmt.all(...a); },
    run: (...a: any[]) => { log.push(sql.replace(/\s+/g, ' ').trim()); return stmt.run(...a); },
    raw: (...a: any[]) => { log.push(sql.replace(/\s+/g, ' ').trim()); return stmt.raw(...a); },
  });
  env = { DB: { ...real, prepare: (sql: string) => wrap(real.prepare(sql), sql) }, JWT_SECRET, ENVIRONMENT: 'development' };
});
after(() => { db?.close(); rmSync(scratch, { recursive: true, force: true }); });

const tokenOf = (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

async function call(app: Hono<any>, who: number) {
  log = [];
  const res = await app.fetch(new Request('https://axal.vc/t', { headers: { Authorization: `Bearer ${await tokenOf(who)}` } }), env);
  const reads = log.filter((s) => s === USER_READ).length;
  return { status: res.status, body: await res.json() as any, reads };
}

test('1. one request reads its caller once, however many times it asks', async () => {
  // Mutation checked: getCurrentUser calling resolveCurrentUser directly (no memo) → 4 reads.
  const app = new Hono<any>();
  app.get('/t', async (c) => {
    const a = await getCurrentUser(c);
    const b = await requireAuth(c);
    const d = await requireAdmin(c);
    const e = await getCurrentUser(c);
    return c.json({ ids: [a?.id, b.id, d.id, e?.id] });
  });
  const r = await call(app, 1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.ids, [1, 1, 1, 1]);
  assert.equal(r.reads, 1, 'the user row is read once');
});

test('2. each caller gets its own copy: editing one changes no other', async () => {
  // Mutation checked: returning the memoized object itself → the second read sees role "admin" and the extra licence.
  const app = new Hono<any>();
  app.get('/t', async (c) => {
    const a = (await getCurrentUser(c))!;
    a.role = 'admin' as any;
    (a.licences ??= []).push('investor' as any);
    const b = (await getCurrentUser(c))!;
    return c.json({ role: b.role, licences: b.licences ?? [] });
  });
  const r = await call(app, 2);
  assert.equal(r.body.role, 'founder');
  assert.ok(!r.body.licences.includes('investor'), JSON.stringify(r.body.licences));
});

test('3. the memo lives for one request: a member deactivated between requests is refused on the next', async () => {
  // Mutation checked: the memo keyed on the token alone, held at module level → the second request answers the stale user.
  const app = new Hono<any>();
  app.get('/t', async (c) => c.json({ id: (await getCurrentUser(c))?.id ?? null }));
  assert.deepEqual((await call(app, 2)).body, { id: 2 });
  db.prepare('UPDATE users SET is_active = 0 WHERE id = 2').run();
  try {
    const r = await call(app, 2);
    assert.deepEqual(r.body, { id: null });
    assert.equal(r.reads, 1, 'the second request read the caller again');
  } finally { db.prepare('UPDATE users SET is_active = 1 WHERE id = 2').run(); }
});

test('4. a null answer is not kept: the next call in the same request resolves again', async () => {
  // Mutation checked: keeping every answer (null included) → the second call stays null.
  db.prepare('UPDATE users SET is_active = 0 WHERE id = 2').run();
  const app = new Hono<any>();
  app.get('/t', async (c) => {
    const first = await getCurrentUser(c);
    db.prepare('UPDATE users SET is_active = 1 WHERE id = 2').run();
    const second = await getCurrentUser(c);
    return c.json({ first: first?.id ?? null, second: second?.id ?? null });
  });
  try {
    const r = await call(app, 2);
    assert.deepEqual(r.body, { first: null, second: 2 });
    assert.equal(r.reads, 2);
  } finally { db.prepare('UPDATE users SET is_active = 1 WHERE id = 2').run(); }
});

test('5. forgetCurrentUser makes the next call in the request read the caller again', async () => {
  // Mutation checked: forgetCurrentUser a no-op → the deactivated member is still answered, from one read.
  const app = new Hono<any>();
  app.get('/t', async (c) => {
    const before = await getCurrentUser(c);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = 2').run();
    const memo = await getCurrentUser(c);
    forgetCurrentUser(c);
    const fresh = await getCurrentUser(c);
    return c.json({ before: before?.id ?? null, memo: memo?.id ?? null, fresh: fresh?.id ?? null });
  });
  try {
    const r = await call(app, 2);
    assert.deepEqual(r.body, { before: 2, memo: 2, fresh: null });
    assert.equal(r.reads, 2);
  } finally { db.prepare('UPDATE users SET is_active = 1 WHERE id = 2').run(); }
});
