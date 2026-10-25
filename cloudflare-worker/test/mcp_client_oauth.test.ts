/**
 * D1080 (#2945, #2404 part 2) — the generic MCP sign-in, end to end against
 * the fake "notes" provider (`_mcp_fake.mjs`, on the reserved `notes.example`
 * domain). No test reaches a real provider host.
 *
 *  1. Sign in: discovery, one DCR registration per redirect URI, PKCE, the
 *     callback, and one `oauth_mcp` row with its tokens encrypted.
 *  2. Discovery through the start: `WWW-Authenticate` first, the well-known
 *     order, an identical issuer, S256, the hosts, and a 3xx refused.
 *  3. Registration order: pre-registered, then CIMD, then DCR.
 *  4. Who the start refuses: signed out, a support session, no company, an
 *     unknown key, Mercury (its own routes), and a client HQ does not hold.
 *  5. The callback's state and cookie: another user's state, a replay, no
 *     cookie, and a provider error, none exchanging a code.
 *  6. RFC 9207: `iss` absent, right and wrong.
 *  7. An overreaching grant and a failed `verifySignIn` are both revoked.
 *  8. The client ID metadata document: served only for a record that
 *     publishes it here, with no secret.
 *  9. Disconnect revokes, then the row is deleted.
 * 10. No token, code or verifier reaches a log, a log row or a redirect.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mcp_client_oauth.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { createMcpOauthRouter, CALLBACK_REASONS, CSRF_COOKIE, returnPath, type McpOauthDeps } from '../src/routes/connector_mcp_oauth.ts';
import { discoverMcp } from '../src/integrations/mcpClient.ts';
import { mcpProvider, type McpProvider } from '../src/integrations/mcpProviders.ts';
import { genericMcpProvider, mcpCallbackUrl, mcpCimdUrl, mcpDisconnect, mcpReadiness } from '../src/integrations/mcpSignIn.ts';
import { decryptCredentials } from '../src/integrations/secrets.ts';
import { MCP_CLIENT_METADATA } from '../src/middleware/rateLimit.ts';
import type { ProviderDescriptor } from '../src/integrations/registry.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { NOTES_ISSUER, NOTES_MCP, notesFake } from './_mcp_fake.mjs';

const KEY = 'notes_fake';
const BASE = `/api/integrations/mcp/${KEY}`;

function notes(over: Partial<McpProvider> = {}): McpProvider {
  return mcpProvider({
    key: KEY,
    resources: [NOTES_MCP],
    hosts: ['notes.example'],
    scopes: ['notes.read'],
    accepted_scopes: ['notes.read', 'offline_access'],
    read_tools: ['search_notes', 'get_note'],
    write_tools: [],
    publish_issue: null,
    registration: ['dcr'],
    cimd_url: null,
    era: 'auto',
    budget: 12,
    headers: {},
    session: 'per_request',
    tool_pins: null,
    lease: `mcp:${KEY}`,
    state_provider: `mcp_${KEY}`,
    client_key_prefix: `mcp_client:${KEY}:`,
    callback_path: `${BASE}/callback`,
    ...over,
  });
}

const DESCRIPTOR: ProviderDescriptor = {
  key: KEY, display_name: 'Notes', integration_type: 'data_feed', description: 'An invented notes app.',
  status: 'beta', tier: 'free', auth_type: 'oauth_mcp', capabilities: ['Read-only'], docs_url: null,
} as ProviderDescriptor;

const ROLES: Record<number, string> = { 10: 'founder', 20: 'partner', 30: 'investor', 1: 'admin' };

function appWith(fake: any, deps: Partial<McpOauthDeps> = {}, record: McpProvider = notes()) {
  const app = new Hono<any>();
  app.route('/api/integrations/mcp', createMcpOauthRouter({
    providers: { [KEY]: record }, descriptor: (k) => (k === KEY ? DESCRIPTOR : null), fetcher: fake.fetch, ...deps,
  }));
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return app;
}

async function req(app: Hono<any>, env: any, who: number | null, path: string, opts: { cookie?: string; impersonated?: boolean; company?: number } = {}) {
  const headers: Record<string, string> = {};
  if (who != null) {
    const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(opts.impersonated ? { impersonated_by: 1 } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    headers.Authorization = `Bearer ${jwt}`;
  }
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.company) headers['X-Company-Id'] = String(opts.company);
  const res = await app.request(path, { method: 'GET', headers }, env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a redirect */ }
  return { status: res.status, body, text, location: res.headers.get('Location'), setCookie: res.headers.get('Set-Cookie') };
}

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup() {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  env.RATE_LIMITS = memoryKv();
  const fake = notesFake();
  return { db, env, fake };
}

type Tamper = { cookie?: string | null; state?: (s: string) => string; as?: number; error?: boolean; iss?: string | null; startQuery?: string };

/** The member's browser: start, the provider's consent, and the callback with the cookie. */
async function signIn(app: Hono<any>, env: any, fake: any, who: number, t: Tamper = {}) {
  const start = await req(app, env, who, `${BASE}/start${t.startQuery ?? ''}`);
  assert.equal(start.status, 200, start.text);
  const u = new URL(start.body.authorize_url);
  const p = Object.fromEntries(u.searchParams);
  const cookie = new RegExp(`${CSRF_COOKIE}=([^;]+)`).exec(start.setCookie || '')![1];
  const { code } = fake.authorize({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge });
  const state = t.state ? t.state(p.state) : p.state;
  const q = new URLSearchParams(t.error ? { error: 'access_denied', state } : { code, state });
  if (t.iss != null) q.set('iss', t.iss);
  const jar = t.cookie === null ? undefined : `${CSRF_COOKIE}=${t.cookie ?? cookie}`;
  const cb = await req(app, env, t.as ?? who, `${BASE}/callback?${q}`, { cookie: jar });
  return { start, params: p, cookie, code, state: p.state, cb };
}

const outcome = (location: string | null) => {
  const u = new URL(location!, 'https://axal.vc');
  return { path: u.pathname, ...Object.fromEntries(u.searchParams) };
};
const row = (db: any, user: number) => db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const tokenCalls = (fake: any) => fake.calls.filter((c: any) => c.path === '/token').length;

test('1. sign in: discovery, one registration per redirect URI, PKCE, the callback, one oauth_mcp row with encrypted tokens', async () => {
  const { db, env, fake } = await setup();
  const app = appWith(fake);
  const { start, params, cb } = await signIn(app, env, fake, 10);
  assert.equal(new URL(start.body.authorize_url).origin + new URL(start.body.authorize_url).pathname, `${NOTES_ISSUER}/authorize`);
  assert.equal(params.scope, 'notes.read');
  assert.equal(params.code_challenge_method, 'S256');
  assert.equal(params.resource, NOTES_MCP);
  assert.equal(params.redirect_uri, `http://localhost${BASE}/callback`);
  assert.match(start.setCookie!, new RegExp(`^${CSRF_COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$`));
  const reg = fake.calls.filter((c: any) => c.path === '/register');
  assert.equal(reg.length, 1);
  assert.deepEqual(reg[0].registration, { client_name: 'Axal VC', application_type: 'web', redirect_uris: [params.redirect_uri], scope: 'notes.read' });
  assert.equal(cb.status, 302);
  assert.deepEqual(outcome(cb.location), { path: `/account/connectors/${KEY}`, oauth: 'ok', provider: KEY });
  assert.match(cb.setCookie!, /Max-Age=0/);
  const r = row(db, 10);
  assert.equal(r.auth_type, 'oauth_mcp');
  assert.equal(r.status, 'active');
  assert.equal(r.display_name, 'Notes');
  assert.deepEqual(JSON.parse(r.scopes_json), ['notes.read']);
  assert.deepEqual(JSON.parse(r.config_json), { via: 'oauth_mcp', resource: NOTES_MCP });
  assert.ok(!/fake-access|fake-refresh/.test(r.credentials_enc), 'the tokens are ciphertext at rest');
  const creds = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  assert.ok(fake.state.access.has(creds.access_token));
  assert.equal(creds.v, 2);
  assert.equal(creds.resource, NOTES_MCP);
  assert.equal(creds.issuer, NOTES_ISSUER);
  assert.equal(creds.client_key, `mcp_client:${KEY}:${params.redirect_uri}`);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM integration_logs WHERE provider_key = ? AND event_type = 'oauth_callback'").get(KEY) as any).n, 1);
  // A second member, and a second sign-in, reuse the client; the row is updated, never doubled.
  await signIn(app, env, fake, 20);
  await signIn(app, env, fake, 10);
  assert.equal(fake.calls.filter((c: any) => c.path === '/register').length, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM integrations WHERE user_id = 10 AND provider_key = ?').get(KEY) as any).n, 1);
  assert.equal(row(db, 10).uid, r.uid);
  // Another host is another redirect URI, so another registration.
  const other = await app.request(`https://app.axal.vc${BASE}/start`, { headers: { Authorization: (await authHeader(env, 10)) } }, env);
  assert.equal(other.status, 200);
  assert.equal(fake.calls.filter((c: any) => c.path === '/register').length, 2);
  assert.equal(new URL((await other.json() as any).authorize_url).searchParams.get('redirect_uri'), `https://app.axal.vc${BASE}/callback`);
  // A return path rides in the state; anything not a path on this site is the connector's page.
  const back = await signIn(app, env, fake, 20, { startQuery: '?return_to=%2Fbuild%2Fconnect' });
  assert.equal(outcome(back.cb.location).path, '/build/connect');
  for (const bad of ['//evil.example/x', 'https://evil.example', '/a\\b', '/a b', `/${'x'.repeat(200)}`, '', null]) assert.equal(returnPath(bad, KEY), `/account/connectors/${KEY}`, String(bad));
  assert.equal(returnPath('/raise/cap-table?tab=a', KEY), '/raise/cap-table?tab=a');
});

async function authHeader(env: any, who: number) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  return `Bearer ${jwt}`;
}

test('2. discovery: WWW-Authenticate first, the well-known order, an identical issuer, S256, the hosts, a 3xx refused', async () => {
  const { env, fake } = await setup();
  // The start's discovery: the resource's well-known URL with its path, then the server's metadata.
  await req(appWith(fake), env, 10, `${BASE}/start`);
  assert.deepEqual(fake.calls.slice(0, 2).map((c: any) => `${c.host}${c.path}`), [
    'mcp.notes.example/.well-known/oauth-protected-resource/mcp', 'auth.notes.example/.well-known/oauth-authorization-server',
  ]);
  assert.ok(fake.calls.every((c: any) => c.redirect === 'manual'));
  // A 401's resource_metadata is read first when it is on the provider's hosts.
  const seen: string[] = [];
  const spy = async (url: string, init: any) => { seen.push(new URL(url).pathname); return fake.fetch(url, init); };
  await discoverMcp(notes(), { fetcher: spy as any, challenge: 'Bearer resource_metadata="https://mcp.notes.example/.well-known/oauth-protected-resource/mcp"' });
  assert.equal(seen[0], '/.well-known/oauth-protected-resource/mcp');
  seen.length = 0;
  await discoverMcp(notes(), { fetcher: spy as any, challenge: 'Bearer resource_metadata="https://elsewhere.example/meta"' });
  assert.ok(!seen.includes('/meta'), 'a resource_metadata off the hosts is never fetched');

  const refused = async (change: (f: any) => void, reason: string) => {
    const f = notesFake();
    change(f);
    const r = await req(appWith(f), env, 10, `${BASE}/start`);
    assert.equal(r.status, 503, reason);
    assert.equal(r.body.error, 'mcp_sign_in_unavailable');
    assert.equal(r.body.reason, reason);
    assert.ok(!r.setCookie, 'no cookie when nothing started');
  };
  await refused((f) => { f.state.meta.serverIssuer = 'https://auth.notes.example/other'; }, 'metadata_refused');
  await refused((f) => { f.state.meta.s256 = false; }, 'metadata_refused');
  await refused((f) => { f.state.meta.endpointHost = 'auth.elsewhere.example'; }, 'metadata_refused');
  await refused((f) => { f.state.meta.resource = 'https://mcp.notes.example/other'; }, 'metadata_refused');
  // A redirect on a metadata URL is never followed.
  const f = notesFake();
  const redirecting = { ...f, fetch: async (url: string, init: any) => (new URL(url).pathname.startsWith('/.well-known/oauth-authorization-server') ? new Response(null, { status: 302, headers: { Location: 'https://auth.notes.example/x' } }) : f.fetch(url, init)) };
  const r = await req(appWith(redirecting), env, 10, `${BASE}/start`);
  assert.equal(r.status, 503);
  assert.equal(r.body.reason, 'discovery_failed');
});

test('3. registration order: pre-registered, then CIMD (on axal.vc), then DCR', async () => {
  const { env, fake } = await setup();
  const clientOf = async (app: Hono<any>) => new URL((await req(app, env, 10, `${BASE}/start`)).body.authorize_url).searchParams.get('client_id');
  const pre = (id: string | null) => () => async () => (id ? { client_id: id, client_secret: 'pre-secret' } : null);
  const all = notes({ registration: ['preregistered', 'cimd', 'dcr'], cimd_url: mcpCimdUrl(KEY) });
  fake.state.meta.cimd = true;
  assert.equal(await clientOf(appWith(fake, { preregistered: pre('pre-registered-id') }, all)), 'pre-registered-id');
  assert.equal(await clientOf(appWith(fake, { preregistered: pre(null) }, all)), mcpCimdUrl(KEY), 'no pre-registered client: CIMD');
  fake.state.meta.cimd = false;
  assert.equal(await clientOf(appWith(fake, { preregistered: pre(null) }, all)), 'fake-client-1', 'no CIMD support: DCR');
  assert.equal(fake.calls.filter((c: any) => c.path === '/register').length, 1);
  // The pre-registered client signs in end to end, its secret never in the row.
  const { db, env: env2, fake: f2 } = await setup();
  const app = appWith(f2, { preregistered: pre('pre-registered-id') }, notes({ registration: ['preregistered'] }));
  const { cb } = await signIn(app, env2, f2, 10);
  assert.equal(outcome(cb.location).oauth, 'ok', cb.location!);
  const creds = await decryptCredentials(env2, row(db, 10).uid, row(db, 10).credentials_enc) as any;
  assert.equal(creds.client_key, `preregistered:${KEY}`);
  assert.ok(!JSON.stringify(creds).includes('pre-secret'));
});

test('4. who the start refuses: signed out, a support session, no company, an unknown key, Mercury, a client HQ does not hold', async () => {
  const { db, env, fake } = await setup();
  const app = appWith(fake);
  const states = () => { try { return (db.prepare('SELECT COUNT(*) AS n FROM oauth_state_tokens').get() as any).n; } catch { return 0; } };
  assert.equal((await req(app, env, null, `${BASE}/start`)).status, 401);
  const support = await req(app, env, 10, `${BASE}/start`, { impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const writes = appWith(fake, { writesProjectData: (k) => k === KEY });
  const noCompany = await req(writes, env, 10, `${BASE}/start`);
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.body.error, 'active_company_required');
  assert.equal((await req(app, env, 10, '/api/integrations/mcp/not_a_record/start')).status, 404);
  assert.equal((await req(app, env, 10, '/api/integrations/mcp/__proto__/start')).status, 404);
  // Mercury keeps routes/mercury_oauth.ts: the default router answers 404 for it.
  const plain = new Hono<any>();
  plain.route('/api/integrations/mcp', createMcpOauthRouter({ fetcher: fake.fetch }));
  plain.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  assert.equal((await req(plain, env, 10, '/api/integrations/mcp/mercury/start')).status, 404);
  assert.equal(genericMcpProvider({ mercury: notes({ key: 'mercury' }) }, 'mercury'), null, 'a record on another callback is not served');
  // D751: only a pre-registered client would do, and HQ holds none.
  const unset = appWith(fake, {}, notes({ registration: ['preregistered'] }));
  const r = await req(unset, env, 10, `${BASE}/start`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'oauth_unconfigured');
  assert.equal(await mcpReadiness(env, notes({ registration: ['preregistered'] }), async () => { throw new Error('unreadable'); }), null);
  const unreadable = await req(appWith(fake, { preregistered: () => async () => { throw new Error('unreadable'); } }, notes({ registration: ['preregistered'] })), env, 10, `${BASE}/start`);
  assert.equal(unreadable.body.error, 'oauth_setup_unreadable');
  // The plan the descriptor names.
  const paid = appWith(fake, { descriptor: () => ({ ...DESCRIPTOR, tier: 'studio' } as ProviderDescriptor) });
  assert.equal((await req(paid, env, 10, `${BASE}/start`)).status, 402, 'a Growth founder, a Studio provider');
  // Nothing refused left a state row or reached the provider.
  assert.equal(states(), 0);
  assert.equal(fake.calls.length, 0);
  // A provider this caller cannot see is answered as if it were not there.
  const personal = appWith(fake, { descriptor: () => ({ ...DESCRIPTOR, personal_roles: ['founder'] } as ProviderDescriptor) });
  assert.equal((await req(personal, env, 20, `${BASE}/start`)).status, 404, 'a partner, a founders-only provider');
  // With a company, the start goes ahead.
  db.exec('CREATE TABLE IF NOT EXISTS user_company_links (user_id INTEGER NOT NULL, company_id INTEGER NOT NULL)');
  db.exec('INSERT INTO user_company_links (user_id, company_id) VALUES (10, 77)');
  const ok = await req(writes, env, 10, `${BASE}/start`, { company: 77 });
  assert.equal(ok.status, 200, ok.text);
});

test('5. the callback\'s state and cookie: another user, a replay, no cookie, a provider error; no code exchanged', async () => {
  const { db, env, fake } = await setup();
  const app = appWith(fake);
  const expect = async (t: Tamper, reason: string) => {
    const before = tokenCalls(fake);
    const { cb } = await signIn(app, env, fake, 10, t);
    assert.equal(cb.status, 302);
    assert.deepEqual(outcome(cb.location), { path: `/account/connectors/${KEY}`, oauth: 'error', provider: KEY, reason });
    assert.equal(tokenCalls(fake), before, `${reason}: no code exchanged`);
  };
  await expect({ as: 20 }, 'invalid_state');
  await expect({ state: (s) => `${s.slice(0, -2)}xx` }, 'invalid_state');
  await expect({ cookie: null }, 'csrf_mismatch');
  await expect({ cookie: 'not-the-cookie' }, 'csrf_mismatch');
  await expect({ error: true }, 'access_denied');
  // A replayed state is refused.
  const first = await signIn(app, env, fake, 10);
  assert.equal(outcome(first.cb.location).oauth, 'ok');
  const again = await req(app, env, 10, `${BASE}/callback?code=x&state=${encodeURIComponent(first.state)}`, { cookie: `${CSRF_COOKIE}=${first.cookie}` });
  assert.equal(outcome(again.location).reason, 'invalid_state');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM integrations WHERE provider_key = ?').get(KEY) as any).n, 1);
  // The start's refusals are checked again at the callback: a support session that opens the callback exchanges nothing.
  const begun = await req(app, env, 10, `${BASE}/start`);
  const bp = Object.fromEntries(new URL(begun.body.authorize_url).searchParams);
  const bc = new RegExp(`${CSRF_COOKIE}=([^;]+)`).exec(begun.setCookie || '')![1];
  const { code: bcode } = fake.authorize({ client_id: bp.client_id, redirect_uri: bp.redirect_uri, code_challenge: bp.code_challenge });
  const before = tokenCalls(fake);
  const support = await req(app, env, 10, `${BASE}/callback?code=${encodeURIComponent(bcode)}&state=${encodeURIComponent(bp.state)}`, { cookie: `${CSRF_COOKIE}=${bc}`, impersonated: true });
  assert.equal(outcome(support.location).reason, 'not_allowed');
  assert.equal(tokenCalls(fake), before);
  for (const r of ['invalid_state', 'csrf_mismatch', 'issuer_mismatch', 'access_denied', 'scope_refused', 'sign_in_refused']) assert.ok((CALLBACK_REASONS as readonly string[]).includes(r));
});

test('6. RFC 9207: iss absent, right and wrong', async () => {
  const { db, env, fake } = await setup();
  const app = appWith(fake);
  // The server says nothing about iss: absent is accepted, a wrong one is not.
  assert.equal(outcome((await signIn(app, env, fake, 10)).cb.location).oauth, 'ok');
  const wrongQuiet = await signIn(app, env, fake, 20, { iss: 'https://auth.elsewhere.example' });
  assert.equal(outcome(wrongQuiet.cb.location).reason, 'issuer_mismatch');
  // The server says it sends iss: absent is refused, right is accepted, wrong is refused.
  fake.state.meta.iss = true;
  const before = tokenCalls(fake);
  assert.equal(outcome((await signIn(app, env, fake, 20)).cb.location).reason, 'issuer_mismatch');
  assert.equal(outcome((await signIn(app, env, fake, 20, { iss: `${NOTES_ISSUER}/` })).cb.location).reason, 'issuer_mismatch');
  // A mismatch acts on nothing, the provider's own error included.
  assert.equal(outcome((await signIn(app, env, fake, 20, { error: true })).cb.location).reason, 'issuer_mismatch');
  assert.equal(tokenCalls(fake), before, 'no code exchanged on a mismatch');
  assert.equal(row(db, 20), undefined);
  assert.equal(outcome((await signIn(app, env, fake, 20, { iss: NOTES_ISSUER })).cb.location).oauth, 'ok');
  assert.equal(row(db, 20).status, 'active');
  // The issuer moved between start and callback: a server that now answers, on the provider's hosts, as
  // another issuer is refused before anything is exchanged.
  const moved = tokenCalls(fake);
  const start = await req(app, env, 30, `${BASE}/start`);
  const p = Object.fromEntries(new URL(start.body.authorize_url).searchParams);
  const cookie = new RegExp(`${CSRF_COOKIE}=([^;]+)`).exec(start.setCookie || '')![1];
  fake.state.meta.issuer = 'https://auth2.notes.example';
  fake.state.meta.iss = false;
  const rehosted = { ...fake, fetch: (url: string, init: any) => fake.fetch(url.replace('://auth2.notes.example', '://auth.notes.example'), init) };
  const cb = await req(appWith(rehosted), env, 30, `${BASE}/callback?code=x&state=${encodeURIComponent(p.state)}`, { cookie: `${CSRF_COOKIE}=${cookie}` });
  assert.equal(outcome(cb.location).reason, 'issuer_mismatch');
  assert.equal(tokenCalls(fake), moved);
});

test('7. an overreaching grant and a failed verifySignIn are both revoked and store nothing', async () => {
  const { db, env, fake } = await setup();
  fake.state.scope = 'notes.read notes.write';
  const wide = await signIn(appWith(fake), env, fake, 10);
  assert.equal(outcome(wide.cb.location).reason, 'scope_refused');
  assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);
  assert.equal(fake.state.access.size, 0, 'the overreaching grant is revoked');
  assert.equal(row(db, 10), undefined);

  fake.state.scope = 'notes.read';
  fake.state.revoked.length = 0;
  let seen: any = null;
  const refusing = appWith(fake, { verifySignIn: { [KEY]: async (_env, access) => { seen = access; return { ok: false }; } } });
  const refused = await signIn(refusing, env, fake, 10);
  assert.equal(outcome(refused.cb.location).reason, 'sign_in_refused');
  assert.equal(seen.resource, NOTES_MCP);
  assert.deepEqual(seen.scopes, ['notes.read']);
  assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);
  assert.equal(fake.state.access.size, 0);
  assert.equal(row(db, 10), undefined);
  // A check that throws is a failure too.
  fake.state.revoked.length = 0;
  const throwing = appWith(fake, { verifySignIn: { [KEY]: async () => { throw new Error('boom'); } } });
  assert.equal(outcome((await signIn(throwing, env, fake, 10)).cb.location).reason, 'sign_in_refused');
  assert.equal(fake.state.revoked.length, 2);
  // A passing check labels the connection.
  const passing = appWith(fake, { verifySignIn: { [KEY]: async () => ({ ok: true, external_account_id: 'ws-1', external_account_name: 'Invented Workspace' }) } });
  assert.equal(outcome((await signIn(passing, env, fake, 10)).cb.location).oauth, 'ok');
  assert.equal(row(db, 10).external_account_name, 'Invented Workspace');
  assert.equal(row(db, 10).external_account_id, 'ws-1');
  const failed = db.prepare("SELECT details FROM activity_logs WHERE action = 'integration_oauth_failed'").all().map((r: any) => JSON.parse(r.details).reason);
  assert.deepEqual(failed, ['scope_refused', 'sign_in_refused', 'sign_in_refused']);
});

test('8. the client ID metadata document: only for a record that publishes it here, with no secret', async () => {
  const { env, fake } = await setup();
  const doc = await req(appWith(fake, {}, notes({ registration: ['cimd', 'dcr'], cimd_url: mcpCimdUrl(KEY) })), env, null, `${BASE}/client.json`);
  assert.equal(doc.status, 200);
  assert.deepEqual(doc.body, {
    client_id: `https://axal.vc${BASE}/client.json`,
    client_name: 'Axal VC',
    client_uri: 'https://axal.vc',
    redirect_uris: [`https://axal.vc${BASE}/callback`, `https://app.axal.vc${BASE}/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'notes.read',
  });
  assert.ok(!/secret/i.test(doc.text));
  assert.equal((await req(appWith(fake), env, null, `${BASE}/client.json`)).status, 404, 'no cimd_url');
  assert.equal((await req(appWith(fake, {}, notes({ registration: ['cimd'], cimd_url: 'https://app.axal.vc/elsewhere.json' })), env, null, `${BASE}/client.json`)).status, 404, 'not this route on axal.vc');
  assert.equal((await req(appWith(fake, {}, notes({ registration: ['dcr'], cimd_url: mcpCimdUrl(KEY) })), env, null, `${BASE}/client.json`)).status, 404, 'a record that does not register by CIMD');
  assert.equal(mcpCallbackUrl(KEY)({ OAUTH_CALLBACK_BASE_URL: 'https://axal.vc/' } as any), `https://axal.vc${BASE}/callback`);
  // A public read, so it has its own per-IP bucket.
  assert.ok(MCP_CLIENT_METADATA.test(`${BASE}/client.json`));
  for (const p of [`${BASE}/start`, `${BASE}/client.json/x`, '/api/integrations/mcp/a/b/client.json']) assert.ok(!MCP_CLIENT_METADATA.test(p), p);
  assert.match(readFileSync('cloudflare-worker/src/middleware/rateLimit.ts', 'utf8'), /name: 'mcp_client_metadata',\s+limit: 60,\s+windowSec: 60,\s+test: \(p, m\) => m === 'GET' && MCP_CLIENT_METADATA\.test\(p\),\s+scope: 'ip',/);
});

test('9. disconnect revokes at the provider, then the row is deleted', async () => {
  const { db, env, fake } = await setup();
  await signIn(appWith(fake), env, fake, 10);
  const r = row(db, 10);
  const out = await mcpDisconnect(env, r, { providers: { [KEY]: notes() }, fetcher: fake.fetch });
  assert.deepEqual(out, { provider_revoked: true });
  assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);
  assert.equal(fake.state.access.size, 0);
  assert.equal(row(db, 10).credentials_enc, null, 'the tokens are deleted whatever the provider answers');
  // Mercury's own disconnect, a token row, and a record off the generic callback are not this revoke's.
  assert.equal(await mcpDisconnect(env, { ...r, auth_type: 'api_key' }, { providers: { [KEY]: notes() }, fetcher: fake.fetch }), null);
  assert.equal(await mcpDisconnect(env, { ...r, provider_key: 'mercury' }, { fetcher: fake.fetch }), null);
  // The integrations router runs it before its DELETE, for a provider without its own disconnect.
  const src = readFileSync('cloudflare-worker/src/routes/integrations.ts', 'utf8');
  const handler = src.slice(src.indexOf("integrations.delete('/:uid'"), src.indexOf('// ───', src.indexOf("integrations.delete('/:uid'")));
  assert.match(handler, /if \(impl\?\.disconnect\) \{[\s\S]*\} else \{[\s\S]*await mcpDisconnect\(c\.env, row\)/);
  assert.ok(handler.indexOf('mcpDisconnect(') < handler.indexOf('DELETE FROM integrations WHERE id'), 'revoked before the delete');
});

test('10. no token, code or verifier reaches a log, a log row or a redirect', async () => {
  const { db, env, fake } = await setup();
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    const ok = await signIn(appWith(fake), env, fake, 10);
    fake.state.scope = 'notes.read notes.write';
    const wide = await signIn(appWith(fake), env, fake, 20);
    const creds = await decryptCredentials(env, row(db, 10).uid, row(db, 10).credentials_enc) as any;
    const secrets = [creds.access_token, creds.refresh_token, ok.code, wide.code, ok.cookie];
    const stored = JSON.stringify([
      db.prepare('SELECT * FROM activity_logs').all(), db.prepare('SELECT * FROM integration_logs').all(),
      db.prepare('SELECT config_json, scopes_json, last_error FROM integrations').all(),
    ]);
    for (const s of secrets) {
      assert.ok(!lines.join('\n').includes(s), 'a log line');
      assert.ok(!stored.includes(s), 'a log row');
      assert.ok(!ok.cb.location!.includes(s) && !wide.cb.location!.includes(s), 'a redirect');
    }
    assert.ok(!/fake-access|fake-refresh|fake-code/.test(lines.join('\n') + stored + ok.cb.location + wide.cb.location));
  } finally { Object.assign(console, orig); }
});
