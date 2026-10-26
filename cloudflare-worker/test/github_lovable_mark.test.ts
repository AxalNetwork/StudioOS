/**
 * D1084 (#2949, Lovable part 5 of #2398) — "Synced with Lovable": a founder-set
 * mark on a picked GitHub repository, in the connection's `config_json`.
 *
 * The real connector routes over D655's harness, with GitHub stubbed: no test
 * reaches a real provider host. The mark is set and cleared only by the
 * connection's owner through `PATCH /:uid/config` (GitHub's `validateConfig`),
 * and a sync never sets or clears it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_lovable_mark.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import { checkSyncedWith, lovableRepositories, syncedWithOf } from '../src/integrations/providers/github/lovableMark.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const mig = (f: string) => readFileSync(`cloudflare-worker/sql/migrations/${f}`, 'utf8');

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}

async function fixture(config: Record<string, unknown> = { repositories: ['acme/app'], project_id: 100 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);
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
    INSERT INTO company_profiles (id) VALUES (10);
    INSERT INTO user_company_links VALUES (1, 10), (2, 10);
    INSERT INTO projects VALUES (100, 10, NULL);`);
  for (const f of ['435_connector_companies.sql', '445_connector_fed_items.sql', '001_progress_tables.sql', '153_mvp_features.sql', '499_github_roadmap.sql']) db.exec(mig(f));
  addMvpStores(db);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: kv(), GITHUB_APP_CLIENT_ID: 'Iv1.fixture', GITHUB_APP_CLIENT_SECRET: 'fixture' } as any;
  const enc = await encryptCredentials(env, 'gh1', { access_token: 'ghu_fixture' });
  db.prepare("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (11, 'gh1', 1, 'github', 'oauth2', ?, ?)").run(enc, JSON.stringify(config));
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10)');
  return { db, env };
}

/** A read-only GitHub with two repositories and nothing in them. */
function fakeGithub() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.hostname !== 'api.github.com') return new Response('{}', { status: 404 });
    if (url.pathname === '/user/installations') return j({ installations: [{ id: 7, permissions: { issues: 'read', pull_requests: 'read', contents: 'read', metadata: 'read' } }] });
    if (url.pathname === '/user/installations/7/repositories') return j({ repositories: [{ full_name: 'acme/app', private: true }, { full_name: 'acme/site', private: false }] });
    if (/^\/repos\/acme\/(app|site)\/(issues|pulls|releases|milestones)$/.test(url.pathname)) return j([]);
    return new Response('{}', { status: 404 });
  }) as any;
  return () => { globalThis.fetch = real; };
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(env: any, method: string, path: string, body?: unknown, user = 1) {
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json() as any };
}
const config = (db: DatabaseSync) => String(db.prepare("SELECT config_json FROM integrations WHERE uid = 'gh1'").get()?.config_json);

test('the owner marks a picked repository Synced with Lovable and clears it; the repositories read returns the mark', async () => {
  // Mutation checked: the mark not validated (stored as sent); a clear ignored.
  const { db, env } = await fixture();
  const restore = fakeGithub();
  try {
    const set = await call(env, 'PATCH', '/api/connectors/gh1/config', { synced_with: { 'acme/app': 'lovable' } });
    assert.equal(set.status, 200);
    assert.deepEqual(JSON.parse(config(db)).synced_with, { 'acme/app': 'lovable' });
    const read = await call(env, 'GET', '/api/connectors/gh1/repositories');
    assert.deepEqual(read.body.synced_with, { 'acme/app': 'lovable' });
    const cleared = await call(env, 'PATCH', '/api/connectors/gh1/config', { synced_with: { 'acme/app': null } });
    assert.equal(cleared.status, 200);
    assert.deepEqual(JSON.parse(config(db)).synced_with, {});
    assert.equal((await call(env, 'GET', '/api/connectors/gh1/repositories')).body.synced_with, undefined, 'no mark: no field');
  } finally { restore(); }
});

test('an unknown value, a repository not picked and a malformed patch are refused, and nothing is saved', async () => {
  // Mutation checked: any value accepted; a repository not picked accepted.
  const { db, env } = await fixture();
  const before = config(db);
  for (const bad of [{ 'acme/app': 'bolt' }, { 'acme/app': true }, { 'acme/site': 'lovable' }, ['acme/app'], 'lovable', {}]) {
    const r = await call(env, 'PATCH', '/api/connectors/gh1/config', { synced_with: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'invalid_config');
  }
  assert.equal(config(db), before, 'nothing saved');
  const impl = getProviderImpl('github')!;
  assert.deepEqual(impl.validateConfig!({ synced_with: { 'acme/app': 'vercel' } }, { repositories: ['acme/app'] }), { ok: false, error: 'invalid_synced_with' });
  assert.deepEqual(impl.validateConfig!({ synced_with: { 'acme/site': 'lovable' } }, { repositories: ['acme/app'] }), { ok: false, error: 'repository_not_chosen' });
});

test('only the connection\'s owner may set it: another member reaches no connection', async () => {
  const { db, env } = await fixture();
  const r = await call(env, 'PATCH', '/api/connectors/gh1/config', { synced_with: { 'acme/app': 'lovable' } }, 2);
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(config(db)).synced_with, undefined);
});

test('a sync never sets or clears the mark: config_json is unchanged with and without it', async () => {
  // Mutation checked: a sync that writes the mark.
  for (const cfg of [{ repositories: ['acme/app'], project_id: 100 }, { repositories: ['acme/app'], project_id: 100, synced_with: { 'acme/app': 'lovable' } }]) {
    const { db, env } = await fixture(cfg);
    const restore = fakeGithub();
    try {
      const before = config(db);
      const r = await call(env, 'POST', '/api/connectors/gh1/sync', {});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(config(db), before, 'the sync left config_json as it was');
    } finally { restore(); }
  }
});

test('the rules: a mark names a picked repository only; Build reads the marks of the project\'s GitHub connections', async () => {
  assert.deepEqual(syncedWithOf({ repositories: ['acme/app'], synced_with: { 'acme/app': 'lovable', 'acme/gone': 'lovable', 'acme/x': 'other' } }), { 'acme/app': 'lovable' });
  assert.deepEqual(syncedWithOf({ repositories: ['acme/app'], synced_with: ['acme/app'] }), {});
  assert.deepEqual(checkSyncedWith({ 'acme/app': null }, { repositories: ['acme/app'], synced_with: { 'acme/app': 'lovable' } }), { ok: true, synced_with: {} });
  const { env } = await fixture({ repositories: ['acme/app', 'acme/site'], project_id: 100, synced_with: { 'acme/site': 'lovable' } });
  assert.deepEqual([...await lovableRepositories(env, 100)], ['acme/site']);
  assert.deepEqual([...await lovableRepositories(env, 999)], [], 'another project reads no mark');
});

test('the GitHub page says how a Lovable project comes in', () => {
  const words = CONNECTOR_PAGES.github.long_description.join(' ');
  assert.match(words, /Built in Lovable\? Sync it to GitHub in Lovable, then pick the repository here\./);
  assert.match(words, /a sync never changes it/);
});

test('Build › Solution design: a marked repository\'s Built with row carries the mark, an unmarked one carries none', async () => {
  // Mutation checked: the mark dropped from Built with; every repository marked.
  const { solutionDesignFromCode } = await import('../src/integrations/providers/github/solutionDesign.ts');
  const { db, env } = await fixture({ repositories: ['acme/app', 'acme/site'], project_id: 100, synced_with: { 'acme/app': 'lovable' } });
  db.exec(mig('500_github_solution_design.sql'));
  for (const [id, repo] of [[1, 'acme/app'], [2, 'acme/site']] as const) {
    db.prepare("INSERT INTO solution_design_stack(id, integration_id, project_id, repository, languages_json, topics_json) VALUES (?, 11, 100, ?, '[]', '[]')").run(id, repo);
    db.prepare("INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (11, 100, 'solution_design', 'stack', ?, 'solution_design_stack', ?)").run(`stack:100:${repo}`, id);
  }
  const read = await solutionDesignFromCode(env, 100);
  assert.deepEqual(read.built_with.map((s: any) => [s.repository, s.synced_with ?? null]), [['acme/app', 'lovable'], ['acme/site', null]]);
  assert.ok(!('synced_with' in read.built_with[1]), 'an unmarked repository carries no field');
});
