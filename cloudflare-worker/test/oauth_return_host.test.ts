/**
 * The shared OAuth callback returns the member to APP_URL's host. The callback
 * answers on OAUTH_CALLBACK_BASE_URL's host (app.axal.vc), but the SPA keeps
 * its signed-in state per origin on axal.vc; a relative return landed the
 * member on app.axal.vc's /login and hid the outcome (Zoom, 2026-10-22).
 * A refused overreach names the extra scopes in its log line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import { issueOauthState } from '../src/integrations/oauth.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key

function fixture(appUrl?: string) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider_key));
    INSERT INTO users(id, role, name, email, subscription_tier) VALUES (1, 'founder', 'First', 'first@example.test', 'growth');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO user_company_links VALUES (1, 10);`);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/457_integrations_last_error_at.sql', 'utf8'));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4), ...(appUrl === undefined ? {} : { APP_URL: appUrl }) } as any;
  return { db, env };
}

function fakeSlack(scopes: string[]) {
  registerProvider({
    key: 'slack',
    async buildAuthorizeUrl(_c, _u, state) { return 'https://provider.example.test/authorize?state=' + encodeURIComponent(state); },
    async connect(_c, _u, input) { return { credentials: {}, scopes, config: input.config }; },
  });
}

async function callback(appUrl: string | undefined, scopes: string[], query = '') {
  const { db, env } = fixture(appUrl);
  fakeSlack(scopes);
  const state = await issueOauthState(env, 1, 'slack', 'fixture', { company_id: 10 });
  const app = new Hono<any>();
  app.route('/api/integrations', integrations);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(`/api/integrations/oauth/slack/callback?code=fixture&state=${encodeURIComponent(state)}${query}`,
    { headers: { Authorization: 'Bearer ' + jwt, 'X-Company-Id': '10' } }, env);
  const log = db.prepare("SELECT response_summary FROM integration_logs WHERE event_type = 'overreach'").get() as { response_summary?: string } | undefined;
  db.close();
  return { status: r.status, location: r.headers.get('location'), overreachLog: log?.response_summary ?? null };
}

test('a successful sign-in returns the member to APP_URL, not the callback host', async () => {
  const r = await callback('https://axal.vc', ['incoming-webhook']);
  assert.deepEqual([r.status, r.location], [302, 'https://axal.vc/integrations?oauth=ok&provider=slack']);
});

test('a refused overreach returns to APP_URL and names the extra scope in the log', async () => {
  const r = await callback('https://axal.vc/', ['incoming-webhook', 'admin']);
  assert.deepEqual([r.status, r.location], [302, 'https://axal.vc/integrations?oauth=error&provider=slack&reason=scope_overreach']);
  assert.equal(r.overreachLog, 'Provider granted permissions beyond the requested set (admin); connection refused.');
});

test("the provider's own error returns to APP_URL too", async () => {
  const r = await callback('https://axal.vc', ['incoming-webhook'], '&error=access_denied');
  assert.deepEqual([r.status, r.location], [302, 'https://axal.vc/integrations?oauth=error&provider=slack&reason=access_denied']);
});

test('without APP_URL the return stays relative, as before', async () => {
  const r = await callback(undefined, ['incoming-webhook']);
  assert.deepEqual([r.status, r.location], [302, '/integrations?oauth=ok&provider=slack']);
});

for (const demo of [undefined, '1', '0']) {
  test(`Carta OAuth start binds the environment to state (demo=${demo ?? 'default'})`, async () => {
    await import('../src/integrations/providers/carta.ts');
    const { db, env } = fixture('https://axal.vc');
    db.prepare("UPDATE users SET subscription_tier = 'studio' WHERE id = 1").run();
    env.CARTA_CLIENT_ID = 'state-fixture-client'; env.CARTA_CLIENT_SECRET = 'state-fixture-secret';
    const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const app = new Hono<any>(); app.route('/api/integrations', integrations);
    try {
      const response = await app.request(`/api/integrations/oauth/carta/start${demo === undefined ? '' : `?demo=${demo}`}`,
        { headers: { Authorization: `Bearer ${jwt}`, 'X-Company-Id': '10' } }, env);
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      const state = db.prepare('SELECT extra_json FROM oauth_state_tokens WHERE state = ?').get(body.state) as any;
      assert.equal(JSON.parse(state.extra_json).is_demo, demo !== '0');
      assert.equal(new URL(body.authorize_url).hostname, demo === '0' ? 'login.app.carta.com' : 'login.playground.carta.team');
    } finally { db.close(); }
  });
}
