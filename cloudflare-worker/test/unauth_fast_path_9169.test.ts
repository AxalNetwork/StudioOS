/**
 * D9169 (#9169) — a CORS preflight and a request that carries no credential
 * skip the role-schema bootstrap, and every /api response says where its time
 * went in `Server-Timing`.
 *
 * Through the real Worker entry (`src/index.ts`, every middleware) over the
 * migrated schema in node:sqlite. Each request gets a NEW D1 binding over the
 * same database, which is what a cold isolate is to the bootstrap's
 * per-binding readiness latch, so every request here would pay the bootstrap
 * if the entry let it. The binding records every statement: the bootstrap's
 * footprint is DDL (`CREATE`/`ALTER`/`DROP`) and `UPDATE users`.
 *
 *   · OPTIONS /api/auth/me from the SPA's origin: 204, no DDL, no UPDATE users;
 *   · GET /api/account/invitations with no credential: 401, the same;
 *   · GET of an unknown /api path with no credential: 404, the same;
 *   · a cookie that is not the session cookie is no credential;
 *   · the same GET signed in (Bearer, and the `studioos_auth` cookie) still
 *     runs the bootstrap and is answered as before;
 *   · each response carries `Server-Timing` with the three phases, by name,
 *     with no path, user or token in it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/unauth_fast_path_9169.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-9169-only-not-a-real-credential'.repeat(2);
const BOOTSTRAP_SQL = /^\s*(?:CREATE|ALTER|DROP)\b|^\s*UPDATE\s+users\b/i;
const PHASES = /^bootstrap;dur=(?:\d+\.\d|0;desc="skipped"), ratelimit;dur=(?:\d+\.\d|0;desc="skipped"), auth;dur=(?:\d+\.\d|0;desc="skipped")$/;

let db: DatabaseSync;
let worker: any;
let token: string;
const realFetch = globalThis.fetch;

before(async () => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  loadSchema(db);
  db.prepare('INSERT INTO users(id, role, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, 1, ?)')
    .run(2, 'founder', 'Synthetic member 2', 'synthetic-2@example.invalid', 'studio');
  worker = (await import('../src/index.ts')).default;
  token = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
});
after(() => { globalThis.fetch = realFetch; db.close(); });

/** A fresh binding over `db` (a cold isolate) that records each statement it runs. */
function coldBinding(log: string[]) {
  const real: any = d1Over(db);
  const note = (sql: string) => { log.push(sql.replace(/\s+/g, ' ').trim()); };
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: any[]) => wrap(stmt.bind(...args), sql),
    first: (...a: any[]) => { note(sql); return stmt.first(...a); },
    all: (...a: any[]) => { note(sql); return stmt.all(...a); },
    run: (...a: any[]) => { note(sql); return stmt.run(...a); },
    raw: (...a: any[]) => { note(sql); return stmt.raw(...a); },
    __inner: stmt,
    __sql: sql,
  });
  return {
    ...real,
    prepare: (sql: string) => wrap(real.prepare(sql), sql),
    batch: (stmts: any[]) => { for (const s of stmts) note(s.__sql ?? 'batch'); return real.batch(stmts.map((s) => s.__inner ?? s)); },
    exec: (sql: string) => { note(sql); return real.exec(sql); },
  };
}

async function send(path: string, init: RequestInit = {}) {
  const log: string[] = [];
  const env: any = { DB: coldBinding(log), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() };
  const pending: Promise<unknown>[] = [];
  const ctx: any = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} };
  const quiet = [console.log, console.info, console.warn, console.error];
  console.log = console.info = console.warn = console.error = () => {};
  try {
    const res: Response = await worker.fetch(new Request(`https://axal.vc${path}`, init), env, ctx);
    await res.arrayBuffer();
    await Promise.allSettled(pending);
    return { status: res.status, timing: res.headers.get('server-timing'), bootstrap: log.filter((s) => BOOTSTRAP_SQL.test(s)) };
  } finally {
    [console.log, console.info, console.warn, console.error] = quiet;
  }
}

test('a CORS preflight runs no DDL and no UPDATE users, answers 204, and says every phase was skipped', async () => {
  const r = await send('/api/auth/me', {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.axal.vc', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(r.status, 204);
  assert.deepEqual(r.bootstrap, []);
  // The CORS middleware answers before the limiter, so nothing was measured.
  assert.equal(r.timing, 'bootstrap;dur=0;desc="skipped", ratelimit;dur=0;desc="skipped", auth;dur=0;desc="skipped"');
  // A browser sends no credential on a preflight; a client that does still gets no bootstrap for one.
  const withCookie = await send('/api/auth/me', {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.axal.vc', 'Access-Control-Request-Method': 'GET', Cookie: `studioos_auth=${token}` },
  });
  assert.equal(withCookie.status, 204);
  assert.deepEqual(withCookie.bootstrap, [], 'a preflight never bootstraps');
});

test('an unauthenticated GET to a protected route runs no DDL and no UPDATE users and is still a 401', async () => {
  const r = await send('/api/account/invitations');
  assert.equal(r.status, 401);
  assert.deepEqual(r.bootstrap, []);
  assert.match(r.timing ?? '', PHASES);
  assert.match(r.timing ?? '', /^bootstrap;dur=0;desc="skipped", ratelimit;dur=\d+\.\d, auth;dur=\d+\.\d$/);
});

test('an unauthenticated GET to an unknown /api path runs no DDL and is still a 404', async () => {
  const r = await send('/api/no-such-route-9169');
  assert.equal(r.status, 404);
  assert.deepEqual(r.bootstrap, []);
  assert.match(r.timing ?? '', /^bootstrap;dur=0;desc="skipped", /);
});

test('a cookie that is not the session cookie is no credential', async () => {
  const r = await send('/api/account/invitations', { headers: { Cookie: 'studioos_csrf=x; studioos_authx=y' } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.bootstrap, []);
});

test('a signed-in request still runs the bootstrap, by Bearer and by the session cookie, and is answered as before', async () => {
  for (const headers of [{ Authorization: `Bearer ${token}` }, { Cookie: `studioos_csrf=x; studioos_auth=${token}` }]) {
    const r = await send('/api/account/invitations', { headers });
    assert.equal(r.status, 200, JSON.stringify(Object.keys(headers)));
    assert.ok(r.bootstrap.some((s) => /^CREATE TABLE IF NOT EXISTS investors\b/.test(s)), 'the investor bootstrap ran');
    assert.ok(r.bootstrap.some((s) => /^UPDATE users\b/.test(s)), 'the role promotion ran');
    assert.match(r.timing ?? '', /^bootstrap;dur=\d+\.\d, ratelimit;dur=\d+\.\d, auth;dur=\d+\.\d$/);
  }
});

test('an unauthenticated POST no longer pays the bootstrap; a credential that is not a valid session still does', async () => {
  const anonymous = await send('/api/account/invitations', { method: 'POST' });
  assert.deepEqual(anonymous.bootstrap, []);
  const invalid = await send('/api/account/invitations', { headers: { Authorization: 'Bearer not-a-token' } });
  assert.equal(invalid.status, 401);
  assert.ok(invalid.bootstrap.length > 0, 'any Authorization header counts as a credential, valid or not');
  assert.ok(!/not-a-token|invitations|user/i.test(invalid.timing ?? ''), 'Server-Timing names phases only');
  // The WebSocket subprotocol and the `?token=` fallback are credentials too (routes/realtime.ts).
  const subprotocol = await send('/api/account/invitations', { headers: { 'Sec-WebSocket-Protocol': 'bearer.not-a-token' } });
  assert.ok(subprotocol.bootstrap.length > 0, 'a WebSocket subprotocol counts as a credential');
  const query = await send('/api/account/invitations?token=not-a-token');
  assert.ok(query.bootstrap.length > 0, 'a token query parameter counts as a credential');
});
