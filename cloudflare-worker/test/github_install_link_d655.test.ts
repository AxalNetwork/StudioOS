/**
 * D655 follow-up (#1884) — live installation status and a configured install link.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_install_link_d655.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { githubInstallUrl } from '../src/integrations/providers/github.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const m435 = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const m445 = readFileSync('cloudflare-worker/sql/migrations/445_connector_fed_items.sql', 'utf8');
const m001 = readFileSync('cloudflare-worker/sql/migrations/001_progress_tables.sql', 'utf8');
const m153 = readFileSync('cloudflare-worker/sql/migrations/153_mvp_features.sql', 'utf8');
import { d1Over } from './_d1_sqlite.mjs';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}

async function fixture(t: any) {
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
  db.exec(m435); db.exec(m445); db.exec(m001); db.exec(m153);
  const KV = kv();
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: KV, GITHUB_APP_CLIENT_ID: 'Iv1.fixture', GITHUB_APP_CLIENT_SECRET: 'fixture' } as any;
  const enc = await encryptCredentials(env, 'gh1', { access_token: 'ghu_fixture' });
  db.prepare("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (11, 'gh1', 1, 'github', 'oauth2', ?, '{}')").run(enc);
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10)');
  t.after(() => db.close());
  return { db, env, KV };
}

function fakeGithub(t: any, installations: number[] = [], repos: Record<number, string[]> = {}, status = 200) {
  const calls: string[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    const json = (data: any, code = 200) => new Response(JSON.stringify(data), { status: code });
    if (url.pathname === '/user/installations') return json({ installations: installations.map(id => ({ id, permissions: { issues: 'read', pull_requests: 'read', contents: 'read', metadata: 'read' } })) }, status);
    const match = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (match) return json({ repositories: (repos[Number(match[1])] || []).map(full_name => ({ full_name, private: true })) });
    return json({}, 404);
  }) as any;
  t.after(() => { globalThis.fetch = real; }); return calls;
}
function noSecrets(body: unknown) {
  const text = JSON.stringify(body);
  for (const secret of ['ghu_fixture', 'Iv1.fixture', 'fixture']) assert.ok(!text.includes(secret), 'a credential escaped');
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

test('no installation reports needs_install and only a configured install URL', async t => {
  const { env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal-vc-studioos'; const calls = fakeGithub(t);
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 200); assert.deepEqual(response.body, { ok: true, available: [], needs_install: true,
    install_url: 'https://github.com/apps/axal-vc-studioos/installations/new', selected: [], project_id: null });
  assert.deepEqual(calls, ['/user/installations']); noSecrets(response.body);
});
test('unset and empty slugs do not guess an install link', async t => {
  const { env } = await fixture(t); fakeGithub(t);
  for (const slug of [undefined, '', '   ']) {
    if (slug === undefined) delete env.GITHUB_APP_SLUG; else env.GITHUB_APP_SLUG = slug;
    const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
    assert.equal(response.status, 200); assert.equal(response.body.needs_install, true);
    assert.equal(response.body.install_url, null); noSecrets(response.body);
  }
});
test('installed repositories keep a strict false flag, install link and stored selection', async t => {
  const { db, env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal-vc-studioos';
  db.prepare('UPDATE integrations SET config_json = ? WHERE uid = ?').run(JSON.stringify({ repositories: ['acme/app'], project_id: 100 }), 'gh1');
  const calls = fakeGithub(t, [7], { 7: ['acme/app', 'acme/site'] });
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 200); assert.equal(response.body.needs_install, false);
  assert.equal(response.body.install_url, 'https://github.com/apps/axal-vc-studioos/installations/new');
  assert.deepEqual(response.body.available.map((r: any) => r.full_name), ['acme/app', 'acme/site']);
  assert.deepEqual(response.body.selected, ['acme/app']); assert.equal(response.body.project_id, 100);
  assert.deepEqual(calls, ['/user/installations', '/user/installations/7/repositories']); noSecrets(response.body);
});
test('installed on no repositories is not reported as needing installation', async t => {
  const { env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal-vc-studioos'; fakeGithub(t, [7]);
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 200); assert.equal(response.body.needs_install, false);
  assert.deepEqual(response.body.available, []); assert.equal(response.body.install_url, 'https://github.com/apps/axal-vc-studioos/installations/new');
  noSecrets(response.body);
});
test('slug builder trims configured values and rejects unsafe or unsupported shapes', () => {
  const url = 'https://github.com/apps/axal-vc-studioos/installations/new';
  assert.equal(githubInstallUrl({ GITHUB_APP_SLUG: '  axal-vc-studioos  ' } as any), url);
  assert.equal(githubInstallUrl({ GITHUB_APP_SLUG: 'a' } as any), 'https://github.com/apps/a/installations/new');
  assert.equal(githubInstallUrl({ GITHUB_APP_SLUG: 'x'.repeat(100) } as any), `https://github.com/apps/${'x'.repeat(100)}/installations/new`);
  for (const slug of ['Axal StudioOS', 'AXAL', 'axal/studioos', 'axal-vc-studioos?x=1', '-axal', 'x'.repeat(101), 'axal-vc-studioos/../x', 'axal.studioos', 'axal\nstudioos']) {
    assert.equal(githubInstallUrl({ GITHUB_APP_SLUG: slug } as any), null, slug);
  }
  assert.equal(githubInstallUrl({} as any), null);
});
test('route rejects a malformed configured slug without changing installation status', async t => {
  const { env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal/studioos'; fakeGithub(t);
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 200); assert.equal(response.body.install_url, null); assert.equal(response.body.needs_install, true);
  noSecrets(response.body);
});
test('ownership, company and provider refusals keep their original bodies and make no GitHub call', async t => {
  const { db, env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal-vc-studioos'; const calls = fakeGithub(t);
  for (const [company, user, status, body] of [[10, 2, 404, { error: 'not_found' }], [20, 1, 403, { error: 'company_not_enabled' }]] as const) {
    const response = await call(env, 'GET', '/api/connectors/gh1/repositories', undefined, company, user);
    assert.equal(response.status, status); assert.deepEqual(response.body, body); noSecrets(response.body);
  }
  db.prepare("UPDATE integrations SET provider_key = 'stripe' WHERE uid = 'gh1'").run();
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 422); assert.deepEqual(response.body, { error: 'repositories_not_supported' });
  assert.deepEqual(calls, []); noSecrets(response.body);
});
test('GitHub read failure stays a 502 without successful-read install fields', async t => {
  const { env } = await fixture(t); env.GITHUB_APP_SLUG = 'axal-vc-studioos'; fakeGithub(t, [], {}, 500);
  const response = await call(env, 'GET', '/api/connectors/gh1/repositories');
  assert.equal(response.status, 502); assert.equal(response.body.error, 'repositories_unreadable');
  assert.equal(Object.hasOwn(response.body, 'needs_install'), false); assert.equal(Object.hasOwn(response.body, 'install_url'), false);
  noSecrets(response.body);
});
function block(text: string, name: string): string {
  let current = ''; const rows: string[] = [];
  for (const line of text.split('\n')) {
    const header = /^\[([^\]]+)\]/.exec(line); if (header) current = header[1];
    else if (current === name) rows.push(line);
  }
  return rows.join('\n');
}
test('S1 configuration mirrors one non-secret slug in default and production, with no preview default', () => {
  const toml = readFileSync('wrangler.toml', 'utf8'); const values: string[] = [];
  for (const name of ['vars', 'env.production.vars']) {
    const lines = [...block(toml, name).matchAll(/^GITHUB_APP_SLUG\s*=\s*"([^"]*)"\s*(?:#.*)?$/gm)];
    assert.equal(lines.length, 1, name); values.push(lines[0][1]);
    assert.ok(values.at(-1) === '' || githubInstallUrl({ GITHUB_APP_SLUG: values.at(-1) } as any));
  }
  assert.equal(values[0], values[1]);
  // #2113: the App the owner registered (#2110), so a repository read with no installation offers its install page.
  assert.deepEqual(values, ['axal-vc-studioos', 'axal-vc-studioos']);
  assert.equal(githubInstallUrl({ GITHUB_APP_SLUG: values[1] } as any), 'https://github.com/apps/axal-vc-studioos/installations/new');
  assert.doesNotMatch(block(toml, 'env.preview.vars'), /^GITHUB_APP_SLUG\s*=/m);
});
test('the Worker has exactly one installation URL builder', () => {
  const found: string[] = [];
  const visit = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name); if (entry.isDirectory()) visit(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      const n = readFileSync(path, 'utf8').split('installations/new').length - 1;
      for (let i = 0; i < n; i += 1) found.push(path);
    }
  } };
  visit('cloudflare-worker/src'); assert.deepEqual(found, ['cloudflare-worker/src/integrations/providers/github.ts']);
});
