/**
 * #4686 (D4686) — termination cleanup and branch licence synchronisation are
 * durable, ordered by REVISION, and never reported as more than they were.
 *
 * What is asserted, by acceptance criterion (each guard was mutation-checked;
 * the list is in D4686.md):
 *   (a) a failure injected after the licence is marked terminated leaves a
 *       visible, resumable operation — and the transition itself is one batch;
 *   (b) a repeat request completes the outstanding administrator / branch work
 *       and writes NO second `terminated` event;
 *   (c) a branch cannot regress from revision N to N-1, including two writes
 *       inside one second and a late delivery of an older push;
 *   (d) a stale acknowledgement cannot delete newer pending retry work, and a
 *       late failure for a superseded push does not recreate it;
 *   (e) a copy whose sections did not all write is partial, never success —
 *       on the branch and when HQ itself could not read a section;
 *   (f) transition commit, push, retry and acknowledgement under concurrency.
 *
 * REAL SQLITE ON THE REAL SCHEMA (`buildFresh`), D1-shaped batches (`d1Over`:
 * one transaction, synchronous), and the whole Worker for the terminate route.
 * Failures are injected by SQL text, so each one lands on the statement that
 * would fail in production.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_termination_durable_4686.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applyLicenceCopy, unbindAdmin } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import {
  pushLicenceToBranch, retryPendingLicencePushes, allocateRevision, LICENCE_PUSH_RETRY_WINDOW_MINUTES,
} from '../src/services/licencePush.ts';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';
const out = join(mkdtempSync(join(tmpdir(), 'd4686-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22',
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
  plugins: [{
    name: 'workers-shims',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
    },
  }],
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const worker = (await import(pathToFileURL(out).href)).default;

function buildFresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS as any);
  loadSchema(db);
  return db;
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_RPC_SECRET = 'synthetic-test-value-not-a-credential';
const HQ = 1;
const PRINCIPAL = 21;
const DEPUTY = 22;
const LIC = 'lic-fr-4686';
const LIC_ID = 1;

type DB = DatabaseSync;

/* ------------------------------------------------------------------ *
 * Harness                                                              *
 * ------------------------------------------------------------------ */

/** The D1 binding, with a switch that makes matching statements throw. */
function flaky(db: DB, rule: { fail: (sql: string) => boolean; stale?: { re: RegExp; first?: any; all?: any[] } | null } = { fail: () => false }) {
  const base = d1Over(db);
  return {
    rule,
    prepare(sql: string) {
      const st = base.prepare(sql);
      // A read that answers ONCE from a snapshot taken earlier: the request saw the world
      // before another request changed it.
      if (rule.stale && rule.stale.re.test(sql)) {
        const snap = rule.stale; rule.stale = null;
        const api: any = { bind: () => api, first: async () => snap.first ?? null, all: async () => ({ results: snap.all ?? [] }), run: async () => st.run(), runSync: () => st.runSync() };
        return api;
      }
      if (!rule.fail(sql)) return st;
      const boom = (): never => { throw new Error('injected: disk I/O error'); };
      const api: any = { bind: () => api, all: async () => boom(), first: async () => boom(), run: async () => boom(), runSync: boom };
      return api;
    },
    batch: base.batch,
    exec: base.exec,
  };
}

function hqDb(): DB {
  const db = buildFresh();
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  u.run(PRINCIPAL, 'admin', 'Paul Principal', 'paul@fr.example');
  u.run(DEPUTY, 'admin', 'Dana Deputy', 'dana@fr.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES ('totp-1', ?, 'totp', datetime('now'), NULL)`).run(HQ);
  db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years, renews_on)
     VALUES (?, ?, 'AXL-FR-1', 'Axal VC France SAS', 'Axal VC France', 'active', 3, '2027-01-01')`,
  ).run(LIC_ID, LIC);
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES (?, 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr-db', 'live')`,
  ).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (?, 'FR')").run(LIC_ID);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (?, 'DE')").run(LIC_ID);
  const la = db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (?, ?, ?)");
  la.run(LIC_ID, PRINCIPAL, 'principal');
  la.run(LIC_ID, DEPUTY, 'delegate');
  return db;
}

function branchDb(): DB {
  const db = buildFresh();
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}
const branchEnv = (bdb: DB) => ({ DB: d1Over(bdb), BRANCH_CODE: 'fr' } as any);
const branchRow = (bdb: DB) => bdb.prepare('SELECT * FROM branch_licence WHERE id = 1').get() as any;

/** The FR branch as HQ's service binding: applyLicence runs the branch's REAL writer on `bdb`. */
function branchBinding(bdb: DB, opts: {
  applyThrows?: (n: number) => boolean; unbindThrows?: () => boolean; gate?: (n: number) => Promise<void> | undefined;
} = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let applyN = 0;
  const stub = {
    async applyLicence(record: Record<string, unknown>) {
      const n = ++applyN;
      calls.push({ method: 'applyLicence', args: [record] });
      const g = opts.gate?.(n);
      if (g) await g;
      if (opts.applyThrows?.(n)) throw new Error('rpc: fr did not answer');
      return applyLicenceCopy(branchEnv(bdb), record);
    },
    async unbindAdmin(...args: unknown[]) {
      calls.push({ method: 'unbindAdmin', args });
      if (opts.unbindThrows?.()) throw new Error('rpc: fr did not answer');
      return { unbound: [{ id: 7 }], skipped: [], branch: 'fr', as_of: '2026-11-07T10:00:00Z' };
    },
  };
  return { stub, calls };
}

function makeEnv(db: ReturnType<typeof flaky>, branches: Record<string, unknown> = {}) {
  const kv = new Map<string, string>();
  return {
    JWT_SECRET, ENVIRONMENT: 'development', HQ_RPC_SECRET,
    DB: db,
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
    ...branches,
  } as any;
}

async function jwtFor(userId: number, jti: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(env: any, method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(HQ, 'totp-1')}` };
  if (body) headers['content-type'] = 'application/json';
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    const waits: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    const res = await worker.fetch(
      new Request(`https://axal.vc${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx,
    );
    await Promise.allSettled(waits);
    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: parsed };
  } finally {
    silence.forEach((m) => m.mock.restore());
  }
}
const terminate = (env: any, body: Record<string, unknown> = { note: 'the agreement has ended' }) =>
  req(env, 'POST', `/api/admin/licences/${LIC}/terminate`, body);

const termEvents = (db: DB) => Number((db.prepare("SELECT COUNT(*) AS n FROM licence_events WHERE licence_id = ? AND event = 'terminated'").get(LIC_ID) as any).n);
const ops = (db: DB) => db.prepare('SELECT * FROM licence_termination_ops WHERE licence_id = ?').get(LIC_ID) as any;
const pending = (db: DB) => db.prepare('SELECT * FROM licence_push_pending WHERE licence_id = ?').get(LIC_ID) as any;
const syncState = (db: DB) => db.prepare('SELECT * FROM licence_sync_state WHERE licence_id = ?').get(LIC_ID) as any;
const licStatus = (db: DB) => (db.prepare('SELECT status FROM territory_licences WHERE id = ?').get(LIC_ID) as any).status;
const role = (db: DB, id: number) => db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(id) as any;
const boundAdmins = (db: DB) => Number((db.prepare('SELECT COUNT(*) AS n FROM licence_admins WHERE licence_id = ?').get(LIC_ID) as any).n);
const quiet = <T>(fn: () => Promise<T>) => {
  const m = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  return fn().finally(() => m.forEach((x) => x.mock.restore()));
};
const tick = () => new Promise((r) => setImmediate(r));

/* ------------------------------------------------------------------ *
 * (a) the transition, its event and the intent commit together          *
 * ------------------------------------------------------------------ */

test('(a) the terminal transition, its event, the release, the revision and the intent are ONE batch', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  // Fail the LAST statement of the batch (the durable intent). Nothing may stay.
  d1.rule.fail = (sql) => /INSERT INTO licence_termination_ops/.test(sql);
  const bb = branchBinding(branchDb());
  const r = await terminate(makeEnv(d1, { BRANCH_FR: bb.stub }));
  assert.equal(r.status, 503, 'a transition whose intent could not be written must not report success');
  assert.ok(!JSON.stringify(r.body).includes('injected'), 'raw error text leaked');
  assert.equal(licStatus(db), 'active', 'the status moved without its durable intent');
  assert.equal(termEvents(db), 0, 'the event was written without its transition');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM licence_territories WHERE licence_id = ?').get(LIC_ID) as any).n), 2,
    'the territory was released without its intent');
  assert.equal(syncState(db), undefined, 'a revision was consumed by a transition that rolled back');
  assert.equal(bb.calls.length, 0, 'the branch was touched by a transition that did not commit');
});

test('(a) a failure injected after the licence is marked terminated leaves a visible, resumable operation', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  // The HQ deprovision batch fails: the licence is already terminated.
  d1.rule.fail = (sql) => /DELETE FROM licence_admins/.test(sql);
  const bb = branchBinding(branchDb());
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  const r = await terminate(env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(licStatus(db), 'terminated');
  assert.equal(r.body.operation.status, 'incomplete');
  assert.equal(r.body.operation.failure_step, 'admins');
  const row = ops(db);
  assert.equal(row.status, 'incomplete');
  assert.equal(row.admins_state, 'failed');
  assert.equal(row.notices_state, 'done');
  assert.equal(row.notify_state, 'done');
  assert.equal(row.lease_until, null, 'the claim must be released so the next request can resume at once');
  assert.equal(role(db, PRINCIPAL).role, 'admin', 'the fixture should still hold the admin role (the failure was injected before it)');

  // It is VISIBLE in HQ's read of the licence.
  const read = await req(env, 'GET', `/api/admin/licences/${LIC}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.sync.termination.status, 'incomplete');
  assert.equal(read.body.sync.termination.steps.admins, 'failed');
  assert.equal(read.body.sync.termination.failure_step, 'admins');
  assert.ok(!JSON.stringify(read.body.sync).includes('injected'), 'raw error text reached the HQ read');
});

test('(a) an exception between the commit and the last consequence still leaves the operation resumable', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  // Not a handled step failure: the progress write itself throws, once.
  let thrown = false;
  d1.rule.fail = (sql) => /SET notices_state = \?, notify_state/.test(sql) && !thrown && (thrown = true);
  const bb = branchBinding(branchDb());
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  const r = await terminate(env);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'termination_interrupted');
  assert.equal(licStatus(db), 'terminated');
  assert.equal(ops(db).status, 'incomplete', 'the interrupted operation was lost');
  assert.equal(ops(db).lease_until, null, 'a crashed run held the claim');
  d1.rule.fail = () => false;
  const again = await terminate(env);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.operation.status, 'complete');
  assert.equal(termEvents(db), 1);
});

/* ------------------------------------------------------------------ *
 * (b) a repeat request resumes, and never writes a second event         *
 * ------------------------------------------------------------------ */

test('(b) retrying completes the outstanding administrator and branch work, with exactly one terminated event', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  let broken = true;
  d1.rule.fail = (sql) => broken && /DELETE FROM licence_admins/.test(sql);
  let branchDown = true;
  const bb = branchBinding(branchDb(), { unbindThrows: () => branchDown, applyThrows: () => branchDown });
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });

  const first = await terminate(env);
  assert.equal(first.status, 200);
  assert.equal(first.body.operation.status, 'incomplete');
  assert.deepEqual(
    Object.entries(ops(db)).filter(([k, v]) => /_state$/.test(k) && v === 'failed').map(([k]) => k).sort(),
    ['admins_state', 'push_state', 'unbind_state'],
  );
  assert.equal(termEvents(db), 1);
  const notified = Number((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'licence_terminated'").get() as any).n);
  assert.equal(notified, 2, 'both administrators should have been told once');

  broken = false; branchDown = false;
  const second = await terminate(env, {});   // a resume needs no note
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.resumed, true);
  assert.equal(second.body.operation.status, 'complete');
  assert.equal(ops(db).status, 'complete');
  assert.ok(ops(db).completed_at);
  assert.equal(boundAdmins(db), 0);
  assert.equal(role(db, PRINCIPAL).role, 'exploring');
  assert.equal(role(db, DEPUTY).is_active, 0);
  assert.equal(termEvents(db), 1, 'a second terminal event was written');
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'licence_terminated'").get() as any).n), notified,
    'the administrators were told twice',
  );
  assert.ok(bb.calls.some((c) => c.method === 'unbindAdmin'));
  assert.equal(pending(db), undefined, 'a push that landed left its retry row behind');

  // Nothing left: a third request is refused, and still writes no event.
  const third = await terminate(env, {});
  assert.equal(third.status, 409);
  assert.match(String(third.body.message), /nothing to resume/);
  assert.equal(termEvents(db), 1);
});

test('(b) a resume does not repeat a step that is done', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  let down = true;
  const bb = branchBinding(branchDb(), { unbindThrows: () => down });
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  await terminate(env);
  assert.equal(ops(db).unbind_state, 'failed');
  assert.equal(ops(db).push_state, 'done');
  const pushes = bb.calls.filter((c) => c.method === 'applyLicence').length;
  down = false;
  const r = await terminate(env, {});
  assert.equal(r.body.operation.status, 'complete');
  assert.equal(bb.calls.filter((c) => c.method === 'applyLicence').length, pushes, 'a done push was sent again');
  assert.deepEqual(r.body.pushed, { ok: true, already_done: true });
});

test('(b) a legacy terminated licence with no ledger row keeps its old refusal', async () => {
  const db = hqDb();
  db.prepare("UPDATE territory_licences SET status = 'terminated', terminated_at = datetime('now') WHERE id = ?").run(LIC_ID);
  const r = await terminate(makeEnv(flaky(db)), {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'bad_transition');
  assert.equal(termEvents(db), 0);
});

test('(b) the branch unbind is idempotent, and its role change and audit rows are one batch', async () => {
  const bdb = branchDb();
  bdb.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (7, 'admin', 'Paul', 'paul@fr.example', 1)").run();
  bdb.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (8, 'admin', 'Dana', 'dana@fr.example', 1)").run();
  const hash = await sha256Hex(HQ_RPC_SECRET);
  const env = (d1: any) => ({ DB: d1, BRANCH_CODE: 'fr', HQ_RPC_SECRET_HASH: hash, ENVIRONMENT: 'development' } as any);
  const call = (d1: any) => unbindAdmin(env(d1), HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', reason: 'Licence terminated: the agreement has ended' } as any);
  const audit = () => Number((bdb.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('hq_admin_unbound','your_role_changed')").get() as any).n);

  // An audit insert that fails takes the role change with it.
  const d1 = flaky(bdb);
  d1.rule.fail = (sql) => /INSERT INTO activity_logs/.test(sql);
  await assert.rejects(() => call(d1));
  assert.equal((bdb.prepare('SELECT role FROM users WHERE id = 7').get() as any).role, 'admin', 'the role changed without its audit rows');
  assert.equal(audit(), 0);

  const first: any = await call(d1Over(bdb));
  assert.equal(first.unbound.length, 2);
  assert.equal(audit(), 4);
  const again: any = await call(d1Over(bdb));
  assert.deepEqual([again.unbound.length, again.skipped.length], [0, 0], 'a repeat unbound someone');
  assert.equal(audit(), 4, 'a repeat wrote a second pair of audit rows');
});

test('(b) a request that read the licence BEFORE another terminated it writes no second event, revision or ledger row', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  const env = makeEnv(d1, { BRANCH_FR: branchBinding(branchDb()).stub });
  const before = db.prepare('SELECT * FROM territory_licences WHERE id = ?').get(LIC_ID);   // 'active'
  assert.equal((await terminate(env)).status, 200);
  const rev = syncState(db).hq_revision;
  const events = Number((db.prepare('SELECT COUNT(*) AS n FROM licence_events WHERE licence_id = ?').get(LIC_ID) as any).n);
  // The second request's read of the licence returns the pre-termination row, once.
  d1.rule.stale = { re: /SELECT \* FROM territory_licences WHERE uid = \?/, first: before };
  const r = await terminate(env);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(termEvents(db), 1, 'a second terminal event was written');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM licence_events WHERE licence_id = ?').get(LIC_ID) as any).n), events);
  assert.equal(syncState(db).hq_revision, rev, 'a second revision was consumed');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM licence_termination_ops').get() as any).n), 1);
});

test('(b) an administrator another request already unbound gets no second audit pair', async () => {
  const bdb = branchDb();
  bdb.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (7, 'admin', 'Paul', 'paul@fr.example', 1)").run();
  const hash = await sha256Hex(HQ_RPC_SECRET);
  const d1 = flaky(bdb);
  const env = { DB: d1, BRANCH_CODE: 'fr', HQ_RPC_SECRET_HASH: hash, ENVIRONMENT: 'development' } as any;
  // This request listed account 7 as an active admin; by the time it writes, it is already unbound.
  d1.rule.stale = { re: /WHERE role = 'admin' AND is_active = 1 ORDER BY id/, all: [{ id: 7, name: 'Paul', email: 'paul@fr.example', role: 'admin', is_active: 1 }] };
  bdb.prepare("UPDATE users SET role = 'exploring', is_active = 0 WHERE id = 7").run();
  const res: any = await unbindAdmin(env, HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', reason: 'Licence terminated: the agreement has ended' } as any);
  assert.deepEqual([res.unbound.length, res.skipped.length], [0, 1]);
  assert.equal(Number((bdb.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('hq_admin_unbound','your_role_changed')").get() as any).n), 0,
    'audit rows were written for a change this request did not make');
});

/* ------------------------------------------------------------------ *
 * (c) a branch cannot regress                                           *
 * ------------------------------------------------------------------ */

const rec = (over: Record<string, unknown>) => ({
  licence_uid: LIC, licence_ref: 'AXL-FR-1', territory: 'FR', status: 'active', ...over,
});

test('(c) a branch holding revision N refuses N-1, even when both pushes carry the same second', async () => {
  const bdb = branchDb();
  const env = branchEnv(bdb);
  const sameSecond = ['2026-11-07T10:00:00.100Z', '2026-11-07T10:00:00.900Z'];
  const a: any = await applyLicenceCopy(env, rec({ status: 'suspended', hq_revision: 5, pushed_at: sameSecond[0] }));
  assert.equal(a.applied, true);
  assert.equal(a.hq_revision, 5);
  // The OLDER revision carries the LATER millisecond: the timestamp rule would have accepted it.
  const b: any = await applyLicenceCopy(env, rec({ status: 'active', hq_revision: 4, pushed_at: sameSecond[1] }));
  assert.equal(b.applied, false);
  assert.equal(b.stale, true);
  assert.equal(b.hq_revision, 5, 'the stale answer must say which revision the branch holds');
  assert.equal(branchRow(bdb).status, 'suspended', 'N-1 overwrote N');
  assert.equal(branchRow(bdb).hq_revision, 5);
  // And identical timestamps, ascending revisions: the newer still wins.
  await applyLicenceCopy(env, rec({ status: 'terminated', hq_revision: 6, pushed_at: sameSecond[0] }));
  assert.equal(branchRow(bdb).status, 'terminated');
  // An equal revision is a re-send, applied again, idempotently.
  const same: any = await applyLicenceCopy(env, rec({ status: 'terminated', hq_revision: 6, pushed_at: sameSecond[0] }));
  assert.equal(same.applied, true);
  assert.equal(branchRow(bdb).hq_revision, 6);
});

test('(c) an unnumbered push keeps the pushed_at rule, and a numbered one supersedes a legacy copy', async () => {
  const bdb = branchDb();
  const env = branchEnv(bdb);
  await applyLicenceCopy(env, rec({ status: 'active', pushed_at: '2026-11-07T10:00:00Z' }));
  await applyLicenceCopy(env, rec({ status: 'suspended', pushed_at: '2026-11-07T09:00:00Z' }));
  assert.equal(branchRow(bdb).status, 'active', 'the legacy ordering was lost');
  assert.equal(branchRow(bdb).hq_revision, null);
  const n: any = await applyLicenceCopy(env, rec({ status: 'suspended', hq_revision: 1, pushed_at: '2026-11-07T08:00:00Z' }));
  assert.equal(n.applied, true);
  assert.equal(branchRow(bdb).status, 'suspended');
  await assert.rejects(() => applyLicenceCopy(env, rec({ hq_revision: 0 })), /positive integer/);
});

test('(c) HQ numbers every push, and a push delivered LATE cannot overwrite the newer one', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const bb = branchBinding(bdb, { gate: (n) => (n === 1 ? gate : undefined) });
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });

  const first = pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00.100Z');   // reads 'active', delayed in flight
  while (bb.calls.length < 1) await tick();
  hq.prepare("UPDATE territory_licences SET status = 'suspended', suspended_at = datetime('now') WHERE id = ?").run(LIC_ID);
  const second = await pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00.900Z');   // same second, newer content
  assert.equal(second.ok, true);
  assert.equal(branchRow(bdb).status, 'suspended');
  release();
  const late = await first;
  assert.equal(branchRow(bdb).status, 'suspended', 'the older push, delivered last, regressed the branch');
  assert.equal(branchRow(bdb).hq_revision, 2);
  assert.equal(late.ok, false, 'a push the branch refused as stale was reported as delivered');
  assert.equal(late.failure_code, 'stale_revision');
  // …and the late refusal of a SUPERSEDED push leaves nothing owed.
  assert.equal(pending(hq), undefined, 'a superseded push recreated retry work');
  assert.equal(syncState(hq).branch_revision, 2);
  assert.equal(syncState(hq).hq_revision, 2);
});

test('(c) if HQ\'s counter is behind the branch, the next attempt is numbered above it instead of being refused for ever', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  await applyLicenceCopy(branchEnv(bdb), rec({ hq_revision: 40, pushed_at: '2026-11-07T10:00:00Z' }));
  const bb = branchBinding(bdb);
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });
  const r = await pushLicenceToBranch(env, LIC_ID);
  assert.equal(r.ok, false);
  assert.equal(syncState(hq).hq_revision, 40, 'the counter was not raised to the branch\'s');
  assert.ok(pending(hq), 'the refused push is still owed');
  const retry = await retryPendingLicencePushes(env, new Date(Date.now() + (LICENCE_PUSH_RETRY_WINDOW_MINUTES + 1) * 60_000));
  assert.deepEqual([(retry as any).tried, (retry as any).ok], [1, 1]);
  assert.equal(branchRow(bdb).hq_revision, 41);
  assert.equal(pending(hq), undefined);
});

/* ------------------------------------------------------------------ *
 * (d) acknowledgements are bound to their revision                      *
 * ------------------------------------------------------------------ */

test('(d) an older success cannot delete newer pending retry work', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  // Push 1 is slow and will succeed; push 2 fails outright.
  const bb = branchBinding(bdb, { gate: (n) => (n === 1 ? gate : undefined), applyThrows: (n) => n === 2 });
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });
  const one = pushLicenceToBranch(env, LIC_ID);
  while (bb.calls.length < 1) await tick();
  const two = await pushLicenceToBranch(env, LIC_ID);
  assert.equal(two.ok, false);
  assert.equal(pending(hq).revision, 2, 'the failed push 2 was not recorded against its revision');
  release();
  const oneRes = await one;
  assert.equal(oneRes.ok, true);
  const row = pending(hq);
  assert.ok(row, 'the success of revision 1 deleted the pending row of revision 2');
  assert.equal(row.revision, 2);
  assert.equal(syncState(hq).branch_revision, 1);
});

test('(d) an older FAILURE does not overwrite a newer pending row\'s revision or reason', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  // Push 1 fails late with a refusal; push 2 failed first with "unreachable".
  const stub = {
    async applyLicence() {
      const n = ++stubN;
      if (n === 1) { await gate; return { ok: false, reason: 'old refusal' }; }
      throw new Error('rpc: fr did not answer');
    },
  };
  let stubN = 0;
  const env = makeEnv(flaky(hq), { BRANCH_FR: stub });
  const one = pushLicenceToBranch(env, LIC_ID);
  while (stubN < 1) await tick();
  await pushLicenceToBranch(env, LIC_ID);
  assert.equal(pending(hq).failure_code, 'unreachable');
  release();
  await one;
  const row = pending(hq);
  assert.equal(row.revision, 2, 'the older failure lowered the pending revision');
  assert.equal(row.failure_code, 'unreachable', 'the older failure overwrote the newer failure\'s reason');
  assert.equal(row.attempts, 2);
  void bdb;
});

test('(d) the retry carries a NEW revision, and only a success at or above a row\'s revision clears it', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  let down = true;
  const bb = branchBinding(bdb, { applyThrows: () => down });
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });
  await pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00Z');
  assert.equal(pending(hq).revision, 1);
  const at = new Date(Date.parse('2026-11-07T10:00:00Z') + LICENCE_PUSH_RETRY_WINDOW_MINUTES * 60_000);
  const still: any = await retryPendingLicencePushes(env, at);
  assert.equal(still.failed, 1);
  assert.equal(pending(hq).revision, 2);
  down = false;
  const done: any = await retryPendingLicencePushes(env, new Date(at.getTime() + LICENCE_PUSH_RETRY_WINDOW_MINUTES * 60_000));
  assert.equal(done.ok, 1);
  assert.equal(pending(hq), undefined);
  assert.equal(syncState(hq).branch_revision, 3);
  assert.ok(syncState(hq).last_success_at);
});

test('(d) retry intent is persisted when the deployment lookup is temporarily unavailable', async () => {
  const hq = hqDb();
  const d1 = flaky(hq);
  const bb = branchBinding(branchDb());
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  d1.rule.fail = (sql) => /FROM licence_deployments/.test(sql);
  const r = await pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00Z');
  assert.equal(r.ok, false);
  assert.equal(r.failure_code, 'deployment_unreadable');
  const row = pending(hq);
  assert.ok(row, 'a lookup that failed left nothing owed');
  assert.deepEqual([row.code, row.failure_code, row.revision], ['', 'deployment_unreadable', 1]);
  d1.rule.fail = () => false;
  const retry: any = await retryPendingLicencePushes(env, new Date(Date.parse('2026-11-07T10:00:00Z') + 61 * 60_000));
  assert.deepEqual([retry.tried, retry.ok], [1, 1]);
  assert.equal(pending(hq), undefined);
  assert.equal(bb.calls.filter((c) => c.method === 'applyLicence').length, 1);
});

test('(d) retry intent is persisted when the licence reread is temporarily unavailable', async () => {
  const hq = hqDb();
  const d1 = flaky(hq);
  const env = makeEnv(d1, { BRANCH_FR: branchBinding(branchDb()).stub });
  d1.rule.fail = (sql) => /SELECT \* FROM territory_licences WHERE id = \?/.test(sql);
  const r = await pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00Z');
  assert.equal(r.failure_code, 'licence_unreadable');
  assert.deepEqual([pending(hq)?.code, pending(hq)?.failure_code], ['', 'licence_unreadable']);
});

test('(d) a licence with cleanly NO deployment owes nothing, and an old row for it is cleared', async () => {
  const hq = hqDb();
  hq.prepare('DELETE FROM licence_deployments').run();
  const env = makeEnv(flaky(hq));
  hq.prepare("INSERT INTO licence_push_pending (licence_id, code, attempts, first_failed_at, last_attempt_at, revision) VALUES (?, 'fr', 1, 'x', 'x', 0)").run(LIC_ID);
  const r = await pushLicenceToBranch(env, LIC_ID);
  assert.equal(r.no_deployment, true);
  assert.equal(pending(hq), undefined);
});

test('(d) the termination leaves its own pending-push intent in the same commit, so a crash before the push still owes it', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  // Make everything after the commit fail hard: the run dies on its first progress write.
  d1.rule.fail = (sql) => /SET notices_state = \?, notify_state/.test(sql);
  const env = makeEnv(d1, { BRANCH_FR: branchBinding(branchDb()).stub });
  const r = await terminate(env);
  assert.equal(r.status, 503);
  const row = pending(db);
  assert.ok(row, 'the committed termination left no push owed');
  assert.equal(row.failure_code, 'termination');
  assert.equal(row.code, 'fr');
  assert.equal(row.revision, syncState(db).hq_revision);
  // The scheduled retry delivers it, with the terminated status.
  d1.rule.fail = () => false;
  const bdb = branchDb();
  const env2 = makeEnv(d1, { BRANCH_FR: branchBinding(bdb).stub });
  const retry: any = await retryPendingLicencePushes(env2, new Date(Date.now() + 61 * 60_000));
  assert.equal(retry.ok, 1);
  assert.equal(branchRow(bdb).status, 'terminated');
});

/* ------------------------------------------------------------------ *
 * (e) a partial copy is partial                                         *
 * ------------------------------------------------------------------ */

test('(e) a branch that could not write a required section answers partial, never applied', async () => {
  const bdb = branchDb();
  bdb.exec('ALTER TABLE branch_licence DROP COLUMN program_grants_json');
  const env = branchEnv(bdb);
  const ans: any = await applyLicenceCopy(env, rec({
    hq_revision: 3, pushed_at: '2026-11-07T10:00:00Z',
    terms_json: '{"a":1}', program_grants_json: '[]', partner_deal_types_json: 'null',
  }));
  assert.equal(ans.ok, false);
  assert.equal(ans.partial, true);
  assert.notEqual(ans.applied, true);
  assert.deepEqual(ans.failed_sections, ['program_grants']);
  const row = branchRow(bdb);
  assert.equal(row.copy_state, 'partial', 'the branch itself must remember the copy is incomplete');
  assert.equal(row.copy_failed_sections, 'program_grants');
  assert.equal(row.terms_json, '{"a":1}', 'the sections that did write must stand');
  assert.equal(row.hq_revision, 3);

  // The same on an UNNUMBERED push (an HQ that predates revisions).
  const bdb2 = branchDb();
  bdb2.exec('ALTER TABLE branch_licence DROP COLUMN terms_json');
  const legacy: any = await applyLicenceCopy(branchEnv(bdb2), rec({ pushed_at: '2026-11-07T10:00:00Z', terms_json: '{"a":1}' }));
  assert.equal(legacy.ok, false);
  assert.deepEqual(legacy.failed_sections, ['terms']);
});

test('(e) through HQ: a partial branch write keeps the push pending, and the next whole push completes it', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  bdb.exec('ALTER TABLE branch_licence RENAME COLUMN partner_deal_types_json TO partner_deal_types_json_x');
  const bb = branchBinding(bdb);
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });
  const r = await pushLicenceToBranch(env, LIC_ID, '2026-11-07T10:00:00Z');
  assert.equal(r.ok, false, 'a copy missing a section was reported as delivered');
  assert.equal(r.partial, true);
  assert.equal(r.failure_code, 'partial');
  assert.equal(pending(hq).failure_code, 'partial');
  assert.equal(syncState(hq).branch_revision, null, 'a partial copy was acknowledged as the branch\'s revision');
  assert.equal(branchRow(bdb).copy_state, 'partial');

  bdb.exec('ALTER TABLE branch_licence RENAME COLUMN partner_deal_types_json_x TO partner_deal_types_json');
  const retry: any = await retryPendingLicencePushes(env, new Date(Date.parse('2026-11-07T10:00:00Z') + 61 * 60_000));
  assert.equal(retry.ok, 1);
  assert.equal(branchRow(bdb).copy_state, 'complete');
  assert.equal(branchRow(bdb).copy_failed_sections, null);
  assert.equal(pending(hq), undefined);
});

test('(e) when HQ itself cannot read a section, the push is partial and stays pending', async () => {
  const hq = hqDb();
  const d1 = flaky(hq);
  const bb = branchBinding(branchDb());
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  d1.rule.fail = (sql) => /FROM licence_terms/.test(sql);
  const r = await quietPush(env);
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.deepEqual(r.failed_sections, ['terms']);
  assert.ok(pending(hq), 'an unreadable section left nothing owed');
  d1.rule.fail = () => false;
  const ok = await pushLicenceToBranch(env, LIC_ID);
  assert.equal(ok.ok, true);
  assert.equal(pending(hq), undefined);
});
const quietPush = (env: any) => quiet(() => pushLicenceToBranch(env, LIC_ID));

/* ------------------------------------------------------------------ *
 * (f) concurrency                                                       *
 * ------------------------------------------------------------------ */

test('(f) two simultaneous terminations write one event, one revision bump and one operation', async () => {
  const db = hqDb();
  const bb = branchBinding(branchDb());
  const env = makeEnv(flaky(db), { BRANCH_FR: bb.stub });
  const [a, b] = await Promise.all([terminate(env), terminate(env)]);
  assert.ok([a.status, b.status].every((s) => s === 200 || s === 409), JSON.stringify([a.body, b.body]));
  assert.ok([a.status, b.status].includes(200));
  assert.equal(termEvents(db), 1, 'two terminal events');
  assert.equal(licStatus(db), 'terminated');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM licence_termination_ops').get() as any).n), 1);
  assert.equal(ops(db).status, 'complete', JSON.stringify(ops(db)));
  const loser = [a, b].find((x) => x.status === 409);
  if (loser) assert.equal(loser.body.error, 'operation_in_progress');
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'licence_terminated'").get() as any).n), 2,
    'the administrators were told more than once',
  );
});

test('(f) two simultaneous resumes do not interleave: one runs, the other is told it is in progress', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  d1.rule.fail = (sql) => /DELETE FROM licence_admins/.test(sql);
  const env = makeEnv(d1, { BRANCH_FR: branchBinding(branchDb()).stub });
  await terminate(env);
  d1.rule.fail = () => false;
  const [a, b] = await Promise.all([terminate(env, {}), terminate(env, {})]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(ops(db).status, 'complete');
  assert.equal(termEvents(db), 1);
  assert.equal(role(db, PRINCIPAL).role, 'exploring');
});

test('(f) a live lease blocks a resume until it expires', async () => {
  const db = hqDb();
  const d1 = flaky(db);
  d1.rule.fail = (sql) => /DELETE FROM licence_admins/.test(sql);
  const env = makeEnv(d1, { BRANCH_FR: branchBinding(branchDb()).stub });
  await terminate(env);
  d1.rule.fail = () => false;
  db.prepare('UPDATE licence_termination_ops SET lease_until = ? WHERE licence_id = ?').run(new Date(Date.now() + 60_000).toISOString(), LIC_ID);
  assert.equal((await terminate(env, {})).status, 409);
  db.prepare('UPDATE licence_termination_ops SET lease_until = ? WHERE licence_id = ?').run(new Date(Date.now() - 1000).toISOString(), LIC_ID);
  assert.equal((await terminate(env, {})).status, 200);
});

test('(f) concurrent pushes get distinct revisions; acks arrive in any order and the branch ends on the newest', async () => {
  const hq = hqDb();
  const bdb = branchDb();
  // Deliver in REVERSE order of allocation.
  const releases: Array<() => void> = [];
  const bb = branchBinding(bdb, { gate: () => new Promise<void>((r) => { releases.push(r); }) });
  const env = makeEnv(flaky(hq), { BRANCH_FR: bb.stub });
  const N = 6;
  const pushes = Array.from({ length: N }, () => pushLicenceToBranch(env, LIC_ID));
  while (releases.length < N) await tick();
  const revs = bb.calls.map((c) => Number((c.args[0] as any).hq_revision));
  assert.equal(new Set(revs).size, N, `duplicate revisions: ${revs}`);
  assert.deepEqual([...revs].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
  for (let i = releases.length - 1; i >= 0; i--) { releases[i](); await tick(); }
  const results = await Promise.all(pushes);
  assert.equal(branchRow(bdb).hq_revision, N);
  assert.equal(syncState(hq).branch_revision, N);
  assert.equal(syncState(hq).hq_revision, N);
  assert.equal(pending(hq), undefined, 'a superseded failure left retry work behind');
  assert.ok(results.some((r) => r.ok));
});

test('(f) allocation is a single statement: parallel allocators never share a revision', async () => {
  const hq = hqDb();
  const env = makeEnv(flaky(hq));
  const got = await Promise.all(Array.from({ length: 20 }, () => allocateRevision(env, LIC_ID)));
  assert.equal(new Set(got).size, 20);
  assert.equal(Math.max(...(got as number[])), 20);
});

/* ------------------------------------------------------------------ *
 * What HQ shows                                                         *
 * ------------------------------------------------------------------ */

test('HQ reads the revision, the last success, the pending revision and a failure CODE — never raw error text', async () => {
  const hq = hqDb();
  const d1 = flaky(hq);
  const bb = branchBinding(branchDb(), { applyThrows: () => down });
  let down = false;
  const env = makeEnv(d1, { BRANCH_FR: bb.stub });
  assert.equal((await pushLicenceToBranch(env, LIC_ID)).ok, true);
  down = true;
  await pushLicenceToBranch(env, LIC_ID);
  const r = await req(env, 'GET', `/api/admin/licences/${LIC}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.sync;
  assert.deepEqual([s.available, s.hq_revision, s.branch_revision], [true, 2, 1]);
  assert.ok(s.last_success_at);
  assert.deepEqual([s.pending.revision, s.pending.failure_code], [2, 'unreachable']);
  assert.equal(s.termination, null);
  assert.ok(!JSON.stringify(s).includes('did not answer'), 'raw error text reached the HQ read');
});

test('HQ reads "not recorded" as null, never 0, for a licence nothing has been pushed for', async () => {
  const r = await req(makeEnv(flaky(hqDb())), 'GET', `/api/admin/licences/${LIC}`);
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.body.sync.hq_revision, r.body.sync.branch_revision, r.body.sync.last_success_at, r.body.sync.pending],
    [null, null, null, null],
  );
});
