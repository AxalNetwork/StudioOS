/**
 * D847 (#2468) — the shared MCP client, against a fake second provider
 * (`_mcp_fake.mjs`, "notes" on the reserved `notes.example` domain).
 *
 *  1. The records: frozen, no write tool without a publishing issue, every
 *     resource on its hosts, Mercury's record equal to D840's constants.
 *  2. The import boundary: Mercury's `mcp.ts` is the only caller, and the
 *     client and StudioOS's own MCP server (`src/mcp/`) never import each other.
 *  3. Discovery: `WWW-Authenticate` first, the well-known order, the resource,
 *     the identical issuer, S256, the hosts, and a refused redirect.
 *  4. Registration: pre-registered, then CIMD, then DCR (once per redirect
 *     URI, `application_type: "web"`, re-registered on a new issuer, the first
 *     of a race kept).
 *  5. PKCE sign-in: the authorize URL, the exchange, RFC 9207 `iss`, and a
 *     grant beyond `accepted_scopes` revoked and refused.
 *  6. The session in each era: modern headers and `_meta`, `auto` falling back
 *     to `initialize` only without a modern error, an unsupported version.
 *  7. Drift: an unknown tool, a write tool, an annotated tool, an invalid
 *     `x-mcp-header` and a changed schema are never called, and logged.
 *  8. Limits: the budget counts the probe and the handshake, a 3xx is not
 *     followed, a body over the cap, unsafe headers, no body in an error.
 *  9. Refresh under the lease: a race refreshes once; a refused or widened
 *     refresh marks the row; both credential versions read.
 * 10. Revoke: the provider's endpoint is called when it has one, and the
 *     stored tokens are deleted either way.
 * 11. No token reaches a log, an error or the drift line.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mcp_client_d847.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  discoverMcp, exchangeMcpCode, onProviderHosts, headerParams, headerValue, issuerAccepted, LEASE_POLL_MS, MAX_TOOL_PAGES, mcpAccessFor, mcpClientFor,
  mcpCredentialsOf, MCP_MAX_BODY_BYTES, openMcpSession, refreshMcpCredentials, revokeMcpConnection, toolFingerprint, authorizeMcpUrl,
  type McpCredentials,
} from '../src/integrations/mcpClient.ts';
import { MCP_PROVIDERS, mcpProvider, mcpProviderFor, type McpProvider } from '../src/integrations/mcpProviders.ts';
import { MERCURY_MCP_URL, MERCURY_READ_TOOLS, MCP_REQUEST_BUDGET } from '../src/services/mercury/mcp.ts';
import { MCP_READ_SCOPES } from '../src/services/mercury/reads.ts';
import { CALLBACK_PATH } from '../src/routes/mercury_oauth.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { FAKE_WRITE_TOOL, NOTES_ISSUER, NOTES_MCP, notesFake, defaultNotesTools } from './_mcp_fake.mjs';

const REDIRECT = 'https://axal.vc/api/integrations/mcp/notes_fake/callback';
const CIMD = 'https://axal.vc/mcp-clients/notes_fake.json';

function notes(over: Partial<McpProvider> = {}): McpProvider {
  return mcpProvider({
    key: 'notes_fake',
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
    headers: { 'X-Notes-Mode': 'read-only' },
    session: 'per_request',
    tool_pins: null,
    lease: 'mcp:notes_fake',
    state_provider: 'mcp_notes_fake',
    client_key_prefix: 'mcp_client:notes_fake:',
    callback_path: '/api/integrations/mcp/notes_fake/callback',
    ...over,
  });
}

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function envWithDb() {
  const { DB, db } = makeD1('CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT);');
  const env: any = { DB, KEK_PII: 'fixture-cipher-key-'.repeat(4), RATE_LIMITS: memoryKv() };
  await ensureIntegrationsSchema(env);
  return { env, db };
}

const quiet = { log: () => {} };

/** A completed sign-in: discovery, registration, PKCE and the exchange. */
async function signIn(env: any, fake: any, provider = notes()) {
  const server = await discoverMcp(provider, { fetcher: fake.fetch });
  const client = await mcpClientFor(env, provider, server, REDIRECT, { fetcher: fake.fetch });
  const verifier = createHash('sha256').update(randomBytes(16)).digest('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(authorizeMcpUrl(provider, server, client, { state: 'st', challenge }));
  const { code } = fake.authorize({ client_id: url.searchParams.get('client_id'), redirect_uri: url.searchParams.get('redirect_uri'), code_challenge: challenge });
  const creds = await exchangeMcpCode(provider, server, client, { code, verifier }, fake.fetch);
  return { server, client, creds, url };
}

async function storeRow(env: any, db: any, creds: McpCredentials | Record<string, unknown>, user = 7) {
  const uid = `mcp-notes-${user}`;
  db.prepare("INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json) VALUES (?, ?, 'notes_fake', 'Notes', 'active', 'oauth_mcp', ?, ?)")
    .run(uid, user, await encryptCredentials(env, uid, creds as any), JSON.stringify({ via: 'oauth_mcp', resource: NOTES_MCP, era: 'modern' }));
  return db.prepare('SELECT * FROM integrations WHERE uid = ?').get(uid) as any;
}

test('1. records are frozen, write tools need a publishing issue, resources sit on their hosts, Mercury equals D840', async () => {
  assert.ok(Object.isFrozen(MCP_PROVIDERS));
  assert.deepEqual(Object.keys(MCP_PROVIDERS), ['mercury'], 'Mercury is the first and only provider');
  for (const [key, p] of Object.entries(MCP_PROVIDERS)) {
    assert.equal(p.key, key);
    for (const f of ['resources', 'hosts', 'scopes', 'accepted_scopes', 'read_tools', 'write_tools', 'registration', 'headers'] as const) assert.ok(Object.isFrozen(p[f]), `${key}.${f}`);
    assert.ok(Object.isFrozen(p));
    if (p.publish_issue === null) assert.deepEqual([...p.write_tools], [], `${key} lists a write tool without a publishing issue`);
    for (const r of p.resources) assert.ok(p.hosts.some((h) => new URL(r).hostname.endsWith(h)), `${key}: ${r} is off its hosts`);
    for (const s of p.scopes) assert.ok(p.accepted_scopes.includes(s), `${key}: asks for ${s} but would refuse it`);
    assert.ok(p.budget > 0 && p.budget <= 24, key);
    assert.equal(p.session, 'per_request');
  }
  const m = MCP_PROVIDERS.mercury;
  assert.deepEqual([...m.resources], [MERCURY_MCP_URL]);
  assert.deepEqual([...m.read_tools], [...MERCURY_READ_TOOLS]);
  assert.equal(MERCURY_READ_TOOLS, m.read_tools, 'mcp.ts re-exports the record, not a copy');
  assert.deepEqual([...m.scopes], [...MCP_READ_SCOPES]);
  assert.deepEqual([...m.accepted_scopes], [...MCP_READ_SCOPES]);
  assert.equal(MCP_REQUEST_BUDGET, 24);
  assert.equal(m.era, 'legacy');
  assert.deepEqual([m.lease, m.state_provider, m.client_key_prefix, m.callback_path], ['mercury_mcp', 'mercury_mcp', 'mercury_mcp_client:', CALLBACK_PATH]);
  assert.equal(mcpProviderFor('mercury'), m);
  assert.equal(mcpProviderFor('constructor'), null);
  assert.equal(mcpProviderFor('notes_fake'), null);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('2. Mercury\'s mcp.ts is the only caller; the client, the records and src/mcp/ never import each other', () => {
  const ROOT = process.cwd();
  const files = walk(resolve(ROOT, 'cloudflare-worker/src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  const importers = (mod: RegExp) => files.filter((f) => mod.test(f.text)).map((f) => f.path).sort();
  // D852 (#2475): a member's custom servers are the client's second caller.
  assert.deepEqual(importers(/from\s+['"][^'"]*integrations\/mcpClient['"]|from\s+['"]\.\/mcpClient['"]/), ['cloudflare-worker/src/integrations/customMcp.ts', 'cloudflare-worker/src/services/mercury/mcp.ts']);
  // #2549: public status reads provider metadata only. The transport importer
  // assertion above still permits only the two actual client callers.
  assert.deepEqual(importers(/from\s+['"][^'"]*integrations\/mcpProviders['"]|from\s+['"]\.\/mcpProviders['"]/), ['cloudflare-worker/src/integrations/customMcp.ts', 'cloudflare-worker/src/integrations/mcpClient.ts', 'cloudflare-worker/src/routes/public.ts', 'cloudflare-worker/src/services/mercury/mcp.ts']);
  const client = files.find((f) => f.path.endsWith('integrations/mcpClient.ts'))!.text;
  const records = files.find((f) => f.path.endsWith('integrations/mcpProviders.ts'))!.text;
  assert.doesNotMatch(client, /from\s+['"][^'"]*\/mcp\/|from\s+['"]\.\.\/mcp['"]/, 'the client imports StudioOS\'s own MCP server');
  assert.equal([...records.matchAll(/^import\s/gm)].length, 0, 'the records import nothing');
  for (const f of files.filter((x) => x.path.startsWith('cloudflare-worker/src/mcp/'))) assert.doesNotMatch(f.text, /mcpClient|mcpProviders/, f.path);
  for (const f of files) assert.ok(!f.text.includes(FAKE_WRITE_TOOL), `${f.path} names the fake's write tool`);
});

test('3. discovery: WWW-Authenticate first, then the well-known URLs; the resource, the issuer, S256 and the hosts are checked', async () => {
  const fake = notesFake();
  const p = notes();
  const server = await discoverMcp(p, { fetcher: fake.fetch });
  assert.deepEqual(server, {
    issuer: NOTES_ISSUER, resource: NOTES_MCP,
    authorization_endpoint: `${NOTES_ISSUER}/authorize`, token_endpoint: `${NOTES_ISSUER}/token`,
    registration_endpoint: `${NOTES_ISSUER}/register`, revocation_endpoint: `${NOTES_ISSUER}/revoke`,
    iss_parameter_supported: false, cimd_supported: false,
  });
  assert.deepEqual(fake.calls.map((c: any) => `${c.host}${c.path}`), ['mcp.notes.example/.well-known/oauth-protected-resource/mcp', 'auth.notes.example/.well-known/oauth-authorization-server']);
  assert.ok(fake.calls.every((c: any) => c.redirect === 'manual' && !c.authorized));

  // A 401's resource_metadata is tried first when it is on the hosts; a foreign one is never fetched.
  fake.calls.length = 0;
  await discoverMcp(p, { fetcher: fake.fetch, challenge: 'Bearer resource_metadata="https://evil.example/.well-known/oauth-protected-resource"' });
  assert.equal(fake.calls.some((c: any) => c.foreign), false);
  fake.calls.length = 0;
  await discoverMcp(p, { fetcher: fake.fetch, challenge: 'Bearer resource_metadata="https://mcp.notes.example/.well-known/oauth-protected-resource/mcp"' });
  assert.equal(fake.calls[0].path, '/.well-known/oauth-protected-resource/mcp');

  // Each refusal on its own fake.
  for (const [what, set] of [
    ['issuer not identical', (f: any) => { f.state.meta.serverIssuer = `${NOTES_ISSUER}/`; }],
    ['no S256', (f: any) => { f.state.meta.s256 = false; }],
    ['an endpoint off the hosts', (f: any) => { f.state.meta.endpointHost = 'notes.example.evil.example'; }],
    ['another resource', (f: any) => { f.state.meta.resource = 'https://mcp.notes.example/other'; }],
    ['an issuer off the hosts', (f: any) => { f.state.meta.issuer = 'https://auth.evil.example'; }],
  ] as const) {
    const f = notesFake();
    set(f);
    await assert.rejects(() => discoverMcp(p, { fetcher: f.fetch }), (e: any) => e.code === 'metadata_refused', what);
  }
  await assert.rejects(() => discoverMcp(p, { fetcher: fake.fetch, resource: 'https://mcp.notes.example/not-listed' }), (e: any) => e.code === 'metadata_refused');
  // The host check: the host or a subdomain, https, no userinfo, no port.
  for (const ok of ['https://notes.example/x', 'https://auth.notes.example/token']) assert.equal(onProviderHosts(ok, ['notes.example']), true, ok);
  for (const bad of ['https://evilnotes.example/x', 'https://notes.example.evil.example/x', 'http://auth.notes.example/x', 'https://u:p@auth.notes.example/x', 'https://auth.notes.example:8443/x', 'notes.example', 42]) {
    assert.equal(onProviderHosts(bad, ['notes.example']), false, String(bad));
  }
  // A redirect during discovery is refused, never followed.
  const redirecting = async (url: string, init: RequestInit) => {
    fake.calls.push({ path: new URL(url).pathname, redirect: init.redirect });
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } });
  };
  await assert.rejects(() => discoverMcp(p, { fetcher: redirecting as any }), (e: any) => e.code === 'discovery_failed');
});

test('4. registration: pre-registered, then CIMD, then DCR once per redirect URI; a new issuer re-registers; a race keeps the first', async () => {
  const { env, db } = await envWithDb();
  const fake = notesFake();
  const server = await discoverMcp(notes(), { fetcher: fake.fetch });

  // DCR: once per redirect URI, as a public web client named "Axal VC".
  const dcr = notes();
  const a = await mcpClientFor(env, dcr, server, REDIRECT, { fetcher: fake.fetch });
  const again = await mcpClientFor(env, dcr, server, REDIRECT, { fetcher: fake.fetch });
  assert.equal(a.client_id, again.client_id);
  assert.equal(a.key, `mcp_client:notes_fake:${REDIRECT}`);
  const regs = fake.calls.filter((c: any) => c.registration).map((c: any) => c.registration);
  assert.deepEqual(regs, [{ client_name: 'Axal VC', application_type: 'web', redirect_uris: [REDIRECT], scope: 'notes.read' }]);
  const other = await mcpClientFor(env, dcr, server, 'https://app.axal.vc/api/integrations/mcp/notes_fake/callback', { fetcher: fake.fetch });
  assert.notEqual(other.client_id, a.client_id, 'each host registers its own redirect URI');

  // A stored client from another issuer is never used: the provider is registered again.
  const moved = { ...server, issuer: 'https://auth2.notes.example' };
  const re = await mcpClientFor(env, dcr, moved, REDIRECT, { fetcher: fake.fetch });
  assert.notEqual(re.client_id, a.client_id);
  assert.equal(re.issuer, 'https://auth2.notes.example');

  // A race for a new redirect URI: both callers get the one stored client.
  // The slower caller's registration answers last: it keeps the stored client, not its own.
  const RACE = 'https://axal.vc/race/callback';
  let releaseFirst!: () => void;
  const held = new Promise<void>((r) => { releaseFirst = r; });
  let registrations = 0;
  const gated = async (url: string, init: any) => {
    if (new URL(url).pathname === '/register' && ++registrations === 1) { const res = await fake.fetch(url, init); await held; return res; }
    return fake.fetch(url, init);
  };
  const slow = mcpClientFor(env, dcr, server, RACE, { fetcher: gated as any });
  while (registrations < 1) await new Promise((r) => setTimeout(r, 1));
  const r2 = await mcpClientFor(env, dcr, server, RACE, { fetcher: gated as any });
  releaseFirst();
  const r1 = await slow;
  assert.equal(registrations, 2, 'both registered');
  assert.equal(r1.client_id, r2.client_id, 'the first stored client wins');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM platform_settings WHERE key = ?').get(`mcp_client:notes_fake:${RACE}`) as any).n, 1);

  // CIMD when the server takes one and the record has a document on axal.vc; else the next method.
  const cimd = notes({ registration: ['cimd', 'dcr'], cimd_url: CIMD });
  assert.equal((await mcpClientFor(env, cimd, { ...server, cimd_supported: true }, REDIRECT, { fetcher: fake.fetch })).client_id, CIMD);
  assert.equal((await mcpClientFor(env, cimd, server, REDIRECT, { fetcher: fake.fetch })).method, 'dcr', 'no CIMD support: DCR');
  const offAxal = notes({ registration: ['cimd'], cimd_url: 'https://evil.example/client.json' });
  await assert.rejects(() => mcpClientFor(env, offAxal, { ...server, cimd_supported: true }, REDIRECT, { fetcher: fake.fetch }), (e: any) => e.code === 'registration_failed');

  // Pre-registered first, when the provider's loader has a client.
  const pre = notes({ registration: ['preregistered', 'dcr'] });
  const preregistered = async () => ({ client_id: 'pre-registered-id', client_secret: null });
  const pc = await mcpClientFor(env, pre, server, REDIRECT, { fetcher: fake.fetch, preregistered });
  assert.deepEqual([pc.method, pc.client_id, pc.key], ['preregistered', 'pre-registered-id', 'preregistered:notes_fake']);
  assert.equal((await mcpClientFor(env, pre, server, REDIRECT, { fetcher: fake.fetch, preregistered: async () => null })).method, 'dcr');
  // No method the server or the record allows.
  await assert.rejects(() => mcpClientFor(env, notes(), { ...server, registration_endpoint: null }, REDIRECT, { fetcher: fake.fetch }), (e: any) => e.code === 'registration_failed');
});

test('5. PKCE sign-in: S256, the scope and the resource; iss checked; a grant beyond accepted_scopes is revoked and refused', async () => {
  const { env } = await envWithDb();
  const fake = notesFake();
  const { creds, url, server } = await signIn(env, fake);
  assert.equal(url.origin + url.pathname, `${NOTES_ISSUER}/authorize`);
  assert.deepEqual([url.searchParams.get('code_challenge_method'), url.searchParams.get('scope'), url.searchParams.get('resource'), url.searchParams.get('response_type')], ['S256', 'notes.read', NOTES_MCP, 'code']);
  assert.equal(creds.v, 2);
  assert.equal(creds.resource, NOTES_MCP);
  assert.deepEqual(creds.scopes, ['notes.read']);
  assert.equal(fake.calls.find((c: any) => c.grant_type === 'authorization_code').resource, NOTES_MCP);
  assert.ok(fake.state.access.has(creds.access_token));

  // RFC 9207.
  assert.equal(issuerAccepted({ iss_parameter_supported: false }, NOTES_ISSUER, null), true);
  assert.equal(issuerAccepted({ iss_parameter_supported: true }, NOTES_ISSUER, null), false, 'advertised but absent');
  assert.equal(issuerAccepted({ iss_parameter_supported: true }, NOTES_ISSUER, NOTES_ISSUER), true);
  assert.equal(issuerAccepted({ iss_parameter_supported: false }, NOTES_ISSUER, 'https://auth.evil.example'), false, 'present and wrong');
  assert.equal(issuerAccepted({ iss_parameter_supported: true }, NOTES_ISSUER, `${NOTES_ISSUER}/`), false, 'byte-equal only');
  assert.equal(server.iss_parameter_supported, false);

  // A wider grant: both tokens are revoked, nothing is returned.
  const wide = notesFake();
  wide.state.scope = 'notes.read notes.write';
  await assert.rejects(async () => signIn((await envWithDb()).env, wide), (e: any) => e.code === 'scope_refused');
  assert.deepEqual(wide.state.revoked, ['refresh_token', 'access_token']);
  assert.equal(wide.state.access.size, 0);
  // A wrong verifier is refused by the server, and the error carries no body.
  const f = notesFake();
  const fenv = (await envWithDb()).env;
  const s = await discoverMcp(notes(), { fetcher: f.fetch });
  const c = await mcpClientFor(fenv, notes(), s, REDIRECT, { fetcher: f.fetch });
  const { code } = f.authorize({ client_id: c.client_id, redirect_uri: REDIRECT, code_challenge: 'not-the-challenge' });
  await assert.rejects(() => exchangeMcpCode(notes(), s, c, { code, verifier: 'wrong' }, f.fetch), (e: any) => e.code === 'token_exchange_failed' && e.status === 400 && !/invalid_grant/.test(e.message));
});

test('6. eras: modern headers and _meta; auto falls back to initialize only without a modern error; an unsupported version', async () => {
  // Modern: no handshake, the headers mirror the body.
  const fake = notesFake({ era: 'modern' });
  const s = await openMcpSession(notes(), { accessToken: fake.signedIn(), fetcher: fake.fetch, ...quiet });
  assert.equal(s.era, 'modern');
  assert.deepEqual(fake.rpcs(), ['tools/list']);
  const list = fake.calls.find((c: any) => c.rpc === 'tools/list');
  assert.deepEqual([list.protocol, list.mcpMethod, list.session, list.fixed], ['2026-07-28', 'tools/list', null, 'read-only']);
  const out: any = await s.callTool('search_notes', { query: 'q', space: 'Café notes' });
  assert.deepEqual(out, { tool: 'search_notes', arguments: { query: 'q', space: 'Café notes' } });
  const call = fake.calls.at(-1);
  assert.deepEqual([call.mcpMethod, call.mcpName], ['tools/call', 'search_notes']);
  assert.deepEqual(call.params, [['mcp-param-space', `=?base64?${Buffer.from('Café notes').toString('base64')}?=`]]);
  await s.callTool('search_notes', { query: 'q' });
  assert.deepEqual(fake.calls.at(-1).params, [], 'no value, no header');

  // Auto against a legacy server: the probe's 400 is not a modern error, so initialize.
  const legacy = notesFake({ era: 'legacy' });
  const l = await openMcpSession(notes(), { accessToken: legacy.signedIn(), fetcher: legacy.fetch, ...quiet });
  assert.equal(l.era, 'legacy');
  assert.deepEqual(legacy.rpcs(), ['tools/list', 'initialize', 'notifications/initialized', 'tools/list']);
  assert.equal(l.requests, 4, 'the probe and the handshake count');
  assert.equal(legacy.calls.at(-1).session, 'fake-session-1');
  await l.callTool('get_note', { id: 'n1' });
  assert.equal(legacy.calls.at(-1).mcpName, null, 'legacy requests carry no modern headers');
  assert.equal(legacy.calls.at(-1).session, 'fake-session-1');

  // Auto against a dual server stays modern; a resolved era skips the probe.
  const dual = notesFake({ era: 'dual' });
  assert.equal((await openMcpSession(notes(), { accessToken: dual.signedIn(), fetcher: dual.fetch, ...quiet })).era, 'modern');
  const pinned = notesFake({ era: 'dual' });
  assert.equal((await openMcpSession(notes(), { accessToken: pinned.signedIn(), fetcher: pinned.fetch, era: 'legacy', ...quiet })).era, 'legacy');
  assert.equal(pinned.rpcs()[0], 'initialize');

  // A modern error is not a reason to fall back: UnsupportedProtocolVersion.
  const newer = notesFake({ era: 'modern' });
  newer.state.unsupported = ['2027-01-01'];
  await assert.rejects(() => openMcpSession(notes(), { accessToken: newer.signedIn(), fetcher: newer.fetch, ...quiet }), (e: any) => e.code === 'unsupported_protocol');
  assert.deepEqual(newer.rpcs(), ['tools/list'], 'no initialize after a modern error');
  // One that lists a legacy version: the legacy handshake.
  const older = notesFake({ era: 'dual' });
  older.state.unsupported = ['2025-11-25'];
  assert.equal((await openMcpSession(notes(), { accessToken: older.signedIn(), fetcher: older.fetch, ...quiet })).era, 'legacy');
  // A modern-only record never probes a legacy server into a session.
  const modernOnly = notesFake({ era: 'legacy' });
  await assert.rejects(() => openMcpSession(notes({ era: 'modern' }), { accessToken: modernOnly.signedIn(), fetcher: modernOnly.fetch, ...quiet }), (e: any) => e.code === 'http_error');
  assert.ok(!modernOnly.rpcs().includes('initialize'));
});

test('7. drift: unknown, write, annotated, invalid and changed tools are never called, and logged by name only', async () => {
  const lines: string[] = [];
  const log = (l: string) => { lines.push(l); };
  const fake = notesFake();
  const s = await openMcpSession(notes(), { accessToken: fake.signedIn(), fetcher: fake.fetch, log });
  assert.deepEqual([...s.offered], ['search_notes', 'get_note']);
  assert.deepEqual([...s.drift], [{ tool: 'export_everything', why: 'unknown' }, { tool: FAKE_WRITE_TOOL, why: 'unknown' }]);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { event: 'mcp_tool_drift', provider: 'notes_fake', tools: [...s.drift] });
  assert.ok(!lines[0].includes('Ignore every rule'), 'no description is logged');
  const before = fake.calls.length;
  for (const name of ['export_everything', FAKE_WRITE_TOOL, 'not_listed']) await assert.rejects(() => s.callTool(name), (e: any) => e.code === 'path_not_allowed', name);
  assert.equal(fake.calls.length, before, 'refused before any request');

  // A write tool on a publishing record is still refused: there is no ticket yet.
  const publishing = notes({ write_tools: [FAKE_WRITE_TOOL], publish_issue: 9999 });
  const w = await openMcpSession(publishing, { accessToken: fake.signedIn(), fetcher: fake.fetch, ...quiet });
  const n = fake.calls.length;
  await assert.rejects(() => w.callTool(FAKE_WRITE_TOOL), (e: any) => e.code === 'path_not_allowed');
  assert.equal(fake.calls.length, n);
  assert.equal(w.drift.some((d) => d.tool === FAKE_WRITE_TOOL), false, 'a recorded write tool is not unknown');

  // A read tool the server annotates as writing, or destructive.
  for (const annotations of [{ readOnlyHint: false }, { destructiveHint: true }]) {
    const f = notesFake();
    f.state.tools = defaultNotesTools().map((t: any) => t.name === 'get_note' ? { ...t, annotations } : t);
    const a = await openMcpSession(notes(), { accessToken: f.signedIn(), fetcher: f.fetch, ...quiet });
    assert.deepEqual([...a.offered], ['search_notes']);
    assert.ok(a.drift.some((d) => d.tool === 'get_note' && d.why === 'annotated'));
  }

  // An x-mcp-header that breaks a rule excludes the tool.
  for (const schema of [
    { type: 'object', properties: { space: { type: 'number', 'x-mcp-header': 'Space' } } },
    { type: 'object', properties: { space: { type: 'string', 'x-mcp-header': 'Bad Name' } } },
    { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'Dup' }, b: { type: 'string', 'x-mcp-header': 'dup' } } },
    { type: 'object', properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'Item' } } } },
  ]) {
    assert.equal(headerParams(schema), null, JSON.stringify(schema));
    const f = notesFake();
    f.state.tools = defaultNotesTools().map((t: any) => t.name === 'search_notes' ? { ...t, inputSchema: schema } : t);
    const x = await openMcpSession(notes(), { accessToken: f.signedIn(), fetcher: f.fetch, ...quiet });
    assert.deepEqual([...x.offered], ['get_note']);
    assert.ok(x.drift.some((d) => d.tool === 'search_notes' && d.why === 'invalid'));
  }
  assert.deepEqual(headerParams({ type: 'object', properties: { o: { type: 'object', properties: { r: { type: 'integer', 'x-mcp-header': 'Region' } } } } }), [{ path: ['o', 'r'], name: 'Region' }]);

  // Pinned schemas: an unchanged schema is offered; a changed one is never called.
  const tools = defaultNotesTools();
  const pins = Object.fromEntries(await Promise.all(['search_notes', 'get_note'].map(async (name) => [name, await toolFingerprint(tools.find((t: any) => t.name === name))])));
  const pinned = notes({ tool_pins: pins });
  const ok = notesFake();
  assert.deepEqual([...(await openMcpSession(pinned, { accessToken: ok.signedIn(), fetcher: ok.fetch, ...quiet })).offered], ['search_notes', 'get_note']);
  const changed = notesFake();
  changed.state.tools = defaultNotesTools().map((t: any) => t.name === 'get_note' ? { ...t, description: 'reworded', inputSchema: { type: 'object', properties: { id: { type: 'string' }, include_deleted: { type: 'boolean' } } } } : t);
  const c = await openMcpSession(pinned, { accessToken: changed.signedIn(), fetcher: changed.fetch, ...quiet });
  assert.deepEqual([...c.offered], ['search_notes']);
  assert.ok(c.drift.some((d) => d.tool === 'get_note' && d.why === 'changed'));
  await assert.rejects(() => c.callTool('get_note', { id: 'n1' }), (e: any) => e.code === 'path_not_allowed');
  assert.deepEqual(changed.toolCalls(), [], 'the changed tool was never called');
  // A description alone is not part of the fingerprint.
  const reworded = notesFake();
  reworded.state.tools = defaultNotesTools().map((t: any) => ({ ...t, description: 'different words' }));
  assert.deepEqual([...(await openMcpSession(pinned, { accessToken: reworded.signedIn(), fetcher: reworded.fetch, ...quiet })).offered], ['search_notes', 'get_note']);
  // An unprintable name is logged as such.
  const odd = notesFake();
  odd.state.tools = [...defaultNotesTools(), { name: 'evil\nname"}', inputSchema: { type: 'object' } }];
  const o = await openMcpSession(notes(), { accessToken: odd.signedIn(), fetcher: odd.fetch, ...quiet });
  assert.ok(o.drift.some((d) => d.tool === '(unprintable)'));
});

test('8. limits: the budget, a refused redirect, the body cap, unsafe headers, pages, and no body in an error', async () => {
  const fake = notesFake({ era: 'legacy' });
  const s = await openMcpSession(notes({ budget: 6 }), { accessToken: fake.signedIn(), fetcher: fake.fetch, ...quiet });
  assert.equal(s.requests, 4);
  await s.callTool('get_note', { id: 'a' });
  await s.callTool('get_note', { id: 'b' });
  const n = fake.calls.length;
  await assert.rejects(() => s.callTool('get_note', { id: 'c' }), (e: any) => e.code === 'rate_limited');
  assert.equal(fake.calls.length, n, 'the request past the budget was not made');
  // The budget can be lowered by a caller, never raised.
  const capped = notesFake();
  await assert.rejects(() => openMcpSession(notes({ budget: 1 }), { accessToken: capped.signedIn(), fetcher: capped.fetch, budget: 50, ...quiet }).then((x) => x.callTool('get_note', { id: 'a' })), (e: any) => e.code === 'rate_limited');

  const r = notesFake();
  r.state.redirect = true;
  await assert.rejects(() => openMcpSession(notes(), { accessToken: r.signedIn(), fetcher: r.fetch, ...quiet }), (e: any) => e.code === 'redirect_refused' && e.status === 302);
  assert.equal(r.calls.some((c: any) => c.foreign), false, 'the redirect was not followed');

  const big = notesFake();
  big.state.oversize = MCP_MAX_BODY_BYTES;
  await assert.rejects(() => openMcpSession(notes(), { accessToken: big.signedIn(), fetcher: big.fetch, ...quiet }), (e: any) => e.code === 'too_large');
  const streamed = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(MCP_MAX_BODY_BYTES / 2)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => openMcpSession(notes({ era: 'modern' }), { accessToken: 't', fetcher: streamed as any, ...quiet }), (e: any) => e.code === 'too_large', 'counted as it streams');

  // Unsafe headers are refused before any request.
  const h = notesFake();
  for (const headers of [{ Authorization: 'x' }, { 'Mcp-Param-Space': 'x' }, { 'X-Ok': 'line\r\nInjected: 1' }, { 'Bad Name': 'x' }]) {
    await assert.rejects(() => openMcpSession(notes(), { accessToken: h.signedIn(), fetcher: h.fetch, headers, ...quiet }), (e: any) => e.code === 'path_not_allowed', JSON.stringify(headers));
  }
  assert.equal(h.calls.length, 0);
  await assert.rejects(() => openMcpSession(notes(), { accessToken: h.signedIn(), fetcher: h.fetch, resource: 'https://mcp.notes.example/other', ...quiet }), (e: any) => e.code === 'path_not_allowed');
  assert.equal(h.calls.length, 0);
  // A connection's own safe header is sent.
  const ph = notesFake();
  await openMcpSession(notes(), { accessToken: ph.signedIn(), fetcher: ph.fetch, headers: { 'X-Notes-Project': 'p-1' }, ...quiet });

  // Pages: every page up to the limit.
  const paged = async (url: string, init: any) => {
    const msg = JSON.parse(init.body);
    const page = Number(msg.params?.cursor ?? 0);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: page === 2 ? 'get_note' : `t${page}`, inputSchema: { type: 'object' } }], nextCursor: String(page + 1) } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const pg = await openMcpSession(notes({ era: 'modern' }), { accessToken: 't', fetcher: paged as any, ...quiet });
  assert.deepEqual([...pg.offered], ['get_note']);
  assert.equal(pg.requests, MAX_TOOL_PAGES);

  // 401 and 403 keep their meaning; insufficient_scope is its own word, never a step-up.
  const answer = (status: number, challenge: string) => async () => new Response('{"error":"secret-body-text"}', { status, headers: { 'WWW-Authenticate': challenge } });
  await assert.rejects(() => openMcpSession(notes(), { accessToken: 't', fetcher: answer(401, 'Bearer') as any, ...quiet }), (e: any) => e.code === 'unauthorized' && !e.message.includes('secret-body-text'));
  await assert.rejects(() => openMcpSession(notes(), { accessToken: 't', fetcher: answer(403, 'Bearer error="insufficient_scope", scope="notes.write"') as any, ...quiet }), (e: any) => e.code === 'scope_insufficient');
  await assert.rejects(() => openMcpSession(notes(), { accessToken: 't', fetcher: answer(403, 'Bearer') as any, ...quiet }), (e: any) => e.code === 'unauthorized');
  await assert.rejects(() => openMcpSession(notes(), { accessToken: 't', fetcher: answer(500, '') as any, ...quiet }), (e: any) => e.code === 'http_error' && e.status === 500 && !e.message.includes('secret-body-text'));
  assert.equal(headerValue('plain-ascii'), 'plain-ascii');
  assert.equal(headerValue(' padded '), `=?base64?${Buffer.from(' padded ').toString('base64')}?=`);
  assert.equal(headerValue('=?base64?literal?='), `=?base64?${Buffer.from('=?base64?literal?=').toString('base64')}?=`);
});

test('9. refresh under the lease: a race refreshes once; refused or widened refreshes mark the row; v1 and v2 blobs read', async () => {
  const { env, db } = await envWithDb();
  const fake = notesFake();
  const p = notes();
  const { creds } = await signIn(env, fake, p);
  const row = await storeRow(env, db, { ...creds, expires_at: Date.now() - 1000 });
  const stored = (await mcpCredentialsOf(env, p, row))!;

  // Two readers race an expired token: one refresh, both end on the new token.
  const [a, b] = await Promise.all([mcpAccessFor(env, p, row, stored, { fetcher: fake.fetch }), mcpAccessFor(env, p, row, stored, { fetcher: fake.fetch })]);
  assert.equal(fake.calls.filter((c: any) => c.grant_type === 'refresh_token').length, 1, 'one refresh for the race');
  assert.equal(a.accessToken, b.accessToken);
  assert.notEqual(a.accessToken, creds.access_token);
  const after = (await decryptCredentials(env, row.uid, (db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(row.id) as any).credentials_enc))!;
  assert.equal(after.access_token, a.accessToken, 'stored before use');
  assert.equal(after.v, 2);
  assert.ok(LEASE_POLL_MS >= 100);
  assert.equal((db.prepare('SELECT status FROM integrations WHERE id = ?').get(row.id) as any).status, 'active');

  // A caller holding stale tokens, after another isolate already refreshed: the row's tokens, no refresh.
  const refreshes = fake.calls.filter((c: any) => c.grant_type === 'refresh_token').length;
  const late = await refreshMcpCredentials(env, p, row, stored, { fetcher: fake.fetch });
  assert.equal(late!.access_token, a.accessToken);
  assert.equal(fake.calls.filter((c: any) => c.grant_type === 'refresh_token').length, refreshes, 'no second refresh');

  // A refused refresh marks the row and asks for a new sign-in.
  const fresh = (await mcpCredentialsOf(env, p, db.prepare('SELECT * FROM integrations WHERE id = ?').get(row.id) as any))!;
  fake.state.failRefresh = 1;
  assert.equal(await refreshMcpCredentials(env, p, row, fresh, { fetcher: fake.fetch }), null);
  assert.deepEqual({ ...(db.prepare('SELECT status, last_error FROM integrations WHERE id = ?').get(row.id) as any) }, { status: 'error', last_error: 'token_rejected' });

  // A refresh reporting a wider scope is refused too.
  db.prepare("UPDATE integrations SET status = 'active', last_error = NULL WHERE id = ?").run(row.id);
  fake.state.scope = 'notes.read notes.write';
  assert.equal(await refreshMcpCredentials(env, p, row, fresh, { fetcher: fake.fetch }), null);
  assert.equal((db.prepare('SELECT last_error FROM integrations WHERE id = ?').get(row.id) as any).last_error, 'token_rejected');
  fake.state.scope = 'notes.read';

  // A version 1 blob (no `v`, no `resource`) reads on the default resource; another provider's row is not read.
  const v1 = await storeRow(env, db, { access_token: 'fake-access-v1', refresh_token: 'r', expires_at: null, scopes: ['notes.read'], issuer: NOTES_ISSUER, client_key: `mcp_client:notes_fake:${REDIRECT}` }, 8);
  const read = (await mcpCredentialsOf(env, p, v1))!;
  assert.equal(read.resource, NOTES_MCP);
  assert.equal(await mcpCredentialsOf(env, MCP_PROVIDERS.mercury, v1), null);
  assert.equal(await mcpCredentialsOf(env, p, { ...v1, auth_type: 'api_key' }), null);
  // No refresh token: nothing to refresh, no request.
  const n = fake.calls.length;
  assert.equal(await refreshMcpCredentials(env, p, v1, { ...read, refresh_token: undefined }, { fetcher: fake.fetch }), null);
  assert.equal(fake.calls.length, n);
});

test('10. revoke calls the revocation endpoint when there is one, and deletes the stored tokens either way', async () => {
  const { env, db } = await envWithDb();
  const fake = notesFake();
  const p = notes();
  const { creds } = await signIn(env, fake, p);
  const row = await storeRow(env, db, creds);
  assert.deepEqual(await revokeMcpConnection(env, p, row, { fetcher: fake.fetch }), { provider_revoked: true });
  assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);
  assert.equal(fake.state.access.has(creds.access_token), false);
  assert.deepEqual({ ...(db.prepare('SELECT credentials_enc, status FROM integrations WHERE id = ?').get(row.id) as any) }, { credentials_enc: null, status: 'disconnected' });

  // No revocation endpoint: the tokens are still deleted, and the answer says the provider was not told.
  const none = notesFake();
  none.state.meta.revocation = false;
  const other = await envWithDb();
  const signed = await signIn(other.env, none, p);
  const row2 = await storeRow(other.env, other.db, signed.creds, 9);
  assert.deepEqual(await revokeMcpConnection(other.env, p, row2, { fetcher: none.fetch }), { provider_revoked: false });
  assert.deepEqual(none.state.revoked, []);
  assert.equal((other.db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(row2.id) as any).credentials_enc, null);
  // An unreachable provider: still deleted.
  const row3 = await storeRow(env, db, creds, 11);
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await revokeMcpConnection(env, p, row3, { fetcher: down as any }), { provider_revoked: false });
  assert.deepEqual({ ...(db.prepare('SELECT credentials_enc, status FROM integrations WHERE id = ?').get(row3.id) as any) }, { credentials_enc: null, status: 'disconnected' });
});

test('11. no token, code or verifier reaches a log, an error or the drift line', async () => {
  const logged: string[] = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(keep) as Array<keyof typeof keep>) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  const errors: string[] = [];
  try {
    const { env } = await envWithDb();
    const fake = notesFake();
    const { creds } = await signIn(env, fake);
    const s = await openMcpSession(notes(), { accessToken: creds.access_token, fetcher: fake.fetch });
    await s.callTool('get_note', { id: 'n1' });
    await openMcpSession(notes(), { accessToken: 'fake-access-not-live', fetcher: fake.fetch }).catch((e) => errors.push(String(e.message)));
    await s.callTool(FAKE_WRITE_TOOL).catch((e) => errors.push(String(e.message)));
  } finally { Object.assign(console, keep); }
  assert.ok(logged.some((l) => l.includes('mcp_tool_drift')), 'the drift line went to the log');
  for (const line of [...logged, ...errors]) assert.ok(!/fake-access|fake-refresh|fake-code/.test(line), `a credential reached "${line}"`);
  assert.deepEqual(errors, ['mcp_unauthorized_401', 'mcp_path_not_allowed']);
});

test('12. Mercury\'s wrapper keeps D710\'s words for the shared client\'s new ones', async () => {
  const { openMercuryMcp } = await import('../src/services/mercury/mcp.ts');
  const { MercuryClientError } = await import('../src/services/mercury/client.ts');
  const answer = (status: number, headers: Record<string, string> = {}, body = '{}') => async () => new Response(body, { status, headers });
  const cases: Array<[any, string, number | null]> = [
    [answer(403, { 'WWW-Authenticate': 'Bearer error="insufficient_scope"' }), 'unauthorized', 403],
    [answer(200, { 'Content-Length': String(MCP_MAX_BODY_BYTES + 1), 'Content-Type': 'application/json' }), 'http_error', 413],
    [answer(302, { Location: 'https://evil.example/' }), 'redirect_refused', 302],
    [answer(401), 'unauthorized', 401],
    [answer(200, { 'Content-Type': 'application/json' }, 'not json'), 'bad_json', null],
  ];
  for (const [fetcher, code, status] of cases) {
    await assert.rejects(() => openMercuryMcp({ accessToken: 't', fetcher }), (e: any) => e instanceof MercuryClientError && e.code === code && e.status === status, `${code} ${status}`);
  }
  await assert.rejects(() => openMercuryMcp({ accessToken: 't', fetcher: answer(200), url: 'https://mcp.mercury.com.evil.example/mcp' }), (e: any) => e instanceof MercuryClientError && e.code === 'path_not_allowed');
});
