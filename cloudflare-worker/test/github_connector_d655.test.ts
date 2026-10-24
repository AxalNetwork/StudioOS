/**
 * D655 (#1467) — the GitHub connector and "now fed by" counts.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_connector_d655.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { getDescriptor, getProviderImpl, publicDescriptor } from '../src/integrations/registry.ts';
import { hasScopeOverreach } from '../src/integrations/connectorRules.ts';
import { checkChoice, prDeliveryStatus } from '../src/integrations/providers/github.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const m435 = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const m445 = readFileSync('cloudflare-worker/sql/migrations/445_connector_fed_items.sql', 'utf8');
const m001 = readFileSync('cloudflare-worker/sql/migrations/001_progress_tables.sql', 'utf8');
const m153 = readFileSync('cloudflare-worker/sql/migrations/153_mvp_features.sql', 'utf8');
const m499 = readFileSync('cloudflare-worker/sql/migrations/499_github_roadmap.sql', 'utf8');
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}

async function fixture() {
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
    INSERT INTO users(id, role, name, email) VALUES (1, 'founder', 'First', 'first@example.test'), (2, 'founder', 'Second', 'second@example.test');
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO user_company_links VALUES (1, 10), (1, 20), (2, 10);
    INSERT INTO projects VALUES (100, 10, NULL), (200, 20, NULL);`);
  db.exec(m435); db.exec(m445); db.exec(m001); db.exec(m153); db.exec(m499); addMvpStores(db);
  const KV = kv();
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: KV, GITHUB_APP_CLIENT_ID: 'Iv1.fixture', GITHUB_APP_CLIENT_SECRET: 'fixture' } as any;
  const enc = await encryptCredentials(env, 'gh1', { access_token: 'ghu_fixture' });
  db.prepare("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (11, 'gh1', 1, 'github', 'oauth2', ?, '{}')").run(enc);
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10)');
  return { db, env, KV };
}

/** A GitHub that answers from a table; `perms` is what the installation grants. */
function fakeGithub(opts: { perms?: Record<string, string>; issues?: any[]; pulls?: any[]; releases?: any[] } = {}) {
  const perms = opts.perms ?? { issues: 'read', pull_requests: 'read', contents: 'read', metadata: 'read' };
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/git\/ref\/tags\//.test(url.pathname)) return new Response('{}', { status: 404 });
    calls.push(url.pathname);
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/user/installations') return j({ installations: [{ id: 7, permissions: perms }] });
    if (url.pathname === '/user/installations/7/repositories') return j({ repositories: [
      { full_name: 'acme/app', private: true, updated_at: '2026-10-12T00:00:00Z' },
      { full_name: 'acme/website', private: false, updated_at: '2026-10-03T00:00:00Z' },
    ] });
    if (url.pathname === '/repos/acme/app/issues') return j(opts.issues ?? []);
    if (url.pathname === '/repos/acme/app/pulls') return j(opts.pulls ?? []);
    if (url.pathname === '/repos/acme/app/releases') return j(opts.releases ?? []);
    if (url.pathname === '/repos/acme/app/milestones') return j([]);
    if (/^\/repos\/acme\/app\/pulls\/\d+\/reviews$/.test(url.pathname)) return j([]);
    return new Response('{}', { status: 404 });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function auth(userId = 1) {
  return new SignJWT({ user_id: userId, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(env: any, method: string, path: string, body?: unknown, company = 10, user = 1) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await auth(user)}`, 'X-Company-Id': String(company), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json() as any };
}

test('the registry asks for read access only, and a write grant is overreach against that same list', () => {
  const desc = getDescriptor('github')!;
  assert.deepEqual(desc.oauth_scopes, ['issues:read', 'pull_requests:read', 'contents:read', 'metadata:read']);
  assert.ok(desc.oauth_scopes!.every((s) => s.endsWith(':read')));
  assert.equal(hasScopeOverreach(desc, ['issues:read', 'metadata:read']), false);
  assert.equal(hasScopeOverreach(desc, ['issues:write', 'metadata:read']), true);
  assert.equal(hasScopeOverreach(desc, ['contents:read', 'administration:read']), true, 'a permission never asked for is overreach too');
  const pub = publicDescriptor(desc);
  assert.equal(pub.permissions.length, desc.oauth_scopes!.length);
  assert.deepEqual(pub.feeds, ['product_roadmap', 'prototype_mvp', 'operating_systems', 'solution_design', 'founding_team', 'company_creation'],
    'D782: Operating systems reads the connection as the Code system; #2114: Solution design; #2115: Founding team and Company creation');
  assert.ok(getProviderImpl('github'), 'the provider registers itself');
});

test('choosing repositories: a write grant is refused and nothing is saved', async () => {
  const { db, env } = await fixture();
  const gh = fakeGithub({ perms: { issues: 'write', pull_requests: 'read', contents: 'read', metadata: 'read' } });
  try {
    const r = await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['acme/app'], project_id: 100 });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'write_scope_refused');
    assert.ok(r.body.granted.includes('issues:write'));
    assert.equal(db.prepare("SELECT config_json FROM integrations WHERE uid = 'gh1'").get()?.config_json, '{}');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integration_logs WHERE event_type = 'overreach'").get()?.n, 1);
  } finally { gh.restore(); }
});

test('choosing repositories: only ones the installation reaches, in an enabled company and project', async () => {
  const { db, env } = await fixture();
  const gh = fakeGithub();
  try {
    const listed = await call(env, 'GET', '/api/connectors/gh1/repositories');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.available.map((r: any) => r.full_name), ['acme/app', 'acme/website']);
    const outside = await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['acme/app', 'other/secret'], project_id: 100 });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.error, 'repository_not_accessible');
    assert.equal((await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: [], project_id: 100 })).body.error, 'repositories_required');
    // Company 20 is not enabled for this connection; neither is its project.
    assert.equal((await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['acme/app'], project_id: 100 }, 20)).status, 403);
    assert.equal((await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['acme/app'], project_id: 200 })).body.error, 'project_not_enabled');
    // Another member cannot reach this connection at all.
    assert.equal((await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['acme/app'], project_id: 100 }, 10, 2)).status, 404);
    const ok = await call(env, 'PUT', '/api/connectors/gh1/repositories', { repositories: ['ACME/app'], project_id: 100 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.repositories, ['acme/app']);
    const cfg = JSON.parse(String(db.prepare("SELECT config_json FROM integrations WHERE uid = 'gh1'").get()?.config_json));
    assert.deepEqual(cfg.repositories, ['acme/app']);
    assert.equal(cfg.project_id, 100);
    // A config patch cannot set repositories around the grant check.
    assert.equal((await call(env, 'PATCH', '/api/connectors/gh1/config', { repositories: ['acme/website'] })).status, 400);
  } finally { gh.restore(); }
});

test('sync lands issues on the roadmap and pull requests on must-haves, once; progress and fed counts follow', async () => {
  const { db, env } = await fixture();
  db.exec(`UPDATE integrations SET config_json = '{"repositories":["acme/app"],"project_id":100}' WHERE uid = 'gh1'`);
  const gh = fakeGithub({
    issues: [{ number: 1, title: 'Export to CSV', state: 'open' }, { number: 2, title: 'Fix login', state: 'closed' }, { number: 3, title: 'A PR', state: 'open', pull_request: {} }],
    pulls: [{ number: 3, title: 'Add export', state: 'open', draft: false }, { number: 4, title: 'Login fix', state: 'closed', merged_at: '2026-10-01' }],
    releases: [{ id: 99, tag_name: 'v1.0' }],
  });
  try {
    const before = await call(env, 'GET', '/api/connectors/gh1/sync-status');
    assert.equal(before.body.state, 'idle');
    assert.equal(before.body.pct, null);
    const r = await call(env, 'POST', '/api/connectors/gh1/sync', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.counts.issues, 2, 'pull requests listed by the issues endpoint are not issues');
    assert.equal(r.body.counts.pull_requests, 2);
    assert.equal(r.body.counts.releases, 1);
    assert.deepEqual(db.prepare('SELECT objective, kanban_status FROM roadmap_okrs WHERE project_id = 100 ORDER BY id').all().map((x: any) => [x.objective, x.kanban_status]),
      [['Export to CSV', 'next'], ['Fix login', 'done']]);
    assert.deepEqual(db.prepare('SELECT title, delivery_status FROM mvp_features WHERE project_id = 100 ORDER BY id').all().map((x: any) => [x.title, x.delivery_status]),
      // D782 (#2112): an open pull request no one was asked to review, and no one approved, is In progress.
      [['Add export', 'In Progress'], ['Login fix', 'Done']]);
    const status = await call(env, 'GET', '/api/connectors/gh1/sync-status');
    assert.equal(status.body.state, 'done');
    assert.equal(status.body.pct, 100);

    // A second sync updates, never duplicates.
    await call(env, 'POST', '/api/connectors/gh1/sync', {});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_okrs').get()?.n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mvp_features').get()?.n, 2);

    const fed = await call(env, 'GET', '/api/connectors/gh1/fed');
    assert.equal(fed.status, 200);
    const by = Object.fromEntries(fed.body.modules.map((m: any) => [m.module, m]));
    // D782 (#2111): the release is a row now, so all three are linked.
    assert.equal(by.product_roadmap.count, 3);
    assert.equal(by.product_roadmap.linked, 3);
    assert.equal(by.product_roadmap.unlanded, 0);
    assert.equal(by.product_roadmap.reason, null);
    assert.equal(by.prototype_mvp.count, 2);
    assert.equal(by.prototype_mvp.linked, 2);
    assert.equal(by.prototype_mvp.reason, null);
  } finally { gh.restore(); }
});

test('sync writes nothing into a project outside the enabled companies', async () => {
  const { db, env } = await fixture();
  db.exec(`UPDATE integrations SET config_json = '{"repositories":["acme/app"],"project_id":200}' WHERE uid = 'gh1'`);
  const gh = fakeGithub({ issues: [{ number: 1, title: 'X', state: 'open' }] });
  try {
    assert.equal((await call(env, 'POST', '/api/connectors/gh1/sync', {}, 20)).status, 403, 'company 20 is not enabled');
    const r = await call(env, 'POST', '/api/connectors/gh1/sync', {}, 10);
    assert.equal(r.status, 502, 'project 200 belongs to company 20');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_okrs').get()?.n, 0);
    assert.equal(gh.calls.filter((p) => p.startsWith('/repos/')).length, 0, 'GitHub is not even read');
  } finally { gh.restore(); }
});

test('fed answers for every connector, and a connector with no ledger says Not recorded, never 0', async () => {
  const { db, env } = await fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (12, 'st1', 1, 'stripe', 'oauth2')");
  const r = await call(env, 'GET', '/api/connectors/st1/fed');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.modules.map((m: any) => m.module), ['revenue_and_traction', 'customers']);
  for (const m of r.body.modules) {
    assert.equal(m.count, null);
    assert.match(m.reason, /^Not recorded/);
  }
  const empty = await call(env, 'GET', '/api/connectors/gh1/fed');
  assert.deepEqual(empty.body.modules.map((m: any) => m.count), [0, 0, null, 0, 0, 0], 'GitHub records its deliveries, so its zero is measured');
  assert.match(empty.body.modules[2].reason, /^Read from the connection/, 'D782: Operating systems reads the connection, so it has no ledger zero');
  assert.equal((await call(env, 'GET', '/api/connectors/st1/fed', undefined, 10, 2)).status, 404);
});

test('the choice check and the pull request states', () => {
  const avail = [{ full_name: 'a/b', private: true, updated_at: null, installation_id: 1 }];
  assert.deepEqual(checkChoice(['a/b', 'A/B'], avail), { ok: true, repositories: ['a/b'] });
  assert.equal((checkChoice(['a/c'], avail) as any).error, 'repository_not_accessible');
  assert.equal((checkChoice(Array(51).fill('a/b'), avail) as any).error, 'too_many_repositories');
  assert.equal(prDeliveryStatus({ merged_at: 'x', state: 'closed' }), 'Done');
  assert.equal(prDeliveryStatus({ state: 'closed' }), 'Blocked');
  assert.equal(prDeliveryStatus({ state: 'open', draft: true }), 'In Progress');
  assert.equal(prDeliveryStatus({ state: 'open' }), 'Review');
});
