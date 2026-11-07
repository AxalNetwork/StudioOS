/**
 * D4706 (#4706) — a deployment's identity kept apart from its attempts, a
 * retry that can never dispatch twice, and a status check that reads what
 * GitHub actually did instead of offering a second Deploy.
 *
 * Dispatched through the real router with a real JWT and a node:sqlite D1
 * built from the real migrations' columns, with `fetch` stubbed to stand in
 * for GitHub. Every test counts the dispatches GitHub received: "no blind
 * duplication" is a count, not a status code.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deployment_attempts_d4706.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminDeployments, { PROVISION_WORKFLOW, NO_RUN_AFTER_MINUTES, deploymentPhase } from '../src/routes/admin_deployments.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;
const GH = { GITHUB_ACCESS_TOKEN: 'ghp_unit_test', GITHUB_REPO_OWNER: 'axalnetwork', GITHUB_REPO_NAME: 'studioos' };

/** `beforeRun` fires before each write runs, so a test can land a rival write between a read and its CAS. */
const hooks: { beforeRun: ((sql: string) => void) | null } = { beforeRun: null };

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          hooks.beforeRun?.(sql);
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/** Migration 258's table, then the real D4706 migration applied on top of it. */
function seededDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE territory_licences ( revision INTEGER NOT NULL DEFAULT 0,id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      licence_ref TEXT UNIQUE NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      country_code TEXT NOT NULL UNIQUE);
  `);
  const sql = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
  db.exec(sql('cloudflare-worker/sql/migrations/258_licence_deployments.sql'));
  // A deployment written before D4706, so the backfill has something to carry.
  db.exec(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, status_note)
           VALUES ('lic_old', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de', 'failed', 'an old refusal')`);
  db.exec(sql('cloudflare-worker/sql/migrations/202611062205_licence_deployment_attempts.sql'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const l = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,?,?)');
  l.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active');
  l.run(2, 'lic_old', 'AXL-002', 'Axal VC Germany GmbH', 'Axal VC Germany', 'active');
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?,?)');
  t.run(1, 'FR'); t.run(2, 'DE');
  return db;
}

/** GitHub, as a script of answers. Records every request it was sent. */
function github(answer: (url: string, init: any) => Response | Promise<Response>) {
  const real = globalThis.fetch;
  const seen: Array<{ url: string; method: string; body: any }> = [];
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    seen.push({ url: String(url), method: String(init.method || 'GET'), body: init.body ? JSON.parse(String(init.body)) : null });
    return answer(String(url), init);
  };
  const dispatches = () => seen.filter((s) => s.url.endsWith('/dispatches'));
  return { seen, dispatches, restore: () => { (globalThis as any).fetch = real; } };
}

function harness(env: Record<string, unknown> = GH) {
  const db = seededDb();
  const app = new Hono<any>();
  app.route('/api/admin', adminDeployments);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));
  const fullEnv = { ...env, DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc' };
  const call = async (method: string, path: string, body?: unknown) => {
    const token = await new SignJWT({ user_id: HOLDER, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(`/api/admin${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, fullEnv);
    return { status: res.status, body: await res.json() as any };
  };
  const dep = (uid = 'lic_fr') => db.prepare('SELECT * FROM licence_deployments WHERE licence_uid = ?').get(uid) as any;
  const attempts = (uid = 'lic_fr') => db.prepare('SELECT * FROM licence_deployment_attempts WHERE licence_uid = ? ORDER BY attempt_no').all(uid) as any[];
  return { call, db, dep, attempts };
}

const DEPLOY = { code: 'fr', d1_jurisdiction: 'eu', location_hint: 'weur', do_jurisdiction: 'eu', principal_email: 'p@fr.example' };
const runsUrl = (u: string) => u.includes(`/actions/workflows/${PROVISION_WORKFLOW}/runs`);

/** A first attempt GitHub refused (403): the starting point of every retry test. */
async function failedFirst() {
  const h = harness();
  const gh = github(() => new Response(JSON.stringify({ message: 'Resource not accessible' }), { status: 403 }));
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
    assert.equal(r.status, 502);
  } finally { gh.restore(); }
  return h;
}

// ── identity and attempts ──────────────────────────────────────────────────

test('the migration backfills one attempt per existing deployment, carrying its outcome', () => {
  const h = harness();
  const [a] = h.attempts('lic_old');
  assert.equal(a.attempt_no, 1);
  assert.equal(a.status, 'failed');
  assert.equal(a.failure_note, 'an old refusal');
  assert.equal(h.dep('lic_old').current_attempt, 1);
});

test('a refused first attempt is recorded on its own row; the identity is kept, not deleted', async () => {
  const h = await failedFirst();
  assert.equal(h.dep().status, 'failed');
  assert.equal(h.dep().do_jurisdiction, 'eu', 'the write-once value is stored so a retry sends the same one');
  const [a] = h.attempts();
  assert.equal(a.attempt_no, 1);
  assert.equal(a.status, 'failed');
  assert.equal(a.failure_code, 'dispatch_failed');
  assert.match(a.failure_note, /403/);
  assert.ok(a.settled_at);
});

test('deploying again over a failure is refused as retryable, not re-created', async () => {
  const h = await failedFirst();
  const r = await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already_deployed');
  assert.equal(r.body.retryable, true);
  assert.equal(r.body.current_attempt, 1);
  assert.match(r.body.message, /Retry it/);
});

// ── retry ──────────────────────────────────────────────────────────────────

test('a retry dispatches attempt 2 with the stored code and residency, and keeps attempt 1', async () => {
  const h = await failedFirst();
  const gh = github(() => new Response(null, { status: 204 }));
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1, principal_email: 'p@fr.example' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.attempt, 2);
    assert.equal(gh.dispatches().length, 1);
    const inputs = gh.dispatches()[0].body.inputs;
    assert.equal(inputs.code, 'fr');
    assert.equal(inputs.d1_jurisdiction, 'eu');
    assert.equal(inputs.location_hint, 'weur');
    assert.equal(inputs.do_jurisdiction, 'eu');
    assert.equal(inputs.territory, 'FR');
  } finally { gh.restore(); }
  assert.equal(h.dep().status, 'requested');
  assert.equal(h.dep().current_attempt, 2);
  assert.equal(h.dep().status_note, null);
  assert.deepEqual(h.attempts().map((a) => [a.attempt_no, a.status]), [[1, 'failed'], [2, 'dispatched']]);
  assert.equal((h.db.prepare('SELECT COUNT(*) n FROM licence_deployments').get() as any).n, 2, 'no identity row added or deleted');
});

test('the same retry sent twice dispatches once; the second is answered with the state', async () => {
  const h = await failedFirst();
  const gh = github(() => new Response(null, { status: 204 }));
  try {
    const first = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
    const again = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.attempt, 2);
    assert.equal(gh.dispatches().length, 1, 'a replay must never reach GitHub');
  } finally { gh.restore(); }
  assert.equal(h.attempts().length, 2);
});

test('two retries racing for one failure: exactly one wins the compare-and-set', async () => {
  const h = await failedFirst();
  const gh = github(() => new Response(null, { status: 204 }));
  try {
    const both = await Promise.all([
      h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 }),
      h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 }),
    ]);
    assert.deepEqual(both.map((b) => b.status), [200, 200]);
    assert.equal(both.filter((b) => b.body.replayed).length, 1);
    assert.equal(gh.dispatches().length, 1);
  } finally { gh.restore(); }
  assert.equal(h.dep().current_attempt, 2);
});

test('a rival retry landing between the read and the write loses nothing: the CAS answers replayed', async () => {
  const h = await failedFirst();
  const gh = github(() => new Response(null, { status: 204 }));
  // Exactly what a second Worker isolate would do after this request read
  // `current_attempt = 1, failed` and before its UPDATE ran.
  hooks.beforeRun = (sql) => {
    if (!/SET status = 'requested', status_note = NULL, current_attempt/.test(sql)) return;
    hooks.beforeRun = null;
    h.db.exec("UPDATE licence_deployments SET status = 'requested', current_attempt = 2 WHERE licence_uid = 'lic_fr'");
    h.db.exec("INSERT INTO licence_deployment_attempts (uid, licence_uid, code, attempt_no, status) VALUES ('att_rival', 'lic_fr', 'fr', 2, 'dispatched')");
  };
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.replayed, true);
    assert.equal(gh.dispatches().length, 0, 'the loser of the race must not dispatch');
  } finally { hooks.beforeRun = null; gh.restore(); }
  assert.equal(h.dep().current_attempt, 2);
  assert.deepEqual(h.attempts().map((a) => a.uid === 'att_rival' || a.attempt_no === 1), [true, true]);
});

test('a retry is refused without moving anything when it names no attempt, or one that is not failed', async () => {
  const h = await failedFirst();
  const gh = github(() => new Response(null, { status: 204 }));
  try {
    const none = await h.call('POST', '/licences/lic_fr/deploy/retry', {});
    assert.equal(none.status, 400);
    assert.equal(none.body.error, 'bad_attempt');
    const future = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 5 });
    assert.equal(future.status, 409);
    assert.equal(future.body.error, 'stale_attempt');
    await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
    const running = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 2 });
    assert.equal(running.status, 409);
    assert.equal(running.body.error, 'not_failed');
    assert.match(running.body.message, /Check its status/);
    assert.equal(gh.dispatches().length, 1);
  } finally { gh.restore(); }
});

test('without the token a retry is refused before the attempt counter moves', async () => {
  const h = harness({});
  await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
  assert.equal(h.attempts()[0].failure_code, 'github_not_configured');
  const r = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'github_not_configured');
  assert.equal(h.dep().current_attempt, 1);
  assert.equal(h.attempts().length, 1);
});

test('a deployment from before the column existed asks for its Durable Object jurisdiction', async () => {
  const h = harness();
  const gh = github(() => new Response(null, { status: 204 }));
  try {
    const asked = await h.call('POST', '/licences/lic_old/deploy/retry', { expected_attempt: 1 });
    assert.equal(asked.status, 409);
    assert.equal(asked.body.error, 'do_jurisdiction_required');
    assert.equal(gh.dispatches().length, 0);
    const given = await h.call('POST', '/licences/lic_old/deploy/retry', { expected_attempt: 1, do_jurisdiction: 'none' });
    assert.equal(given.status, 200, JSON.stringify(given.body));
    assert.equal(gh.dispatches()[0].body.inputs.do_jurisdiction, 'none');
  } finally { gh.restore(); }
  assert.equal(h.dep('lic_old').do_jurisdiction, 'none');
});

test('a deployment that is not failed is told so first, not asked for inputs a retry would need', async () => {
  const h = harness();
  h.db.exec("UPDATE licence_deployments SET status = 'requested' WHERE licence_uid = 'lic_old'");
  const r = await h.call('POST', '/licences/lic_old/deploy/retry', { expected_attempt: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_failed');
});

// ── the ambiguous answer ───────────────────────────────────────────────────

test('a dispatch whose answer never arrives is sent once and left UNKNOWN, not failed', async () => {
  const h = harness();
  const gh = github(() => { throw new TypeError('The operation timed out'); });
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
    assert.equal(r.status, 504);
    assert.equal(r.body.error, 'outcome_unknown');
    assert.equal(r.body.outcome, 'unknown');
    assert.equal(gh.dispatches().length, 1, 'a dispatch that may have landed is never re-sent');
    assert.equal(r.body.deployment.phase, 'unknown');
    assert.equal(r.body.deployment.retryable, false);
    assert.equal(r.body.deployment.reconcilable, true);
  } finally { gh.restore(); }
  assert.equal(h.dep().status, 'requested');
  assert.equal(h.attempts()[0].status, 'dispatching');
  // Neither Retry nor Deploy can send a second one while it is unknown.
  const gh2 = github(() => new Response(null, { status: 204 }));
  try {
    const retry = await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 });
    assert.equal(retry.body.error, 'not_failed');
    const again = await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
    assert.equal(again.body.error, 'already_deployed');
    assert.equal(gh2.dispatches().length, 0);
  } finally { gh2.restore(); }
});

test('a 5xx from GitHub is unknown too, and is not retried inside the Worker', async () => {
  const h = harness();
  const gh = github(() => new Response('{}', { status: 502 }));
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy', DEPLOY);
    assert.equal(r.status, 504);
    assert.equal(gh.dispatches().length, 1);
  } finally { gh.restore(); }
});

// ── reconcile ──────────────────────────────────────────────────────────────

/** An attempt GitHub accepted, then a GitHub that lists `runs` with their jobs. */
async function dispatched(runs: Array<{ id: number; code: string | null; status: string; conclusion?: string | null }>) {
  const h = harness();
  const gh0 = github(() => new Response(null, { status: 204 }));
  try { await h.call('POST', '/licences/lic_fr/deploy', DEPLOY); } finally { gh0.restore(); }
  const gh = github((url) => {
    if (runsUrl(url)) {
      return Response.json({
        workflow_runs: runs.map((r, i) => ({
          id: r.id, status: r.status, conclusion: r.conclusion ?? null,
          html_url: `https://github.com/axalnetwork/studioos/actions/runs/${r.id}`,
          created_at: `2026-11-06T10:0${i}:00Z`,
        })),
      });
    }
    const m = url.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (m) {
      const run = runs.find((r) => String(r.id) === m[1]);
      return Response.json({ jobs: run?.code ? [{ name: `provision ${run.code}` }] : [] });
    }
    return new Response(null, { status: 404 });
  });
  return { h, gh };
}

test('a run that succeeded is matched by its job, recorded, and reads as PARTIAL until HQ is linked', async () => {
  const { h, gh } = await dispatched([
    { id: 11, code: 'de', status: 'completed', conclusion: 'failure' },
    { id: 12, code: 'fr', status: 'completed', conclusion: 'success' },
  ]);
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.checked, 'succeeded');
    assert.equal(r.body.deployment.phase, 'partial');
    assert.equal(r.body.deployment.last_success.run_id, '12');
    assert.equal(gh.dispatches().length, 0, 'a status check never dispatches');
    const listed = gh.seen.find((s) => runsUrl(s.url))!;
    assert.match(decodeURIComponent(listed.url), /event=workflow_dispatch/);
    assert.match(decodeURIComponent(listed.url), /created=>=/);
  } finally { gh.restore(); }
  assert.equal(h.dep().status, 'hostname_active');
  assert.equal(h.dep().provision_run_id, '12');
  assert.match(h.dep().status_note, /linking PR/);
  const [a] = h.attempts();
  assert.equal(a.status, 'succeeded');
  assert.equal(a.run_url, 'https://github.com/axalnetwork/studioos/actions/runs/12');
});

test('a run that failed fails the attempt with its log link, and makes it retryable', async () => {
  const { h, gh } = await dispatched([{ id: 21, code: 'fr', status: 'completed', conclusion: 'failure' }]);
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(r.body.checked, 'failed');
    assert.equal(r.body.deployment.phase, 'refused');
    assert.equal(r.body.deployment.retryable, true);
    assert.equal(r.body.deployment.last_failure.failure_code, 'run_failed');
    assert.match(r.body.deployment.last_failure.failure_note, /actions\/runs\/21/);
  } finally { gh.restore(); }
});

test('a run still going is recorded and left pending', async () => {
  const { h, gh } = await dispatched([{ id: 31, code: 'fr', status: 'in_progress' }]);
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(r.body.checked, 'running');
    assert.equal(r.body.deployment.phase, 'pending');
  } finally { gh.restore(); }
  assert.equal(h.attempts()[0].run_id, '31');
  assert.equal(h.attempts()[0].status, 'dispatched');
});

test('no run yet is pending; no run after the window fails the attempt so it can be retried', async () => {
  const { h, gh } = await dispatched([{ id: 41, code: 'de', status: 'completed', conclusion: 'success' }]);
  try {
    const soon = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(soon.body.checked, 'no_run_yet');
    assert.equal(h.dep().status, 'requested');
    const old = new Date(Date.now() - (NO_RUN_AFTER_MINUTES + 1) * 60000).toISOString();
    h.db.prepare('UPDATE licence_deployment_attempts SET requested_at = ? WHERE licence_uid = ?').run(old, 'lic_fr');
    const late = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(late.body.checked, 'no_run');
    assert.equal(late.body.deployment.retryable, true);
    assert.equal(late.body.deployment.last_failure.failure_code, 'run_not_found');
  } finally { gh.restore(); }
});

test('a run an earlier attempt already claimed is never matched to the current one', async () => {
  const { h, gh } = await dispatched([{ id: 51, code: 'fr', status: 'completed', conclusion: 'failure' }]);
  try {
    await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(h.attempts()[0].run_id, '51');
  } finally { gh.restore(); }
  const gh2 = github(() => new Response(null, { status: 204 }));
  try { await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 }); } finally { gh2.restore(); }
  const gh3 = github((url) => runsUrl(url)
    ? Response.json({ workflow_runs: [{ id: 51, status: 'completed', conclusion: 'failure', created_at: '2026-11-06T10:00:00Z' }] })
    : Response.json({ jobs: [{ name: 'provision fr' }] }));
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(r.body.checked, 'no_run_yet');
  } finally { gh3.restore(); }
  assert.equal(h.attempts()[1].run_id, null);
  assert.equal(h.dep().status, 'requested');
});

test('an unreadable GitHub changes nothing and says so', async () => {
  const h = harness();
  const gh0 = github(() => new Response(null, { status: 204 }));
  try { await h.call('POST', '/licences/lic_fr/deploy', DEPLOY); } finally { gh0.restore(); }
  const gh = github(() => new Response('{}', { status: 401 }));
  try {
    const r = await h.call('POST', '/licences/lic_fr/deploy/reconcile');
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'github_unreadable');
  } finally { gh.restore(); }
  assert.equal(h.attempts()[0].status, 'dispatched');
});

// ── the read ───────────────────────────────────────────────────────────────

test('the deployment read carries the current attempt, the last failure and the last success', async () => {
  const { h, gh } = await dispatched([{ id: 61, code: 'fr', status: 'completed', conclusion: 'failure' }]);
  try { await h.call('POST', '/licences/lic_fr/deploy/reconcile'); } finally { gh.restore(); }
  const gh2 = github(() => new Response(null, { status: 204 }));
  try { await h.call('POST', '/licences/lic_fr/deploy/retry', { expected_attempt: 1 }); } finally { gh2.restore(); }
  const r = await h.call('GET', '/licences/lic_fr/deployment');
  assert.equal(r.status, 200);
  const d = r.body.deployment;
  assert.equal(d.current_attempt, 2);
  assert.equal(d.current_attempt_row.status, 'dispatched');
  assert.equal(d.last_failure.attempt_no, 1);
  assert.equal(d.last_success, null);
  assert.deepEqual(d.attempts.map((a: any) => a.attempt_no), [2, 1]);
  const none = await h.call('GET', '/licences/lic_none/deployment');
  assert.equal(none.body.deployment, null);
});

test('the phase vocabulary: pending, partial, committed, refused, unknown', () => {
  assert.equal(deploymentPhase('requested', { status: 'dispatched' }), 'pending');
  assert.equal(deploymentPhase('requested', { status: 'dispatching' }), 'unknown');
  assert.equal(deploymentPhase('hostname_active', { status: 'succeeded' }), 'partial');
  assert.equal(deploymentPhase('worker_live', null), 'partial');
  assert.equal(deploymentPhase('linked', { status: 'succeeded' }), 'committed');
  assert.equal(deploymentPhase('failed', { status: 'failed' }), 'refused');
});
