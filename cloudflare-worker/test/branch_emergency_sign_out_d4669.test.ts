/**
 * D4669 part 2 (#4669) — HQ's emergency sign-out reaches branch deployments ON
 * REQUEST, and each branch reports its own outcome (the owner's option B,
 * 2026-11-10).
 *
 * Three halves, each where it can actually fail:
 *   1. the branch's `emergencySignOut` against a database built from the
 *      baseline and every migration: refusals write nothing, the write and its
 *      audit row land together, and a retry of the same act writes nothing;
 *   2. HQ's route through the bundled Worker, with the REAL branch function
 *      bound as `BRANCH_FR` over its own database, beside stubs that refuse or
 *      never answer: a branch that did not answer is never counted as done,
 *      and partial is said as partial;
 *   3. the deadline: a branch that is still running when HQ stops waiting is
 *      `unreachable`, with mock timers rather than a ten-second test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_emergency_sign_out_d4669.test.ts
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
import { d1Over } from './_d1_sqlite.mjs';
import { emergencySignOut, EMERGENCY_SIGN_OUT_ACTION } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import {
  signOutOnBranches, classifyBranchError, overallOutcome, BRANCH_WRITE_DEADLINE_MS,
} from '../src/services/emergencyScope.ts';
import { DeadlineExceeded } from '../src/util/deadline.ts';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  // #3852: the Agents SDK (sdkRuntime.ts) also imports these; nothing here calls them.
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';
const out = join(mkdtempSync(join(tmpdir(), 'd4669b-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  // D711 — the legal paper's faces and mark, as wrangler.toml's `Data` rule bundles them.
  loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22',
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

function hqDb(): DB {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  const s = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now', ?), ?)`,
  );
  s.run('totp-1', HQ, '+0 seconds', null);
  s.run('totp-2', PLAIN, '+0 seconds', null);
  s.run('stale-1', HQ, '-2 days', null);
  return db;
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


const REASON = 'Credential leak reported on the shared drive, ticket 9012';
const KEY = `op_${'a'.repeat(32)}`;
const KEY2 = `op_${'b'.repeat(32)}`;

// ─────────────────────────────────────────── the branch, on its own database

const FR_ALICE = 21; const FR_BEN = 22; const FR_GONE = 23;

function branchDb(): DB {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, jwt_min_iat) VALUES (?, ?, ?, ?, ?, 0)');
  u.run(FR_ALICE, 'founder', 'Alice FR', 'Alice@FR.example', 1);
  u.run(FR_BEN, 'investor', 'Ben FR', 'ben@fr.example', 1);
  u.run(FR_GONE, 'founder', 'Gone FR', 'gone@fr.example', 0);
  return db;
}

async function branchEnv(db: DB, opts: { hash?: string | null } = {}) {
  const hash = opts.hash === undefined ? await sha256Hex(HQ_RPC_SECRET) : opts.hash;
  return {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development',
    BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc', PUBLIC_BASE_URL: 'https://fr.axal.vc',
    ...(hash === null ? {} : { HQ_RPC_SECRET_HASH: hash }),
  } as any;
}

const floors = (db: DB) => JSON.stringify(db.prepare('SELECT id, jwt_min_iat FROM users ORDER BY id').all());
const logRows = (db: DB) => db.prepare(
  `SELECT action, actor, user_id, details FROM activity_logs WHERE action IN (?, 'your_sessions_ended') ORDER BY id`,
).all(EMERGENCY_SIGN_OUT_ACTION) as any[];
const bReq = (over: Record<string, unknown> = {}) => ({
  hq_actor_name: 'Hana HQ', reason: REASON, op_key: KEY, target: { kind: 'all' }, ...over,
}) as any;

test('branch: every refusal is an rpc: error thrown before anything is written', async () => {
  const cases: Array<[string, (db: DB) => Promise<unknown>, RegExp]> = [
    ['a wrong secret', async (db) => emergencySignOut(await branchEnv(db), 'not-the-secret', bReq()), /rpc: HQ presented the wrong secret/],
    ['a branch with no hash', async (db) => emergencySignOut(await branchEnv(db, { hash: null }), HQ_RPC_SECRET, bReq()), /rpc: .*HQ_RPC_SECRET_HASH/],
    ['a short reason', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ reason: 'too short' })), /rpc: .*reason/],
    ['no operator', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ hq_actor_name: ' ' })), /rpc: .*operator/],
    ['a malformed key', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ op_key: 'op_123' })), /rpc: .*operation key/],
    ['no target', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'some' } })), /rpc: .*target/],
    ['an id this branch does not hold', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'account', user_id: 999 } })), /rpc: fr holds no account with id 999/],
    ['an email that is not one', async (db) => emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'account', email: 'nobody' } })), /rpc: /],
  ];
  for (const [what, call, pattern] of cases) {
    const db = branchDb();
    const before = floors(db);
    await assert.rejects(call(db), pattern, what);
    assert.equal(floors(db), before, `${what}: a floor moved`);
    assert.equal(logRows(db).length, 0, `${what}: something was recorded`);
  }
});

test('branch: every account — the active ones are signed out, and the count is in the audit row', async () => {
  // Mutation checked: without `WHERE is_active = 1` the inactive account's floor moves.
  const db = branchDb();
  const res = await emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq());
  assert.equal(res.affected, 2);
  assert.equal(res.replayed, false);
  assert.equal(res.branch, 'fr');
  const f = db.prepare('SELECT id, jwt_min_iat FROM users ORDER BY id').all() as any[];
  assert.ok(f.find((x) => x.id === FR_ALICE).jwt_min_iat > 0 && f.find((x) => x.id === FR_BEN).jwt_min_iat > 0);
  assert.equal(f.find((x) => x.id === FR_GONE).jwt_min_iat, 0, 'an inactive account was touched');
  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.match(rows[0].details, /affected=2/);
  assert.match(rows[0].details, new RegExp(`\\[op:${KEY}\\]`));
  assert.equal(rows[0].actor, 'hq:Hana HQ');
});

test('branch: one account by email (any case) — only that floor moves, with a row for the act and one for the person', async () => {
  const db = branchDb();
  const res = await emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'account', email: 'alice@fr.EXAMPLE' } }));
  assert.equal(res.affected, 1);
  assert.equal(res.note, null);
  const f = db.prepare('SELECT id, jwt_min_iat FROM users ORDER BY id').all() as any[];
  assert.ok(f.find((x) => x.id === FR_ALICE).jwt_min_iat > 0);
  assert.equal(f.find((x) => x.id === FR_BEN).jwt_min_iat, 0, 'another account was signed out');
  const rows = logRows(db);
  assert.deepEqual(rows.map((r) => [r.action, r.user_id]), [[EMERGENCY_SIGN_OUT_ACTION, FR_ALICE], ['your_sessions_ended', FR_ALICE]]);
  assert.match(rows[0].details, /affected=1/);
});

test('branch: one account by its id on this branch', async () => {
  const db = branchDb();
  const res = await emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'account', user_id: FR_BEN } }));
  assert.equal(res.affected, 1);
  const f = db.prepare('SELECT id, jwt_min_iat FROM users WHERE id = ?').get(FR_BEN) as any;
  assert.ok(f.jwt_min_iat > 0);
});

test('branch: an email nobody holds here is a fact, not an error — nothing signed out, the act recorded', async () => {
  const db = branchDb();
  const before = floors(db);
  const res = await emergencySignOut(await branchEnv(db), HQ_RPC_SECRET, bReq({ target: { kind: 'account', email: 'stranger@else.example' } }));
  assert.equal(res.affected, 0);
  assert.equal(res.note, 'no_account');
  assert.equal(floors(db), before);
  assert.equal(logRows(db).length, 1, 'the act was not recorded, so its retry would not be recognised');
});

test('branch: the same key twice is one act — the retry writes nothing and answers what the first did', async () => {
  // Mutation checked: without the key lookup, the retry raises the floor
  // again and writes a second audit row.
  const db = branchDb();
  const env = await branchEnv(db);
  const first = await emergencySignOut(env, HQ_RPC_SECRET, bReq());
  const after = floors(db);
  const again = await emergencySignOut(env, HQ_RPC_SECRET, bReq());
  assert.equal(again.replayed, true);
  assert.equal(again.affected, first.affected, 'the replay reports a different count');
  assert.equal(again.revoked_at, null);
  assert.equal(floors(db), after, 'the retry moved a floor');
  assert.equal(logRows(db).length, 1, 'the retry wrote a second row');
  // A different act is a different key.
  const other = await emergencySignOut(env, HQ_RPC_SECRET, bReq({ op_key: KEY2 }));
  assert.equal(other.replayed, false);
  assert.equal(logRows(db).length, 2);
});

// ──────────────────────────────────────────────────── HQ's route, end to end

const BRANCH_FR_ACCOUNTS = () => branchDb();

async function realBranch(db: DB) {
  const env = await branchEnv(db);
  const calls: unknown[] = [];
  return { calls, stub: { async emergencySignOut(secret: string, r: unknown) { calls.push(r); return emergencySignOut(env, secret, r as any); } } };
}
function refusingBranch() {
  const calls: unknown[] = [];
  return { calls, stub: { async emergencySignOut(_s: string, r: unknown) { calls.push(r); throw new Error('rpc: de holds no account with id 4'); } } };
}
function brokenBranch() {
  const calls: unknown[] = [];
  return { calls, stub: { async emergencySignOut(_s: string, r: unknown) { calls.push(r); throw new Error('Network connection lost.'); } } };
}

const signOut = (env: any, body: Record<string, unknown>, as = HQ, jti: string | null = 'totp-1') =>
  req(env, 'POST', '/api/admin/security/branch-sign-out', { reason: REASON, op_key: KEY, target: { kind: 'all' }, branches: 'all', ...body }, as, jti);

test('HQ: the act carries the write bar, a reason, a key and a secret — and no branch is asked before all four', async () => {
  const fr = await realBranch(BRANCH_FR_ACCOUNTS());
  const env = makeEnv(hqDb(), { BRANCH_FR: fr.stub });
  assert.equal((await signOut(env, {}, PLAIN, 'totp-2')).status, 403, 'an admin without the elevation');
  assert.equal((await signOut(env, {}, HQ, 'stale-1')).status, 403, 'a session without a fresh TOTP');
  assert.equal((await signOut(env, { reason: 'short' })).body.code, 'reason_required');
  assert.equal((await signOut(env, { op_key: 'nope' })).body.code, 'op_key_required');
  assert.equal((await signOut(env, { target: { kind: 'someone' } })).body.code, 'invalid_target');
  assert.equal((await signOut(env, { target: { kind: 'account', user_id: 4 }, branches: ['fr', 'de'] })).body.code, 'invalid_target',
    'an id belongs to one branch');
  const noSecret = makeEnv(hqDb(), { BRANCH_FR: fr.stub }, { HQ_RPC_SECRET: undefined });
  const ns = await signOut(noSecret, {});
  assert.equal(ns.status, 409);
  assert.equal(ns.body.code, 'hq_rpc_secret_unset');
  const none = await signOut(makeEnv(hqDb(), {}), {});
  assert.equal(none.status, 409);
  assert.equal(none.body.code, 'no_branch');
  assert.equal(fr.calls.length, 0, 'a branch was asked before every check passed');
});

test('HQ: done on one branch, refused on another, silent on a third — partial, each said as what it is', async () => {
  const frDb = BRANCH_FR_ACCOUNTS();
  const fr = await realBranch(frDb);
  const de = refusingBranch();
  const it = brokenBranch();
  const hq = hqDb();
  const env = makeEnv(hq, { BRANCH_FR: fr.stub, BRANCH_DE: de.stub, BRANCH_IT: it.stub });
  const res = await signOut(env, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'partial');
  assert.equal(res.body.ok, false, 'a partial act reads as success');
  const by = Object.fromEntries(res.body.outcomes.map((o: any) => [o.deployment, o]));
  assert.equal(by.fr.outcome, 'done');
  assert.equal(by.fr.affected, 2);
  assert.equal(by.de.outcome, 'failed', 'a branch refusal is a certain "nothing changed"');
  assert.match(by.de.reason, /Nothing changed there\./);
  // Mutation checked: classifying every error as `failed` turns this row into
  // a certain "nothing changed" about a branch that may have acted.
  assert.equal(by.it.outcome, 'unreachable', 'a branch that did not answer is not known to have failed');
  assert.match(by.it.reason, /not known/);
  assert.match(res.body.message, /1 of 3 branches answered that they acted/);
  // The branch really acted, and HQ recorded the act with every branch's row.
  assert.equal(logRows(frDb).length, 1);
  const audit = hq.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'security_branch_sign_out'").get() as any;
  assert.ok(audit, 'HQ did not record the act');
  const recorded = JSON.parse(audit.filters_json);
  assert.equal(recorded.outcome, 'partial');
  assert.deepEqual(recorded.branches.map((b: any) => [b.code, b.outcome]).sort(), [['de', 'failed'], ['fr', 'done'], ['it', 'unreachable']]);
});

test('HQ: done only when every branch asked says done; a retry of the same act is answered from each branch\'s record', async () => {
  const frDb = BRANCH_FR_ACCOUNTS();
  const fr = await realBranch(frDb);
  const env = makeEnv(hqDb(), { BRANCH_FR: fr.stub });
  const first = await signOut(env, { target: { kind: 'account', email: 'ben@fr.example' } });
  assert.equal(first.body.outcome, 'done');
  assert.equal(first.body.ok, true);
  const after = floors(frDb);
  const retry = await signOut(env, { target: { kind: 'account', email: 'ben@fr.example' } });
  assert.equal(retry.body.outcome, 'done');
  assert.equal(retry.body.outcomes[0].replayed, true);
  assert.equal(floors(frDb), after, 'the retry signed someone out again');
});

test('HQ: a named branch with no binding is asked nothing and is not counted as done', async () => {
  const fr = await realBranch(BRANCH_FR_ACCOUNTS());
  const env = makeEnv(hqDb(), { BRANCH_FR: fr.stub });
  const res = await signOut(env, { branches: ['fr', 'zz'] });
  assert.equal(res.body.outcome, 'partial');
  const zz = res.body.outcomes.find((o: any) => o.deployment === 'zz');
  assert.equal(zz.outcome, 'unreachable');
  assert.match(zz.reason, /not asked/);
});

test('HQ: an email reaches the person on every branch named; a branch without them says so', async () => {
  const frDb = BRANCH_FR_ACCOUNTS();
  const fr = await realBranch(frDb);
  const deDb = branchDb();
  deDb.prepare("UPDATE users SET email = 'someone-else@de.example' WHERE id = ?").run(FR_ALICE);
  const deEnv = { ...(await branchEnv(deDb)), BRANCH_CODE: 'de' };
  const de = { stub: { async emergencySignOut(secret: string, r: any) { return emergencySignOut(deEnv, secret, r); } } };
  const env = makeEnv(hqDb(), { BRANCH_FR: fr.stub, BRANCH_DE: de.stub });
  const res = await signOut(env, { target: { kind: 'account', email: 'alice@fr.example' } });
  assert.equal(res.body.outcome, 'done', 'a branch that answered "no such account" did answer');
  const by = Object.fromEntries(res.body.outcomes.map((o: any) => [o.deployment, o]));
  assert.equal(by.fr.affected, 1);
  assert.equal(by.de.affected, 0);
  assert.match(by.de.reason, /No account holds that email on this branch/);
});

// ─────────────────────────────────────────────────── the deadline, and the words

test('a branch still running when HQ stops waiting is unreachable — never done, never failed', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const env = { BRANCH_FR: { emergencySignOut: () => new Promise(() => {}) } } as any;
    const pending = signOutOnBranches(env, ['fr'], { secret: 's', hq_actor_name: 'H', reason: REASON, op_key: KEY, target: { kind: 'all' } });
    await Promise.resolve();
    mock.timers.tick(BRANCH_WRITE_DEADLINE_MS);
    const res = await pending;
    assert.equal(res.outcome, 'failed', 'no branch answered, so nothing is done');
    assert.equal(res.outcomes[0].outcome, 'unreachable');
    assert.equal(res.outcomes[0].timed_out, true);
    assert.match(String(res.outcomes[0].reason), /may or may not have signed anyone out/);
  } finally { mock.timers.reset(); }
});

test('the error a branch raises on purpose is failed; anything else is unreachable', () => {
  assert.equal(classifyBranchError('fr', new Error('rpc: fr holds no account with id 3')).outcome, 'failed');
  assert.equal(classifyBranchError('fr', new DeadlineExceeded('x', 1)).outcome, 'unreachable');
  assert.equal(classifyBranchError('fr', new Error('Network connection lost.')).outcome, 'unreachable');
  assert.equal(classifyBranchError('fr', 'a string').outcome, 'unreachable');
});

test('the whole act is done only when every branch is done', () => {
  const r = (outcome: any) => ({ deployment: 'x', outcome });
  assert.equal(overallOutcome([r('done'), r('done')]), 'done');
  assert.equal(overallOutcome([r('done'), r('unreachable')]), 'partial');
  assert.equal(overallOutcome([r('done'), r('failed')]), 'partial');
  assert.equal(overallOutcome([r('failed'), r('unreachable')]), 'failed');
  assert.equal(overallOutcome([]), 'failed', 'an act that asked nobody is not done');
});
