/**
 * D846 (#2467) — one MCP tool registry, listed per member: the tool's source,
 * version, plan and connection; `tools/list` filtered by scope, plan and
 * connection; a hidden tool answering a call exactly as an unknown one; the
 * three read scopes on the consent page; and the two connector-backed reads,
 * which return StudioOS's records and never call a provider.
 *
 * The server is driven through the SDK's own client over an in-memory pair, so
 * the listing and the call gate are the SDK's, not a re-implementation.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mcp_registry_d846.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import * as server from '../src/mcp/server.ts';
import { SCOPES, consentKey, oauthHelpers, requestedScopes } from '../src/mcp/oauth.ts';
import { SCOPE_COPY, mcpConsent } from '../src/routes/mcp_consent.ts';
import { scopesOf } from '../../frontend/src/pages/connect/assistantConsentModel.js';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FAY = 10, BO = 20;            // two founders
const P = 1, P2 = 2, P_BO = 3;      // projects.id: Fay's two ventures and Bo's
const C = 100, C2 = 200, C_BO = 300; // their companies (company_profiles.id)
const TOKEN = 'SECRET-TOKEN-never-leaves';
const STORED_ERROR = 'token=ghp_storederrorleak0123456789';

// A plan-gated tool, so two members on different plans list differently.
const STUDIO_TOOL: server.McpTool = {
  name: 'd846_studio_only', requiredScope: 'build:read', source: 'axal', version: '2.1.0', entitlement: 'studio',
  title: 'Studio only', description: 'A test tool that needs the Raise + Grow plan.', inputSchema: {}, company: false,
  run: async () => ({ ok: true }),
};
server.registerMcpTools([STUDIO_TOOL]);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, founder_id INTEGER,
      spinout_lab_active INTEGER DEFAULT 0, jwt_min_iat INTEGER, deletion_requested_at TEXT,
      subscription_tier TEXT DEFAULT 'free', subscription_status TEXT, subscription_renews_at TEXT);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active',
      auth_type TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, external_account_id TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1, PRIMARY KEY (integration_id, company_id));
    CREATE TABLE connector_fed_items(id INTEGER PRIMARY KEY, integration_id INTEGER, project_id INTEGER, module TEXT, kind TEXT, external_id TEXT, local_table TEXT, local_id INTEGER);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT DEFAULT 'now', shipped_release_id INTEGER);
    CREATE TABLE roadmap_releases(id INTEGER PRIMARY KEY, project_id INTEGER, repository TEXT, tag TEXT, published_at TEXT, prerelease INTEGER DEFAULT 0);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, is_must_have INTEGER, pr_state TEXT);

    INSERT INTO users(id, role, name, email, founder_id, subscription_tier, subscription_status) VALUES
      (${FAY}, 'founder', 'Fay', 'fay@example.test', 1001, 'studio', 'active'),
      (${BO}, 'founder', 'Bo', 'bo@example.test', 1002, 'free', NULL);
    INSERT INTO projects(id, name, founder_id, company_id) VALUES (${P}, 'Acme', 1001, ${C}), (${P2}, 'Second', 1001, ${C2}), (${P_BO}, 'Beta', 1002, ${C_BO});
    INSERT INTO user_company_links VALUES (${FAY}, ${C}), (${FAY}, ${C2}), (${BO}, ${C_BO});

    -- Fay: GitHub, active and switched on for Acme only; HubSpot switched on for Second.
    INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, credentials_enc, external_account_id, last_synced_at, last_error, last_error_at) VALUES
      (1, 'gh-fay', ${FAY}, 'github', 'active', 'oauth2', '${TOKEN}', 'acct-123', '2026-10-20T10:00:00Z', '${STORED_ERROR}', '2026-10-19T09:00:00Z'),
      (2, 'hs-fay', ${FAY}, 'hubspot', 'active', 'oauth2', '${TOKEN}', 'acct-456', '2026-10-18T08:00:00Z', NULL, NULL);
    INSERT INTO integration_companies VALUES (1, ${C}, 1), (2, ${C2}, 1);
    -- Bo: GitHub connected, but switched off for his company.
    INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (3, 'gh-bo', ${BO}, 'github', 'active', 'oauth2', '${TOKEN}');
    INSERT INTO integration_companies VALUES (3, ${C_BO}, 0);

    -- Acme's Build records: three roadmap items (two Now, one Done and shipped), one release and one prerelease, two must-haves (one built).
    INSERT INTO roadmap_releases(id, project_id, repository, tag, published_at, prerelease) VALUES
      (1, ${P}, 'acme/app', 'v1.0.0', '2026-10-01T00:00:00Z', 0), (2, ${P}, 'acme/app', 'v1.1.0-rc', '2026-10-10T00:00:00Z', 1);
    INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status, shipped_release_id) VALUES
      (1, ${P}, 'Sign in', 'now', NULL), (2, ${P}, 'Billing', 'now', NULL), (3, ${P}, 'Onboarding', 'done', 1);
    INSERT INTO mvp_features(id, project_id, title, is_must_have, pr_state) VALUES
      (1, ${P}, 'Auth', 1, 'built'), (2, ${P}, 'Export', 1, 'in_review'), (3, ${P}, 'Nice to have', 0, 'built');
    -- What GitHub fed: one roadmap item still standing, one the founder deleted, one must-have.
    INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES
      (1, ${P}, 'product_roadmap', 'issue', 'i1', 'roadmap_okrs', 1),
      (1, ${P}, 'product_roadmap', 'issue', 'i2', 'roadmap_okrs', NULL),
      (1, ${P}, 'prototype_mvp', 'pull_request', 'pr1', 'mvp_features', 1);
  `);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV(), OAUTH_KV: memKV(), MCP_SERVER_ENABLED: 'true' };
  return { db, env };
}

const grant = (userId: number, companies: number[]) => ({
  userId, companies, clientId: 'test-client', clientName: 'Claude', redirectHost: 'client.example',
  redirectUri: 'https://client.example/callback', grantedAt: Math.floor(Date.now() / 1000),
});
const READS = ['validate:read', 'build:read', 'connectors:read'];

/** A connected SDK client on a fresh server for this grant and scope. */
async function session(env: any, props: any, scope: string[]) {
  const s = await server.createServer(env, props, null, scope);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await s.connect(serverSide);
  const client = new Client({ name: 'd846-test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}
const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();
const body = (r: any) => JSON.parse(r.content[0].text);

/** Fail the test if anything reaches the network. */
async function noNetwork<T>(f: () => Promise<T>): Promise<{ value: T; calls: string[] }> {
  const saved = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (input: any) => { calls.push(String(input?.url ?? input)); throw new Error('D846: a connector-backed read called the network'); }) as any;
  try { return { value: await f(), calls }; } finally { globalThis.fetch = saved; }
}

// ── The registry ─────────────────────────────────────────────────────────────

test('every registered tool says where it comes from and carries a semver version', () => {
  const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  for (const t of server.registeredTools()) {
    assert.ok(['axal', 'connector', 'remote_mcp'].includes(t.source), `${t.name}: source`);
    assert.match(t.version, semver, `${t.name}: version`);
    assert.ok((SCOPES as readonly string[]).includes(t.requiredScope), `${t.name}: scope`);
    if (t.source !== 'axal' && t.requiresConnection) assert.ok(t.provider, `${t.name}: a connector tool that needs a connection names its provider`);
  }
  const byName = new Map(server.registeredTools().map((t) => [t.name, t]));
  assert.deepEqual(
    ['get_build_progress', 'list_connections'].map((n) => { const t = byName.get(n)!; return [n, t.requiredScope, t.source, t.provider ?? null, !!t.requiresConnection]; }),
    [['get_build_progress', 'build:read', 'connector', 'github', true], ['list_connections', 'connectors:read', 'connector', null, false]],
  );
});

// ── Filtered listing across three principals ─────────────────────────────────

test('three principals list three different tool sets: by scope, by plan, and by connection', async () => {
  const { env } = fixture();
  // Fay: Studio plan, GitHub switched on for Acme, every read scope.
  const fay = await names(await session(env, grant(FAY, [P, P2]), READS));
  // Bo: Free plan, GitHub connected but switched off for Beta, the same scopes.
  const bo = await names(await session(env, grant(BO, [P_BO]), READS));
  // Fay again, with only validate:read.
  const narrow = await names(await session(env, grant(FAY, [P, P2]), ['validate:read']));
  assert.deepEqual(fay, ['d846_studio_only', 'get_build_progress', 'get_interview_guide', 'get_meeting_transcript', 'get_session_insights', 'get_validate_context', 'list_channel_chats', 'list_companies', 'list_connections', 'list_meetings']);
  assert.deepEqual(bo, ['get_interview_guide', 'get_meeting_transcript', 'get_session_insights', 'get_validate_context', 'list_channel_chats', 'list_companies', 'list_connections', 'list_meetings'], 'no plan, no switched-on GitHub');
  assert.deepEqual(narrow, ['get_interview_guide', 'get_meeting_transcript', 'get_session_insights', 'get_validate_context', 'list_channel_chats', 'list_companies', 'list_meetings'], 'scope decides');
  assert.ok(!fay.includes('submit_interview'), 'a write tool needs validate:write');
});

test('a connection outside the grant does not list a tool: GitHub on Acme, a grant for Second only', async () => {
  const { env } = fixture();
  assert.ok(!(await names(await session(env, grant(FAY, [P2]), READS))).includes('get_build_progress'));
});

test('a connection that is not active does not list its tool', async () => {
  const { env, db } = fixture();
  db.exec("UPDATE integrations SET status = 'revoked' WHERE id = 1");
  assert.ok(!(await names(await session(env, grant(FAY, [P, P2]), READS))).includes('get_build_progress'));
});

test('a plan past due drops a plan-gated tool', async () => {
  const { env, db } = fixture();
  db.exec(`UPDATE users SET subscription_status = 'past_due' WHERE id = ${FAY}`);
  assert.ok(!(await names(await session(env, grant(FAY, [P]), READS))).includes('d846_studio_only'));
});

// ── The hidden-tool call ─────────────────────────────────────────────────────

test('a hidden tool called by name answers exactly as an unknown name does, and does not run', async () => {
  const { env } = fixture();
  const client = await session(env, grant(BO, [P_BO]), READS);
  const hidden = await client.callTool({ name: 'get_build_progress', arguments: { company: P_BO } });
  const studio = await client.callTool({ name: 'd846_studio_only', arguments: {} });
  const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} });
  assert.deepEqual(hidden, unknown);
  assert.deepEqual(studio, unknown);
  assert.equal(unknown.isError, true);
  assert.deepEqual(body(unknown), { error: server.NOT_AVAILABLE });
  assert.ok(!JSON.stringify(hidden).includes('get_build_progress'), 'the answer does not name the tool');
});

test('a grant whose account has ended lists nothing, and a call answers why', async () => {
  const { env, db } = fixture();
  db.exec(`UPDATE users SET is_active = 0 WHERE id = ${FAY}`);
  const client = await session(env, grant(FAY, [P]), READS);
  assert.deepEqual(await names(client), []);
  const r = await client.callTool({ name: 'list_companies', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(body(r).error, /no longer has an active StudioOS account/);
});

// ── Listing is not authorization: callTool asks again ────────────────────────

test('callTool re-checks the scope, the plan and the connection on every call', async () => {
  const { env, db } = fixture();
  const tool = server.registeredTools().find((t) => t.name === 'get_build_progress')!;
  let ran = 0;
  const counted = { ...tool, run: async (r: any) => { ran += 1; return tool.run(r); } };
  // Scope: a token without build:read is refused before the tool runs.
  const noScope = await server.callTool(env, grant(FAY, [P]), null, counted, { company: P }, ['validate:read', 'connectors:read']);
  assert.equal(noScope.isError, true);
  assert.match(body(noScope).error, /needs build:read/);
  // Connection: switched off since the list was drawn.
  db.exec('UPDATE integration_companies SET enabled = 0 WHERE integration_id = 1');
  const off = await server.callTool(env, grant(FAY, [P]), null, counted, { company: P }, READS);
  // D842 (#2470): every refusal also carries its structured code.
  assert.deepEqual(body(off), { error: server.NOT_AVAILABLE, code: 'refused' });
  db.exec('UPDATE integration_companies SET enabled = 1 WHERE integration_id = 1');
  // A granted company the connection is not switched on for.
  const second = await server.callTool(env, grant(FAY, [P, P2]), null, counted, { company: P2 }, READS);
  assert.match(body(second).error, /not switched on for Second/);
  // Plan: lapsed since the list was drawn.
  let studioRan = 0;
  const studio = { ...STUDIO_TOOL, run: async () => { studioRan += 1; return {}; } };
  db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FAY}`);
  assert.deepEqual(body(await server.callTool(env, grant(FAY, [P]), null, studio, {}, READS)), { error: server.NOT_AVAILABLE, code: 'refused' });
  assert.deepEqual([ran, studioRan], [0, 0], 'nothing ran');
  // And with all of it in place, it runs.
  const ok = await server.callTool(env, grant(FAY, [P]), null, counted, { company: P }, READS);
  assert.equal(ok.isError, undefined, JSON.stringify(ok));
  assert.equal(ran, 1);
});

// ── The new scopes and the consent page ──────────────────────────────────────

test('the three read scopes are requestable, worded on the consent page, and never dropped from it', async () => {
  for (const s of ['build:read', 'raise:read', 'connectors:read']) assert.ok((SCOPES as readonly string[]).includes(s), s);
  assert.deepEqual(requestedScopes(['build:read', 'admin:all', 'connectors:read', 'build:read']), ['build:read', 'connectors:read'], 'only known scopes, once each');
  for (const s of SCOPES) assert.ok(SCOPE_COPY[s] && SCOPE_COPY[s].length > 10, `${s} has wording`);

  const { env } = fixture();
  const client = await oauthHelpers(env).createClient({ redirectUris: ['https://client.example/callback'], clientName: 'Claude', tokenEndpointAuthMethod: 'none' });
  const id = 'a'.repeat(32);
  await env.OAUTH_KV.put(consentKey(id), JSON.stringify({ createdAt: Date.now(), authRequest: {
    clientId: client.clientId, redirectUri: 'https://client.example/callback', responseType: 'code', state: 's',
    scope: ['validate:read', 'build:read', 'raise:read', 'connectors:read'], codeChallenge: 'v'.repeat(43), codeChallengeMethod: 'S256', resource: 'https://axal.vc/mcp' } }));
  const app = new Hono<any>(); app.route('/api/mcp/consent', mcpConsent);
  const jwt = await new SignJWT({ user_id: FAY, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/mcp/consent/${id}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
  assert.equal(res.status, 200, await res.clone().text());
  const parked = await res.json() as any;
  assert.deepEqual(parked.scopes, ['validate:read', 'build:read', 'raise:read', 'connectors:read']);
  assert.deepEqual(parked.scope_labels.map((l: any) => [l.scope, l.label]), parked.scopes.map((s: string) => [s, SCOPE_COPY[s as keyof typeof SCOPE_COPY]]));
  // The page shows the Worker's words, and a scope it has no words for by its name.
  assert.deepEqual(scopesOf(parked), parked.scopes.map((s: string) => SCOPE_COPY[s as keyof typeof SCOPE_COPY]));
  assert.deepEqual(scopesOf({ scopes: ['future:read'] }), ['future:read'], 'never approved unseen');
  assert.deepEqual(scopesOf({ scopes: ['build:read'], scope_labels: [{ scope: 'build:read', label: 'The Worker says this' }] }), ['The Worker says this'], 'the Worker\'s words win');
});

// ── The two connector-backed reads: records only, no provider call ───────────

test('get_build_progress returns Acme\'s Build records and what GitHub fed, with no network call and no token', async () => {
  const { env } = fixture();
  const client = await session(env, grant(FAY, [P, P2]), READS);
  const { value: r, calls } = await noNetwork(() => client.callTool({ name: 'get_build_progress', arguments: { company: P } }));
  assert.deepEqual(calls, [], 'no provider call');
  assert.equal(r.isError, undefined, JSON.stringify(r));
  assert.deepEqual(body(r), {
    company: 'Acme',
    product_roadmap: { items: 3, by_column: { now: 2, next: 0, later: 0, done: 1 }, shipped: 1, releases: 1, latest_release_at: '2026-10-01T00:00:00Z' },
    prototype_mvp: { must_haves: 2, built: 1, in_progress: 1 },
    from_github: { last_synced_at: '2026-10-20T10:00:00Z', fed_by_module: { product_roadmap: 1, prototype_mvp: 1 } },
  });
  const whole = JSON.stringify(r);
  for (const secret of [TOKEN, 'ghp_storederror', 'acct-123']) assert.ok(!whole.includes(secret), secret);
});

test('get_build_progress with no records says unknown, not zero', async () => {
  const { env, db } = fixture();
  db.exec(`INSERT INTO integration_companies VALUES (1, ${C2}, 1)`);
  const r = await server.callTool(env, grant(FAY, [P2]), null, server.registeredTools().find((t) => t.name === 'get_build_progress')!, { company: P2 }, READS);
  const b = body(r);
  assert.equal(b.product_roadmap.items, 0);
  assert.equal(b.product_roadmap.shipped, null);
  assert.deepEqual([b.prototype_mvp.built, b.prototype_mvp.in_progress], [null, null]);
  assert.equal(b.product_roadmap.latest_release_at, null);
});

test('list_connections lists each granted company\'s switched-on connections: provider, status and times, never a token or an error\'s text', async () => {
  const { env } = fixture();
  const client = await session(env, grant(FAY, [P, P2]), READS);
  const { value: r, calls } = await noNetwork(() => client.callTool({ name: 'list_connections', arguments: {} }));
  assert.deepEqual(calls, []);
  assert.deepEqual(body(r), { companies: [
    { id: P, name: 'Acme', connections: [{ provider: 'github', name: 'GitHub', status: 'active', last_synced_at: '2026-10-20T10:00:00Z', last_failed_at: '2026-10-19T09:00:00Z' }] },
    { id: P2, name: 'Second', connections: [{ provider: 'hubspot', name: 'HubSpot', status: 'active', last_synced_at: '2026-10-18T08:00:00Z', last_failed_at: null }] },
  ] });
  const whole = JSON.stringify(r);
  for (const secret of [TOKEN, 'ghp_storederror', 'acct-123', 'acct-456', 'gh-fay']) assert.ok(!whole.includes(secret), secret);
  // Bo's GitHub is switched off for Beta, so Beta lists none.
  const bo = await server.callTool(env, grant(BO, [P_BO]), null, server.registeredTools().find((t) => t.name === 'list_connections')!, {}, READS);
  assert.deepEqual(body(bo), { companies: [{ id: P_BO, name: 'Beta', connections: [] }] });
});

// ── Versioning ───────────────────────────────────────────────────────────────

test('each tool\'s version is reported in _meta, on the listing and on every result', async () => {
  const { env } = fixture();
  const client = await session(env, grant(FAY, [P]), READS);
  const listed = (await client.listTools()).tools;
  for (const t of listed) {
    const reg = server.registeredTools().find((x) => x.name === t.name)!;
    assert.deepEqual(t._meta, { [server.META.version]: reg.version, [server.META.source]: reg.source }, t.name);
  }
  assert.equal(listed.find((t) => t.name === 'd846_studio_only')!._meta![server.META.version], '2.1.0');
  const r = await client.callTool({ name: 'list_companies', arguments: {} });
  // D843 adds the per-call execution id beside D846's tool metadata.
  const { execution_id: executionId, [server.EXECUTION_META]: namespacedId, ...toolMetadata } = r._meta ?? {};
  assert.equal(namespacedId, executionId);
  assert.match(String(executionId), /^[0-9a-f-]{36}$/);
  assert.deepEqual(toolMetadata, { [server.META.version]: '1.0.0', [server.META.source]: 'axal' });
});

test('the call gate sits on the SDK\'s own tools/call handler: the server builds, and an empty list still answers', async () => {
  const { env, db } = fixture();
  db.exec(`UPDATE users SET deletion_requested_at = '2026-10-21' WHERE id = ${BO}`);
  const client = await session(env, grant(BO, [P_BO]), READS);
  assert.deepEqual((await client.listTools()).tools, []);
  assert.equal((await client.callTool({ name: 'no_such_tool', arguments: {} })).isError, true);
});
