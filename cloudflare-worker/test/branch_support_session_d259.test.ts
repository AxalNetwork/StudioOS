/**
 * D259 — HQ's cross-host support session (D120): the recovery cool-off pauses
 * it and the move beside it, the audit reaches Security, and the account is
 * named as a BRANCH-local id rather than as an HQ user.
 *
 * THE WHOLE WORKER, the D248 harness: `index.ts` bundled the way Wrangler
 * bundles it, every request through the real `fetch`, on the database the
 * repo's schema story builds (`buildFresh`, the deploy's step 9, D235). The
 * cool-off is registered in index.ts ahead of the route table, so whether a
 * request reaches the branch is a question only the whole Worker can answer.
 *
 * The branch is a stub binding, `BRANCH_FR`, whose methods record every call.
 * "The spy is never called" is the property: a refused request that still
 * reached the branch would have opened a session there.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_support_session_d259.test.ts
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
const out = join(mkdtempSync(join(tmpdir(), 'd259-')), 'worker.mjs');
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
const BRANCH_ACCOUNT = 7;  // an id on the FR branch's own database
const REASON = 'Founder on FR cannot reach their data room (ticket 6120)';

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
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  // A DIFFERENT PERSON who happens to hold id 7 in HQ's own database. If the
  // audit row named the branch account as `target_user_id`, Security would
  // join it here and name Otto — the wrong person on the wrong database.
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(BRANCH_ACCOUNT, 'founder', 'Otto HQ-Local', 'otto@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES ('totp-1', ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(HQ);
  return db;
}

function coolOff(db: DB, userId: number) {
  db.prepare(
    `INSERT INTO user_recovery_state (user_id, cooling_off_until, updated_at)
     VALUES (?, datetime('now', '+1 day'), datetime('now'))`,
  ).run(userId);
}

/** The FR branch, as a stub binding that records every call. */
function branchStub() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = {
    async openSupportSession(...args: unknown[]) {
      calls.push({ method: 'openSupportSession', args });
      return {
        target: { id: BRANCH_ACCOUNT, name: 'Fleur Founder', email: 'fleur@fr.example', role: 'founder' },
        expires_at: '2026-09-24 12:05:00',
        redeem_path: '/support/session?code=one-time-test-code',
      };
    },
    async moveAccountOut(...args: unknown[]) { calls.push({ method: 'moveAccountOut', args }); return { ok: true }; },
    async inviteAccount(...args: unknown[]) { calls.push({ method: 'inviteAccount', args }); return { ok: true }; },
  };
  return { stub, calls };
}

function makeEnv(db: DB, branches: Record<string, unknown>) {
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
  } as any;
}

async function jwtFor(userId: number, session = true): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', ...(session ? { jti: `totp-${userId}` } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(
  env: any, method: string, path: string, body?: Record<string, unknown>, session = true,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(HQ, session)}` };
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

const open = (env: any, session = true) =>
  req(env, 'POST', '/api/admin/branches/fr/support-session', { target_user_id: BRANCH_ACCOUNT, reason: REASON }, session);

/* ------------------------------------------------------------------ *
 * 1. The recovery cool-off                                            *
 * ------------------------------------------------------------------ */

test('D259: inside the recovery cool-off, opening a branch support session is refused 423 and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const env = makeEnv(db, { BRANCH_FR: fr.stub });
  coolOff(db, HQ);
  const r = await open(env);
  assert.equal(r.status, 423, `the open was not paused by the cool-off: ${JSON.stringify(r.body)}`);
  assert.equal(r.body?.error, 'recovery_cool_off_active', 'the 423 did not come from the cool-off middleware');
  assert.equal(fr.calls.length, 0, 'a refused request still reached the branch and opened a session there');
});

test('D259: inside the recovery cool-off, moving an account between branches is refused 423 and neither branch is called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const de = branchStub();
  const env = makeEnv(db, { BRANCH_FR: fr.stub, BRANCH_DE: de.stub });
  coolOff(db, HQ);
  const r = await req(env, 'POST', `/api/admin/branches/fr/accounts/${BRANCH_ACCOUNT}/move`,
    { destination_code: 'de', reason: 'Founder relocated from Lyon to Berlin' });
  assert.equal(r.status, 423, `the move was not paused by the cool-off: ${JSON.stringify(r.body)}`);
  assert.equal(r.body?.error, 'recovery_cool_off_active');
  assert.equal(fr.calls.length + de.calls.length, 0, 'a refused move still reached a branch');
});

test('D259: the gates still come first — no TOTP session is refused and the branch is never called', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await open(makeEnv(db, { BRANCH_FR: fr.stub }), false);
  assert.equal(r.status, 403, `a bare JWT opened a branch session: ${JSON.stringify(r.body)}`);
  assert.equal(fr.calls.length, 0);
});

/* ------------------------------------------------------------------ *
 * 2. Opening one, and the record it leaves                            *
 * ------------------------------------------------------------------ */

test('D259: outside the cool-off, the session opens on the branch and answers the URL the route built', async () => {
  const db = freshDb();
  const fr = branchStub();
  const r = await open(makeEnv(db, { BRANCH_FR: fr.stub }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(fr.calls.length, 1, 'the branch was not asked exactly once');
  assert.equal(fr.calls[0].args[0], HQ_RPC_SECRET, 'the branch call does not lead with the HQ secret');
  assert.equal((fr.calls[0].args[1] as any).target_user_id, BRANCH_ACCOUNT);
  assert.equal(r.body?.open_url, 'https://fr.axal.vc/support/session?code=one-time-test-code');
  assert.equal(r.body?.branch, 'fr');
});

test('D259: the audit row names the branch and its account, never an HQ user — and Security shows it', async () => {
  const db = freshDb();
  const fr = branchStub();
  const env = makeEnv(db, { BRANCH_FR: fr.stub });
  const r = await open(env);
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const audit = db.prepare(
    "SELECT admin_user_id, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'hq_branch_support_session'",
  ).all() as any[];
  assert.equal(audit.length, 1, 'the act did not reach admin_audit_log');
  assert.equal(audit[0].admin_user_id, HQ);
  assert.equal(audit[0].viewed_user_id, null,
    'the branch account was stored as an HQ viewed_user_id — Security would name the HQ user who holds that id');
  const d = JSON.parse(audit[0].filters_json);
  assert.deepEqual([d.branch, d.branch_user_id, d.reason], ['fr', BRANCH_ACCOUNT, REASON]);
  assert.ok(!('target_user_id' in d), 'the audit details carry target_user_id, which logAdminAction reads as an HQ id');

  const feed = await req(env, 'GET', '/api/admin/security/governance?filter=all');
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  const rows = (feed.body?.rows || feed.body?.items || []) as any[];
  const mine = rows.filter((x) => x.action === 'hq_branch_support_session');
  assert.ok(mine.some((x) => x.source === 'activity_logs'), 'the activity arm does not show HQ opening a branch session');
  assert.ok(mine.some((x) => x.source === 'admin_audit_log'), 'the audit arm does not show HQ opening a branch session');
  assert.ok(mine.every((x) => !String(x.target || '').includes('Otto')),
    'Security named the HQ user who shares the branch account\'s id');
});
