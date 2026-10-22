/**
 * D848 (#2469) — one connector contract, and the health of each connection.
 *
 *   1. GitHub and Stripe implement `ConnectorAdapter` with the routes' own
 *      connect, disconnect and revoke, and run only read tools their pages name.
 *   2. An error becomes a fixed category: a 429 is `rate_limited`, a 401 `auth`.
 *   3. `execute` runs a listed tool, refuses an unknown one or an unknown
 *      field, and reports one unit with no provider price.
 *   4. `GET /api/connectors/health`: a revoked token is `expired`, a 429
 *      `degraded`, no provider message reaches the response, a connection
 *      without an adapter is not guessed, and only the member's own
 *      connections and granted companies are listed.
 *   5. Checks are kept: a fresh one is reused, a stale one run again, and the
 *      last ten shown newest first.
 *
 * No live provider: every call to GitHub or Stripe is answered by the stub
 * below, and any other URL fails the test.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/connector_contract_d848.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import connectorsHealth, { FRESH_MS, RECENT_CHECKS, decodeCheck } from '../src/routes/connectors_health.ts';
import {
  ConnectorError, ERROR_CATEGORIES, HEALTH_STATES, categoryOfStatus, checkToolInput, connectorAdapterKeys,
  getConnectorAdapter, healthOfCategory,
} from '../src/integrations/contract.ts';
import { getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { GITHUB_SIGN_IN_EXPIRED, classifyGithubError } from '../src/integrations/providers/github.ts';
import { classifyStripeError } from '../src/integrations/providers/stripe.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'd'.repeat(64); // synthetic fixture key
/** Provider text a stub answers with; it must never reach a response. */
const PROVIDER_TEXT = 'Bad credentials for d848-fixture-account';

function world() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, name, email) VALUES (1, 'founder', 'Fay', 'fay@example.test'), (2, 'founder', 'Gus', 'gus@example.test');
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);`);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKv() } as any;
  return { db, env, all: (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((row) => ({ ...row })) };
}

function memKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

/** A connection with a live token, as connect would have saved it. */
async function connection(w: ReturnType<typeof world>, o: { id: number; user: number; provider: string; status?: string; creds?: boolean; companies?: number[] }) {
  const uid = `d848-${o.provider}-${o.id}`;
  const enc = o.creds === false ? null : await encryptCredentials(w.env, uid, { access_token: `fixture-${o.provider}-token`, token_type: 'Bearer' });
  w.db.prepare('INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(o.id, uid, o.user, o.provider, o.status ?? 'active', 'oauth2', enc);
  for (const company of o.companies ?? []) w.db.prepare('INSERT INTO integration_companies VALUES (?, ?, 1)').run(o.id, company);
  return uid;
}

type Answer = { status: number; body?: unknown };
/** GitHub's `/user` and Stripe's `/v1/account`, answering what each test sets. Anything else throws. */
function stub(answers: { github?: Answer; stripe?: Answer; installations?: number[]; repos?: string[] }) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  const j = (a: Answer) => new Response(JSON.stringify(a.body ?? { message: PROVIDER_TEXT }), { status: a.status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.host}${url.pathname}`);
    assert.equal(method, 'GET', 'nothing the contract runs writes to a provider');
    if (url.host === 'api.github.com' && url.pathname === '/user') return j(answers.github ?? { status: 200, body: { id: 4242, login: 'fay-founder' } });
    if (url.host === 'api.github.com' && url.pathname === '/user/installations') {
      return j({ status: 200, body: { installations: (answers.installations ?? [7]).map((id) => ({ id, permissions: { issues: 'read', metadata: 'read' } })) } });
    }
    if (url.host === 'api.github.com' && url.pathname === '/user/installations/7/repositories') {
      return j({ status: 200, body: { repositories: (answers.repos ?? []).map((full_name) => ({ full_name, private: true, updated_at: '2026-10-21T00:00:00Z', owner: { email: 'x@example.test' } })) } });
    }
    if (url.host === 'api.stripe.com' && url.pathname === '/v1/account') {
      return j(answers.stripe ?? { status: 200, body: { id: 'acct_d848', business_profile: { name: 'Fay Ltd' }, email: 'fay@example.test' } });
    }
    throw new Error(`unexpected fetch ${url.href}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const app = new Hono<any>();
app.route('/api/connectors/health', connectorsHealth);
// As the Worker entry's `onError` maps the auth helpers' plain throws (`AUTH_ERROR_STATUSES`).
app.onError((e, c) => (e instanceof Response ? e : c.json({ detail: e.message }, e.message === 'Unauthorized' ? 401 : 500)));
async function health(env: any, userId = 1) {
  const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/api/connectors/health', { headers: { Authorization: `Bearer ${jwt}` } }, env);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}
const of = (body: any, provider: string) => body.connections.find((c: any) => c.provider_key === provider);

// ── 1. Conformance ───────────────────────────────────────────────────────

for (const key of ['github', 'stripe']) {
  test(`1. ${key} implements the contract with the routes' own connect, disconnect and revoke`, () => {
    const adapter = getConnectorAdapter(key);
    assert.ok(adapter, `${key} registers an adapter`);
    const impl = getProviderImpl(key)!;
    assert.equal(adapter.key, key);
    assert.equal(adapter.pattern, 'api');
    assert.equal(adapter.connect, impl.connect, 'connect is the route\'s own');
    assert.equal(adapter.disconnect, impl.disconnect, 'disconnect is the route\'s own');
    assert.equal(adapter.revoke, impl.revokeGranted, 'revoke is the route\'s revokeGranted');
    assert.deepEqual([...adapter.capabilities()], getDescriptor(key)!.capabilities);
    const page = CONNECTOR_PAGES[key] as any;
    assert.ok(adapter.tools().length > 0);
    for (const tool of adapter.tools()) {
      const named = page.tools.find((t: any) => t.name === tool.name);
      assert.ok(named, `${key}.${tool.name} is a tool its page names`);
      assert.equal(named.access, 'read', `${key}.${tool.name} is a read on its page`);
      assert.equal(tool.access, 'read', `${key}.${tool.name} reads`);
      assert.equal(tool.unit, 'call');
      assert.equal(tool.input_schema.type, 'object');
      assert.equal(tool.input_schema.additionalProperties, false);
    }
  });
}

test('1. only GitHub and Stripe adopt the contract so far', () => {
  assert.deepEqual(connectorAdapterKeys(), ['github', 'stripe']);
});

// ── 2. Error mapping ─────────────────────────────────────────────────────

test('2. an HTTP status becomes its category', () => {
  const table: Array<[number, string]> = [[401, 'auth'], [403, 'auth'], [429, 'rate_limited'], [404, 'not_found'], [410, 'not_found'],
    [400, 'invalid_input'], [409, 'invalid_input'], [422, 'invalid_input'], [500, 'provider_down'], [503, 'provider_down'], [418, 'unknown'], [302, 'unknown']];
  for (const [status, category] of table) assert.equal(categoryOfStatus(status), category, String(status));
});

test('2. a category becomes its health', () => {
  assert.deepEqual(ERROR_CATEGORIES.map((c) => [c, healthOfCategory(c)]), [
    ['auth', 'expired'], ['rate_limited', 'degraded'], ['not_found', 'error'], ['invalid_input', 'error'], ['provider_down', 'degraded'], ['unknown', 'error'],
  ]);
});

test('2. GitHub: a 429 is rate_limited, a 401 or a spent sign-in auth, a dropped connection provider_down', () => {
  assert.equal(classifyGithubError(new Error('github_api_failed: 429 /user')), 'rate_limited');
  assert.equal(classifyGithubError(new Error('github_api_failed: 401 /user')), 'auth');
  assert.equal(classifyGithubError(new Error('github_api_failed: 404 /user/installations/123/repositories')), 'not_found');
  assert.equal(classifyGithubError(new Error('github_api_failed: 502 /user')), 'provider_down');
  assert.equal(classifyGithubError(new Error(GITHUB_SIGN_IN_EXPIRED)), 'auth');
  assert.equal(classifyGithubError(new Error('github_credentials_missing')), 'auth');
  assert.equal(classifyGithubError(new Error('github_refresh_busy: wait')), 'provider_down');
  assert.equal(classifyGithubError(new TypeError('fetch failed')), 'provider_down');
  assert.equal(classifyGithubError(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), 'provider_down');
  assert.equal(classifyGithubError(new ConnectorError('invalid_input', 'x')), 'invalid_input');
  assert.equal(classifyGithubError(new Error('upstream said 429 too many')), 'unknown', 'a status outside our own code is not read');
});

test('2. Stripe: a 429 is rate_limited, a 401 auth, and the body after the status is never read', () => {
  assert.equal(classifyStripeError(new Error('stripe_api_failed /v1/account: 429 {"error":"rate"}')), 'rate_limited');
  assert.equal(classifyStripeError(new Error('stripe_api_failed /v1/account: 401 {"error":{"message":"Invalid API Key"}}')), 'auth');
  assert.equal(classifyStripeError(new Error('stripe_api_failed /v1/charges?limit=100: 500 x')), 'provider_down');
  assert.equal(classifyStripeError(new Error('stripe_api_failed /v1/account: 200 but 429 later')), 'unknown');
  assert.equal(classifyStripeError(new ConnectorError('auth', 'stripe_credentials_missing')), 'auth');
});

// ── 3. execute ───────────────────────────────────────────────────────────

test('3. execute runs a listed read tool and reports one call with no provider price', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github' });
  await connection(w, { id: 2, user: 1, provider: 'stripe' });
  const rows = w.all('SELECT * FROM integrations ORDER BY id');
  const s = stub({ repos: ['fay/app'] });
  try {
    const gh = getConnectorAdapter('github')!;
    assert.deepEqual(await gh.execute('read_account', {}, { env: w.env, row: rows[0] }),
      { result: { login: 'fay-founder', id: '4242' }, usage: { units: 1, provider_cost_microusd: null } });
    const listed = await gh.execute('list_repositories', undefined, { env: w.env, row: rows[0] });
    assert.deepEqual(listed.result, { repositories: [{ full_name: 'fay/app', private: true, updated_at: '2026-10-21T00:00:00Z' }] });
    const st = getConnectorAdapter('stripe')!;
    const account = await st.execute('read_account', {}, { env: w.env, row: rows[1] });
    assert.deepEqual(account.result, { id: 'acct_d848', name: 'Fay Ltd' }, 'the account email is not returned');
    assert.equal(JSON.stringify(account).includes('fay@example.test'), false);
  } finally { s.restore(); }
});

test('3. execute refuses an unknown tool, an unknown field and a non-object input, before any call', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github' });
  const row = w.all('SELECT * FROM integrations')[0];
  const s = stub({});
  try {
    const gh = getConnectorAdapter('github')!;
    const refusal = async (tool: string, input: unknown) => {
      try { await gh.execute(tool, input, { env: w.env, row }); return null; } catch (e) { return gh.classifyError(e); }
    };
    assert.equal(await refusal('push_issue', {}), 'not_found');
    assert.equal(await refusal('read_account', { org: 'other' }), 'invalid_input');
    assert.equal(await refusal('read_account', ['x']), 'invalid_input');
    assert.equal(await refusal('read_account', 'x'), 'invalid_input');
    assert.deepEqual(s.calls, [], 'a refused tool calls nothing');
  } finally { s.restore(); }
});

test('3. a tool input is checked against its schema', () => {
  const schema = { type: 'object' as const, properties: { repo: { type: 'string' }, page: { type: 'integer' } }, required: ['repo'], additionalProperties: false as const };
  assert.deepEqual(checkToolInput(schema, { repo: 'a/b', page: 2 }), { repo: 'a/b', page: 2 });
  const code = (input: unknown) => { try { checkToolInput(schema, input); return null; } catch (e) { return (e as Error).message; } };
  assert.equal(code({}), 'missing_input_field');
  assert.equal(code({ repo: 3 }), 'bad_input_field');
  assert.equal(code({ repo: 'a/b', page: 1.5 }), 'bad_input_field');
  assert.equal(code({ repo: 'a/b', owner: 'x' }), 'unknown_input_field');
  const open = { type: 'object' as const, properties: {}, additionalProperties: false as const };
  for (const notObject of [5, true, 'a/b', ['a/b']]) {
    try { checkToolInput(open, notObject); assert.fail(`${JSON.stringify(notObject)} was taken`); }
    catch (e) { assert.equal((e as Error).message, 'input_not_object', JSON.stringify(notObject)); }
  }
});

// ── 4. GET /api/connectors/health ────────────────────────────────────────

test('4. a revoked GitHub token is expired, a Stripe 429 is degraded, and no provider text is answered', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github', companies: [10] });
  await connection(w, { id: 2, user: 1, provider: 'stripe', companies: [10] });
  const s = stub({ github: { status: 401 }, stripe: { status: 429 } });
  try {
    const res = await health(w.env);
    assert.equal(res.status, 200, res.text);
    const gh = of(res.body, 'github');
    assert.equal(gh.contract, true);
    assert.equal(gh.health.state, 'expired');
    assert.equal(gh.health.error_category, 'auth');
    assert.match(gh.health.checked_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const st = of(res.body, 'stripe');
    assert.equal(st.health.state, 'degraded');
    assert.equal(st.health.error_category, 'rate_limited');
    assert.equal(res.text.includes(PROVIDER_TEXT), false, 'the provider\'s message is not answered');
    assert.equal(res.text.includes('fixture-github-token'), false, 'no token is answered');
    assert.equal(res.text.includes('credentials_enc'), false);
    assert.deepEqual(w.all("SELECT provider_key, status, response_summary FROM integration_logs WHERE event_type = 'health' ORDER BY id"), [
      { provider_key: 'github', status: 'error', response_summary: 'expired:auth' },
      { provider_key: 'stripe', status: 'error', response_summary: 'degraded:rate_limited' },
    ], 'each check is kept as its two words, never the provider\'s message');
  } finally { s.restore(); }
});

test('4. a healthy connection is ok with no category', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github' });
  const s = stub({});
  try {
    const res = await health(w.env);
    assert.deepEqual({ ...of(res.body, 'github').health, checked_at: null }, { state: 'ok', checked_at: null, error_category: null });
  } finally { s.restore(); }
});

test('4. a connection with no grant is disconnected, and one without an adapter is not guessed', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github', status: 'pending' });
  await connection(w, { id: 2, user: 1, provider: 'stripe', creds: false });
  await connection(w, { id: 3, user: 1, provider: 'hubspot' });
  const s = stub({});
  try {
    const res = await health(w.env);
    assert.equal(of(res.body, 'github').health.state, 'disconnected');
    assert.equal(of(res.body, 'stripe').health.state, 'disconnected');
    const hub = of(res.body, 'hubspot');
    assert.equal(hub.contract, false);
    assert.deepEqual(hub.health, { state: null, checked_at: null, error_category: null }, 'unknown is null');
    assert.deepEqual(s.calls, [], 'nothing is called for them');
  } finally { s.restore(); }
});

test('4. only the member\'s own connections, and only companies they still belong to', async () => {
  const w = world();
  const mine = await connection(w, { id: 1, user: 1, provider: 'github', companies: [10, 30] });
  await connection(w, { id: 2, user: 2, provider: 'github', companies: [20] });
  // Company 40 is one the member belongs to, but the connection is not enabled there.
  w.db.exec('INSERT INTO integration_companies VALUES (1, 40, 0); INSERT INTO user_company_links VALUES (1, 40)');
  const s = stub({});
  try {
    const res = await health(w.env);
    assert.deepEqual(res.body.connections.map((c: any) => c.uid), [mine], 'another member\'s connection is not listed');
    assert.deepEqual(of(res.body, 'github').company_ids, [10], 'a company left, or one not enabled, is not granted');
    assert.deepEqual(res.body.companies, [{ company_id: 10, connections: [mine] }]);
    assert.equal(s.calls.length, 1, 'another member\'s connection is not checked');
  } finally { s.restore(); }
});

test('4. a signed-out caller is refused', async () => {
  const w = world();
  const res = await app.request('/api/connectors/health', {}, w.env);
  assert.equal(res.status, 401);
});

// ── 5. Kept checks ───────────────────────────────────────────────────────

test('5. a fresh check is reused, a stale one is run again, newest first', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github' });
  const s = stub({});
  try {
    await health(w.env);
    assert.equal(s.calls.length, 1);
    const again = await health(w.env);
    assert.equal(s.calls.length, 1, 'a check younger than FRESH_MS is not run again');
    assert.equal(of(again.body, 'github').checks.length, 1);
    w.db.prepare("UPDATE integration_logs SET created_at = datetime('now', ?)").run(`-${FRESH_MS / 60_000 + 1} minutes`);
    const stale = await health(w.env);
    assert.equal(s.calls.length, 2, 'a stale check is run again');
    const checks = of(stale.body, 'github').checks;
    assert.equal(checks.length, 2);
    assert.ok(checks[0].checked_at > checks[1].checked_at, 'newest first');
    assert.deepEqual(of(stale.body, 'github').health, checks[0]);
  } finally { s.restore(); }
});

test('5. the last ten checks are shown, and a stored row that is not two known words is dropped', async () => {
  const w = world();
  await connection(w, { id: 1, user: 1, provider: 'github' });
  const insert = w.db.prepare("INSERT INTO integration_logs(integration_id, user_id, provider_key, direction, event_type, status, response_summary, created_at) VALUES (1, 1, 'github', 'outbound', 'health', 'ok', ?, datetime('now', ?))");
  for (let i = 12; i >= 1; i -= 1) insert.run(i === 2 ? `error:auth: ${PROVIDER_TEXT}` : 'ok', `-${i} minutes`);
  const s = stub({});
  try {
    const res = await health(w.env);
    const checks = of(res.body, 'github').checks;
    assert.equal(s.calls.length, 0, 'the newest check is fresh');
    assert.equal(checks.length, RECENT_CHECKS - 1, 'ten rows are read and the one that is not two known words is dropped');
    assert.equal(res.text.includes(PROVIDER_TEXT), false);
  } finally { s.restore(); }
});

test('5. a stored check is read back only as words the contract knows', () => {
  assert.deepEqual(decodeCheck('expired:auth', 't'), { state: 'expired', checked_at: 't', error_category: 'auth' });
  assert.deepEqual(decodeCheck('ok', 't'), { state: 'ok', checked_at: 't', error_category: null });
  for (const bad of ['', 'fine', 'expired:revoked', 'expired:auth:more', null]) assert.equal(decodeCheck(bad, 't'), null, String(bad));
  assert.deepEqual([...HEALTH_STATES], ['ok', 'degraded', 'expired', 'disconnected', 'error']);
});
