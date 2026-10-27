import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelClient, exchangeVercelCode } from '../src/services/vercel/api.ts';
import { fakeVercel } from './_vercel_api_fake.mjs';
const auth = { access_token: 'fixture_vercel_token', configuration_id: 'icfg_fixture', team_id: 'team_fixture' };
test('Vercel fake refuses every unapproved non-GET', async () => {
  const f = fakeVercel();
  for (const method of ['POST', 'DELETE', 'PATCH', 'PUT']) await assert.rejects(f.fetch('https://api.vercel.com/v10/projects', { method }), /method_refused/);
});
test('typed client reads every planned endpoint with team scope and refuses redirects', async () => {
  const f = fakeVercel(); globalThis.fetch = f.fetch as typeof fetch;
  const c = vercelClient(auth);
  await c.installation(); await c.projects(); await c.project('prj_fixture'); await c.deployments('prj_fixture'); await c.deployment('dpl_fixture');
  await c.promotionAliases('prj_fixture'); await c.deploymentAliases('dpl_fixture'); await c.projectDomains('prj_fixture'); await c.domainConfig('fixture.example'); await c.domains();
  await c.deploymentEvents('dpl_fixture'); await c.runtimeLogs('prj_fixture', 'dpl_fixture'); await c.analyticsCount('prj_fixture'); await c.analyticsAggregate('prj_fixture');
  assert.equal(f.calls.length, 14); assert.ok(f.calls.every(x => x.method === 'GET' && x.teamId === 'team_fixture' && x.redirect === 'error'));
});
test('OAuth exchange and uninstall are the only account writes', async () => {
  const f = fakeVercel({ allowAccountWrites: true }); globalThis.fetch = f.fetch as typeof fetch;
  assert.deepEqual(await exchangeVercelCode('fixture_client', 'fixture_secret', 'fixture_code', 'https://app.example/callback'), auth);
  await vercelClient(auth).uninstall(); assert.deepEqual(f.calls.map(x => x.method), ['POST', 'DELETE']);
});
test('429 is a static error, exposes reset metadata, never echoes a body or token', async () => {
  globalThis.fetch = (async () => new Response('fixture_secret', { status: 429, headers: { 'x-ratelimit-reset': '1792886460', 'x-ratelimit-remaining': '0' } })) as typeof fetch;
  const seen: any[] = [];
  await assert.rejects(vercelClient(auth, { onRateLimit: x => seen.push(x) }).projects(), (e: any) => e.message === 'vercel_rate_limited' && e.reset === 1792886460 && !JSON.stringify(e).includes('fixture_secret'));
  assert.equal(seen[0].remaining, 0);
});

// ───────────────────────────────────────────── D1096: the connection's lifecycle, through the routes

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import vercelWebhook, { vercelSignature } from '../src/routes/vercel_webhook.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import { checkProjects, liveOf, productionDomain, validateVercelConfig } from '../src/integrations/providers/vercel.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'v'.repeat(64); // synthetic fixture key
const CLIENT = { VERCEL_CLIENT_ID: 'oac_fixture', VERCEL_CLIENT_SECRET: 'fixture_client_secret', VERCEL_INTEGRATION_SLUG: 'axal-vc-fixture' };
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const m435 = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const m589 = readFileSync('cloudflare-worker/sql/migrations/589_vercel_installations.sql', 'utf8');
const m445 = readFileSync('cloudflare-worker/sql/migrations/445_connector_fed_items.sql', 'utf8');
const m591 = readFileSync('cloudflare-worker/sql/migrations/591_vercel_deployments.sql', 'utf8');
const FOUNDER = 1, OTHER = 2;
const PROJECTS = [
  { id: 'prj_web', name: 'acme-web', framework: 'nextjs', nodeVersion: '20.x', plan: 'hobby', link: { type: 'github', org: 'acme', repo: 'web', productionBranch: 'main' },
    targets: { production: { id: 'dpl_1', readyState: 'READY', ready: 1792886400000, createdAt: 1792886300000 } } },
  { id: 'prj_docs', name: 'acme-docs', framework: null, targets: { production: { id: 'dpl_2', readyState: 'ERROR', createdAt: 1792886000000 } } },
  { id: 'prj_other', name: 'side-project' },
];
const DOMAINS = { prj_web: [{ name: 'acme-web.vercel.app', verified: true }, { name: 'app.acme.example', verified: true }, { name: 'www.acme.example', verified: false }], default: [] };

function fixture(env: Record<string, string> = CLIENT) {
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
    CREATE TABLE provider_oauth_keys (provider_key TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret_enc TEXT NOT NULL,
      created_by_user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, name, email) VALUES (1, 'founder', 'Fay', 'fay@example.test'), (2, 'founder', 'Oz', 'oz@example.test');
    INSERT INTO company_profiles (id) VALUES (10), (20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
    INSERT INTO projects VALUES (100, 10, NULL), (200, 20, NULL);`);
  db.exec(m435);
  db.exec(tableFromBaseline(baseline, 'oauth_state_tokens'));
  db.exec(m589);
  db.exec(m445);
  db.exec(m591);
  const kv = memKV();
  const e = { DB: d1Over(db), RATE_LIMITS: kv, JWT_SECRET, ENVIRONMENT: 'development', OAUTH_CALLBACK_BASE_URL: 'https://app.example', ...env } as any;
  return { db, env: e };
}

const waits: Promise<unknown>[] = [];
async function call(env: any, method: string, path: string, user = FOUNDER, body?: unknown, headers: Record<string, string> = {}) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono<any>();
  app.route('/api/connectors/webhook/vercel', vercelWebhook);
  app.route('/api/connectors', integrations);
  app.onError((err, c) => c.json({ error: err.message }, 500));
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException() {} };
  const res = await app.request(path, {
    method, redirect: 'manual',
    headers: { Authorization: `Bearer ${jwt}`, 'X-Company-Id': user === FOUNDER ? '10' : '20', 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }, env, ctx as any);
  await Promise.all(waits.splice(0));
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, location: res.headers.get('location') };
}

const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
const all = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];

/** Start, then come back from Vercel with a code: the callback's redirect. */
async function signIn(env: any, f = fakeVercel({ allowAccountWrites: true, projects: PROJECTS, domains: DOMAINS })) {
  globalThis.fetch = f.fetch as typeof fetch;
  const start = await call(env, 'GET', '/api/connectors/oauth/vercel/start?return_to=build&project_id=100');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const back = await call(env, 'GET', `/api/connectors/oauth/vercel/callback?code=fixture_code&configurationId=icfg_fixture&state=${encodeURIComponent(start.body.state)}`);
  return { start, back, f };
}

test.beforeEach(() => _clearOauthCredsCache());

test('D1096: the start sends the member to the Integration\'s install page with our state; no slug or no client is not set up', async () => {
  const { env } = fixture();
  globalThis.fetch = fakeVercel().fetch as typeof fetch;
  const r = await call(env, 'GET', '/api/connectors/oauth/vercel/start');
  assert.equal(r.status, 200);
  const url = new URL(r.body.authorize_url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://vercel.com/integrations/axal-vc-fixture/new');
  assert.equal(url.searchParams.get('state'), r.body.state);
  assert.equal([...url.searchParams.keys()].join(), 'state', 'no client secret, scope or redirect rides in the address');
  for (const env2 of [{ ...CLIENT, VERCEL_INTEGRATION_SLUG: '' }, { ...CLIENT, VERCEL_INTEGRATION_SLUG: 'Bad Slug/../x' }, { VERCEL_INTEGRATION_SLUG: 'axal-vc-fixture' }]) {
    _clearOauthCredsCache();
    const { env: e2, db } = fixture(env2 as any);
    const s = await call(e2, 'GET', '/api/connectors/oauth/vercel/start');
    assert.equal(s.status, 503, JSON.stringify(env2));
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM oauth_state_tokens').n, 0, 'no state row is left that nobody can consume');
  }
  assert.equal(await getProviderImpl('vercel')!.ready!({ ...env, VERCEL_INTEGRATION_SLUG: '' }), false);
});

test('D1096: a grant wider than Read is refused and uninstalled, and no connection is saved', async () => {
  const { env, db } = fixture();
  const f = fakeVercel({ allowAccountWrites: true, scopes: ['read:project', 'read:deployment', 'read:domain', 'read-write:deployment'] });
  const { back } = await signIn(env, f);
  assert.equal(back.status, 302);
  assert.match(back.location!, /oauth=error&provider=vercel&reason=scope_overreach/);
  assert.ok(f.calls.some((x) => x.method === 'DELETE' && x.path === '/v1/integrations/configuration/icfg_fixture'), 'the installation is removed');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'vercel'").n, 0);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM vercel_installations').n, 0);
});

test('D1096: a forged, reused or another member\'s state is refused before any exchange', async () => {
  const { env } = fixture();
  const f = fakeVercel({ allowAccountWrites: true });
  globalThis.fetch = f.fetch as typeof fetch;
  const forged = await call(env, 'GET', '/api/connectors/oauth/vercel/callback?code=fixture_code&state=not-a-state');
  assert.equal(forged.status, 400);
  const start = await call(env, 'GET', '/api/connectors/oauth/vercel/start');
  const theirs = await call(env, 'GET', `/api/connectors/oauth/vercel/callback?code=fixture_code&state=${encodeURIComponent(start.body.state)}`, OTHER);
  assert.equal(theirs.status, 400, 'a state is bound to the member who started it');
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 0, 'no code was exchanged');
});

test('D1096: a Read grant connects; the installation is recorded for the webhook; the token is stored only encrypted', async () => {
  const { env, db } = fixture();
  const { back } = await signIn(env);
  assert.match(back.location!, /\/build\/connect\?oauth=ok&provider=vercel&project_id=100$/);
  const row = one(db, "SELECT * FROM integrations WHERE provider_key = 'vercel'");
  assert.equal(row.status, 'active');
  assert.ok(!String(row.credentials_enc).includes('fixture_vercel_token'));
  assert.deepEqual(JSON.parse(row.scopes_json), ['read:project', 'read:deployment', 'read:domain']);
  assert.deepEqual(JSON.parse(row.config_json), { account_kind: 'team', project_id: null, projects: [], known_projects: [] });
  const inst = one(db, 'SELECT * FROM vercel_installations');
  assert.deepEqual([inst.integration_id, inst.configuration_id, inst.team_id, inst.account_kind], [row.id, 'icfg_fixture', 'team_fixture', 'team']);
  const logs = JSON.stringify(all(db, 'SELECT * FROM integration_logs'));
  assert.ok(!logs.includes('fixture_vercel_token') && !logs.includes('fixture_client_secret'), 'no token or secret in a log');
});

test('D1096: Choose projects offers only what the installation reaches, and the config takes only those', async () => {
  const { env, db } = fixture();
  await signIn(env, fakeVercel({ allowAccountWrites: true, projects: PROJECTS, selection: 'selected', selected: ['prj_web', 'prj_docs'] }));
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  const r = await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.selection, 'selected');
  assert.deepEqual(r.body.result.available.map((p: any) => p.id), ['prj_web', 'prj_docs'], 'a project the member did not grant is not offered');
  assert.deepEqual(JSON.parse(one(db, 'SELECT config_json FROM integrations WHERE uid = ?', uid).config_json).known_projects, ['prj_web', 'prj_docs']);
  const bad = await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web', 'prj_other'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, 'project_not_accessible');
  for (const k of ['known_projects', 'account_kind', 'configuration_id']) {
    const ro = await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { [k]: ['prj_other'] });
    assert.equal(ro.body.message, 'read_only_field', k);
  }
  const elsewhere = await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { project_id: 200 });
  assert.equal(elsewhere.status, 403, 'a venture in a company the connection is not enabled for');
  const ok = await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web', 'prj_web', 'prj_docs'], project_id: 100 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.config.projects, ['prj_web', 'prj_docs']);
});

test('D1096: the sync records each chosen project\'s facts, prunes what is no longer chosen, and never writes Vercel', async () => {
  const { env, db } = fixture();
  const { f } = await signIn(env);
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web', 'prj_docs'], project_id: 100 });
  const s = await call(env, 'POST', `/api/connectors/${uid}/sync`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const rows = all(db, 'SELECT * FROM vercel_projects ORDER BY vercel_project_id');
  assert.deepEqual(rows.map((r) => [r.vercel_project_id, r.project_id, r.name, r.framework, r.node_version, r.production_branch, r.git_repository, r.production_domain, r.plan, r.live_state, r.live_since]), [
    ['prj_docs', 100, 'acme-docs', null, null, null, null, null, null, 'failing', new Date(1792886000000).toISOString()],
    ['prj_web', 100, 'acme-web', 'nextjs', '20.x', 'main', 'acme/web', 'app.acme.example', 'hobby', 'live', new Date(1792886400000).toISOString()],
  ]);
  assert.ok(f.calls.every((x) => x.method === 'GET' || x.path === '/v2/oauth/access_token'), 'the sync only reads');
  assert.ok(!f.calls.some((x) => /runtime-logs|web-analytics|events$/.test(x.path)), 'the sync reads no log, event or analytics');
  assert.deepEqual(f.calls.filter((x) => /deployments/.test(x.path)).map((x) => x.path), ['/v7/deployments', '/v7/deployments'], 'one deployment list per chosen project (D1098)');
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web'] });
  await call(env, 'POST', `/api/connectors/${uid}/sync`);
  assert.deepEqual(all(db, 'SELECT vercel_project_id FROM vercel_projects').map((r) => r.vercel_project_id), ['prj_web']);
});

test('D1096: a 429 stops the sync Partly synced and keeps what it did not reach; a 401 asks to reconnect', async () => {
  const { env, db } = fixture();
  await signIn(env);
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web', 'prj_docs'], project_id: 100 });
  await call(env, 'POST', `/api/connectors/${uid}/sync`);
  globalThis.fetch = fakeVercel({ projects: PROJECTS, domains: DOMAINS, rateLimited: (p) => p === '/v9/projects/prj_docs' }).fetch as typeof fetch;
  const partly = await call(env, 'POST', `/api/connectors/${uid}/sync`);
  assert.equal(partly.status, 200, JSON.stringify(partly.body));
  assert.match(JSON.stringify(partly.body), /Partly synced/);
  assert.equal(all(db, 'SELECT * FROM vercel_projects').length, 2, 'a partly synced run prunes nothing');
  globalThis.fetch = fakeVercel({ status: 401 }).fetch as typeof fetch;
  const lost = await call(env, 'POST', `/api/connectors/${uid}/sync`);
  assert.notEqual(lost.status, 200);
  const row = one(db, 'SELECT status, last_error FROM integrations WHERE uid = ?', uid);
  assert.equal(row.status, 'error');
  assert.match(row.last_error, /^vercel_reconnect_required/);
  assert.ok(!row.last_error.includes('fixture_secret_must_never_escape'), 'a provider body never reaches the row');
});

test('D1096: disconnect uninstalls on Vercel and deletes every Vercel row', async () => {
  const { env, db } = fixture();
  const { f } = await signIn(env);
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web'], project_id: 100 });
  await call(env, 'POST', `/api/connectors/${uid}/sync`);
  assert.equal(all(db, 'SELECT * FROM vercel_projects').length, 1);
  const d = await call(env, 'DELETE', `/api/connectors/${uid}`);
  assert.equal(d.status, 200);
  assert.ok(f.calls.some((x) => x.method === 'DELETE'), 'uninstalled on Vercel');
  for (const t of ['integrations', 'vercel_installations', 'vercel_projects']) assert.equal(one(db, `SELECT COUNT(*) AS n FROM ${t}`).n, 0, t);
});

const signed = async (body: unknown, secret = CLIENT.VERCEL_CLIENT_SECRET) => {
  const text = JSON.stringify(body);
  return { text, sig: await vercelSignature(secret, text) };
};
const hook = (env: any, text: string, sig?: string) =>
  call(env, 'POST', '/api/connectors/webhook/vercel', FOUNDER, text, sig === undefined ? {} : { 'x-vercel-signature': sig });

test('D1096: the webhook answers 404 to a missing or wrong signature before any lookup, and to an unknown installation', async () => {
  const { env, db } = fixture();
  await signIn(env);
  const before = one(db, 'SELECT COUNT(*) AS n FROM integration_logs').n;
  const event = { type: 'deployment.succeeded', payload: { configuration: { id: 'icfg_fixture' }, deployment: { id: 'dpl_9' } } };
  const { text, sig } = await signed(event);
  assert.equal((await hook(env, text)).status, 404, 'missing');
  assert.equal((await hook(env, text, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a'))).status, 404, 'wrong');
  assert.equal((await hook(env, text, (await signed(event, 'another_secret')).sig)).status, 404, 'signed with another key');
  assert.equal((await hook(env, `${text} `, sig)).status, 404, 'the body changed after signing');
  const unknown = await signed({ ...event, payload: { configuration: { id: 'icfg_nobody' } } });
  assert.equal((await hook(env, unknown.text, unknown.sig)).status, 404, 'an installation Axal does not hold');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM integration_logs').n, before, 'nothing was logged');
});

test('D1096: a good delivery is a nudge: it re-reads Vercel, stores nothing from the body, and a repeat within 60 s is dropped', async () => {
  const { env, db } = fixture();
  await signIn(env);
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web'], project_id: 100 });
  const f = fakeVercel({ projects: PROJECTS, domains: DOMAINS });
  globalThis.fetch = f.fetch as typeof fetch;
  const event = { type: 'deployment.succeeded', payload: { configuration: { id: 'icfg_fixture' }, deployment: { id: 'dpl_9', url: 'secret-preview.example' }, project: { id: 'prj_web', name: 'body-name-never-stored' } } };
  const { text, sig } = await signed(event);
  const r = await hook(env, text, sig);
  assert.equal(r.status, 200);
  assert.equal(one(db, 'SELECT name FROM vercel_projects').name, 'acme-web', 'the fact is Vercel\'s answer, not the body');
  const reads = f.calls.length;
  assert.ok(reads > 0, 'the nudge re-read Vercel');
  const again = await hook(env, text, sig);
  assert.equal(again.body.dropped, 'repeat');
  assert.equal(f.calls.length, reads, 'a repeat reads nothing');
  const logs = JSON.stringify(all(db, "SELECT * FROM integration_logs WHERE event_type = 'webhook'"));
  assert.ok(!/secret-preview|body-name-never-stored|fixture_vercel_token/.test(logs), 'a log holds no body, name or token');
});

test('D1096: integration-configuration.removed marks the connection Removed in Vercel and deletes its Vercel rows', async () => {
  const { env, db } = fixture();
  await signIn(env);
  const uid = one(db, "SELECT uid FROM integrations WHERE provider_key = 'vercel'").uid;
  await call(env, 'GET', `/api/connectors/${uid}/action/projects`);
  await call(env, 'PATCH', `/api/connectors/${uid}/config`, FOUNDER, { projects: ['prj_web'], project_id: 100 });
  await call(env, 'POST', `/api/connectors/${uid}/sync`);
  const { text, sig } = await signed({ type: 'integration-configuration.removed', payload: { configuration: { id: 'icfg_fixture' } } });
  assert.equal((await hook(env, text, sig)).status, 200);
  const row = one(db, 'SELECT status, last_error FROM integrations WHERE uid = ?', uid);
  assert.equal(row.status, 'error');
  assert.match(row.last_error, /Removed in Vercel/);
  for (const t of ['vercel_installations', 'vercel_projects']) assert.equal(one(db, `SELECT COUNT(*) AS n FROM ${t}`).n, 0, t);
  const later = await signed({ type: 'deployment.created', payload: { configuration: { id: 'icfg_fixture' } } });
  assert.equal((await hook(env, later.text, later.sig)).status, 404, 'a removed installation takes no more deliveries');
});

test('D1096: the rules, unit by unit', () => {
  assert.deepEqual(checkProjects(['a', 'b', 'a'], ['a', 'b']), { ok: true, projects: ['a', 'b'] });
  assert.deepEqual(checkProjects(['c'], ['a']), { ok: false, error: 'project_not_accessible' });
  assert.deepEqual(checkProjects('a', ['a']), { ok: false, error: 'projects_must_be_a_list' });
  assert.deepEqual(checkProjects(Array.from({ length: 51 }, (_, i) => `p${i}`), Array.from({ length: 60 }, (_, i) => `p${i}`)), { ok: false, error: 'too_many_projects' });
  assert.deepEqual(validateVercelConfig({ project_id: 4 }, {}), { ok: true, patch: { project_id: 4 } });
  assert.equal(productionDomain([{ name: 'x.vercel.app', verified: true }, { name: 'App.Acme.example', verified: true }]), 'app.acme.example');
  assert.equal(productionDomain([{ name: 'x.vercel.app', verified: true }]), 'x.vercel.app');
  assert.equal(productionDomain([{ name: 'app.acme.example', verified: false }]), null, 'an unverified domain is never the production domain');
  assert.deepEqual(liveOf(null), { state: 'not_deployed', since: null });
  assert.deepEqual(liveOf({ readyState: 'QUEUED', createdAt: 1792886000000 }), { state: 'building', since: new Date(1792886000000).toISOString() });
  assert.deepEqual(liveOf({ readyState: 'CANCELED' }), { state: 'not_deployed', since: null });
});
