/**
 * #4708 part 2 (D4708-p2) — request-scoped authentication on `/api/admin/security/*`, pinned as a regression
 * gate. Measured for this package: the caller (the user row, its side tables, the elevation and the session
 * standing) is resolved once per request and reused by every gate in it (#4573 H1, `getCurrentUser`); the
 * write bar's own checks (how the session was minted, the recent step-up) each read the session store on every
 * write; and nothing is reused from one request to the next. Part 2 found no further repeat to remove, so this
 * file holds what is there:
 *
 *   · a read (`/overview`, `/governance`, `/sessions`) resolves the caller once;
 *   · a write resolves the caller once and still runs each fresh check against the store;
 *   · a second request resolves the caller again, and a step-up that has aged out is refused on the next write.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_security_request_auth_4708.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import security from '../src/routes/admin_security.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 4708;
const JTI = 'jti-4708-super';

async function freshDb() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  await loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Synthetic Super', 'super@example.invalid', 1)").run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  // The write bar wants a TOTP-minted session with a recent step-up.
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(JTI, SUPER);
  return db;
}

/** The statements that resolve the caller, and the write bar's fresh checks, by what they read. */
const CALLER = /^SELECT \* FROM users WHERE id = \?$/;
const ELEVATION = /\bFROM super_admins WHERE user_id = \?/;
const STANDING = /^SELECT revoked_at(, step_up_due_at)? FROM user_sessions WHERE jti = \?/;
const MINTED_BY = /^SELECT factor FROM user_sessions WHERE jti = \? AND user_id = \?$/;
const STEPPED_UP = /^SELECT factor, created_at(, last_step_up_at)? FROM user_sessions WHERE jti = \?/;

function app() {
  const a = new Hono();
  a.route('/', security);
  // The worker's own mapping (index.ts), so a refused gate is its status here as it is in production.
  a.onError((err: any, c) => {
    const msg = String(err?.message ?? '');
    if (msg === 'step_up_required') return c.json({ detail: msg }, 403);
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[msg];
    if (mapped) return c.json({ detail: msg }, mapped as 401 | 403);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
}

async function call(db: any, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin', jti: JTI })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const base = d1Over(db);
  const statements: string[] = [];
  const DB = { ...base, prepare(sql: string) { statements.push(sql.replace(/\s+/g, ' ').trim()); return base.prepare(sql); } };
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app().fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB } as any,
  );
  const count = (re: RegExp) => statements.filter((s) => re.test(s)).length;
  return { status: res.status, body: await res.json().catch(() => ({})) as any, count };
}

const WRITE = ['POST', '/dsr/999999/close', { outcome: 'not-an-outcome', reason: 'Synthetic reason for the fixture' }] as const;

test('a read resolves the caller once, however many gates and helpers ask', async () => {
  const db = await freshDb();
  for (const path of ['/overview', '/governance', '/sessions']) {
    const r = await call(db, 'GET', path);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.equal(r.count(CALLER), 1, `${path}: the caller's row was read ${r.count(CALLER)} times`);
    assert.equal(r.count(ELEVATION), 1, `${path}: the elevation was read ${r.count(ELEVATION)} times`);
    assert.equal(r.count(STANDING), 1, `${path}: the session standing was read ${r.count(STANDING)} times`);
  }
});

test('a write resolves the caller once and still runs each fresh check against the store', async () => {
  const db = await freshDb();
  const r = await call(db, ...WRITE);
  // Past the bar: the handler's own refusal of the body, not a gate's.
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'invalid_outcome');
  assert.equal(r.count(CALLER), 1, `the caller's row was read ${r.count(CALLER)} times across the bar's three gates`);
  assert.equal(r.count(ELEVATION), 1);
  assert.equal(r.count(MINTED_BY), 1, 'how the session was minted was not read for this write');
  assert.equal(r.count(STEPPED_UP), 1, 'the step-up was not read for this write');
  // Mutation checked (#4708 part 2): without the per-request caller memo (`getCurrentUser`), the bar's three
  // gates read the caller three times and this fails; skipping the step-up read fails the count above.
});

test('nothing is reused across requests: the caller is resolved again, and an aged-out step-up is refused', async () => {
  const db = await freshDb();
  const first = await call(db, ...WRITE);
  assert.equal(first.status, 400);
  const second = await call(db, 'GET', '/governance');
  assert.equal(second.count(CALLER), 1, 'the second request reused the first one\'s caller');
  // The step-up ages out between two writes: the next write reads it again and is refused.
  db.prepare(`UPDATE user_sessions SET created_at = datetime('now', '-2 hours'), last_step_up_at = datetime('now', '-2 hours') WHERE jti = ?`).run(JTI);
  const third = await call(db, ...WRITE);
  assert.equal(third.status, 403, JSON.stringify(third.body));
  assert.equal(third.body.detail, 'step_up_required');
});
