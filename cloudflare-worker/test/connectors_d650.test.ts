import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { hasScopeOverreach, validateConnectorSettings, automaticSendAllowed, scheduledSyncDue } from '../src/integrations/connectorRules.ts';
import { getDescriptor } from '../src/integrations/registry.ts';
import { syncStripeForUser } from '../src/integrations/providers/stripe.ts';
import { scheduledConnectorEnabled } from '../src/integrations/companyScope.ts';
import { issueOauthState } from '../src/integrations/oauth.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const migration = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE project_metrics(id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE discovery_interviews(id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider_key));
    INSERT INTO users(id, role, name, email, subscription_tier) VALUES (1, 'founder', 'First', 'first@example.test', 'growth'), (2, 'founder', 'Second', 'second@example.test', 'free'), (3, 'admin', 'Owner', 'owner@example.test', 'free');
    INSERT INTO super_admins VALUES (3);
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO user_company_links VALUES (1, 10), (1, 20), (2, 10), (3, 10);
    INSERT INTO projects VALUES (100, 10, NULL), (200, 20, NULL);`);
  db.exec(migration);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

async function auth(userId = 1) {
  return new SignJWT({ user_id: userId, role: userId === 3 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.route('/api/integrations', integrations);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(env: any, method: string, path: string, body?: unknown, company = 10, user = 1) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await auth(user)}`, 'X-Company-Id': String(company), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json() as any };
}

test('both mounts use one catalogue handler and calendar state comes from its own token table', async () => {
  assert.match(index, /app\.route\('\/api\/connectors', integrations\)/);
  assert.match(index, /app\.route\('\/api\/integrations', integrations\)/);
  const { db, env } = fixture();
  db.exec('CREATE TABLE google_oauth_tokens(user_id INTEGER); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER); INSERT INTO google_oauth_tokens VALUES (1)');
  const canonical = await call(env, 'GET', '/api/connectors/available');
  const alias = await call(env, 'GET', '/api/integrations/available');
  assert.equal(canonical.status, 200);
  assert.deepEqual(alias.body, canonical.body);
  assert.equal(canonical.body.items.find((item: any) => item.key === 'google_calendar').already_connected, true);
  assert.equal(canonical.body.items.find((item: any) => item.key === 'microsoft_365').already_connected, false);
  assert.deepEqual(canonical.body.unreadable_sources, []);
  for (const item of canonical.body.items) {
    assert.equal(item.permissions.length, getDescriptor(item.key)?.oauth_scopes?.length || (item.auth_type === 'api_key' ? 1 : 0));
  }
  db.close();
});

test('a disabled company cannot sync, and teammate lookup discloses a name only', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (11, 'ours', 1, 'hubspot', 'oauth2'), (12, 'theirs', 2, 'hubspot', 'oauth2');");
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10), (11, 20), (12, 10)');
  db.exec('INSERT INTO project_metrics(id, project_id) VALUES (1, 200)');
  let syncs = 0;
  registerProvider({ key: 'hubspot', async connect() { return { credentials: {}, scopes: ['oauth'] }; }, async sync() { syncs++; return { summary: 'ok' }; } });
  const scoped = await call(env, 'PUT', '/api/connectors/ours/companies', { company_ids: [10] });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.company_ids, [10]);
  assert.equal((await call(env, 'POST', '/api/connectors/ours/sync', {}, 20)).status, 403);
  assert.equal(syncs, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_metrics WHERE project_id = 200').get()?.n, 1, 'disabling keeps prior data');
  assert.equal((await call(env, 'POST', '/api/connectors/ours/sync', {}, 10)).status, 200);
  assert.equal(syncs, 1);
  const mate = await call(env, 'GET', '/api/connectors/hubspot');
  assert.deepEqual(mate.body.teammate, { name: 'Second' });
  assert.equal(JSON.stringify(mate.body).includes('theirs'), false);
  assert.equal((await call(env, 'PUT', '/api/connectors/ours/companies', { company_ids: [999] })).status, 403);
  assert.equal((await call(env, 'GET', '/api/connectors/ours/logs', undefined, 10, 3)).status, 404);
  assert.equal((await call(env, 'PATCH', '/api/connectors/ours/config', { sync_frequency: 'manual' }, 10, 3)).status, 404);
  db.close();
});

test('personal connectors continue syncing for their owner with no enabled company', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (11, 'personal', 1, 'calendly', 'oauth2')");
  let syncedUser: number | null = null;
  registerProvider({ key: 'calendly', async connect() { return { credentials: {}, scopes: [] }; }, async sync(_c, user) { syncedUser = user.id; return { summary: 'personal sync' }; } });
  assert.equal(await scheduledConnectorEnabled(env, { id: 11, provider_key: 'calendly', config_json: null, last_synced_at: null } as any), true);
  assert.equal(await scheduledConnectorEnabled(env, { id: 11, provider_key: 'calendly', config_json: '{"sync_frequency":"manual"}', last_synced_at: null } as any), false);
  assert.equal(await scheduledConnectorEnabled(env, { id: 11, provider_key: 'stripe', config_json: null, last_synced_at: null } as any), false);
  const own = await call(env, 'POST', '/api/connectors/personal/sync', {}, 20);
  assert.equal(own.status, 200);
  assert.equal(syncedUser, 1);
  assert.equal((await call(env, 'POST', '/api/connectors/personal/sync', {}, 10, 2)).status, 404);
  assert.equal((await call(env, 'GET', '/api/connectors/calendly')).body.teammate, null);
  db.close();
});

test('DocuSign reconciliation follows the sender, even when the recipient is another connected user', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE esign_envelopes(id INTEGER PRIMARY KEY, envelope_uuid TEXT, user_id INTEGER, created_by INTEGER,
    provider TEXT, docusign_envelope_id TEXT, docusign_account_id TEXT, status TEXT);
    INSERT INTO esign_envelopes VALUES (1, 'from-first', 2, 1, 'docusign', 'remote-1', 'shared-account', 'sent'),
      (2, 'from-second', 1, 2, 'docusign', 'remote-2', 'shared-account', 'sent');`);
  const source = readFileSync('cloudflare-worker/src/integrations/providers/docusign.ts', 'utf8');
  const lookups = [...source.matchAll(/`(SELECT id, envelope_uuid, status FROM esign_envelopes[\s\S]*?)`/g)].map((match) => match[1]);
  assert.equal(lookups.length, 2);
  assert.equal(db.prepare(lookups[0]).get(1, 'remote-1', 'shared-account')?.envelope_uuid, 'from-first');
  assert.equal(db.prepare(lookups[0]).get(1, 'remote-2', 'shared-account'), undefined);
  assert.equal(db.prepare(lookups[1]).get(1, 'remote-1')?.envelope_uuid, 'from-first');
  assert.equal(db.prepare(lookups[1]).get(1, 'remote-2'), undefined);
  const sweep = source.match(/`(SELECT docusign_envelope_id FROM esign_envelopes[\s\S]*?)`/);
  assert.ok(sweep);
  assert.deepEqual(db.prepare(sweep[1]).all(1, 'shared-account').map((row) => ({ ...row })), [{ docusign_envelope_id: 'remote-1' }]);
  db.close();
});

test('request and suggestions are company-scoped; request list is Super Admin only', async () => {
  const { db, env } = fixture();
  const requested = await call(env, 'POST', '/api/connectors/requests', { tool: 'Tool X', use: 'Customer records' });
  assert.equal(requested.status, 201);
  assert.equal(db.prepare("SELECT action FROM activity_logs WHERE action = 'connector_requested'").get()?.action, 'connector_requested');
  assert.equal((await call(env, 'GET', '/api/connectors/requests')).status, 403);
  const listed = await call(env, 'GET', '/api/connectors/requests', undefined, 10, 3);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].tool, 'Tool X');
  const suggestions = await call(env, 'GET', '/api/connectors/suggestions');
  assert.deepEqual(suggestions.body.items.map((item: any) => item.provider_key), ['stripe', 'calendly']);
  db.prepare('INSERT INTO project_metrics(id, project_id) VALUES (1, 100)').run();
  const after = await call(env, 'GET', '/api/connectors/suggestions');
  assert.deepEqual(after.body.items.map((item: any) => item.provider_key), ['calendly']);
  db.close();
});

test('OAuth overreach and generic settings are validated before persistence', () => {
  const desc = getDescriptor('hubspot')!;
  assert.equal(hasScopeOverreach(desc, ['oauth', 'crm.objects.deals.read']), false);
  assert.equal(hasScopeOverreach(desc, []), false);
  assert.equal(hasScopeOverreach(desc, ['oauth', 'admin.accounts.write']), true);
  assert.equal(validateConnectorSettings('slack', { sync_frequency: 'daily', send_modes: { 'Slack channel': 'ask' } }).ok, true);
  assert.equal(validateConnectorSettings('slack', { sync_frequency: 'sometimes' }).ok, false);
  assert.equal(validateConnectorSettings('slack', { send_modes: { 'Slack channel': 'unexpected' } }).ok, false);
  assert.equal(automaticSendAllowed('hubspot', 'auto_push:deal_stage_change', null), true);
  assert.equal(automaticSendAllowed('hubspot', 'auto_push:project_created', null), false);
  assert.equal(automaticSendAllowed('hubspot', 'auto_push:project_created', '{"send_modes":{"HubSpot company":"auto"}}'), true);
  assert.equal(scheduledSyncDue('{"sync_frequency":"manual"}', null), false);
  assert.equal(scheduledSyncDue('{"sync_frequency":"hourly"}', '2026-10-09 12:00:00', Date.parse('2026-10-09T12:30:00Z')), false);
  assert.equal(scheduledSyncDue('{"sync_frequency":"hourly"}', '2026-10-09 12:00:00', Date.parse('2026-10-09T13:01:00Z')), true);
});

test('sync frequency and send modes persist on the owner connection only', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, config_json) VALUES (11, 'settings-own', 1, 'hubspot', 'oauth2', '{}')");
  const changed = await call(env, 'PATCH', '/api/connectors/settings-own/config', {
    sync_frequency: 'daily', send_modes: { 'HubSpot deal': 'ask' },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(JSON.parse(db.prepare('SELECT config_json FROM integrations WHERE id = 11').get()?.config_json as string), {
    sync_frequency: 'daily', send_modes: { 'HubSpot deal': 'ask' },
  });
  assert.equal((await call(env, 'PATCH', '/api/connectors/settings-own/config', { sync_frequency: 'sometimes' })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/connectors/settings-own/config', { sync_frequency: 'manual' }, 10, 2)).status, 404);
  db.close();
});

test('Free cannot connect a studio-tier provider; overreach is logged without saving a connection', async () => {
  const { db, env } = fixture();
  assert.equal((await call(env, 'POST', '/api/connectors/connect', { provider_key: 'carta' }, 10, 2)).status, 402);
  let revoked = 0;
  registerProvider({
    key: 'slack',
    async connect() { return { credentials: { access_token: 'fixture-value' }, scopes: ['incoming-webhook', 'admin'] }; },
    async revokeGranted() { revoked++; },
  });
  const overreach = await call(env, 'POST', '/api/connectors/connect', { provider_key: 'slack' });
  assert.equal(overreach.status, 403);
  assert.equal(overreach.body.error, 'scope_overreach');
  assert.equal(revoked, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integrations').get()?.n, 0);
  assert.equal(db.prepare("SELECT event_type FROM integration_logs WHERE event_type = 'overreach'").get()?.event_type, 'overreach');
  db.close();
});

test('an explicit Stripe import cannot write a project in a disabled company', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (11, 'stripe-own', 1, 'stripe', 'oauth2')");
  db.exec('INSERT INTO integration_companies(integration_id, company_id) VALUES (11, 10)');
  const blocked = await syncStripeForUser(env, 1, 200);
  assert.deepEqual(blocked, { ok: false, imported: 0, detail: 'company_not_enabled' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_metrics').get()?.n, 0);
  db.close();
});

test('OAuth callback refuses an overbroad grant before storing credentials', async () => {
  const { db, env } = fixture();
  let revoked = 0;
  registerProvider({
    key: 'slack',
    async connect() { return { credentials: { access_token: 'fixture-value' }, scopes: ['incoming-webhook', 'admin'] }; },
    async revokeGranted() { revoked++; },
  });
  const state = await issueOauthState(env, 1, 'slack', 'test-verifier', { company_id: 10 });
  const response = await app.request(`/api/connectors/oauth/slack/callback?code=fixture&state=${encodeURIComponent(state)}`, {
    headers: { Authorization: `Bearer ${await auth()}` },
  }, env);
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') || '', /reason=scope_overreach/);
  assert.equal(revoked, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integrations').get()?.n, 0);
  db.close();
});

test('activity log search is literal and paged newest first', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (11, 'log-own', 1, 'slack', 'oauth2')");
  db.exec("INSERT INTO integration_logs(integration_id, user_id, provider_key, direction, event_type, status, response_summary) VALUES (11, 1, 'slack', 'internal', 'alpha', 'ok', 'old'), (11, 1, 'slack', 'internal', 'alpha', 'ok', 'new'), (11, 1, 'slack', 'internal', 'other', 'ok', 'not this')");
  const first = await call(env, 'GET', '/api/connectors/log-own/logs?q=alpha&limit=1&page=1');
  const second = await call(env, 'GET', '/api/connectors/log-own/logs?q=alpha&limit=1&page=2');
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 2);
  assert.equal(first.body.items[0].response_summary, 'new');
  assert.equal(second.body.items[0].response_summary, 'old');
  const wildcard = await call(env, 'GET', '/api/connectors/log-own/logs?q=%25');
  assert.equal(wildcard.body.total, 0);
  db.close();
});

test('D651: GET /waitlist reaches the waitlist, not the per-provider read registered before it', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integration_waitlist (user_id, provider_key) VALUES (1, 'notion')");
  for (const base of ['/api/connectors', '/api/integrations']) {
    const r = await call(env, 'GET', `${base}/waitlist`);
    assert.equal(r.status, 200, `${base}/waitlist`);
    assert.deepEqual(r.body.items.map((i: any) => i.provider_key), ['notion']);
  }
  // The per-provider read still answers for a real key, and still refuses an unknown one.
  assert.equal((await call(env, 'GET', '/api/connectors/hubspot')).status, 200);
  assert.equal((await call(env, 'GET', '/api/connectors/not_a_provider')).status, 404);
});
