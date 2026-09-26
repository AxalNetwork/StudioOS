/**
 * D110 — asking for a branch, and what the answer says when it cannot be had.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is that an absent credential is a STATE
 * with a name, not a crash: `GITHUB_ACCESS_TOKEN` with `actions: write` is
 * task #192 and is not set in production, so the Deploy button's normal
 * answer today is 409 `github_not_configured` carrying the exact secrets to
 * set. A 500 would read as a broken button and send someone to the logs; this
 * sends them to the Actions tab, where the same workflow runs by hand.
 *
 * THE OTHER HALF, and the reason the row is written BEFORE the dispatch: a
 * `workflow_dispatch` returns 204 with no body whether the run then succeeds,
 * fails or is never scheduled. So the dispatch establishes only that GitHub
 * accepted the request, and a route that wrote its row afterwards would leave
 * no trace of an attempt that failed. Every refusal path below therefore
 * asserts the ROW as well as the status.
 *
 * Dispatched through the real router with a real JWT and a real (node:sqlite)
 * D1 rather than called directly: `requireSuperAdmin` resolves the token and
 * the `users` row, and a hand-built context would let the deploy decision be
 * asserted while skipping the gate it sits behind.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_licences_deploy.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminDeployments, { PROVISION_WORKFLOW } from '../src/routes/admin_deployments.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7; // an admin WITH a super_admins row
const PLAIN = 9;  // an admin without one

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
    licence_ref TEXT UNIQUE NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft');
  CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
    country_code TEXT NOT NULL UNIQUE);
  CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
    d1_jurisdiction TEXT, location_hint TEXT, residency_requested TEXT, residency_granted TEXT,
    status TEXT NOT NULL DEFAULT 'requested', status_note TEXT, rpc_secret_hash TEXT,
    provision_run_id TEXT, requested_by_user_id INTEGER,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')), live_at TEXT,
    last_health_at TEXT, last_health_ok INTEGER, last_version TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

/** One active licence holding FR·BE·LU, and one holding nothing at all. */
function seededDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);

  const l = db.prepare(
    'INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,?,?)',
  );
  l.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active');
  l.run(2, 'lic_empty', 'AXL-009', 'Axal VC Nowhere BV', 'Axal VC Nowhere', 'active');
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?,?)');
  // Deliberately not in alphabetical order: the route orders them, and a
  // dispatch that shipped insertion order would pass a test seeded sorted.
  t.run(1, 'LU'); t.run(1, 'FR'); t.run(1, 'BE');
  return db;
}

const HQ_VARS = {
  APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
};
const GH_VARS = {
  GITHUB_ACCESS_TOKEN: 'ghp_unit_test', GITHUB_REPO_OWNER: 'axalnetwork', GITHUB_REPO_NAME: 'studioos',
};

/**
 * The router under test, mounted where `index.ts` mounts it, with the error
 * map `index.ts` applies. Returns both the dispatcher and the raw sqlite
 * handle, because half of what this route promises is what it LEFT BEHIND.
 */
function deployApp(extraEnv: Record<string, unknown> = {}, bindings: Record<string, unknown> = {}) {
  const db = seededDb();
  const env = { ...HQ_VARS, ...extraEnv, ...bindings, DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/admin', adminDeployments);
  app.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });

  const call = async (path: string, init: RequestInit = {}, userId: number | null = HOLDER) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) {
      const token = await new SignJWT({ user_id: userId, role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await app.request(`/api/admin${path}`, { ...init, headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const rows = () => db.prepare('SELECT * FROM licence_deployments ORDER BY code').all() as any[];
  return { call, rows, db };
}

/** The request the H3 Deploy step makes, as a (path, init) pair. */
function deploy(body: Record<string, unknown>, uid = 'lic_fr'): [string, RequestInit] {
  return [`/licences/${uid}/deploy`, { method: 'POST', body: JSON.stringify(body) }];
}

/**
 * Stub `fetch` for one call and record what GitHub was actually asked for.
 * Restored in a `finally` by every caller — a leaked stub would make a later
 * test pass against this one's answer.
 */
function stubFetch(handler: (url: string, init: any) => Response) {
  const real = globalThis.fetch;
  const seen: Array<{ url: string; init: any }> = [];
  (globalThis as any).fetch = async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { seen, restore: () => { (globalThis as any).fetch = real; } };
}

// ── the credential, which is a state ───────────────────────────────────────

test('without the token the deploy is 409 with a named reason, and the attempt leaves a row', async () => {
  const { call, rows } = deployApp();
  const r = await call(...deploy({ code: 'fr', d1_jurisdiction: 'eu', location_hint: 'weur' }));

  assert.equal(r.status, 409, 'an unset credential is a state, not a 500');
  assert.equal(r.body.error, 'github_not_configured');
  assert.equal(r.body.branch, 'fr', 'D258: the branch code travels as `branch`');
  assert.equal(r.body.code, undefined, 'D258: `code` is the refusal code the SPA reads into e.code');
  // The exact things to set, named. "Not configured" covers three different
  // things and only one of them is this one.
  assert.match(r.body.message, /GITHUB_ACCESS_TOKEN/);
  assert.match(r.body.message, /actions: write/);
  assert.match(r.body.message, /GITHUB_REPO_OWNER/);
  assert.match(r.body.message, /GITHUB_REPO_NAME/);
  // And the way round it, because there IS one.
  assert.match(r.body.message, /Actions tab/);
  assert.equal(r.body.workflow, PROVISION_WORKFLOW);

  const [row] = rows();
  assert.ok(row, 'the attempt must leave a trace — the row is written before the dispatch');
  assert.equal(row.status, 'failed');
  assert.match(String(row.status_note), /GITHUB_ACCESS_TOKEN/);
  assert.equal(row.code, 'fr');
  assert.equal(row.hostname, 'fr.axal.vc');
  assert.equal(row.requested_by_user_id, HOLDER);
});

test('WITH the token the same request dispatches and the row says requested', async () => {
  // The other half of the pair. Without it, a route that always answered 409
  // would pass the test above.
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(null, { status: 204 }));
  try {
    const r = await call(...deploy({ code: 'fr', d1_jurisdiction: 'eu', location_hint: 'weur', principal_email: 'p@fr.example' }));

    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.hostname, 'fr.axal.vc');
    assert.equal(r.body.status, 'requested');
    // Said plainly, because a 204 does not mean what a reader assumes.
    assert.match(r.body.note, /not that the branch exists/);

    assert.equal(s.seen.length, 1, 'exactly one dispatch');
    assert.equal(
      s.seen[0].url,
      `https://api.github.com/repos/axalnetwork/studioos/actions/workflows/${PROVISION_WORKFLOW}/dispatches`,
    );
    const sent = JSON.parse(String(s.seen[0].init.body));
    assert.equal(sent.ref, 'main');
    assert.equal(sent.inputs.code, 'fr');
    assert.equal(sent.inputs.licence_uid, 'lic_fr');
    // Ordered, not as inserted — the workflow writes this into the registry.
    assert.equal(sent.inputs.territory, 'BE,FR,LU');
    assert.equal(sent.inputs.name, 'Axal VC France');
    assert.equal(sent.inputs.principal_email, 'p@fr.example');

    const [row] = rows();
    assert.equal(row.status, 'requested');
    assert.equal(row.status_note, null);
    assert.equal(row.worker_name, 'studioos-fr');
    assert.equal(row.d1_name, 'studioos-fr');
  } finally { s.restore(); }
});

test('a 403 from GitHub is reported as the SCOPE, not as an unset secret', async () => {
  // The distinction is the whole value of this branch: telling someone to set
  // a secret that is already set sends them to fix the wrong thing.
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(JSON.stringify({ message: 'Resource not accessible' }), { status: 403 }));
  try {
    const r = await call(...deploy({ code: 'fr' }));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'dispatch_failed');
    assert.equal(r.body.branch, 'fr', 'D258: the branch code travels as `branch`');
    assert.equal(r.body.code, undefined, 'D258: `code` is the refusal code the SPA reads into e.code');
    assert.match(r.body.message, /actions: write/);
    assert.match(r.body.message, /authenticated/);
    assert.ok(
      !/is not set/.test(r.body.message),
      'a refused scope must not be reported as a missing secret',
    );
    assert.equal(rows()[0].status, 'failed');
    assert.match(String(rows()[0].status_note), /403/);
  } finally { s.restore(); }
});

test('a non-403 dispatch failure keeps its own reason rather than borrowing the scope one', async () => {
  const { call } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(JSON.stringify({ message: 'No ref found for: main' }), { status: 422 }));
  try {
    const r = await call(...deploy({ code: 'fr' }));
    assert.equal(r.status, 502);
    // RE-AIMED BY D278: GitHub's own reason is kept — on `upstream`, which an
    // admin on this console may read — and `message` is our sentence, naming
    // the status rather than borrowing the scope explanation.
    assert.match(r.body.upstream, /No ref found/);
    assert.match(r.body.message, /HTTP 422/);
    assert.doesNotMatch(r.body.message, /No ref found/);
    assert.ok(!/actions: write/.test(r.body.message), 'only a 403 is a scope problem');
  } finally { s.restore(); }
});

// ── the collisions, which need two different answers ───────────────────────

test('a licence that already has a deployment is already_deployed; a taken code is code_taken', async () => {
  const { call, rows } = deployApp();
  // Seed by deploying once — the row that exists is the one the route writes.
  await call(...deploy({ code: 'fr' }));
  assert.equal(rows().length, 1);

  const again = await call(...deploy({ code: 'nord' }));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_deployed', 'this licence, under a different code');
  assert.match(again.body.message, /AXL-001/);
  assert.equal(again.body.branch, 'fr', 'the answer names the deployment that exists, not the one asked for');
  // D258: a body's `code` is the refusal's machine code, read into e.code by the
  // SPA, so a branch code must never travel under that key.
  assert.equal(again.body.code, undefined, 'the branch code travels as `branch`, never as `code`');

  const taken = await call(...deploy({ code: 'fr' }, 'lic_empty'));
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'code_taken', 'a different licence, under this code');
  assert.match(taken.body.message, /lic_fr/);

  assert.equal(rows().length, 1, 'neither collision may write a second row');
});

test('a licence holding no country is refused before anything is written', async () => {
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(null, { status: 204 }));
  try {
    const r = await call(...deploy({ code: 'nowhere' }, 'lic_empty'));
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'no_territory');
    assert.equal(s.seen.length, 0, 'nothing may be dispatched for a licence with no territory');
    assert.equal(rows().length, 0, 'and no row may be left behind');
  } finally { s.restore(); }
});

test('an unknown licence is 404, not a deployment of nothing', async () => {
  const { call, rows } = deployApp();
  const r = await call(...deploy({ code: 'fr' }, 'lic_nope'));
  assert.equal(r.status, 404);
  assert.equal(rows().length, 0);
});

// ── the inputs, validated before they reach a workflow ─────────────────────

test('a code outside the charset is refused, and so is a residency Cloudflare does not offer', async () => {
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(null, { status: 204 }));
  try {
    for (const bad of ['FR', 'f', '1fr', 'fr; rm -rf /', 'a-very-long-branch-code', '']) {
      const r = await call(...deploy({ code: bad }));
      assert.equal(r.status, 400, `${JSON.stringify(bad)} must be refused`);
      assert.equal(r.body.error, 'bad_code');
    }
    for (const bad of [
      { code: 'fr', d1_jurisdiction: 'ch' },
      { code: 'fr', location_hint: 'zurich' },
      { code: 'fr', do_jurisdiction: 'uk' },
    ]) {
      const r = await call(...deploy(bad));
      assert.equal(r.status, 400, `${JSON.stringify(bad)} must be refused`);
      assert.equal(r.body.error, 'bad_residency');
    }
    assert.equal(s.seen.length, 0);
    assert.equal(rows().length, 0, 'a refused input may not leave a deployment row');

    // The other direction: the values Cloudflare DOES offer are accepted, or
    // the loop above would pass against a route that refused everything.
    const ok = await call(
      ...deploy({ code: 'nordics-2', d1_jurisdiction: 'none', location_hint: 'oc', do_jurisdiction: 'us' }),
    );
    assert.equal(ok.status, 200);
    assert.equal(rows()[0].code, 'nordics-2');
  } finally { s.restore(); }
});

test('the code "hq" passes the charset and is still refused, with its own sentence (D211)', async () => {
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(null, { status: 204 }));
  try {
    const r = await call(...deploy({ code: 'hq' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_code');
    assert.match(r.body.message, /HQ's own deployment in the metrics store/,
      'the charset sentence would tell the operator to fix a code that already fits it');
    assert.equal(s.seen.length, 0, 'nothing is dispatched for a refused code');
    assert.equal(rows().length, 0, 'and no deployment row is left behind');
    // A code that merely STARTS with hq is a branch like any other.
    const ok = await call(...deploy({ code: 'hq-north' }));
    assert.equal(ok.status, 200);
  } finally { s.restore(); }
});

test('what was requested is recorded apart from what Cloudflare can grant', async () => {
  // D.1: `eu` is a guarantee and a location hint is not. A record that stored
  // only the request would misreport a Dubai branch's residency.
  const { call, rows } = deployApp(GH_VARS);
  const s = stubFetch(() => new Response(null, { status: 204 }));
  try {
    await call(...deploy({ code: 'dxb', d1_jurisdiction: 'none', location_hint: 'apac' }));
    const row = rows()[0];
    assert.equal(row.residency_requested, 'hint:apac', 'a hint is recorded as a hint');
    assert.equal(row.d1_jurisdiction, null, '"none" is stored as absent, not as the string');
    assert.equal(row.residency_granted, null, 'nothing is granted until provisioning says so');
  } finally { s.restore(); }
});

// ── the gate ───────────────────────────────────────────────────────────────

test('deploying is super-admin only, and anonymous is 401', async () => {
  const { call, rows } = deployApp(GH_VARS);
  const [path, init] = deploy({ code: 'fr' });
  const plain = await call(path, init, PLAIN);
  assert.equal(plain.status, 403);
  assert.match(plain.body.detail, /Super admin/);

  const anon = await call(path, init, null);
  assert.equal(anon.status, 401);
  assert.equal(rows().length, 0, 'a refused caller may not write a deployment row');
});

// ── GET /deployments ───────────────────────────────────────────────────────

test('the registry and the live read are separate fields, and one branch down says so', async () => {
  const { call, db } = deployApp(GH_VARS, {
    BRANCH_FR: { health: async () => ({ ok: true, licence_status: 'active', licence_pushed_at: '2026-09-15T08:00:00Z' }) },
    BRANCH_DACH: { health: async () => { throw new Error('boom'); } },
  });
  const ins = db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES (?,?,?,?,?,?)`,
  );
  ins.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'worker_live');
  ins.run('lic_dach', 'dach', 'dach.axal.vc', 'studioos-dach', 'studioos-dach', 'worker_live');
  ins.run('lic_es', 'es', 'es.axal.vc', 'studioos-es', 'studioos-es', 'requested');

  const r = await call('/deployments');
  assert.equal(r.status, 200);
  assert.equal(r.body.registry_available, true);
  assert.equal(r.body.registry_reason, undefined);

  const by = Object.fromEntries(r.body.deployments.map((d: any) => [d.code, d]));
  assert.equal(by.fr.live_state, 'ok');
  assert.equal(by.fr.live.licence_status, 'active');
  assert.equal(by.dach.live_state, 'unreadable');
  assert.ok(by.dach.live_reason, 'an unreadable branch says why');
  // THE POINT OF THE TWO FIELDS: dach reached `worker_live` and is
  // unreachable right now. It has not regressed to `requested`.
  assert.equal(by.dach.status, 'worker_live', 'a failed live read must not rewrite the provisioning status');
  assert.equal(by.es.live_state, 'not_deployed', 'a registry row HQ cannot call yet is not "down"');

  // The denominator counts what HQ ASKED — the two bound branches — and the
  // registry row it cannot call yet is reported under its own name. Folding
  // `es` into `unreadable` would report a deploy HQ owes itself as a branch
  // that is down.
  assert.equal(r.body.coverage.total, 2);
  assert.equal(r.body.coverage.answered, 1);
  assert.equal(r.body.coverage.complete, false);
  assert.deepEqual(r.body.coverage.unreadable, ['dach']);
  assert.deepEqual(r.body.coverage.not_deployed, ['es']);
});

test('the button states its own precondition rather than letting someone press it', async () => {
  const off = await deployApp().call('/deployments');
  assert.equal(off.body.dispatch_available, false);
  assert.match(off.body.dispatch_reason, /GITHUB_ACCESS_TOKEN/);
  assert.match(off.body.dispatch_reason, /Actions tab/);

  const on = await deployApp(GH_VARS).call('/deployments');
  assert.equal(on.body.dispatch_available, true);
  assert.equal(on.body.dispatch_reason, undefined);
});

test('a database without migration 258 is reported unreadable, not as zero branches', async () => {
  // "No deployments" and "the table is not there" are different answers, and
  // rendering the second as the first is how a missing migration reads as a
  // business with no subsidiaries.
  const { call, db } = deployApp(GH_VARS);
  db.exec('DROP TABLE licence_deployments');
  const r = await call('/deployments');
  assert.equal(r.status, 200);
  assert.equal(r.body.registry_available, false);
  assert.match(r.body.registry_reason, /258/);
  assert.deepEqual(r.body.deployments, []);
});

test('reading the deployments list is super-admin only too', async () => {
  const { call } = deployApp(GH_VARS);
  assert.equal((await call('/deployments', {}, PLAIN)).status, 403);
  assert.equal((await call('/deployments', {}, null)).status, 401);
});

// ── the mount ──────────────────────────────────────────────────────────────

test('the router is mounted before the licence ledger, or /licences/:uid/deploy never reaches it', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const deployAt = src.indexOf("app.route('/api/admin', adminDeployments)");
  assert.ok(deployAt > 0, 'admin_deployments must be mounted under /api/admin');
  const ledgerAt = src.indexOf("app.route('/api/admin/licences'");
  assert.ok(ledgerAt > 0, 'the licence ledger mount is the one this must precede');
  assert.ok(
    deployAt < ledgerAt,
    'a ledger mounted first would answer /licences/:uid/deploy with its own 404',
  );
  assert.match(src, /import adminDeployments from '\.\/routes\/admin_deployments'/);
});

test('the SPA reaches both routes through api.js, which the drift gate pairs with these mounts', () => {
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /licenceDeploy:\s*\(/, 'the H3 Deploy step calls api.licenceDeploy');
  assert.match(api, /\/admin\/licences\/\$\{[^}]+\}\/deploy/);
  assert.match(api, /\bdeployments:\s*\(\)/, 'the Platform zone calls api.deployments');
  assert.match(api, /request\('\/admin\/deployments'\)/);
});
