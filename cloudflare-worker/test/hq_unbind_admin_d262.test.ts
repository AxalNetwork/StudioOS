/**
 * D262 — HQ reaches an administrator whose account lives on a branch database.
 *
 * THE HQ HALF, THROUGH THE WHOLE WORKER (the D248 harness): `index.ts` bundled
 * the way Wrangler bundles it, on the `buildFresh` schema, with `BRANCH_FR` as
 * a stub binding that records every call. "The stub is never called" is the
 * property for every refusal: TOTP, step-up and the elevation are facts only
 * HQ can check, so a request that fails them must never reach the branch.
 *
 * AND TERMINATION: it now asks the branch to unbind every administrator, after
 * the push, and a branch that throws must not undo the recorded termination.
 * Terminate also moved up to the write bar (TOTP and a fresh step-up).
 *
 * The branch half — `unbindAdmin`'s own refusals and writes — is
 * branch_unbind_admin_d262.test.ts.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_unbind_admin_d262.test.ts
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

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};';
const out = join(mkdtempSync(join(tmpdir(), 'd262-')), 'worker.mjs');
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
// Obviously synthetic. HQ holds this; the stub branch never checks it.
const HQ_RPC_SECRET = 'synthetic-test-value-not-a-credential';
const HQ = 1;              // the Super Admin
const PLAIN = 2;           // an HQ admin without the elevation
const BRANCH_ADMIN = 7;    // an id on the FR branch's own database
const REASON = 'Principal breached the brand terms twice (ticket 7731)';
const LIC = 'lic-fr-d262';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
type DB = ReturnType<typeof buildFresh>;
function makeD1(db: DB) {
  return {
    prepare(sql: string) {
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
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@axal.example');
  // A DIFFERENT PERSON who holds id 7 in HQ's own database: the audit row
  // must never name them for an act on the branch's account 7.
  u.run(BRANCH_ADMIN, 'founder', 'Otto HQ-Local', 'otto@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  const s = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now', ?), ?)`,
  );
  s.run('totp-1', HQ, '+0 seconds', null);
  s.run('totp-2', PLAIN, '+0 seconds', null);
  s.run('stale-1', HQ, '-2 days', null);
  return db;
}

function withLicence(db: DB) {
  db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status)
     VALUES (1, ?, 'AXL-FR-1', 'Axal VC France SAS', 'Axal VC France', 'active')`,
  ).run(LIC);
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES (?, 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr-db', 'live')`,
  ).run(LIC);
}

function coolOff(db: DB, userId: number) {
  db.prepare(
    `INSERT INTO user_recovery_state (user_id, cooling_off_until, updated_at)
     VALUES (?, datetime('now', '+1 day'), datetime('now'))`,
  ).run(userId);
}

/** The FR branch, as a stub binding that records every call. */
function branchStub(opts: { throws?: boolean } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = {
    async unbindAdmin(...args: unknown[]) {
      calls.push({ method: 'unbindAdmin', args });
      if (opts.throws) throw new Error('rpc: fr did not answer');
      const named = (args[1] as any)?.target_user_id;
      return {
        unbound: named ? [{ id: named, name: 'Paul Principal', email: 'paul@fr.example' }]
          : [{ id: 7, name: 'Paul Principal', email: 'paul@fr.example' }, { id: 8, name: 'Dana Deputy', email: 'dana@fr.example' }],
        skipped: [], branch: 'fr', as_of: '2026-09-25T09:00:00Z',
      };
    },
    async applyLicence(...args: unknown[]) {
      calls.push({ method: 'applyLicence', args });
      if (opts.throws) throw new Error('rpc: fr did not answer');
      return { ok: true };
    },
  };
  return { stub, calls };
}

function makeEnv(db: DB, branches: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const kv = new Map<string, string>();
  return {
    JWT_SECRET, ENVIRONMENT: 'development', HQ_RPC_SECRET,
    DB: makeD1(db),
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
    ...branches,
    ...extra,
  } as any;
}

async function jwtFor(userId: number, jti: string | null): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(
  env: any, method: string, path: string, body?: Record<string, unknown>, as = HQ, jti: string | null = 'totp-1',
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(as, jti)}` };
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

const unbind = (env: any, over: Record<string, unknown> = {}, as = HQ, jti: string | null = 'totp-1', code = 'fr') =>
  req(env, 'POST', `/api/admin/branches/${code}/admins/${BRANCH_ADMIN}/unbind`, { reason: REASON, ...over }, as, jti);
const auditRows = (db: DB) => db.prepare(
  "SELECT admin_user_id, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'hq_branch_admin_unbound'",
).all() as any[];

/* ------------------------------------------------------------------ *
 * 1. The gates run before the branch is touched                        *
 * ------------------------------------------------------------------ */

test('D262: a JWT with no TOTP session is refused 403, and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await unbind(makeEnv(db, { BRANCH_FR: fr.stub }), {}, HQ, null);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(fr.calls.length, 0, 'the branch was asked to unbind without the operator\'s TOTP');
});

test('D262: a TOTP session with no fresh step-up is refused, and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await unbind(makeEnv(db, { BRANCH_FR: fr.stub }), {}, HQ, 'stale-1');
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(JSON.stringify(r.body), /step_up_required/);
  assert.equal(fr.calls.length, 0, 'the branch was asked to unbind before the step-up');
});

test('D262: an HQ admin without the elevation is refused 403, and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await unbind(makeEnv(db, { BRANCH_FR: fr.stub }), {}, PLAIN, 'totp-2');
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(fr.calls.length, 0);
});

test('D262: a reason under ten characters is refused 400 at HQ, and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await unbind(makeEnv(db, { BRANCH_FR: fr.stub }), { reason: 'too short' });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body?.error, 'unbind_reason_required');
  assert.equal(fr.calls.length, 0);
});

test('D262: inside the recovery cool-off, unbind and HQ\'s demote-admin are both refused 423', async () => {
  const db = freshDb();
  const fr = branchStub();
  const env = makeEnv(db, { BRANCH_FR: fr.stub });
  coolOff(db, HQ);
  const r = await unbind(env);
  assert.equal(r.status, 423, JSON.stringify(r.body));
  assert.equal(r.body?.error, 'recovery_cool_off_active');
  assert.equal(fr.calls.length, 0);
  const d = await req(env, 'POST', `/api/admin/users/${PLAIN}/demote-admin`, { reason: 'Pat left the programme team' });
  assert.equal(d.status, 423, `demote-admin was not paused by the cool-off: ${JSON.stringify(d.body)}`);
  assert.equal((db.prepare('SELECT role FROM users WHERE id = ?').get(PLAIN) as any).role, 'admin');
});

/* ------------------------------------------------------------------ *
 * 2. The refusals an operator can act on                              *
 * ------------------------------------------------------------------ */

test('D262: no secret, no binding, a branch that refuses: each is its own 409, and no audit row is written', async () => {
  const db = freshDb();
  const noSecret = await unbind(makeEnv(db, { BRANCH_FR: branchStub().stub }, { HQ_RPC_SECRET: '' }));
  assert.equal(noSecret.status, 409);
  assert.equal(noSecret.body?.error, 'hq_rpc_secret_unset');

  const unbound = await unbind(makeEnv(db, {}), {}, HQ, 'totp-1', 'de');
  assert.equal(unbound.status, 409);
  assert.equal(unbound.body?.error, 'branch_not_bound');

  const refusing = branchStub({ throws: true });
  const refused = await unbind(makeEnv(db, { BRANCH_FR: refusing.stub }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body?.error, 'branch_refused');
  assert.match(refused.body?.message, /fr did not answer/, 'the branch\'s own words were lost');
  assert.doesNotMatch(refused.body?.message, /^rpc:/);
  assert.deepEqual(auditRows(db), [], 'a refused unbind was recorded as done');
});

/* ------------------------------------------------------------------ *
 * 3. Success                                                          *
 * ------------------------------------------------------------------ */

test('D262: the branch is asked once, secret first, and HQ\'s audit row names the branch account — never an HQ user', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await unbind(makeEnv(db, { BRANCH_FR: fr.stub }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.branch, 'fr');
  assert.deepEqual(r.body.unbound.map((u: any) => u.id), [BRANCH_ADMIN]);

  assert.equal(fr.calls.length, 1);
  assert.equal(fr.calls[0].method, 'unbindAdmin');
  assert.equal(fr.calls[0].args[0], HQ_RPC_SECRET, 'the secret is not the first argument');
  assert.deepEqual(fr.calls[0].args[1], { hq_actor_name: 'Hana HQ', target_user_id: BRANCH_ADMIN, reason: REASON });

  const audit = auditRows(db);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, HQ);
  assert.equal(audit[0].viewed_user_id, null, 'HQ\'s viewed_user_id names whoever holds id 7 at HQ — a different person');
  const d = JSON.parse(audit[0].filters_json);
  assert.equal(d.branch, 'fr');
  assert.equal(d.branch_user_id, BRANCH_ADMIN);
  assert.ok(!('target_user_id' in d), 'the audit carries target_user_id, which logAdminAction reads as an HQ id');
  assert.equal((db.prepare('SELECT role FROM users WHERE id = ?').get(BRANCH_ADMIN) as any).role, 'founder',
    'HQ\'s own account 7 was touched');
});

/* ------------------------------------------------------------------ *
 * 4. Termination                                                      *
 * ------------------------------------------------------------------ */

test('D262: terminate asks the branch to unbind every administrator, after the push, with no target', async () => {
  const db = freshDb();
  withLicence(db);
  const fr = branchStub();
  const r = await req(makeEnv(db, { BRANCH_FR: fr.stub }), 'POST', `/api/admin/licences/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(fr.calls.map((c) => c.method), ['applyLicence', 'unbindAdmin'], 'the unbind did not follow the push');
  const call = fr.calls[1];
  assert.equal(call.args[0], HQ_RPC_SECRET);
  assert.ok(!('target_user_id' in (call.args[1] as any)), 'termination named one administrator instead of every one');
  assert.match((call.args[1] as any).reason, /^Licence terminated: the agreement has ended/);
  assert.equal(r.body.branch_admins_unbound.ok, true);
  assert.equal(r.body.branch_admins_unbound.unbound, 2);
});

test('D262: a branch that throws does not undo the termination — it is reported as its own field', async () => {
  const db = freshDb();
  withLicence(db);
  const fr = branchStub({ throws: true });
  const r = await req(makeEnv(db, { BRANCH_FR: fr.stub }), 'POST', `/api/admin/licences/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(r.status, 200, `a failed unbind turned the termination into ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.status, 'terminated');
  assert.equal((db.prepare('SELECT status FROM territory_licences WHERE uid = ?').get(LIC) as any).status, 'terminated',
    'the termination was undone by the cleanup after it');
  assert.ok(fr.calls.some((c) => c.method === 'unbindAdmin'), 'the unbind was never attempted');
  assert.equal(r.body.branch_admins_unbound.ok, false);
  assert.match(r.body.branch_admins_unbound.reason, /termination is recorded/);
});

test('D262: terminate now needs a fresh step-up — the write bar — and a stale session terminates nothing', async () => {
  const db = freshDb();
  withLicence(db);
  const fr = branchStub();
  const r = await req(makeEnv(db, { BRANCH_FR: fr.stub }), 'POST', `/api/admin/licences/${LIC}/terminate`,
    { note: 'the agreement has ended' }, HQ, 'stale-1');
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT status FROM territory_licences WHERE uid = ?').get(LIC) as any).status, 'active');
  assert.equal(fr.calls.length, 0);
});
