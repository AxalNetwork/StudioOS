/**
 * D248 — a support session tells the person it opens on; Extend asks for a
 * reason, stops at a ceiling measured from when the session opened, and is
 * recorded where Security reads; and Extend is paused by the recovery
 * cool-off while End is not.
 *
 * THE WHOLE WORKER, NOT THE ADMIN ROUTER ALONE. The cool-off is registered in
 * index.ts, ahead of the route table, and what this file has to prove about it
 * is WHICH REQUESTS REACH IT — a question the admin router cannot answer on its
 * own. So the entry is bundled the way Wrangler bundles it (esbuild, the D239
 * precedent) and every request below goes through the real `fetch`: security
 * headers, the rate limiter, CSRF, the cool-off, then the route.
 *
 * THE DATABASE IS THE ONE THE REPO'S SCHEMA STORY BUILDS: schema_baseline.sql
 * and every later migration, in order, through `buildFresh` — the same builder
 * the deploy's step 9 uses (D235). `user_recovery_state` (migration 277) is
 * above the baseline cutoff, so a baseline-only fixture could not hold a
 * cool-off at all.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/impersonation_d248.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';
import { IMPERSONATION_CEILING_MINUTES, IMPERSONATION_EXPIRY_MINUTES } from '../src/auth.ts';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};';
const out = join(mkdtempSync(join(tmpdir(), 'd248-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
  plugins: [{
    name: 'workers-shims',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({
        contents: readFileSync(a.path, 'utf8'), loader: 'text',
      }));
    },
  }],
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const worker = (await import(pathToFileURL(out).href)).default;

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ = 1;         // the Super Admin
const PEER = 2;       // a plain admin
const FOUNDER = 30;   // the person a support session opens on
const REASON = 'Founder asked for help re-linking their bank account (ticket 5512)';
const EXTEND_REASON = 'Still re-linking: the bank sent a second verification step';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
type DB = ReturnType<typeof buildFresh>;
function makeD1(db: DB, refuse?: (sql: string) => boolean) {
  return {
    prepare(sql: string) {
      if (refuse?.(sql)) throw new Error('D1_ERROR: refused by the test');
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return (db.prepare(sql).get(...b) as any) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async raw() { return (db.prepare(sql).all(...b) as any[]).map((r) => Object.values(r)); },
        async run() {
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

function freshDb(): DB {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  u.run(PEER, 'admin', 'Pere Peer', 'pere@axal.example');
  u.run(FOUNDER, 'founder', 'Fran Founder', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  const sess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  );
  for (const id of [HQ, PEER]) sess.run(`totp-${id}`, id);
  return db;
}

/** A freshly recovered account: the cool-off runs a day from now. */
function coolOff(db: DB, userId: number) {
  db.prepare(
    `INSERT INTO user_recovery_state (user_id, cooling_off_until, updated_at)
     VALUES (?, datetime('now', '+1 day'), datetime('now'))`,
  ).run(userId);
}

function makeEnv(db: DB, refuse?: (sql: string) => boolean) {
  const kv = new Map<string, string>();
  return {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: makeD1(db, refuse),
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
  } as any;
}

async function jwtFor(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(
  env: any, actor: number, method: string, path: string, body?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(actor)}` };
  if (body) headers['content-type'] = 'application/json';
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    const waits: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    const res = await worker.fetch(
      new Request(`https://axal.vc${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }),
      env, ctx,
    );
    await Promise.allSettled(waits);
    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: parsed };
  } finally {
    silence.forEach((m) => m.mock.restore());
  }
}

const open = (env: any, actor: number, target: number, reason = REASON) =>
  req(env, actor, 'POST', `/api/admin/impersonate/${target}?context=${encodeURIComponent(reason)}`);
const extend = (env: any, actor: number, id: number, reason?: string) =>
  req(env, actor, 'POST', `/api/admin/impersonate-sessions/${id}/extend`, reason === undefined ? {} : { reason });

const notices = (db: DB, userId: number) => {
  try {
    return db.prepare('SELECT type, title, body, link, category FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[];
  } catch { return []; }
};
const auditRows = (db: DB) =>
  db.prepare('SELECT action, admin_user_id, viewed_user_id, filters_json FROM admin_audit_log ORDER BY id').all() as any[];
/**
 * The route's own activity rows. `http_*` rows are excluded: the observability
 * middleware writes one access-log line per request (`POST /… → 400`), refused
 * ones included, and it is not the route recording an act.
 */
const activityActions = (db: DB) =>
  (db.prepare("SELECT action FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\' ORDER BY id").all() as any[])
    .map((r) => r.action);
const sessionRow = (db: DB, id: number) =>
  db.prepare('SELECT * FROM impersonation_sessions WHERE id = ?').get(id) as any;

async function openOnFounder(db: DB, env: any): Promise<number> {
  const r = await open(env, HQ, FOUNDER);
  assert.equal(r.status, 200, `the open was refused: ${JSON.stringify(r.body)}`);
  const id = Number(r.body?.impersonation_session_id);
  assert.ok(id > 0, 'the open returned no session id');
  return id;
}

/* ------------------------------------------------------------------ *
 * 1. The person is told                                               *
 * ------------------------------------------------------------------ */

test('D248: opening a session sends the target exactly one security notice: who, why and how long', async () => {
  const db = freshDb();
  const r = await open(makeEnv(db), HQ, FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body?.target_notified, true, 'the response does not report that the person was told');
  const got = notices(db, FOUNDER);
  assert.equal(got.length, 1, `the target received ${got.length} notices for one session`);
  const [n] = got;
  assert.equal(n.category, 'security');
  assert.equal(n.link, '/account/security');
  assert.ok(n.body.includes('Hana HQ'), 'the notice does not say who');
  assert.ok(n.body.includes(`"${REASON}"`), 'the notice does not carry the typed reason');
  assert.ok(n.body.includes(`${IMPERSONATION_EXPIRY_MINUTES} minutes`), 'the notice does not say how long');
  assert.ok(n.body.includes(`${IMPERSONATION_CEILING_MINUTES / 60} hours`), 'the notice does not state the ceiling');
  assert.doesNotMatch(`${n.title} ${n.body}`, /advis|advice|recommend|fiduciar/i);
  assert.equal(notices(db, HQ).length, 0, 'the admin was notified of their own act');
});

test('D248: a refused open tells nobody', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  const short = await open(env, HQ, FOUNDER, 'too short');
  assert.equal(short.status, 400);
  // A plain admin may not open a session on another admin (D133).
  const peer = await open(env, PEER, HQ);
  assert.equal(peer.status, 403);
  assert.equal(notices(db, FOUNDER).length, 0, 'a refused open notified the founder');
  assert.equal(notices(db, HQ).length, 0, 'a refused open notified the admin it was aimed at');
});

test('D248: an inbox that refuses every write still opens the session, and reports the person as not told', async () => {
  const db = freshDb();
  const r = await open(makeEnv(db, (sql) => sql.includes('notifications_inbox')), HQ, FOUNDER);
  assert.equal(r.status, 200, 'a failed notice turned a granted session into a failed request');
  assert.equal(typeof r.body?.token, 'string');
  assert.equal(r.body?.target_notified, false, 'the response claims a notice that never reached the inbox');
});

/* ------------------------------------------------------------------ *
 * 2. Extend: a reason, a ceiling, a record                            *
 * ------------------------------------------------------------------ */

test('D248: Extend is recorded with the target and the reason, where Security reads it', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  const id = await openOnFounder(db, env);
  const r = await extend(env, HQ, id, EXTEND_REASON);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(typeof r.body?.token, 'string');
  const ext = auditRows(db).filter((a) => a.action === 'admin_impersonate_extend');
  assert.equal(ext.length, 1, 'one extension must write exactly one audit row');
  assert.equal(ext[0].admin_user_id, HQ);
  assert.equal(ext[0].viewed_user_id, FOUNDER, 'the audit row has no subject (D159)');
  const details = JSON.parse(ext[0].filters_json);
  assert.equal(details.reason, EXTEND_REASON);
  assert.equal(details.impersonation_session_id, id);
});

test('D248: Extend with no reason, or a short one → 400, and nothing is written', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  const id = await openOnFounder(db, env);
  const before = { activity: activityActions(db).length, audit: auditRows(db).length };
  for (const reason of [undefined, '', '         ', '123456789']) {
    const r = await extend(env, HQ, id, reason);
    assert.equal(r.status, 400, `${JSON.stringify(reason)} extended a session`);
    assert.equal(r.body?.code, 'extend_reason_required');
    assert.equal(r.body?.token, undefined, 'a token was minted on a refused extension');
  }
  assert.equal(activityActions(db).length, before.activity, 'a refused extension wrote an activity row');
  assert.equal(auditRows(db).length, before.audit, 'a refused extension wrote an audit row');
});

/**
 * A session HQ opened `age` ago and never ended. Inserted rather than
 * back-dated: D156 seals `impersonation_sessions` so `started_at` cannot be
 * rewritten, which is the property the ceiling reads.
 */
function sessionOpened(db: DB, age: string): number {
  const r = db.prepare(
    `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at)
     VALUES (?, ?, ?, datetime('now', ?))`,
  ).run(HQ, FOUNDER, REASON, age);
  return Number(r.lastInsertRowid);
}

test(`D248: Extend past ${IMPERSONATION_CEILING_MINUTES} minutes from when the session opened is refused, and writes nothing`, async () => {
  const db = freshDb();
  const env = makeEnv(db);
  // An HQ session whose tab was closed: ended_at stays NULL for ever. Days
  // old, and one old enough that thirty more minutes would cross the ceiling.
  const stale = [
    sessionOpened(db, '-3 days'),
    sessionOpened(db, `-${IMPERSONATION_CEILING_MINUTES - IMPERSONATION_EXPIRY_MINUTES + 10} minutes`),
  ];
  const before = { activity: activityActions(db).length, audit: auditRows(db).length };
  for (const id of stale) {
    const r = await extend(env, HQ, id, EXTEND_REASON);
    assert.equal(r.status, 409, `a session opened at ${sessionRow(db, id).started_at} was extended`);
    assert.equal(r.body?.code, 'support_session_ceiling');
    assert.equal(r.body?.token, undefined);
    assert.equal(sessionRow(db, id).ended_at, null, 'a refused extension ended the session — it must write nothing');
  }
  assert.equal(activityActions(db).length, before.activity, 'a refused extension wrote an activity row');
  assert.equal(auditRows(db).length, before.audit, 'a refused extension wrote an audit row');

  // The control: inside the ceiling, the same request passes. Without it the
  // refusal above could be a route that refuses every extension.
  const young = sessionOpened(db, `-${IMPERSONATION_CEILING_MINUTES - IMPERSONATION_EXPIRY_MINUTES - 10} minutes`);
  const ok = await extend(env, HQ, young, EXTEND_REASON);
  assert.equal(ok.status, 200, `a session inside the ceiling was refused: ${JSON.stringify(ok.body)}`);
});

/* ------------------------------------------------------------------ *
 * 3. The recovery cool-off                                            *
 * ------------------------------------------------------------------ */

test('D248: during the recovery cool-off, Extend is refused 423 by the middleware, and End still works', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  const id = await openOnFounder(db, env);
  coolOff(db, HQ);

  const ext = await extend(env, HQ, id, EXTEND_REASON);
  assert.equal(ext.status, 423, `Extend was not paused by the cool-off: ${JSON.stringify(ext.body)}`);
  assert.equal(ext.body?.error, 'recovery_cool_off_active', 'the 423 did not come from the cool-off middleware');
  assert.equal(auditRows(db).filter((a) => a.action === 'admin_impersonate_extend').length, 0);

  // Ending is the safe direction, and a recovered owner may need it.
  const end = await req(env, HQ, 'POST', `/api/admin/impersonate-sessions/${id}/end`);
  assert.equal(end.status, 200, `End was paused by the cool-off: ${JSON.stringify(end.body)}`);
  assert.ok(sessionRow(db, id).ended_at, 'End answered 200 and did not stamp the session');
});

test('D248: the cool-off covers the elevation, account and role writes, and leaves the holder list and force re-auth open', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  coolOff(db, HQ);
  const paused: Array<[string, string, Record<string, unknown>?]> = [
    ['POST', `/api/admin/super-admins/${PEER}?transfer=1`, { reason: 'handing the platform on for the audit' }],
    ['DELETE', `/api/admin/super-admins/${PEER}`],
    ['PATCH', `/api/admin/users/${PEER}/toggle-active`, { reason: 'closing a compromised admin account' }],
    ['PATCH', `/api/admin/users/${FOUNDER}/role?role=investor`, {}],
  ];
  for (const [method, path, body] of paused) {
    const r = await req(env, HQ, method, path, body);
    assert.equal(r.status, 423, `${method} ${path} was not paused during the cool-off`);
    assert.equal(r.body?.error, 'recovery_cool_off_active');
  }
  assert.equal((db.prepare('SELECT is_active FROM users WHERE id = ?').get(PEER) as any).is_active, 1);
  assert.equal((db.prepare('SELECT role FROM users WHERE id = ?').get(FOUNDER) as any).role, 'founder');

  // Reads, and acts that only end sessions, stay open.
  const open423 = [
    ['GET', '/api/admin/super-admins'],
    ['POST', `/api/admin/security/force-reauth/${FOUNDER}`],
  ] as const;
  for (const [method, path] of open423) {
    const r = await req(env, HQ, method, path, method === 'POST' ? { reason: 'suspected token theft' } : undefined);
    assert.notEqual(r.body?.error, 'recovery_cool_off_active', `${method} ${path} was paused, and must not be`);
  }
});
