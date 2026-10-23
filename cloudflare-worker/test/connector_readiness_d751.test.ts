/**
 * D751 (#1880) — the catalogue says whether each OAuth connector is set up,
 * and an unset one is refused before any sign-in state is written.
 *
 * Real SQLite, with `oauth_state_tokens` present so a count of 0 is measured.
 * Every provider module that registers itself is found by reading the
 * sources and imported, so the catalogue is the one production serves.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/connector_readiness_d751.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { REGISTRY, getProviderImpl, registerProvider } from '../src/integrations/registry.ts';
import { _clearOauthCredsCache, setOauthCreds } from '../src/services/providerOauthKeys.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'y'.repeat(64); // synthetic fixture key
const FIXTURE_ID = 'Iv1.d751-fixture';
const FIXTURE_SECRET = 'd751-fixture-secret';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const m435 = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');

/** Every file under src that registers a provider, read from the sources. */
function registeringFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && /^registerProvider\(/m.test(readFileSync(p, 'utf8'))) out.push(p);
    }
  };
  walk('cloudflare-worker/src');
  return out.sort();
}
const FILES = registeringFiles();
for (const f of FILES) await import(pathToFileURL(f).href);

const NINE = ['calendly', 'carta', 'docusign', 'github', 'hubspot', 'salesforce', 'slack', 'stripe', 'zoom'];
const MANAGED = NINE.filter((k) => k !== 'zoom');
const NAMES: Record<string, string> = { github: 'GitHub', slack: 'Slack', zoom: 'Zoom' };
const FOUNDER = 1, ADMIN = 2, STUDIO = 3;

function fixture(opts: { env?: Record<string, string>; unreadable?: boolean } = {}) {
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
    CREATE TABLE provider_oauth_keys (provider_key TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret_enc TEXT NOT NULL,
      created_by_user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, name, email, subscription_tier) VALUES (1, 'founder', 'Fay', 'fay@example.test', 'free'),
      (2, 'admin', 'Ada', 'ada@example.test', 'free'), (3, 'founder', 'Sam', 'sam@example.test', 'studio');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO user_company_links VALUES (1, 10), (2, 10), (3, 10);
    INSERT INTO projects VALUES (100, 10, NULL);`);
  db.exec(m435);
  db.exec(tableFromBaseline(baseline, 'oauth_state_tokens'));
  const real = d1Over(db);
  const keySelects = { n: 0 };
  const DB = {
    ...real,
    prepare(sql: string) {
      if (/provider_oauth_keys/.test(sql)) {
        if (opts.unreadable) throw new Error('D1_ERROR: fixture read failure');
        if (/^\s*SELECT/i.test(sql)) keySelects.n++;
      }
      return real.prepare(sql);
    },
    batch: (...a: any[]) => (real as any).batch(...a),
  };
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'development', ...(opts.env || {}) } as any;
  const states = () => (db.prepare('SELECT COUNT(*) AS n FROM oauth_state_tokens').get() as any).n as number;
  return { db, env, states, keySelects };
}

async function call(env: any, method: string, path: string, user = FOUNDER, body?: unknown) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  const res = await app.request(path, {
    method, redirect: 'manual',
    headers: { Authorization: `Bearer ${jwt}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const seen: unknown[] = [];
const rows = async (env: any, user = FOUNDER) => {
  const r = await call(env, 'GET', '/api/connectors/available', user);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  seen.push(r.body);
  return new Map<string, any>(r.body.providers.map((p: any) => [p.key ?? p.provider_name, p]));
};
const start = async (env: any, provider: string, user = FOUNDER) => {
  const r = await call(env, 'GET', `/api/connectors/oauth/${provider}/start`, user);
  // A started flow's authorize_url carries the client id to the provider by design; every refusal is checked.
  if (r.status !== 200) seen.push(r.body);
  return r;
};
const unset = (name: string) => `${name} isn't set up on Axal yet, so it can't be connected. Nothing was sent to ${name}.`;
const GH = { GITHUB_APP_CLIENT_ID: FIXTURE_ID, GITHUB_APP_CLIENT_SECRET: FIXTURE_SECRET };

test.beforeEach(() => _clearOauthCredsCache());

test('D751 1-2: /available says configured for the nine OAuth connectors only, from the env pair', async () => {
  const f = fixture();
  // #2634: Carta is visible to its founder/investor audiences only.
  const none = await rows(f.env, FOUNDER);
  assert.equal((await rows(f.env, ADMIN)).has('carta'), false);
  for (const k of NINE) assert.equal(none.get(k)?.configured, false, k);
  for (const k of ['figma', 'google_calendar', 'microsoft_365', 'crunchbase', 'affinity', 'mercury']) {
    if (none.has(k)) assert.ok(!('configured' in none.get(k)), `${k} carries no configured`);
  }
  assert.ok(none.has('figma') && none.has('crunchbase') && none.has('google_calendar'));
  for (const k of NINE) assert.equal(none.get(k).has_implementation, true, `${k} has_implementation unchanged`);
  assert.equal(none.get('figma').has_implementation, false);

  _clearOauthCredsCache();
  const gh = await rows(fixture({ env: GH }).env);
  assert.equal(gh.get('github').configured, true);
  for (const k of NINE.filter((x) => x !== 'github')) assert.equal(gh.get(k).configured, false, k);
});

test('D751 3: a D1 row that decrypts is configured; one that does not is not', async () => {
  const f = fixture();
  await setOauthCreds(f.env, 'github', FIXTURE_ID, FIXTURE_SECRET, ADMIN);
  _clearOauthCredsCache();
  assert.equal((await rows(f.env)).get('github').configured, true);
  f.db.prepare("UPDATE provider_oauth_keys SET client_secret_enc = 'bm90LWEtYm94LWF0LWFsbC1qdXN0LWZpeHR1cmUtdGV4dA==' WHERE provider_key = 'github'").run();
  _clearOauthCredsCache();
  assert.equal((await rows(f.env)).get('github').configured, false);
});

test('D751 4: an unreadable key table is null, not unset, and the start says so without a state row', async () => {
  const f = fixture({ unreadable: true });
  const r = await rows(f.env);
  for (const k of MANAGED) assert.equal(r.get(k).configured, null, k);
  assert.equal(r.get('zoom').configured, false, 'Zoom is env only');
  const s = await start(f.env, 'github');
  assert.deepEqual([s.status, s.body.error, s.headers.get('retry-after')], [503, 'oauth_setup_unreadable', '60']);
  assert.equal(s.body.message, "Axal couldn't check whether GitHub is set up, so it can't be connected right now. Nothing was sent to GitHub. Try again in a minute.");
  assert.equal(f.states(), 0);
});

test('D751 5-6: an unset GitHub is refused before any state; an admin is told where the keys go', async () => {
  const f = fixture();
  const s = await start(f.env, 'github');
  assert.deepEqual([s.status, s.body.error, s.body.provider, s.body.message], [503, 'oauth_unconfigured', 'github', unset('GitHub')]);
  assert.equal(s.headers.get('retry-after'), null, 'retrying cannot help');
  assert.ok(!('admin_href' in s.body) && !('env_vars' in s.body), 'a founder gets the sentence only');
  assert.equal(f.states(), 0);
  const a = await start(f.env, 'github', ADMIN);
  assert.equal(a.body.admin_href, '/admin/integration-keys');
  assert.deepEqual(a.body.env_vars, ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']);
  assert.equal(f.states(), 0);

  _clearOauthCredsCache();
  const g = fixture({ env: GH });
  const ok = await start(g.env, 'github');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.authorize_url, /^https:\/\//);
  assert.equal(g.states(), 1, 'the control writes its one row, so 0 above is measured');
});

test('D751 7: the backstop answers the same sentence, and the thrown text stays in the log', async () => {
  const real = getProviderImpl('slack')!;
  registerProvider({
    ...real, key: 'slack', ready: async () => true,
    buildAuthorizeUrl: async () => { throw new Error('slack_oauth_unconfigured: fixture detail'); },
  });
  try {
    const f = fixture();
    const s = await start(f.env, 'slack', ADMIN);
    assert.deepEqual([s.status, s.body.error, s.body.message], [503, 'oauth_unconfigured', unset('Slack')]);
    assert.deepEqual(s.body.env_vars, ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']);
    assert.ok(!JSON.stringify(s.body).includes('fixture detail'));
  } finally {
    registerProvider(real);
  }
});

test('D751 9: a client gone missing mid-flow reaches the page as not_configured; other reasons are unchanged', async () => {
  const f = fixture({ env: GH });
  const s = await start(f.env, 'github');
  assert.equal(s.status, 200);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
  try {
    _clearOauthCredsCache();
    const gone = { ...f.env, GITHUB_APP_CLIENT_ID: undefined, GITHUB_APP_CLIENT_SECRET: undefined };
    const r = await call(gone, 'GET', `/api/connectors/oauth/github/callback?code=x&state=${encodeURIComponent(s.body.state)}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location')!, /oauth=error&provider=github&reason=not_configured$/);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'integration_oauth_failed'").get() as any).n, 1);

    _clearOauthCredsCache();
    const again = await start(f.env, 'github');
    const ctl = await call(f.env, 'GET', `/api/connectors/oauth/github/callback?code=x&state=${encodeURIComponent(again.body.state)}`);
    assert.match(ctl.headers.get('location')!, /reason=github_token_exchange_failed$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('D751 10: Slack and Zoom refuse the same way; Zoom is set up only with all three secrets', async () => {
  const f = fixture();
  const sl = await start(f.env, 'slack');
  assert.deepEqual([sl.status, sl.body.error, sl.body.message], [503, 'oauth_unconfigured', unset('Slack')]);
  const z = await start(f.env, 'zoom', ADMIN);
  assert.deepEqual([z.status, z.body.error, z.body.message], [503, 'oauth_unconfigured', unset('Zoom')]);
  assert.deepEqual(z.body.env_vars, ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN']);
  assert.ok(!('admin_href' in z.body), 'the console cannot set Zoom');
  assert.equal(f.states(), 0);
  const three = { ZOOM_CLIENT_ID: 'zoom-d751-id', ZOOM_CLIENT_SECRET: 'zoom-d751-secret', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-d751-token' };
  assert.equal((await rows(fixture({ env: three }).env)).get('zoom').configured, true);
  assert.equal((await rows(fixture({ env: { ...three, ZOOM_WEBHOOK_SECRET_TOKEN: '' } }).env)).get('zoom').configured, false, 'the client pair alone is not set up');
  assert.equal((await rows(fixture({ env: { ...three, ZOOM_CLIENT_ID: '   ' } }).env)).get('zoom').configured, false, 'whitespace is unset');
});

test('D751 11: a coming_soon connector is refused at the start as /connect refuses it', async () => {
  const f = fixture({ env: { SF_CLIENT_ID: 'sf-d751-id', SF_CLIENT_SECRET: 'sf-d751-secret' } });
  const s = await start(f.env, 'salesforce', STUDIO);
  assert.deepEqual([s.status, s.body.error, s.headers.get('retry-after')], [503, 'coming_soon', '86400']);
  assert.equal(s.body.notify_me_url, '/api/integrations/salesforce/notify-me');
  assert.equal(f.states(), 0);
  const viaConnect = await call(f.env, 'POST', '/api/connectors/connect', STUDIO, { provider_key: 'salesforce' });
  assert.equal(viaConnect.status, 503);
  assert.deepEqual(s.body, viaConnect.body, 'one body for both routes');
});

test('D751 12: readiness and the start read one cache entry', async () => {
  const f = fixture();
  assert.equal((await rows(f.env)).get('github').configured, false);
  const after = f.keySelects.n;
  assert.ok(after >= 1);
  const s = await start(f.env, 'github');
  assert.equal(s.status, 503);
  assert.equal(f.keySelects.n, after, 'no second provider_oauth_keys SELECT within the TTL');
});

test('D751 8: no response carries a secret or a client field', () => {
  assert.ok(seen.length > 10);
  for (const b of seen) {
    const s = JSON.stringify(b);
    for (const bad of [FIXTURE_ID, FIXTURE_SECRET, 'zoom-d751-secret', 'zoom-d751-token', 'sf-d751-secret', '"client_id"', '"client_secret"', '"client_id_preview"']) {
      assert.ok(!s.includes(bad), `${bad} in ${s.slice(0, 120)}`);
    }
  }
});

test('D751 13: every OAuth provider with an impl implements ready, and they are exactly the nine', () => {
  const withImpl = REGISTRY.filter((p) => p.auth_type === 'oauth2' && getProviderImpl(p.key)).map((p) => p.key).sort();
  assert.deepEqual(withImpl, NINE);
  for (const k of withImpl) assert.equal(typeof getProviderImpl(k)!.ready, 'function', `${k} implements ready`);
  assert.ok(FILES.some((f) => f.endsWith('services/channels/zoom.ts')), 'Zoom registers outside providers/');
  assert.ok(Object.keys(NAMES).every((k) => NINE.includes(k)));
});
