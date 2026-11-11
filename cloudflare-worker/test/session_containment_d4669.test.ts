/**
 * D4669 — session containment: an ended session stops working everywhere,
 * an unreadable session store refuses, request protection follows the
 * credential that actually authenticates, and HQ · Security's emergency acts
 * say what they reached, deployment by deployment.
 *
 * Every assertion runs the real code against a real SQLite database built
 * from schema_baseline.sql and every later migration, and reads its effect
 * back: whether a token still opens a door, whether a row changed.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/session_containment_d4669.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT, decodeJwt } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

import admin from '../src/routes/admin.ts';
import security from '../src/routes/admin_security.ts';
import authRoutes from '../src/routes/auth.ts';
import { authenticateForUpgrade } from '../src/routes/realtime.ts';
import { csrfMiddleware } from '../src/middleware/csrf.ts';
import { requireAuth, sessionStanding } from '../src/auth.ts';
import { endImpersonation } from '../src/services/userSessions.ts';
import { openSupportSession, redeemSupportCode } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BRANCH_NOT_REACHED } from '../src/services/emergencyScope.ts';

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ = 1;        // the Super Admin, the operator
const FOUNDER = 30;  // the account a support session opens on
const OTHER = 31;
const REASON = 'Founder asked for help re-linking their bank account (ticket 5512)';
const SEC_REASON = 'Incident SEC-9: containment drill';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
type DB = ReturnType<typeof buildFresh>;
/** A D1 over the database; `refuse(sql)` makes that statement fail as an unreadable store would. */
function makeD1(db: DB, ctl: { refuse?: (sql: string) => boolean } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const guard = () => { if (ctl.refuse?.(sql)) throw new Error('D1_ERROR: store unavailable (test)'); };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { guard(); return (db.prepare(sql).get(...b) as any) ?? null; },
        async all() { guard(); return { results: db.prepare(sql).all(...b) }; },
        async raw() { guard(); return (db.prepare(sql).all(...b) as any[]).map((r) => Object.values(r)); },
        async run() {
          guard();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const outs: any[] = []; for (const s of stmts) outs.push(await s.run()); return outs; },
  };
}

// The schema is built once and copied per test: building the baseline and
// every migration is the slow part, and each test needs its own database.
const SNAP_DIR = mkdtempSync(join(tmpdir(), 'd4669-'));
const SNAPSHOT = join(SNAP_DIR, 'schema.db');
buildFresh(BASELINE, LATER, { dqs: true }).exec(`VACUUM INTO '${SNAPSHOT}'`);
let copies = 0;
after(() => rmSync(SNAP_DIR, { recursive: true, force: true }));

function freshDb(): DB {
  const path = join(SNAP_DIR, `t${copies++}.db`);
  copyFileSync(SNAPSHOT, path);
  const db = new DatabaseSync(path, { enableDoubleQuotedStringLiterals: true }) as unknown as DB;
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  u.run(FOUNDER, 'founder', 'Fran Founder', 'fran@example.com');
  u.run(OTHER, 'founder', 'Olu Other', 'olu@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-hq', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(HQ);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('pw-founder', ?, 'password', datetime('now'))`,
  ).run(FOUNDER);
  return db;
}

const envOf = (db: DB, ctl: { refuse?: (sql: string) => boolean } = {}, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, ctl), ...extra }) as any;

async function sign(claims: Record<string, unknown>, iat?: number): Promise<string> {
  const j = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h');
  if (iat === undefined) j.setIssuedAt(); else j.setIssuedAt(iat);
  return j.sign(new TextEncoder().encode(JWT_SECRET));
}
const hqToken = () => sign({ user_id: HQ, email: 'hana@axal.example', role: 'admin', jti: 'totp-hq' });

function mapErrors(a: Hono<any>) {
  a.onError((err: any, c) => {
    const msg = String(err?.message ?? '');
    if (msg === 'step_up_required') return c.json({ detail: msg }, 403);
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[msg];
    if (mapped) return c.json({ detail: msg }, mapped as 401 | 403);
    return c.json({ detail: 'Internal server error', msg }, 500);
  });
  return a;
}
function adminApp() { const a = new Hono(); a.route('/', admin); return mapErrors(a); }
function securityApp() { const a = new Hono(); a.route('/', security); return mapErrors(a); }

async function call(app: Hono<any>, env: any, token: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/** Which account a token opens the ordinary door as, or null when it is refused. */
async function opensAs(env: any, token: string): Promise<number | null> {
  const a = new Hono();
  a.get('/me', async (c) => c.json({ id: (await requireAuth(c as any)).id }));
  a.onError((_e, c) => c.json({ detail: 'refused' }, 401));
  const res = await a.fetch(new Request('http://x/me', { headers: { Authorization: `Bearer ${token}` } }), env);
  return res.status === 200 ? Number(((await res.json()) as any).id) : null;
}

/** Open an HQ support session on FOUNDER through the real route. */
async function openSupport(db: DB, env = envOf(db)) {
  const r = await call(adminApp(), env, await hqToken(), 'POST',
    `/impersonate/${FOUNDER}?context=${encodeURIComponent(REASON)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { token: string; impersonation_session_id: number };
}

// ─────────────────────────────────────────── HQ support sessions ──

test('an HQ support token names its record, and ending the record ends the token on its next request', async () => {
  const db = freshDb();
  const env = envOf(db);
  const s = await openSupport(db, env);
  assert.equal(Number(decodeJwt(s.token).sid), s.impersonation_session_id, 'the token does not name its record');
  assert.equal(await opensAs(env, s.token), FOUNDER, 'a live support token does not open the account');

  const end = await call(adminApp(), env, await hqToken(), 'POST', `/impersonate-sessions/${s.impersonation_session_id}/end`);
  assert.equal(end.status, 200);
  assert.equal(end.body.ended, true, 'the operator is not told the session ended');
  assert.equal(await opensAs(env, s.token), null, 'an ended support session still opens the account');

  const again = await call(adminApp(), env, await hqToken(), 'POST', `/impersonate-sessions/${s.impersonation_session_id}/end`);
  assert.equal(again.body.ended, false, 'a second end claims to have ended something');
});

test('HQ · Security ending a support session refuses its token, and says so', async () => {
  const db = freshDb();
  const env = envOf(db);
  const s = await openSupport(db, env);
  const r = await call(securityApp(), env, await hqToken(), 'POST',
    `/impersonations/${s.impersonation_session_id}/end`, { reason: SEC_REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.message, /refused from its next request/);
  assert.doesNotMatch(r.body.message, /stays valid/, 'the message still says the token outlives the end');
  assert.equal(await opensAs(env, s.token), null, 'the support token survived HQ ending its session');
});

test('the extended token carries the same record, so ending the session ends the extension too', async () => {
  const db = freshDb();
  const env = envOf(db);
  const s = await openSupport(db, env);
  const ext = await call(adminApp(), env, await hqToken(), 'POST',
    `/impersonate-sessions/${s.impersonation_session_id}/extend`, { reason: 'Still re-linking: second verification step' });
  assert.equal(ext.status, 200, JSON.stringify(ext.body));
  assert.equal(Number(decodeJwt(ext.body.token).sid), s.impersonation_session_id);
  assert.equal(await endImpersonation(env, s.impersonation_session_id).then((o) => o.outcome), 'ended');
  assert.equal(await opensAs(env, ext.body.token), null, 'an extension outlived the ended session');
});

test('signing the operator out, or deactivating them, ends the support sessions they hold', async () => {
  for (const act of ['sign_out', 'deactivate', 'demote'] as const) {
    const db = freshDb();
    const env = envOf(db);
    const s = await openSupport(db, env);
    assert.equal(await opensAs(env, s.token), FOUNDER);
    if (act === 'sign_out') db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 5, HQ);
    if (act === 'deactivate') db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(HQ);
    if (act === 'demote') db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(HQ);
    assert.equal(await opensAs(env, s.token), null, `the support token survived the operator's ${act}`);
  }
});

test('a support token naming another account\'s record, another operator\'s, or no record is refused', async () => {
  const db = freshDb();
  const env = envOf(db);
  const s = await openSupport(db, env);
  const sid = s.impersonation_session_id;
  const forOther = await sign({ user_id: OTHER, role: 'founder', impersonated_by: HQ, sid });
  assert.equal(await opensAs(env, forOther), null, 'a record opened on one account opened another');
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (2, 'admin', 'Pere', 'p@x', 1)").run();
  const otherOperator = await sign({ user_id: FOUNDER, role: 'founder', impersonated_by: 2, sid });
  assert.equal(await opensAs(env, otherOperator), null, 'another operator rode a record they did not open');
  const missing = await sign({ user_id: FOUNDER, role: 'founder', impersonated_by: HQ, sid: sid + 999 });
  assert.equal(await opensAs(env, missing), null, 'a token naming no record was accepted');
  const bad = await sign({ user_id: FOUNDER, role: 'founder', impersonated_by: HQ, sid: 'x' });
  assert.equal(await opensAs(env, bad), null, 'a malformed record id was accepted');
});

test('a support session whose record cannot be written is not opened, and no token is handed out', async () => {
  const db = freshDb();
  const env = envOf(db, { refuse: (q) => /INSERT INTO impersonation_sessions/.test(q) });
  const r = await call(adminApp(), env, await hqToken(), 'POST',
    `/impersonate/${FOUNDER}?context=${encodeURIComponent(REASON)}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'support_session_unrecorded');
  assert.equal(r.body.token, undefined, 'a token was issued for a session with no record');
});

test('ending a support session whose store is unreadable says it failed, not ok', async () => {
  const db = freshDb();
  const s = await openSupport(db);
  const env = envOf(db, { refuse: (q) => /UPDATE impersonation_sessions/.test(q) });
  const r = await call(adminApp(), env, await hqToken(), 'POST', `/impersonate-sessions/${s.impersonation_session_id}/end`);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'support_session_end_failed');
});

// ────────────────────────────────────────── dependency failure ──

test('an unreadable session store refuses the token instead of skipping the check', async () => {
  const db = freshDb();
  const token = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  assert.equal(await opensAs(envOf(db), token), FOUNDER);
  const down = envOf(db, { refuse: (q) => /FROM user_sessions/.test(q) });
  assert.equal(await opensAs(down, token), null, 'a session check that could not run let the token through');
  const out = await sessionStanding(down, decodeJwt(token) as any, { id: FOUNDER });
  assert.deepEqual(out, { ok: false, reason: 'session_store_unavailable' });
  // Only a missing column may fall back to the narrower read; any other
  // failure of the first read is the store being down.
  const firstReadDown = envOf(db, { refuse: (q) => /step_up_due_at FROM user_sessions/.test(q) });
  assert.equal(await opensAs(firstReadDown, token), null, 'a failed session read fell back and let the token through');
});

test('an unreadable support-session store refuses the support token', async () => {
  const db = freshDb();
  const s = await openSupport(db);
  const down = envOf(db, { refuse: (q) => /FROM impersonation_sessions i/.test(q) });
  assert.equal(await opensAs(down, s.token), null, 'a support check that could not run let the token through');
});

test('a database without the step-up column still checks revocation, and only that failure falls back', async () => {
  const db = freshDb();
  const token = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  const noColumn = {
    ...envOf(db),
    DB: (() => {
      const d1 = makeD1(db);
      return { ...d1, prepare(q: string) {
        if (/step_up_due_at FROM user_sessions/.test(q)) throw new Error('D1_ERROR: no such column: step_up_due_at');
        return d1.prepare(q);
      } };
    })(),
  };
  assert.equal(await opensAs(noColumn, token), FOUNDER);
  db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE jti = 'pw-founder'").run();
  assert.equal(await opensAs(noColumn, token), null, 'the fallback read skipped the revocation');
});

// ────────────────────────────────────────────── realtime door ──

function upgradeCtx(env: any, token: string) {
  return {
    env,
    req: {
      header: (n: string) => (n.toLowerCase() === 'sec-websocket-protocol' ? `bearer.${token}` : undefined),
      query: () => undefined,
      path: '/api/pipeline/ws/1',
    },
  } as any;
}

test('the realtime upgrade refuses a revoked session, a signed-out account, an ended support session and an unreadable store', async () => {
  const db = freshDb();
  const env = envOf(db);
  const token = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  assert.equal((await authenticateForUpgrade(upgradeCtx(env, token)))?.id, FOUNDER);

  assert.equal(await authenticateForUpgrade(upgradeCtx(envOf(db, { refuse: (q) => /FROM user_sessions/.test(q) }), token)), null,
    'the upgrade let a token through when its session could not be checked');

  db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE jti = 'pw-founder'").run();
  assert.equal(await authenticateForUpgrade(upgradeCtx(env, token)), null, 'a revoked session opened a realtime channel');

  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('pw-other', ?, 'password', datetime('now'))`).run(OTHER);
  const old = await sign({ user_id: OTHER, role: 'founder', jti: 'pw-other' }, Math.floor(Date.now() / 1000) - 60);
  assert.equal((await authenticateForUpgrade(upgradeCtx(env, old)))?.id, OTHER);
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), OTHER);
  assert.equal(await authenticateForUpgrade(upgradeCtx(env, old)), null, 'a signed-out account opened a realtime channel');

  const s = await openSupport(db, env);
  assert.equal((await authenticateForUpgrade(upgradeCtx(env, s.token)))?.id, FOUNDER);
  await endImpersonation(env, s.impersonation_session_id);
  assert.equal(await authenticateForUpgrade(upgradeCtx(env, s.token)), null, 'an ended support session opened a realtime channel');
});

// ───────────────────────────────────────── request protection ──

async function csrfStatus(env: any, headers: Record<string, string>): Promise<number> {
  const a = new Hono();
  a.use('/api/*', csrfMiddleware());
  a.post('/api/thing', (c) => c.json({ ok: true }));
  const res = await a.fetch(new Request('http://x/api/thing', { method: 'POST', headers }), env);
  return res.status;
}

test('request protection follows the credential that authenticates, not the presence of a Bearer header', async () => {
  const env = envOf(freshDb());
  const cookieTok = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  const sameBearer = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  const otherBearer = await sign({ user_id: OTHER, role: 'founder', jti: 'x' });
  const cookie = `studioos_auth=${cookieTok}; studioos_csrf=abc`;

  assert.equal(await csrfStatus(env, { Cookie: cookie }), 403, 'a cookie POST with no CSRF header passed');
  assert.equal(await csrfStatus(env, { Cookie: cookie, 'X-CSRF-Token': 'abc' }), 200);
  for (const [label, bearer] of [['empty', ''], ['undecodable', 'not-a-jwt'], ['another identity\'s', otherBearer]]) {
    assert.equal(await csrfStatus(env, { Cookie: cookie, Authorization: `Bearer ${bearer}` }), 403,
      `an ${label} Bearer exempted the ambient cookie from CSRF`);
  }
  assert.equal(await csrfStatus(env, { Cookie: cookie, Authorization: `Bearer ${sameBearer}` }), 200,
    'a Bearer that authenticates was asked for CSRF');
  assert.equal(await csrfStatus(env, { Authorization: `Bearer ${otherBearer}` }), 200, 'a Bearer-only call was asked for CSRF');

  // A legitimate support Bearer beside the operator's cookie authenticates as the Bearer.
  const opCookie = await sign({ user_id: HQ, role: 'admin', jti: 'totp-hq' });
  const support = await sign({ user_id: FOUNDER, role: 'founder', impersonated_by: HQ, sid: 1 });
  assert.equal(await csrfStatus(env, { Cookie: `studioos_auth=${opCookie}`, Authorization: `Bearer ${support}` }), 200);
});

test('sign-out on a branch revokes the session the branch cookie carries, and says it did', async () => {
  const db = freshDb();
  const env = envOf(db, {}, { BRANCH_CODE: 'fr' });
  const tok = await sign({ user_id: FOUNDER, role: 'founder', jti: 'pw-founder' });
  const a = new Hono(); a.route('/', authRoutes);
  const res = await a.fetch(new Request('http://x/logout', {
    method: 'POST', headers: { Cookie: `studioos_auth_fr=${tok}` },
  }), env);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).session_revoked, 'revoked');
  const row = db.prepare("SELECT revoked_at FROM user_sessions WHERE jti = 'pw-founder'").get() as any;
  assert.ok(row.revoked_at, 'signing out on a branch left the branch session valid');
});

test('sign-out under a support Bearer also revokes the operator\'s own cookie session', async () => {
  const db = freshDb();
  const env = envOf(db);
  const s = await openSupport(db, env);
  const a = new Hono(); a.route('/', authRoutes);
  const res = await a.fetch(new Request('http://x/logout', {
    method: 'POST', headers: { Authorization: `Bearer ${s.token}`, Cookie: `studioos_auth=${await hqToken()}` },
  }), env);
  assert.equal(res.status, 200);
  const row = db.prepare("SELECT revoked_at FROM user_sessions WHERE jti = 'totp-hq'").get() as any;
  assert.ok(row.revoked_at, 'the operator\'s cookie session survived sign-out');
});

// ─────────────────────────────────────── branch support sessions ──

const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
async function branchEnv(db: DB, ctl: { refuse?: (sql: string) => boolean } = {}) {
  return envOf(db, ctl, { BRANCH_CODE: 'fr', HQ_RPC_SECRET_HASH: await sha256Hex(HQ_SECRET) });
}

test('a branch support session names its record, and ending the record on the branch ends the token', async () => {
  const db = freshDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', hq_actor_ref: '7', target_user_id: FOUNDER, reason: REASON,
  } as any);
  const session = await redeemSupportCode(env, offer.code);
  const sid = Number(decodeJwt(session.token).sid);
  assert.ok(sid > 0, 'the branch support token names no record');
  assert.equal(await opensAs(env, session.token), FOUNDER);
  assert.equal((await endImpersonation(env, sid)).outcome, 'ended');
  assert.equal(await opensAs(env, session.token), null, 'an ended branch support session still opens the account');
});

test('a branch support session whose session row cannot be written is not opened', async () => {
  const db = freshDb();
  const env = await branchEnv(db, { refuse: (q) => /INSERT INTO user_sessions/.test(q) });
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', hq_actor_ref: '7', target_user_id: FOUNDER, reason: REASON,
  } as any);
  await assert.rejects(() => redeemSupportCode(env, offer.code), /^Error: support-unavailable: /);
  const open = db.prepare("SELECT COUNT(*) AS n FROM impersonation_sessions WHERE ended_at IS NULL").get() as any;
  assert.equal(Number(open.n), 0, 'a refused redeem left a support record open');
});

// ────────────────────────────────────────── emergency-action scope ──

const BRANCH_STUB = { ping: async () => 'ok' };

test('sign-everyone-out reports each deployment: done here, each bound branch not reached', async () => {
  const db = freshDb();
  const env = envOf(db, {}, { BRANCH_FR: BRANCH_STUB, BRANCH_DE: BRANCH_STUB });
  const r = await call(securityApp(), env, await hqToken(), 'POST', '/force-reauth', { reason: SEC_REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.outcomes.map((o: any) => [o.deployment, o.outcome]),
    [['hq', 'done'], ['de', 'not_reached'], ['fr', 'not_reached']]);
  assert.equal(r.body.outcomes[0].affected, 3);
  assert.equal(r.body.outcomes[1].reason, BRANCH_NOT_REACHED);
  assert.equal(r.body.scope.reaches, 'this_deployment_only');
  assert.equal(r.body.scope.branches_bound, 2);
  assert.doesNotMatch(r.body.message, /everywhere/, 'the answer claims a platform-wide sign-out');
});

test('a sign-out that cannot be written says nothing changed, and nothing did', async () => {
  const db = freshDb();
  const env = envOf(db, { refuse: (q) => /UPDATE users SET jwt_min_iat/.test(q) });
  for (const path of ['/force-reauth', `/force-reauth/${FOUNDER}`]) {
    const r = await call(securityApp(), env, await hqToken(), 'POST', path, { reason: SEC_REASON });
    assert.equal(r.status, 503, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'sign_out_failed');
    assert.equal(r.body.outcomes[0].outcome, 'failed');
  }
  const floors = db.prepare('SELECT COUNT(*) AS n FROM users WHERE COALESCE(jwt_min_iat, 0) > 0').get() as any;
  assert.equal(Number(floors.n), 0);
  const logged = db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'security_force_reauth%'").get() as any;
  assert.equal(Number(logged.n), 0, 'a sign-out that did not happen was recorded as one');
});

test('signing one account out reports the scope, and the list states it too', async () => {
  const db = freshDb();
  const env = envOf(db, {}, { BRANCH_FR: BRANCH_STUB });
  const r = await call(securityApp(), env, await hqToken(), 'POST', `/force-reauth/${FOUNDER}`, { reason: SEC_REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.outcomes.map((o: any) => o.outcome), ['done', 'not_reached']);
  assert.match(r.body.message, /on this deployment/);
  const list = await call(securityApp(), env, await hqToken(), 'GET', '/sessions');
  assert.equal(list.status, 200);
  assert.equal(list.body.scope.deployment, 'hq');
  assert.match(list.body.scope.summary, /1 bound branch is not reached/);
});

// ──────────────────────────────────────────── every mint binds ──

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The argument list of each `createJWT(` call, split at top-level commas. */
function createJwtCalls(src: string): string[][] {
  const calls: string[][] = [];
  const re = /\bcreateJWT\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    let depth = 1; let i = m.index + m[0].length; let cur = ''; const args: string[] = [];
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) { args.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    calls.push(args);
  }
  return calls;
}

test('every token the Worker mints is bound to a row that can end it (a jti, or a support-session record)', () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const file of sources(resolve(ROOT, 'cloudflare-worker/src'))) {
    for (const args of createJwtCalls(readFileSync(file, 'utf8'))) {
      seen++;
      const jti = args[5];
      const sid = args[7];
      const bound = (jti && jti !== 'undefined') || (sid && sid !== 'undefined');
      if (!bound) offenders.push(`${file.slice(ROOT.length + 1)}: createJWT(${args.join(', ')})`);
    }
  }
  assert.ok(seen >= 10, `only ${seen} createJWT calls found; the scan is broken`);
  assert.deepEqual(offenders, [], 'a mint path issues a token no revoke can reach');
});
