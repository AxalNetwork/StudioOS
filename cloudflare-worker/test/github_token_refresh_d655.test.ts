/**
 * D655 follow-up (#1883) — GitHub token renewal and grant revocation.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_token_refresh_d655.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import { accessToken, GITHUB_SIGN_IN_EXPIRED } from '../src/integrations/providers/github.ts';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const m435 = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const m445 = readFileSync('cloudflare-worker/sql/migrations/445_connector_fed_items.sql', 'utf8');
const m001 = readFileSync('cloudflare-worker/sql/migrations/001_progress_tables.sql', 'utf8');
const m153 = readFileSync('cloudflare-worker/sql/migrations/153_mvp_features.sql', 'utf8');
// #2114: the sync also writes Solution design's stack and proposals.
const m500 = readFileSync('cloudflare-worker/sql/migrations/500_github_solution_design.sql', 'utf8');
import { d1Over } from './_d1_sqlite.mjs';

function kv() {
  const m = new Map<string, string>();
  const puts: any[] = [];
  return { get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string, options: any) => { puts.push({ k, options }); m.set(k, v); },
    delete: async (k: string) => { m.delete(k); }, m, puts };
}
const expired = (more: any = {}) => ({ access_token: 'ghu_t5_old', refresh_token: 'ghr_t5_old', expires_at: Date.now() - 1000,
  refresh_token_expires_at: Date.now() + 86400000, ...more });
const refreshed = { access_token: 'ghu_t5_new', refresh_token: 'ghr_t5_new', expires_in: 28800, refresh_token_expires_in: 15897600 };
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
const secretValues = ['ghu_t5_old', 'ghr_t5_old', 'ghu_t5_new', 'ghr_t5_new', 'ghu_t5_reconnect', 't5-client-secret-x9', 'Basic ', 'sensitive-description-marker'];
function noSecrets(value: string) { for (const secret of secretValues) assert.ok(!value.includes(secret), 'a fixture secret escaped'); }
let consoleText: string[] = [];
let oldConsole: any;
let oldFetch: typeof fetch;
test.beforeEach(() => {
  consoleText = []; oldConsole = { log: console.log, warn: console.warn, error: console.error }; oldFetch = globalThis.fetch;
  for (const key of ['log', 'warn', 'error'] as const) console[key] = (...values: any[]) => { consoleText.push(values.join(' ')); };
});
test.afterEach(() => {
  Object.assign(console, oldConsole); globalThis.fetch = oldFetch; noSecrets(consoleText.join(' '));
});
function github(replies: (() => any)[] = [], revoke: () => any = () => new Response(null, { status: 204 })) {
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    calls.push({ url: String(url), method: init.method || 'GET', headers: new Headers(init.headers), body: String(init.body || '') });
    if (url.hostname === 'github.com') { const next = replies.shift(); assert.ok(next, 'unexpected token request'); return await next(); }
    if (init.method === 'DELETE') return await revoke();
    if (url.pathname === '/user') return json({ id: 7, login: 'fixture' });
    if (url.pathname === '/user/installations') return json({ installations: [{ id: 7, permissions: { issues: 'read', pull_requests: 'read', contents: 'read', metadata: 'read' } }] });
    if (url.pathname === '/user/installations/7/repositories') return json({ repositories: [] });
    return json([]);
  }) as any;
  return { calls, tokens: () => calls.filter(c => new URL(c.url).hostname === 'github.com'), revokes: () => calls.filter(c => c.method === 'DELETE') };
}
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }
async function rejectsSafe(fn: () => Promise<any>, expected: RegExp) {
  await assert.rejects(fn, (e: Error) => { noSecrets(e.message); assert.match(e.message, expected); return true; });
}
async function fixture(t: any, creds: any = expired()) {
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
  db.exec(m435); db.exec(m445); db.exec(m001); db.exec(m153); db.exec(m500);
  const KV = kv();
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: KV, GITHUB_APP_CLIENT_ID: 'Iv1.t5-client', GITHUB_APP_CLIENT_SECRET: 't5-client-secret-x9' } as any;
  const enc = await encryptCredentials(env, 'gh1', creds);
  db.prepare("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (11, 'gh1', 1, 'github', 'oauth2', ?, '{}')").run(enc);
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10)');
  db.exec(`UPDATE integrations SET config_json = '{"repositories":["acme/app"],"project_id":100}' WHERE uid = 'gh1'`);
  t.after(() => {
    const logs = ['integration_logs', 'activity_logs'].flatMap(table => db.prepare(`SELECT * FROM ${table}`).all());
    const errors = db.prepare('SELECT last_error FROM integrations').all();
    noSecrets(JSON.stringify({ logs, errors })); db.close();
  });
  const row = () => db.prepare("SELECT * FROM integrations WHERE uid = 'gh1'").get() as any;
  const read = () => decryptCredentials(env, 'gh1', row()?.credentials_enc);
  const write = async (value: any) => db.prepare("UPDATE integrations SET credentials_enc = ? WHERE uid = 'gh1'")
    .run(await encryptCredentials(env, 'gh1', value));
  return { db, env, KV, row, read, write };
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

test('expired concurrent callers refresh once, store the rotated pair, and reuse it', async t => {
  const f = await fixture(t); const row = f.row(); const entered = deferred(); const answer = deferred();
  const gh = github([async () => { entered.resolve(); return answer.promise; }]);
  const a = accessToken(f.env, row); await entered.promise;
  const contended = deferred(); const get = f.KV.get;
  f.KV.get = async key => { const value = await get(key); if (key === 'github:refresh:gh1' && value) contended.resolve(); return value; };
  const b = accessToken(f.env, row); await contended.promise; answer.resolve(json(refreshed));
  assert.deepEqual(await Promise.all([a, b]), ['ghu_t5_new', 'ghu_t5_new']);
  assert.equal(await accessToken(f.env, row), 'ghu_t5_new');
  assert.equal(gh.tokens().length, 1);
  const req = gh.tokens()[0]; const form = new URLSearchParams(req.body);
  assert.equal(req.method, 'POST'); assert.equal(req.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(req.headers.get('accept'), 'application/json');
  assert.deepEqual(Object.fromEntries(form), { client_id: 'Iv1.t5-client', client_secret: 't5-client-secret-x9', grant_type: 'refresh_token', refresh_token: 'ghr_t5_old' });
  const stored = (await f.read())!;
  assert.equal(stored.access_token, 'ghu_t5_new'); assert.equal(stored.refresh_token, 'ghr_t5_new');
  assert.equal(stored.token_type, 'Bearer'); assert.equal(stored.expires_in, 28800);
  assert.ok(Math.abs(Number(stored.expires_at) - Date.now() - 28800000) < 5000);
  assert.ok(Math.abs(Number(stored.refresh_token_expires_at) - Date.now() - 15897600000) < 5000);
  assert.ok(f.KV.puts.every(p => p.options.expirationTtl >= 60)); assert.equal(f.KV.m.has('github:refresh:gh1'), false);
});
test('refreshes 60 seconds early, but leaves a live token alone', async t => {
  for (const [left, count, expected] of [[30000, 1, 'ghu_t5_new'], [120000, 0, 'ghu_t5_old']] as const) {
    const f = await fixture(t, expired({ expires_at: Date.now() + left })); const gh = github([() => json(refreshed)]);
    assert.equal(await accessToken(f.env, f.row()), expected); assert.equal(gh.tokens().length, count);
  }
});
test('legacy expiry derives from issued_at and expires_in', async t => {
  const f = await fixture(t, { access_token: 'ghu_t5_old', refresh_token: 'ghr_t5_old', issued_at: Date.now() - 32400000, expires_in: 28800 });
  const gh = github([() => json(refreshed)]); assert.equal(await accessToken(f.env, f.row()), 'ghu_t5_new'); assert.equal(gh.tokens().length, 1);
});
test('non-expiring tokens keep sync behaviour and make no token request', async t => {
  for (const creds of [{ access_token: 'ghu_t5_old' }, { access_token: 'ghu_t5_old', refresh_token: null, expires_in: null, issued_at: Date.now() }]) {
    const f = await fixture(t, creds); const gh = github();
    assert.equal(await accessToken(f.env, f.row()), 'ghu_t5_old');
    assert.equal((await call(f.env, 'POST', '/api/connectors/gh1/sync', {})).status, 200);
    assert.equal(gh.tokens().length, 0);
  }
});
test('refused renewal marks reconnect, repository reads and repeat sync never renew again', async t => {
  const f = await fixture(t); const stale = f.row();
  const gh = github([() => json({ error: 'bad_refresh_token', error_description: 'sensitive-description-marker' })]);
  const response = await call(f.env, 'POST', '/api/connectors/gh1/sync', {});
  assert.equal(response.status, 502); assert.equal(response.body.error, 'sync_failed'); noSecrets(JSON.stringify(response.body));
  assert.equal(f.row().status, 'error'); assert.equal(f.row().last_error, GITHUB_SIGN_IN_EXPIRED);
  assert.match(f.row().last_error, /expired|invalid_grant|unauthori[sz]ed|\b401\b|revoked/i);
  assert.equal((await f.read())!.reauth_required, true); assert.equal((await f.read())!.refresh_token, null);
  const marked = f.row().credentials_enc;
  await call(f.env, 'POST', '/api/connectors/gh1/sync', {}); await call(f.env, 'GET', '/api/connectors/gh1/repositories');
  await rejectsSafe(() => accessToken(f.env, f.row()), /github_sign_in_expired/);
  assert.equal(gh.tokens().length, 1); assert.equal(f.row().credentials_enc, marked, 'a final refusal is not rewritten or retried');
  await f.write(expired({ access_token: 'ghu_t5_reconnect', expires_at: Date.now() + 3600000 }));
  assert.equal(await accessToken(f.env, stale), 'ghu_t5_reconnect');
});
test('late refusal of a spent token cannot mark a newer pair', async t => {
  const f = await fixture(t); const stale = f.row(); const entered = deferred(); const answer = deferred();
  f.KV.get = async () => { throw new Error('KV down'); };
  const gh = github([async () => { entered.resolve(); return answer.promise; }]);
  const late = accessToken(f.env, stale); await entered.promise;
  await f.write({ ...refreshed, expires_at: Date.now() + 3600000 });
  answer.resolve(json({ error: 'bad_refresh_token' })); assert.equal(await late, 'ghu_t5_new');
  assert.equal(gh.tokens().length, 1); assert.equal(f.row().status, 'active'); assert.equal(f.row().last_error, null);
});
test('missing or locally expired refresh token is final without a request', async t => {
  for (const patch of [{ refresh_token: null }, { refresh_token_expires_at: Date.now() - 1000 }]) {
    const f = await fixture(t, expired(patch)); const gh = github();
    await rejectsSafe(() => accessToken(f.env, f.row()), /github_sign_in_expired/);
    assert.equal(gh.tokens().length, 0); assert.equal(f.row().status, 'error'); assert.equal((await f.read())!.reauth_required, true);
  }
});
test('transport, non-JSON and non-refusal errors preserve credentials and can retry', async t => {
  const f = await fixture(t); const enc = f.row().credentials_enc;
  const responses = [() => json({}, 502), () => { throw new Error('ghu_t5_old sensitive-description-marker'); },
    () => new Response('not JSON'), () => json({ error: 'incorrect_client_credentials', error_description: 'sensitive-description-marker' }),
    () => json({ error: 'ghu_t5_old sensitive-description-marker' }), () => json({})];
  const gh = github(responses);
  for (const code of ['unavailable', 'unavailable', 'unavailable', 'failed: incorrect_client_credentials', 'failed: unknown', 'unavailable']) {
    await rejectsSafe(() => accessToken(f.env, f.row()), new RegExp('github_refresh_' + code));
    assert.equal(f.row().credentials_enc, enc); assert.equal(f.row().status, 'active'); assert.equal(f.row().last_error, null);
    assert.equal((await f.read())!.refresh_token, 'ghr_t5_old'); assert.equal(f.KV.m.has('github:refresh:gh1'), false);
  }
  assert.equal(gh.tokens().length, 6);
});
test('successful renewal never overwrites a concurrent reconnect', async t => {
  const f = await fixture(t); const entered = deferred(); const answer = deferred();
  github([async () => { entered.resolve(); return answer.promise; }]);
  const pending = accessToken(f.env, f.row()); await entered.promise;
  await f.write(expired({ access_token: 'ghu_t5_reconnect', expires_at: Date.now() + 3600000 }));
  const enc = f.row().credentials_enc; answer.resolve(json(refreshed));
  assert.equal(await pending, 'ghu_t5_reconnect'); assert.equal(f.row().credentials_enc, enc);
});
test('lease loser waits then fails retryably, never refreshes or deletes another holder', async t => {
  const f = await fixture(t); f.KV.m.set('github:refresh:gh1', 'someone-else'); const gh = github(); const start = Date.now();
  await rejectsSafe(() => accessToken(f.env, f.row()), /github_refresh_busy/);
  assert.ok(Date.now() - start >= 2900); assert.equal(gh.tokens().length, 0);
  assert.equal(f.KV.m.get('github:refresh:gh1'), 'someone-else'); assert.equal(f.KV.puts.length, 0);
});
test('lease read-back loss never refreshes', async t => {
  const f = await fixture(t); let reads = 0; f.KV.get = async () => ++reads === 1 ? null : 'someone-else'; const gh = github();
  await rejectsSafe(() => accessToken(f.env, f.row()), /github_refresh_busy/); assert.equal(gh.tokens().length, 0);
});
test('renewal keeps old refresh token and expiry if the response omits them', async t => {
  const f = await fixture(t); const old = (await f.read())!;
  github([() => json({ access_token: 'ghu_t5_new', expires_in: 28800 })]);
  assert.equal(await accessToken(f.env, f.row()), 'ghu_t5_new');
  assert.equal((await f.read())!.refresh_token, 'ghr_t5_old'); assert.equal((await f.read())!.refresh_token_expires_at, old.refresh_token_expires_at);
});
test('connect records response expiries without assuming GitHub durations', async t => {
  const f = await fixture(t); github([() => json({ ...refreshed, expires_in: 1200, refresh_token_expires_in: 5000 })]);
  const result = await getProviderImpl('github')!.connect({ env: f.env } as any, {} as any, { oauth_code: 'fixture-code' });
  assert.equal(result.credentials.expires_at, Number(result.credentials.issued_at) + 1200000);
  assert.equal(result.credentials.refresh_token_expires_at, Number(result.credentials.issued_at) + 5000000);
  assert.equal(result.credentials.expires_in, 1200);
});
test('disconnect revokes with Basic client auth and the live token, renewing first if needed', async t => {
  for (const expires_at of [Date.now() + 3600000, Date.now() - 1000]) {
    const f = await fixture(t, expired({ expires_at })); const gh = github([() => json(refreshed)]);
    const result = await call(f.env, 'DELETE', '/api/connectors/gh1'); assert.equal(result.status, 200); assert.equal(f.row(), undefined);
    const revoke = gh.revokes(); assert.equal(revoke.length, 1); assert.equal(revoke[0].url, 'https://api.github.com/applications/Iv1.t5-client/grant');
    assert.equal(revoke[0].headers.get('authorization'), `Basic ${btoa('Iv1.t5-client:t5-client-secret-x9')}`);
    assert.deepEqual(JSON.parse(revoke[0].body), { access_token: expires_at < Date.now() ? 'ghu_t5_new' : 'ghu_t5_old' });
    assert.equal(gh.tokens().length, expires_at < Date.now() ? 1 : 0);
  }
});
test('disconnect still removes locally on revoke failures or a final refusal', async t => {
  for (const mode of ['422', 'network', 'reauth']) {
    const f = await fixture(t, expired({ expires_at: Date.now() + 3600000, ...(mode === 'reauth' ? { reauth_required: true } : {}) }));
    const gh = github([], () => { if (mode === 'network') throw new Error('ghu_t5_old sensitive-description-marker'); return json({}, 422); });
    assert.equal((await call(f.env, 'DELETE', '/api/connectors/gh1')).status, 200); assert.equal(f.row(), undefined);
    assert.equal(gh.revokes().length, mode === 'reauth' ? 0 : 1); assert.equal(gh.tokens().length, 0);
  }
});
test('overreach revocation checks GitHub status without exposing its body', async t => {
  const f = await fixture(t); github([], () => json({ error_description: 'sensitive-description-marker' }, 422));
  await rejectsSafe(() => getProviderImpl('github')!.revokeGranted!(f.env, { credentials: { access_token: 'ghu_t5_old' } } as any), /github_revoke_failed: 422/);
});


test('D1 lease prevents an early duplicate refusal when KV is unavailable', async t => {
  const f = await fixture(t); const row = f.row(); const entered = deferred(); const answer = deferred();
  f.KV.get = async () => { throw new Error('KV down'); };
  const gh = github([async () => { entered.resolve(); return answer.promise; }, () => json({ error: 'bad_refresh_token' })]);
  const winner = accessToken(f.env, row); await entered.promise;
  const loser = accessToken(f.env, row);
  // Let the loser reach its D1 claim while the successful answer is still held.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(gh.tokens().length, 1, 'the duplicate must never spend the token');
  answer.resolve(json(refreshed));
  assert.deepEqual(await Promise.all([winner, loser]), ['ghu_t5_new', 'ghu_t5_new']);
  assert.equal((await f.read())!.refresh_token, 'ghr_t5_new'); assert.equal((await f.read())!.reauth_required, undefined);
  assert.equal((await f.read())!.refresh_lease, undefined); assert.equal(f.row().status, 'active'); assert.equal(f.row().last_error, null);
});
test('a stale D1 lease can be claimed after its holder dies', async t => {
  const f = await fixture(t, expired({ refresh_lease: { holder: 'dead-worker', until: Date.now() - 1000 } }));
  const gh = github([() => json(refreshed)]);
  assert.equal(await accessToken(f.env, f.row()), 'ghu_t5_new'); assert.equal(gh.tokens().length, 1);
  assert.equal((await f.read())!.refresh_lease, undefined);
});


test('CAS loss respects an expired or refused reconnect instead of returning an unstored token', async t => {
  for (const reauth_required of [false, true]) {
    const f = await fixture(t); const entered = deferred(); const answer = deferred();
    github([async () => { entered.resolve(); return answer.promise; }]);
    const pending = accessToken(f.env, f.row()); await entered.promise;
    await f.write(expired({ access_token: 'ghu_t5_reconnect', reauth_required }));
    const enc = f.row().credentials_enc;
    const checked = rejectsSafe(() => pending, reauth_required ? /github_sign_in_expired/ : /github_refresh_busy/);
    answer.resolve(json(refreshed)); await checked;
    assert.equal(f.row().credentials_enc, enc);
  }
});


test('disconnect completes local removal when grant revocation times out', async t => {
  const f = await fixture(t, expired({ expires_at: Date.now() + 3600000 }));
  let deadline = 0; let calls = 0;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadline = ms; return AbortSignal.abort(new DOMException('sensitive-description-marker', 'TimeoutError'));
  });
  globalThis.fetch = (async (_input: any, init: any) => {
    calls += 1; init.signal?.throwIfAborted(); return new Response(null, { status: 204 });
  }) as any;
  assert.equal((await call(f.env, 'DELETE', '/api/connectors/gh1')).status, 200);
  assert.equal(deadline, 5000); assert.equal(calls, 1); assert.equal(f.row(), undefined);
});


test('a rotated pair retries persistence once and never restores the spent token', async t => {
  for (const failures of [1, 2]) {
    const f = await fixture(t); const original = f.row().credentials_enc; let writes = 0;
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = (sql: string) => {
      const stmt = prepare(sql);
      if (!sql.startsWith('UPDATE integrations SET credentials_enc')) return stmt;
      return { ...stmt, bind(...values: any[]) {
        const bound = stmt.bind(...values);
        return { ...bound, async run() {
          writes += 1;
          if (writes > 1 && writes <= failures + 1) throw new Error('sensitive-description-marker');
          return bound.run();
        } };
      } };
    };
    const gh = github([() => json(refreshed)]);
    if (failures === 1) {
      assert.equal(await accessToken(f.env, f.row()), 'ghu_t5_new');
      assert.equal((await f.read())!.refresh_token, 'ghr_t5_new'); assert.equal((await f.read())!.refresh_lease, undefined);
    } else {
      await rejectsSafe(() => accessToken(f.env, f.row()), /github_refresh_unavailable/);
      assert.notEqual(f.row().credentials_enc, original, 'a spent token is never restored to the original ciphertext');
      assert.ok((await f.read())!.refresh_lease, 'leave the lease bounded while storage is unavailable');
    }
    assert.equal(writes, 3); assert.equal(gh.tokens().length, 1);
  }
});
