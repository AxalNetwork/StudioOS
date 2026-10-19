/**
 * #1906 (D751 T8, a D655 follow-up) — the GitHub connector end to end against a
 * stubbed GitHub: sign-in, the callback, its refusals, the repository choice,
 * the sync and a re-sync. Then the two defects reading the code found: a
 * founder's deleted item still counted as linked, and a sync with no bound on
 * its Worker subrequests.
 *
 * No live GitHub: every call to github.com and api.github.com is answered by
 * the fake below, and a URL it does not know fails the test.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_connector_flow_d751.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { syncGithub, SYNC_SUBREQUEST_BUDGET, MAX_REPOSITORIES } from '../src/integrations/providers/github.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'z'.repeat(64); // synthetic fixture key
const CLIENT_ID = 'Iv1.flow-fixture';
const CLIENT_SECRET = 'flow-fixture-secret';
const READ = { issues: 'read', pull_requests: 'read', contents: 'read', metadata: 'read' };
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const MIGRATIONS = ['001_progress_tables.sql', '153_mvp_features.sql', '435_connector_companies.sql', '445_connector_fed_items.sql']
  .map((m) => readFileSync(`cloudflare-worker/sql/migrations/${m}`, 'utf8'));

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}

/** The world: SQLite with the stores the flow writes, and a D1 that counts its subrequests. */
function world() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    INSERT INTO users(id, role, name, email) VALUES (1, 'founder', 'Fay', 'fay@example.test');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO user_company_links VALUES (1, 10);
    INSERT INTO projects VALUES (100, 10, NULL);`);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(tableFromBaseline(baseline, 'oauth_state_tokens'));
  const real = d1Over(db) as any;
  const meter = { d1: 0, batches: 0, statements: 0 };
  const DB = {
    prepare(sql: string) {
      const st = real.prepare(sql);
      const wrap = (s: any): any => ({
        bind: (...a: any[]) => wrap(s.bind(...a)),
        all: async () => { meter.d1 += 1; return s.all(); },
        first: async (col?: string) => { meter.d1 += 1; return s.first(col); },
        run: async () => { meter.d1 += 1; return s.run(); },
        raw: (s as any).raw?.bind(s),
        _inner: s,
      });
      return wrap(st);
    },
    batch: async (stmts: any[]) => { meter.d1 += 1; meter.batches += 1; meter.statements += stmts.length; return real.batch(stmts.map((s) => s._inner ?? s)); },
    exec: real.exec?.bind(real),
  };
  const KV = kv();
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: KV, GITHUB_APP_CLIENT_ID: CLIENT_ID, GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET } as any;
  const one = (sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as any;
  const all = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as any[];
  return { db, env, KV, meter, one, all };
}

type Repo = { issues: any[]; pulls: any[]; releases: any[] };
/** A GitHub that answers from tables, pages them, and records every call. A URL it does not know throws. */
function fakeGithub(opts: { perms?: Record<string, string>; installations?: number; repos?: Record<string, Repo>; reach?: string[] } = {}) {
  const calls: string[] = [];
  const repos = opts.repos ?? {};
  const reach = opts.reach ?? Object.keys(repos);
  const real = globalThis.fetch;
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.host}${url.pathname}${url.search}`);
    if (url.host === 'github.com' && method === 'POST' && url.pathname === '/login/oauth/access_token') {
      return j({ access_token: 'ghu_flow_fixture', token_type: 'bearer' });
    }
    if (url.host !== 'api.github.com') throw new Error(`unexpected fetch ${url.href}`);
    if (method === 'DELETE' && /^\/applications\/[^/]+\/grant$/.test(url.pathname)) return new Response(null, { status: 204 });
    if (method !== 'GET') throw new Error(`unexpected ${method} ${url.pathname}`);
    if (url.pathname === '/user') return j({ id: 4242, login: 'fay-founder' });
    if (url.pathname === '/user/installations') {
      const n = opts.installations ?? 1;
      return j({ installations: Array.from({ length: n }, (_, i) => ({ id: 7 + i, permissions: opts.perms ?? READ })) });
    }
    if (url.pathname === '/user/installations/7/repositories') {
      return j({ repositories: reach.map((full_name) => ({ full_name, private: true, updated_at: '2026-10-12T00:00:00Z' })) });
    }
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|releases)$/);
    if (m) {
      const r = repos[`${m[1]}/${m[2]}`];
      if (!r) return j({ message: 'Not Found' }, 404);
      const per = Number(url.searchParams.get('per_page'));
      const page = Number(url.searchParams.get('page'));
      if (m[3] !== 'releases') assert.equal(url.searchParams.get('state'), 'all');
      assert.equal(per, 100);
      return j(r[m[3] as keyof Repo].slice((page - 1) * per, page * per));
    }
    throw new Error(`unexpected GET ${url.pathname}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const app = new Hono<any>();
app.route('/api/integrations', integrations);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(env: any, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, redirect: 'manual',
    headers: { Authorization: `Bearer ${jwt}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, location: res.headers.get('location') };
}

/** Sign in through the start and the callback, as the browser does. */
async function signIn(w: ReturnType<typeof world>, query = '') {
  const start = await call(w.env, 'GET', `/api/integrations/oauth/github/start${query}`);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const cb = await call(w.env, 'GET', `/api/integrations/oauth/github/callback?code=flow-code&state=${encodeURIComponent(start.body.state)}`);
  return { start, cb };
}
const uidOf = (w: ReturnType<typeof world>) => w.one("SELECT uid FROM integrations WHERE provider_key = 'github'")?.uid as string;
const rowOf = (w: ReturnType<typeof world>) => w.one("SELECT * FROM integrations WHERE provider_key = 'github'");

const issue = (n: number, title: string, state = 'open', extra = {}) => ({ number: n, title, state, ...extra });
const pull = (n: number, title: string, extra = {}) => ({ number: n, title, state: 'open', draft: false, ...extra });
const appRepo = (): Repo => ({
  issues: [issue(1, 'Export to CSV'), issue(2, 'Fix login', 'closed'), issue(5, 'Add export', 'open', { pull_request: {} })],
  pulls: [pull(5, 'Add export'), pull(6, 'Login fix', { state: 'closed', merged_at: '2026-10-01' }), pull(7, 'Old idea', { state: 'closed' }), pull(8, 'WIP', { draft: true })],
  releases: [{ id: 99, tag_name: 'v1.0' }],
});

test.beforeEach(() => _clearOauthCredsCache());

test('#1906 sign-in: the authorize URL, the callback, the saved connection and both returns', async () => {
  const w = world();
  const gh = fakeGithub({ repos: { 'acme/app': appRepo() } });
  try {
    const { start, cb } = await signIn(w);
    const url = new URL(start.body.authorize_url);
    assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('state'), start.body.state);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.axal.vc/api/integrations/oauth/github/callback');
    assert.equal(cb.status, 302);
    assert.equal(cb.location, '/integrations?oauth=ok&provider=github');
    assert.deepEqual(gh.calls, [
      'POST github.com/login/oauth/access_token',
      'GET api.github.com/user',
      'GET api.github.com/user/installations?per_page=100&page=1',
    ]);
    const row = rowOf(w);
    assert.equal(row.status, 'active');
    assert.deepEqual(JSON.parse(row.scopes_json), ['contents:read', 'issues:read', 'metadata:read', 'pull_requests:read'], 'the scopes are read back');
    assert.equal(row.external_account_name, 'fay-founder');
    assert.deepEqual(JSON.parse(row.config_json), { repositories: [], installations: [7] });
    assert.equal(w.one('SELECT enabled FROM integration_companies WHERE integration_id = ? AND company_id = 10', row.id)?.enabled, 1);
    assert.ok(!String(row.credentials_enc).includes('ghu_flow_fixture'), 'the token is stored encrypted');

    const build = await signIn(w, '?return_to=build&project_id=100');
    assert.equal(build.cb.location, '/build/connect?oauth=ok&provider=github&project_id=100');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM integrations').n, 1, 'a second sign-in re-consents the same connection');
  } finally { gh.restore(); }
});

test('#1906 the refusals: a denied consent saves nothing, an overreach is revoked, zero installations still connects', async () => {
  const w = world();
  let gh = fakeGithub();
  try {
    const start = await call(w.env, 'GET', '/api/integrations/oauth/github/start');
    const denied = await call(w.env, 'GET', `/api/integrations/oauth/github/callback?error=access_denied&state=${encodeURIComponent(start.body.state)}`);
    assert.equal(denied.location, '/integrations?oauth=error&provider=github&reason=access_denied');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM integrations').n, 0);
    assert.equal(gh.calls.length, 0, 'GitHub is not called');
  } finally { gh.restore(); }

  gh = fakeGithub({ perms: { ...READ, administration: 'read' } });
  try {
    const { cb } = await signIn(w);
    assert.equal(cb.location, '/integrations?oauth=error&provider=github&reason=scope_overreach');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM integrations').n, 0, 'nothing is saved');
    assert.ok(gh.calls.includes(`DELETE api.github.com/applications/${CLIENT_ID}/grant`), 'the grant is revoked');
  } finally { gh.restore(); }

  gh = fakeGithub({ installations: 0 });
  try {
    const { cb } = await signIn(w);
    assert.equal(cb.location, '/integrations?oauth=ok&provider=github');
    assert.deepEqual(JSON.parse(rowOf(w).config_json), { repositories: [], installations: [] });
    const listed = await call(w.env, 'GET', `/api/integrations/${uidOf(w)}/repositories`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(listed.body.available, [], 'no repositories to choose');
  } finally { gh.restore(); }
});

test('#1906 the repository choice: two chosen; more than fifty refused', async () => {
  const w = world();
  const many = Array.from({ length: MAX_REPOSITORIES + 1 }, (_, i) => `acme/r${i}`);
  const gh = fakeGithub({ reach: ['acme/app', 'acme/web', ...many] });
  try {
    await signIn(w);
    const uid = uidOf(w);
    const listed = await call(w.env, 'GET', `/api/integrations/${uid}/repositories`);
    assert.equal(listed.body.available.length, 2 + many.length);
    const ok = await call(w.env, 'PUT', `/api/integrations/${uid}/repositories`, { repositories: ['acme/app', 'acme/web'], project_id: 100 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(JSON.parse(rowOf(w).config_json).repositories, ['acme/app', 'acme/web']);
    const tooMany = await call(w.env, 'PUT', `/api/integrations/${uid}/repositories`, { repositories: many, project_id: 100 });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error, 'too_many_repositories');
  } finally { gh.restore(); }
});

/** Sign in, choose acme/app for project 100, and return the connection's uid. */
async function connected(w: ReturnType<typeof world>, repos: Record<string, Repo>) {
  await signIn(w);
  const uid = uidOf(w);
  const r = await call(w.env, 'PUT', `/api/integrations/${uid}/repositories`, { repositories: Object.keys(repos), project_id: 100 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return uid;
}
const fedOf = async (w: ReturnType<typeof world>, uid: string) =>
  Object.fromEntries((await call(w.env, 'GET', `/api/integrations/${uid}/fed`)).body.modules.map((m: any) => [m.module, m]));

test('#1906 the sync lands issues on the roadmap and pull requests on must-haves; a re-sync updates and keeps the founder\'s lane', async () => {
  const w = world();
  const repo = appRepo();
  const gh = fakeGithub({ repos: { 'acme/app': repo } });
  try {
    const uid = await connected(w, { 'acme/app': repo });
    const r = await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.counts, { issues: 2, pull_requests: 4, releases: 1, roadmap_items_created: 2, must_haves_created: 4 });
    assert.deepEqual(w.all('SELECT objective, kanban_status FROM roadmap_okrs ORDER BY id').map((x) => [x.objective, x.kanban_status]),
      [['Export to CSV', 'next'], ['Fix login', 'done']]);
    assert.deepEqual(w.all('SELECT title, delivery_status FROM mvp_features ORDER BY id').map((x) => [x.title, x.delivery_status]),
      [['Add export', 'Review'], ['Login fix', 'Done'], ['Old idea', 'Blocked'], ['WIP', 'In Progress']]);
    assert.equal(w.one("SELECT COUNT(*) AS n FROM roadmap_okrs WHERE objective = 'Add export'").n, 0, 'a pull request the issues endpoint lists is not landed twice');
    assert.deepEqual(w.all('SELECT kind, COUNT(*) AS n FROM connector_fed_items GROUP BY kind ORDER BY kind').map((x) => [x.kind, x.n]),
      [['issue', 2], ['pull_request', 4], ['release', 1]]);
    for (const l of w.all("SELECT local_table, local_id FROM connector_fed_items WHERE kind != 'release'")) {
      assert.equal(w.one(`SELECT COUNT(*) AS n FROM ${l.local_table} WHERE id = ?`, l.local_id).n, 1, 'every ledger row points at its landed row');
    }
    const fed = await fedOf(w, uid);
    assert.deepEqual([fed.product_roadmap.count, fed.product_roadmap.linked, fed.prototype_mvp.count, fed.prototype_mvp.linked], [3, 2, 4, 4]);

    // The founder moves "Export to CSV" to their own lane; GitHub renames it, and closes nothing it owns.
    w.db.exec("UPDATE roadmap_okrs SET kanban_status = 'now' WHERE objective = 'Export to CSV'");
    repo.issues[0] = issue(1, 'Export to CSV and XLSX');
    repo.pulls[3] = pull(8, 'WIP', { state: 'closed' });
    const again = await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(again.body.counts.roadmap_items_created, 0);
    assert.equal(again.body.counts.must_haves_created, 0);
    assert.deepEqual(w.all('SELECT objective, kanban_status FROM roadmap_okrs ORDER BY id').map((x) => [x.objective, x.kanban_status]),
      [['Export to CSV and XLSX', 'now'], ['Fix login', 'done']], 'renamed, and the founder\'s lane kept');
    assert.equal(w.one("SELECT delivery_status FROM mvp_features WHERE title = 'WIP'").delivery_status, 'Blocked');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM connector_fed_items').n, 7, 'nothing new');

    // GitHub closes the founder's item: a close is GitHub's.
    repo.issues[0] = issue(1, 'Export to CSV and XLSX', 'closed');
    await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(w.one('SELECT kanban_status FROM roadmap_okrs WHERE id = 1').kanban_status, 'done');
  } finally { gh.restore(); }
});

test('#1906 defect (a): a founder\'s deleted item is never re-created and no longer counts as linked', async () => {
  const w = world();
  const repo = appRepo();
  const gh = fakeGithub({ repos: { 'acme/app': repo } });
  try {
    const uid = await connected(w, { 'acme/app': repo });
    await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    const before = await fedOf(w, uid);
    w.db.exec("DELETE FROM roadmap_okrs WHERE objective = 'Fix login'");
    w.db.exec("DELETE FROM mvp_features WHERE title = 'Old idea'");
    const r = await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(r.status, 200);
    assert.equal(w.one("SELECT COUNT(*) AS n FROM roadmap_okrs WHERE objective = 'Fix login'").n, 0, 'the deletion stands');
    assert.equal(w.one("SELECT COUNT(*) AS n FROM mvp_features WHERE title = 'Old idea'").n, 0);
    assert.deepEqual(w.all("SELECT external_id, local_table, local_id FROM connector_fed_items WHERE external_id IN ('issue:acme/app#2', 'pull:acme/app#7') ORDER BY external_id")
      .map((x) => [x.external_id, x.local_table, x.local_id]), [['issue:acme/app#2', null, null], ['pull:acme/app#7', null, null]]);
    const after = await fedOf(w, uid);
    assert.equal(after.product_roadmap.linked, before.product_roadmap.linked - 1);
    assert.equal(after.prototype_mvp.linked, before.prototype_mvp.linked - 1);
    assert.equal(after.product_roadmap.count, before.product_roadmap.count, 'still counted as arrived');

    const snapshot = () => JSON.stringify([w.all('SELECT * FROM roadmap_okrs ORDER BY id').map((x) => [x.id, x.objective, x.kanban_status]),
      w.all('SELECT id, title, delivery_status FROM mvp_features ORDER BY id'), w.all('SELECT external_id, local_id FROM connector_fed_items ORDER BY id')]);
    const settled = snapshot();
    await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(snapshot(), settled, 'a third sync changes nothing');
  } finally { gh.restore(); }
});

const fullRepo = (name: string, pages: number): Repo => ({
  issues: Array.from({ length: pages * 100 }, (_, i) => issue(i + 1, `${name}#${i + 1}`)),
  pulls: [], releases: [],
});

test('#1906 defect (b): each page costs a fetch, a ledger read and one batch, far inside the budget', async () => {
  const w = world();
  const repos = { 'acme/one': fullRepo('acme/one', 5), 'acme/two': fullRepo('acme/two', 5) };
  const gh = fakeGithub({ repos });
  try {
    const uid = await connected(w, repos);
    const fetchesBefore = gh.calls.length;
    w.meter.d1 = 0; w.meter.batches = 0; w.meter.statements = 0;
    const r = await call(w.env, 'POST', `/api/integrations/${uid}/sync`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.counts.issues, 1000);
    assert.equal(r.body.counts.partial, undefined);
    const fetches = gh.calls.length - fetchesBefore;
    // Five full issue pages (MAX_PAGES stops there), and one empty page each of pulls and releases.
    assert.equal(fetches, 2 * (5 + 1 + 1));
    assert.equal(w.meter.batches, 10, 'one batch per page that has items');
    assert.ok(w.meter.d1 <= 2 * 10 + 15, `D1 subrequests per page are two, not one per item (${w.meter.d1})`);
    assert.ok(fetches + w.meter.d1 < SYNC_SUBREQUEST_BUDGET);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM roadmap_okrs').n, 1000);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM connector_fed_items WHERE local_id IS NOT NULL').n, 1000);
    // Every ledger row points at the row inserted just before it.
    assert.equal(w.one(`SELECT COUNT(*) AS n FROM connector_fed_items f JOIN roadmap_okrs r ON r.id = f.local_id
      WHERE 'issue:' || r.objective = f.external_id`).n, 1000);
  } finally { gh.restore(); }
});

// 30 stops inside the first repository's issues, before page 5; 40 stops at the second repository's first page.
for (const [budget, expected] of [[30, 400], [40, 500]] as const) test(`#1906 defect (b): at a budget of ${budget} the sync stops partly synced, and the next run finishes without duplicates`, async () => {
  const w = world();
  const repos = { 'acme/one': fullRepo('acme/one', 5), 'acme/two': fullRepo('acme/two', 5) };
  const gh = fakeGithub({ repos });
  try {
    const uid = await connected(w, repos);
    const first = await syncGithub(w.env, rowOf(w), budget);
    assert.equal(first.counts?.partial, true);
    const landed = Number(first.counts?.issues);
    assert.equal(landed, expected);
    assert.match(first.summary, /^Partly synced: run Sync again to continue/);
    const status = await call(w.env, 'GET', `/api/integrations/${uid}/sync-status`);
    assert.deepEqual([status.body.state, status.body.reading], ['done', 'Partly synced: run Sync again to continue']);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM roadmap_okrs').n, landed);

    const second = await syncGithub(w.env, rowOf(w));
    assert.equal(second.counts?.partial, undefined);
    assert.equal(Number(second.counts?.issues), 1000 - landed, 'it continues where the first stopped');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM roadmap_okrs').n, 1000);
    assert.equal(w.one('SELECT COUNT(DISTINCT objective) AS n FROM roadmap_okrs').n, 1000, 'no duplicates');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM connector_fed_items').n, 1000);
    assert.equal([...w.KV.m.keys()].filter((k) => k.startsWith('connector-sync-cursor:')).length, 0, 'the cursor is cleared');

    const third = await syncGithub(w.env, rowOf(w));
    assert.equal(Number(third.counts?.issues), 1000, 'with no cursor a run reads everything again');
    assert.equal(Number(third.counts?.roadmap_items_created), 0);
  } finally { gh.restore(); }
});
