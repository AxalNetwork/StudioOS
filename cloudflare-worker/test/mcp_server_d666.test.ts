/**
 * D666 (#1496) — the StudioOS MCP server: the flag, OAuth discovery, the SPA
 * consent hand-off, grants and revocation, the read tools and their checks,
 * and wrangler.toml. The whole OAuth flow runs for real against
 * @cloudflare/workers-oauth-provider over an in-memory KV and SQLite D1.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mcp_server_d666.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import worker from '../src/index.ts';
import { assistantGrants, mcpConsent } from '../src/routes/mcp_consent.ts';
import { isMcpPath } from '../src/mcp/oauth.ts';
import { bumpJwtMinIat } from '../src/auth.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (f: string) => readFileSync(resolve(ROOT, `cloudflare-worker/sql/migrations/${f}`), 'utf8');
const ORIGIN = 'https://axal.vc';
const FOUNDER = 10, OTHER = 20, ADMIN = 30;
const P = 1, P2 = 2, P_OTHER = 3;
const INTERVIEWEE = 'Zelda Quintanilla-Marsh';

function fixture({ enabled = true, kv = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  // D690 (#1692): the Validate reads behind get_validate_context touch 460's stores.
  db.exec(sqlOf('460_validate_record_stores.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P2}, 'Second', 1001), (${P_OTHER}, 'Beta', 1002)`);
  // Validate data for Acme, with an interviewee whose name must never leave.
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_company, interview_date, created_at)
           VALUES (1, ${P}, '${INTERVIEWEE}', 'Zelda Corp', '2026-09-01', '2026-09-01')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, created_at) VALUES (1, ${P}, 'H1', 'Ops leads lose a day a week to manual reconciliation', '2026-09-01')`);
  const env: any = {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    RATE_LIMITS: memKV(), TOKENS: memKV(),
    ...(enabled ? { MCP_SERVER_ENABLED: 'true' } : {}),
    ...(kv ? { OAUTH_KV: memKV() } : {}),
  };
  return { db, env };
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const quiet = async <T>(f: () => Promise<T>) => { const s = [console.warn, console.error]; console.warn = () => {}; console.error = () => {}; try { return await f(); } finally { [console.warn, console.error] = s; } };
const hit = (env: any, path: string, init: RequestInit = {}) => quiet(() => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx));

const spa = new Hono<any>();
spa.route('/api/mcp/consent', mcpConsent);
spa.route('/api/connectors/assistants', assistantGrants);
async function asUser(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await quiet(() => spa.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64url');
const VERIFIER = 'v'.repeat(64);
const challenge = async () => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)));
const REDIRECT = 'https://client.example/callback';

async function register(env: any, name = 'Claude') {
  const r = await hit(env, '/api/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: name, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) });
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json() as any).client_id as string;
}

async function authorize(env: any, clientId: string, { pkce = true } = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st8', resource: `${ORIGIN}/mcp`, scope: 'validate:read validate:write' });
  if (pkce) { q.set('code_challenge', await challenge()); q.set('code_challenge_method', 'S256'); }
  return hit(env, `/api/oauth/authorize?${q}`);
}

const requestIdOf = (r: Response) => new URL(r.headers.get('location')!).searchParams.get('request')!;

/** Register, authorize, approve for `companies`, exchange the code: an access token. */
async function connect(env: any, companies = [P]) {
  const clientId = await register(env);
  const id = requestIdOf(await authorize(env, clientId));
  const ok = await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const code = new URL(ok.body.redirectTo).searchParams.get('code')!;
  const t = await hit(env, '/api/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: `${ORIGIN}/mcp` }) });
  assert.equal(t.status, 200, await t.clone().text());
  return { token: (await t.json() as any).access_token as string, clientId };
}

let rpcId = 0;
async function mcp(env: any, token: string | null, method: string, params: unknown = {}) {
  const r = await hit(env, '/mcp', { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
}
const callTool = (env: any, token: string, name: string, args: Record<string, unknown> = {}) => mcp(env, token, 'tools/call', { name, arguments: args });
const toolJson = (r: any) => JSON.parse(r.body.result.content[0].text);

// ── The flag ────────────────────────────────────────────────────────────────

test('with the flag off, every MCP and OAuth path answers 404, and nothing else changes', async () => {
  for (const env of [fixture({ enabled: false }).env, fixture({ kv: false }).env]) {
    for (const path of ['/mcp', '/api/mcp', '/api/oauth/authorize', '/api/oauth/token', '/api/oauth/register',
      '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']) {
      for (const method of ['GET', 'POST']) assert.equal((await hit(env, path, { method })).status, 404, `${method} ${path}`);
    }
    assert.equal((await asUser(env, FOUNDER, 'GET', '/api/mcp/consent/' + 'a'.repeat(32))).status, 404);
    assert.equal((await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).status, 404);
  }
  assert.equal(isMcpPath('/api/mcp/consent/abc'), false, 'consent is the SPA\'s, through the app');
  assert.equal(isMcpPath('/api/connectors'), false);
});

// ── Discovery and the resource ─────────────────────────────────────────────

test('discovery names https://axal.vc/mcp and S256 only; an unauthenticated call gets 401 naming the metadata', async () => {
  const { env } = fixture();
  const as = await (await hit(env, '/.well-known/oauth-authorization-server')).json() as any;
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.token_endpoint, `${ORIGIN}/api/oauth/token`);
  assert.equal(as.registration_endpoint, `${ORIGIN}/api/oauth/register`);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/api/oauth/authorize`);
  const pr = await (await hit(env, '/.well-known/oauth-protected-resource/mcp')).json() as any;
  assert.equal(pr.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(pr.authorization_servers, [ORIGIN]);
  const r = await mcp(env, null, 'tools/list');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/axal\.vc\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test('D784: /api/mcp answers 308 to /mcp, keeping the method, path and query; the SPA\'s consent API is not redirected', async () => {
  const { env } = fixture();
  for (const method of ['GET', 'POST', 'DELETE']) {
    const r = await hit(env, '/api/mcp', { method });
    assert.equal(r.status, 308, method);
    assert.equal(r.headers.get('location'), `${ORIGIN}/mcp`);
  }
  const deep = await hit(env, '/api/mcp/sse?x=1');
  assert.equal(deep.status, 308);
  assert.equal(deep.headers.get('location'), `${ORIGIN}/mcp/sse?x=1`);
  assert.equal(isMcpPath('/mcp'), true);
  assert.equal(isMcpPath('/mcp/anything'), true);
  assert.equal(isMcpPath('/mcpx'), false, 'only /mcp and paths under it');
  assert.equal(isMcpPath('/api/mcp/consent/abc'), false, 'consent stays the SPA\'s, through the app');
  const consent = await asUser(env, FOUNDER, 'GET', `/api/mcp/consent/${'c'.repeat(32)}`);
  assert.equal(consent.status, 410, 'an unknown consent request, answered by the app, never redirected');
  // The server itself answers at /mcp: an unauthenticated call is the provider's 401, not a redirect.
  assert.equal((await mcp(env, null, 'tools/list')).status, 401);
});

test('authorize requires S256 PKCE, parks the request and sends the founder to the SPA; nothing is auto-approved', async () => {
  const { env } = fixture();
  const clientId = await register(env);
  assert.equal((await authorize(env, clientId, { pkce: false })).status, 400, 'no PKCE');
  // The provider demands PKCE only of public clients; a client with a secret is refused here.
  const conf = await hit(env, '/api/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Confidential', token_endpoint_auth_method: 'client_secret_basic' }) });
  const confId = (await conf.json() as any).client_id;
  const noPkce = await authorize(env, confId, { pkce: false });
  assert.equal(noPkce.status, 400, 'a confidential client without PKCE');
  assert.match((await noPkce.json() as any).detail, /PKCE with S256 is required/);
  const r = await authorize(env, clientId);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location')!);
  assert.equal(loc.pathname, '/connect/assistant');
  assert.match(loc.searchParams.get('request')!, /^[a-f0-9]{32}$/);
  assert.equal(loc.searchParams.get('code'), null, 'no code without consent');
});

// ── Consent ────────────────────────────────────────────────────────────────

test('consent: the page offers owned companies only; approve refuses an unowned company', async () => {
  const { env } = fixture();
  const id = requestIdOf(await authorize(env, await register(env, 'Claude')));
  const read = await asUser(env, FOUNDER, 'GET', `/api/mcp/consent/${id}`);
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.client_name, read.body.redirect_host], ['Claude', 'client.example']);
  assert.deepEqual(read.body.companies.map((c: any) => c.id), [P, P2], 'only the founder\'s own companies');
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [P, P_OTHER] })).status, 403);
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [] })).status, 400);
  // Staff's board read does not authorize handing a venture to an assistant.
  assert.deepEqual((await asUser(env, ADMIN, 'GET', `/api/mcp/consent/${id}`)).body.companies.map((p: any) => p.id), []);
  assert.equal((await asUser(env, ADMIN, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [P] })).status, 403);
});

test('consent: a request id is single-use, an unknown or lapsed one is expired, and deny returns access_denied', async () => {
  const { env } = fixture();
  const clientId = await register(env);
  const id = requestIdOf(await authorize(env, clientId));
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [P] })).status, 200);
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [P] })).status, 409, 'used');
  assert.equal((await asUser(env, FOUNDER, 'GET', `/api/mcp/consent/${id}`)).status, 409);
  assert.equal((await asUser(env, FOUNDER, 'GET', `/api/mcp/consent/${'b'.repeat(32)}`)).status, 410, 'unknown');
  // A request past its ten minutes.
  const late = requestIdOf(await authorize(env, clientId));
  const raw = JSON.parse(await env.OAUTH_KV.get(`mcp_consent:${late}`));
  await env.OAUTH_KV.put(`mcp_consent:${late}`, JSON.stringify({ ...raw, createdAt: Date.now() - 11 * 60_000 }));
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${late}/approve`, { companies: [P] })).status, 410);
  const no = requestIdOf(await authorize(env, clientId));
  const denied = await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${no}/deny`);
  const to = new URL(denied.body.redirectTo);
  assert.deepEqual([to.host, to.searchParams.get('error'), to.searchParams.get('state'), to.searchParams.get('code')], ['client.example', 'access_denied', 'st8', null]);
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${no}/approve`, { companies: [P] })).status, 409);
});

// ── Tools ──────────────────────────────────────────────────────────────────

test('tools: list_companies is the grant; get_validate_context never names an interviewee; the guide is built from the hypotheses', async () => {
  const { env } = fixture();
  const { token } = await connect(env, [P]);
  const list = await mcp(env, token, 'tools/list');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.result.tools.map((t: any) => t.name).sort(), ['assign_chat_to_interview', 'extract_action_items', 'get_interview_guide', 'get_meeting_transcript', 'get_session_insights', 'get_validate_context', 'list_channel_chats', 'list_companies', 'list_meetings', 'propose_placements', 'structure_with_studioos', 'submit_interview', 'summarize_meeting']);
  for (const t of list.body.result.tools) assert.ok(t.description.length > 20 && t.inputSchema?.type === 'object', t.name);
  assert.deepEqual(toolJson(await callTool(env, token, 'list_companies')).companies, [{ id: P, name: 'Acme' }]);
  const ctxRes = await callTool(env, token, 'get_validate_context', { company: P });
  assert.equal(ctxRes.body.result.isError, undefined, JSON.stringify(ctxRes.body));
  const whole = JSON.stringify(ctxRes.body);
  assert.ok(!whole.includes('Zelda'), 'no interviewee name anywhere in the response');
  assert.ok(!whole.includes('Quintanilla'));
  const c = toolJson(ctxRes);
  assert.equal(c.interviews.recorded, 1);
  assert.match(c.hypotheses[0].hypothesis, /^H1 · Ops leads lose a day/);
  const guide = toolJson(await callTool(env, token, 'get_interview_guide', { company: P }));
  assert.ok(guide.questions.some((q: any) => q.question.includes('Ops leads lose a day a week')));
  assert.deepEqual(toolJson(await callTool(env, token, 'get_interview_guide', { company: P })), guide, 'the same input gives the same guide');
});

test('tools: a company outside the grant is refused, and so is one the user has since lost', async () => {
  const { env, db } = fixture();
  const { token } = await connect(env, [P]);
  const outside = await callTool(env, token, 'get_validate_context', { company: P2 });
  assert.equal(outside.body.result.isError, true);
  assert.match(toolJson(outside).error, /not one this connection was approved for/);
  const foreign = await callTool(env, token, 'get_validate_context', { company: P_OTHER });
  assert.equal(foreign.body.result.isError, true);
  db.exec(`UPDATE projects SET founder_id = 1002 WHERE id = ${P}`); // the founder no longer owns it
  const lost = await callTool(env, token, 'get_validate_context', { company: P });
  assert.match(toolJson(lost).error, /can no longer read that company/);
  assert.deepEqual(toolJson(await callTool(env, token, 'list_companies')).companies, [], 'a lost company drops out of the list');
});

test('activity_logs: one row per call with tool, company, client and outcome, and no argument text', async () => {
  const { env, db } = fixture();
  const { token } = await connect(env, [P]);
  await callTool(env, token, 'get_interview_guide', { company: P, hypothesis: 'SECRET-ARG-TEXT reconciliation' });
  const rows = db.prepare(`SELECT user_id, project_id, details FROM activity_logs WHERE action = 'mcp_tool_call'`).all() as any[];
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].details), { tool: 'get_interview_guide', company_id: P, client: 'Claude', outcome: 'ok' });
  assert.deepEqual([rows[0].user_id, rows[0].project_id], [FOUNDER, P]);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM activity_logs').all()).includes('SECRET-ARG-TEXT'));
});

test('tools are rate-limited per grant', async () => {
  const { env } = fixture();
  const { token } = await connect(env, [P]);
  let last: any;
  for (let i = 0; i <= 60; i += 1) last = await callTool(env, token, 'list_companies');
  assert.equal(last.body.result.isError, true);
  assert.match(toolJson(last).error, /Too many calls/);
});

// ── Grants ─────────────────────────────────────────────────────────────────

test('grants: listed without tokens; a revoked grant\'s token gets 401 on its next call; only the owner revokes', async () => {
  const { env } = fixture();
  const { token } = await connect(env, [P, P2]);
  await callTool(env, token, 'list_companies');
  const list = await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants');
  assert.equal(list.status, 200);
  const g = list.body.grants[0];
  assert.deepEqual([g.client_name, g.redirect_host, g.companies.map((c: any) => c.name)], ['Claude', 'client.example', ['Acme', 'Second']]);
  assert.match(g.connected_at, /^\d{4}-/);
  assert.match(g.last_used_at, /^\d{4}-/);
  assert.ok(!JSON.stringify(list.body).includes(token.split(':')[2]), 'no token in the list');
  assert.equal((await asUser(env, OTHER, 'DELETE', `/api/connectors/assistants/${g.id}`)).status, 404, 'not theirs');
  assert.equal((await mcp(env, token, 'tools/list')).status, 200);
  assert.equal((await asUser(env, FOUNDER, 'DELETE', `/api/connectors/assistants/${g.id}`)).status, 200);
  assert.equal((await mcp(env, token, 'tools/list')).status, 401, 'revoked at once');
  assert.deepEqual((await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants, []);
});

test('signing out everywhere ends every grant; a raised session floor refuses a grant even if the revoke failed', async () => {
  const { env, db } = fixture();
  const { token } = await connect(env, [P]);
  await bumpJwtMinIat(env, FOUNDER);
  assert.equal((await mcp(env, token, 'tools/list')).status, 401);
  // The founder signs in again (their own session floor lifted for the test)
  // and connects a second grant; then the floor rises with no revoke at all.
  db.exec(`UPDATE users SET jwt_min_iat = 0 WHERE id = ${FOUNDER}`);
  const second = await connect(env, [P]);
  db.exec(`UPDATE users SET jwt_min_iat = ${Math.floor(Date.now() / 1000) + 5} WHERE id = ${FOUNDER}`);
  const r = await callTool(env, second.token, 'list_companies');
  assert.equal(r.body.result.isError, true);
  assert.match(toolJson(r).error, /signed out everywhere/);
  db.exec(`UPDATE users SET jwt_min_iat = 0, deletion_requested_at = datetime('now') WHERE id = ${FOUNDER}`);
  assert.match(toolJson(await callTool(env, second.token, 'list_companies')).error, /no longer has an active StudioOS account/);
});

// ── wrangler.toml ──────────────────────────────────────────────────────────

/**
 * The MCP flag HQ ships at the top level and in [env.production] (D681). The
 * lasting switch-off is one PR to main that sets MCP_SERVER_ENABLED to "false"
 * in wrangler.toml's top-level [vars] and [env.production.vars] and sets this
 * constant to 'false' (PRODUCTION.md, "MCP enablement"). Preview's flag stays
 * 'false' whatever this says.
 */
const HQ_MCP_FLAG = 'true';
/** HQ's OAuth namespace (D681), and the placeholder [env.preview] binds until preview has its own. */
const HQ_MCP_STORE_ID = 'a536c75e7461447a89b1967d367c13ad';
const PREVIEW_MCP_STORE_PLACEHOLDER = 'REPLACE_WITH_PREVIEW_KV_OAUTH_ID';
/**
 * The three scopes the guard requires, each with its table prefix, the
 * wrangler environment it is (none for the top level), its expected flag and
 * its OAuth namespace, shared by checkMcpDeployment and its mutation probes.
 * Every other environment wrangler.toml declares is read too, and held to
 * preview's rule (checkMcpDeployment).
 */
const MCP_SCOPES = [
  ['', undefined, HQ_MCP_FLAG, HQ_MCP_STORE_ID],
  ['env.production.', 'production', HQ_MCP_FLAG, HQ_MCP_STORE_ID],
  ['env.preview.', 'preview', 'false', PREVIEW_MCP_STORE_PLACEHOLDER],
] as const;
/** HQ's two scopes. Any D1 or KV id either binds is HQ's store. */
const HQ_SCOPES: readonly string[] = ['', 'env.production.'];
const scopeName = (scope: string) => (scope ? '[' + scope.slice(0, -1) + ']' : 'top level');

/**
 * wrangler.toml as the installed wrangler resolves it for the top level and
 * for every environment its `env` table declares, each read by
 * `unstable_readConfig`, the reader `wrangler deploy` uses, beside the raw
 * table wrangler parsed for it (`experimental_readRawConfig`, the same TOML
 * parser). The raw `env` table names the environments, so one added later
 * (`[env.inspector]`) is read as surely as production and preview, which
 * must be there. A line-based parser misses spellings TOML allows and
 * wrangler reads: spaces or a quoted segment inside a header's brackets
 * (`[[ env.preview.kv_namespaces ]]`, `[[env."preview".kv_namespaces]]`), a
 * quoted key, a literal or escaped string. An HQ id written that way would
 * reach a scope unseen. wrangler reads a file, so `toml` goes to a temporary
 * directory first. CLOUDFLARE_ENV is cleared for the read: wrangler takes it
 * as the environment when none is named, and the top level would then read
 * as another scope. A config or environment wrangler cannot read fails as an
 * assertion, so no spelling passes unread.
 */
function wranglerScopes(toml: string): Map<string, { raw: any; config: any }> {
  const dir = mkdtempSync(join(tmpdir(), 'd681-wrangler-'));
  const config = join(dir, 'wrangler.toml');
  const cloudflareEnv = process.env.CLOUDFLARE_ENV;
  delete process.env.CLOUDFLARE_ENV;
  try {
    writeFileSync(config, toml);
    let raw: any;
    try {
      raw = experimental_readRawConfig({ config }).rawConfig;
    } catch (e) {
      return assert.fail('wrangler cannot read wrangler.toml: ' + (e as Error).message);
    }
    const envs = raw.env ?? {};
    assert.ok(envs && typeof envs === 'object' && !Array.isArray(envs), 'wrangler.toml\'s env is a table');
    const names = [...new Set(['production', 'preview', ...Object.keys(envs)])];
    return new Map([undefined, ...names].map((env) => {
      const scope = env === undefined ? '' : 'env.' + env + '.';
      let c: any;
      try {
        c = unstable_readConfig({ config, env }, { hideWarnings: true });
      } catch (e) {
        return assert.fail('wrangler cannot read the ' + scopeName(scope) + ': ' + (e as Error).message);
      }
      assert.equal(c.targetEnvironment, env, 'wrangler read the ' + scopeName(scope));
      const own = env === undefined ? raw : envs[env];
      assert.ok(own && typeof own === 'object' && !Array.isArray(own), 'the ' + scopeName(scope) + ' is a table');
      return [scope, { raw: own, config: c }];
    }));
  } finally {
    if (cloudflareEnv !== undefined) process.env.CLOUDFLARE_ENV = cloudflareEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every store id a resolved scope's D1 and KV bindings name, `wrangler dev`'s preview ids included. */
function storeIds(c: any): [string, string, unknown][] {
  const named = (b: any, keys: string[]) => keys.map((k) => [b.binding, k, b[k]] as [string, string, unknown]);
  return [
    ...(c.kv_namespaces ?? []).flatMap((b: any) => named(b, ['id', 'preview_id'])),
    ...(c.d1_databases ?? []).flatMap((b: any) => named(b, ['database_id', 'preview_database_id'])),
  ].filter(([, , v]) => v !== undefined);
}

/** A store id as wrangler read it (quotes stripped, escapes decoded), lower-cased so a hex id matches in any case. */
function storeKey(binding: string, key: string, v: unknown): string {
  assert.equal(typeof v, 'string', binding + ' ' + key + ' is a string');
  return (v as string).toLowerCase();
}

/** D681 (#1555): pin each scope as wrangler resolves it, not commented placeholders, table order or spelling. */
function checkMcpDeployment(toml: string) {
  const scopes = wranglerScopes(toml);
  // No scope declares an `unsafe` key, and wrangler.toml has none. Its
  // bindings (`unsafe.bindings`, `unsafe.metadata.bindings`) can name a D1
  // database or KV namespace by id where the store check below never reads.
  // wrangler never carries `unsafe` from the top level into an environment,
  // so each scope's own table is the place to look.
  for (const [scope, { raw }] of scopes) {
    assert.equal(Object.hasOwn(raw, 'unsafe'), false, scopeName(scope) + ' declares `unsafe`, whose bindings the store check cannot read');
  }
  // Every D1 and KV id HQ binds, at the top level and in production. Preview has
  // its own D1 and grants are keyed by numeric user id, so any store preview
  // shares with HQ crosses deployments.
  const hqIds = new Set(HQ_SCOPES.flatMap((s) => storeIds(scopes.get(s)!.config).map(([b, k, v]) => storeKey(b, k, v))));
  const preview = scopes.get('env.preview.')!.config;
  assert.ok((preview.d1_databases ?? []).length > 0, 'preview declares its D1');
  assert.ok((preview.kv_namespaces ?? []).length > 0, 'preview declares its KV namespaces');
  for (const b of preview.d1_databases) assert.ok(b.database_id, 'preview\'s D1 ' + b.binding + ' names its database_id');
  for (const b of preview.kv_namespaces) assert.ok(b.id, 'preview\'s KV ' + b.binding + ' names its id');
  // A D1 binding with no database_id is looked up by database_name at deploy,
  // so HQ's database names count as HQ's stores too.
  const hqD1Names = new Set(HQ_SCOPES.flatMap((s) => (scopes.get(s)!.config.d1_databases ?? []).map((b: any) => String(b.database_name ?? '').toLowerCase())).filter(Boolean));
  // Preview's rule, for preview and every other environment but production:
  // every store named by its own id, no store HQ binds, and MCP off.
  for (const [scope, { config: c }] of scopes) {
    if (HQ_SCOPES.includes(scope)) continue;
    for (const b of c.d1_databases ?? []) {
      assert.ok(typeof b.database_id === 'string' && b.database_id !== '', scopeName(scope) + '\'s D1 ' + b.binding + ' names its database_id');
      assert.equal(hqD1Names.has(String(b.database_name ?? '').toLowerCase()), false, scopeName(scope) + '\'s D1 ' + b.binding + ' uses HQ\'s database_name ' + b.database_name);
    }
    for (const b of c.kv_namespaces ?? []) {
      assert.ok(typeof b.id === 'string' && b.id !== '', scopeName(scope) + '\'s KV ' + b.binding + ' names its id');
    }
    for (const [binding, key, v] of storeIds(c)) {
      assert.equal(hqIds.has(storeKey(binding, key, v)), false, scopeName(scope) + '\'s ' + binding + ' ' + key + ' is one of HQ\'s D1 or KV ids: ' + v);
    }
    assert.equal(c.vars?.MCP_SERVER_ENABLED, 'false', 'MCP flag in ' + scopeName(scope));
  }
  for (const [scope, , flag, store] of MCP_SCOPES) {
    const c = scopes.get(scope)!.config;
    assert.equal(c.vars?.MCP_SERVER_ENABLED, flag, 'MCP flag in ' + scopeName(scope));
    const bindings = (c.kv_namespaces ?? []).filter((b: any) => b.binding === 'OAUTH_KV');
    assert.equal(bindings.length, 1, 'exactly one live OAuth binding in ' + scopeName(scope));
    const id = bindings[0].id;
    if (scope === 'env.preview.') {
      assert.notEqual(storeKey('OAUTH_KV', 'id', id), HQ_MCP_STORE_ID, 'preview never binds HQ\'s OAuth namespace');
    } else {
      assert.equal(id, store, 'owner-provisioned OAuth namespace');
    }
  }
  assert.doesNotMatch(toml, /OAUTH_KV-PENDING|<owner-provided>/);
}

test('D681 wrangler.toml, as wrangler resolves it: HQ\'s MCP flag at top level and production on HQ\'s OAuth namespace; preview off, on stores HQ never binds', () => {
  checkMcpDeployment(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8'));
});

/** The id HQ's top level binds for a KV or D1 `binding`, as wrangler reads it. */
function hqStoreId(toml: string, table: 'kv_namespaces' | 'd1_databases', binding: string, key: string): string {
  const b = wranglerScopes(toml).get('')!.config[table].find((x: any) => x.binding === binding);
  assert.equal(typeof b?.[key], 'string', 'HQ\'s ' + binding + ' ' + key);
  return b[key];
}

test('D681 deployment mutations fail the same assertions; the shipped config restores them', () => {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const hqTokensId = hqStoreId(toml, 'kv_namespaces', 'TOKENS', 'id');
  for (const [scope, , flag, id] of MCP_SCOPES) {
    // The table header on its own line, never a mention of it in a comment.
    const header = '\n[' + scope + 'vars]\n';
    const start = toml.indexOf(header), next = toml.indexOf('\n[', start + header.length);
    assert.ok(start >= 0, 'live ' + header.trim() + ' table');
    const vars = toml.slice(start, next < 0 ? undefined : next);
    const flipped = vars.replace('MCP_SERVER_ENABLED = "' + flag + '"', 'MCP_SERVER_ENABLED = "' + (flag === 'true' ? 'false' : 'true') + '"');
    assert.notEqual(flipped, vars, 'live flag mutation target');
    assert.throws(() => checkMcpDeployment(toml.replace(vars, flipped)), assert.AssertionError);
    const block = '[[' + scope + 'kv_namespaces]]\nbinding = "OAUTH_KV"\nid      = "' + id + '"';
    assert.ok(toml.includes(block), 'live namespace mutation target');
    const bad = ['# ' + block.replaceAll('\n', '\n# '), block + '\n' + block];
    if (scope === 'env.preview.') {
      // Preview back on HQ's OAuth store, or on any other HQ namespace.
      bad.push(block.replace(id, HQ_MCP_STORE_ID), block.replace(id, hqTokensId));
    } else {
      bad.push(block.replace(id, '0'.repeat(32)));
    }
    for (const replacement of bad) assert.throws(() => checkMcpDeployment(toml.replace(block, replacement)), assert.AssertionError);
    checkMcpDeployment(toml);
  }
  // Preview's own namespace, once provisioned, passes as the placeholder does.
  const preview = '[[env.preview.kv_namespaces]]\nbinding = "OAUTH_KV"\nid      = "' + PREVIEW_MCP_STORE_PLACEHOLDER + '"';
  checkMcpDeployment(toml.replace(preview, preview.replace(PREVIEW_MCP_STORE_PLACEHOLDER, 'f'.repeat(32))));
  assert.throws(() => checkMcpDeployment(toml + '\n# OAUTH_KV-PENDING'), assert.AssertionError);
  // A CLOUDFLARE_ENV in the test's environment never makes the top level read as another scope.
  const cloudflareEnv = process.env.CLOUDFLARE_ENV;
  try {
    for (const env of ['preview', 'production']) {
      process.env.CLOUDFLARE_ENV = env;
      checkMcpDeployment(toml);
      assert.equal(process.env.CLOUDFLARE_ENV, env, 'the read restores CLOUDFLARE_ENV');
    }
  } finally {
    if (cloudflareEnv === undefined) delete process.env.CLOUDFLARE_ENV;
    else process.env.CLOUDFLARE_ENV = cloudflareEnv;
  }
  checkMcpDeployment(toml);
});

test('D681 preview isolation: no [env.preview] D1 or KV store may name an id HQ binds, in any TOML spelling wrangler reads; its own ids pass', () => {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const hqTokensId = hqStoreId(toml, 'kv_namespaces', 'TOKENS', 'id');
  const hqD1Id = hqStoreId(toml, 'd1_databases', 'DB', 'database_id');
  const stores = [
    ['[[env.preview.kv_namespaces]]\nbinding = "OAUTH_KV"\nid      = ', PREVIEW_MCP_STORE_PLACEHOLDER, [HQ_MCP_STORE_ID, hqTokensId]],
    ['[[env.preview.kv_namespaces]]\nbinding = "TOKENS"\nid      = ', 'REPLACE_WITH_PREVIEW_KV_TOKENS_ID', [hqTokensId, HQ_MCP_STORE_ID]],
    ['[[env.preview.d1_databases]]\nbinding       = "DB"\ndatabase_name = "studioos-db-preview"\ndatabase_id   = ', 'REPLACE_WITH_PREVIEW_D1_ID', [hqD1Id]],
  ] as const;
  // Refused as HQ's store, not merely as unreadable.
  const refusesHqStore = (e: any) => e instanceof assert.AssertionError && /HQ's/.test(e.message);
  const refusesUnreadable = (e: any) => e instanceof assert.AssertionError && /wrangler cannot read/.test(e.message);
  // Table and key spellings TOML allows and a line-based parser skips: the
  // same table and key to wrangler, so the probe below must still refuse them.
  const tableSpellings: [string, (head: string) => string][] = [
    ['spaces inside the brackets', (h) => h.replace(/^\[\[env\.preview\.(\w+)\]\]/, '[[ env.preview.$1 ]]')],
    ['a quoted header segment', (h) => h.replace(/^\[\[env\.preview\./, '[[env."preview".')],
    ['a quoted key', (h) => h.replace(/\n(id|database_id)( *)= $/, '\n"$1"$2= ')],
  ];
  for (const [head, placeholder, hqIds] of stores) {
    const block = head + '"' + placeholder + '"';
    assert.ok(toml.includes(block), 'live preview store mutation target: ' + placeholder);
    const at = (value: string, h: string = head) => toml.replace(block, h + value);
    for (const hq of hqIds) {
      for (const spelling of [
        '"' + hq + '"', // basic string
        "'" + hq + "'", // literal string
        '"""' + hq + '"""', // multi-line basic string, on one line
        "'''" + hq + "'''", // multi-line literal string, on one line
        '"' + hq.toUpperCase() + '"', // the same id in capitals
        '"\\u' + hq.charCodeAt(0).toString(16).padStart(4, '0') + hq.slice(1) + '"', // its first character escaped
        '"' + hq + '"   # with a trailing comment',
      ]) {
        assert.throws(() => checkMcpDeployment(at(spelling)), refusesHqStore, placeholder + ' = ' + spelling);
      }
    }
    const own = 'e'.repeat(32);
    for (const [name, spell] of tableSpellings) {
      const h = spell(head);
      assert.notEqual(h, head, name + ' mutation target: ' + placeholder);
      for (const hq of hqIds) assert.throws(() => checkMcpDeployment(at('"' + hq + '"', h)), refusesHqStore, placeholder + ', ' + name + ', = ' + hq);
      checkMcpDeployment(at('"' + own + '"', h));
    }
    // An id that is not a TOML string fails closed rather than passing unread.
    for (const bare of [hqIds[0], own]) assert.throws(() => checkMcpDeployment(at(bare)), refusesUnreadable, placeholder + ' = ' + bare);
    // The store's own id passes, in each quoting.
    for (const spelling of ['"' + own + '"', "'" + own + "'", '"""' + own + '"""', "'''" + own + "'''"]) checkMcpDeployment(at(spelling));
  }
  // `wrangler dev`'s preview_id names a store too, and so does D1's
  // preview_database_id, under a bare or a quoted key.
  const tokens = stores[1][0] + '"' + stores[1][1] + '"';
  assert.throws(() => checkMcpDeployment(toml.replace(tokens, tokens + "\npreview_id = '" + hqTokensId + "'")), refusesHqStore);
  const d1 = stores[2][0] + '"' + stores[2][1] + '"';
  for (const key of ['preview_database_id', '"preview_database_id"']) {
    assert.throws(() => checkMcpDeployment(toml.replace(d1, d1 + '\n' + key + " = '" + hqD1Id + "'")), refusesHqStore, 'a ' + key);
    checkMcpDeployment(toml.replace(d1, d1 + '\n' + key + ' = "' + 'e'.repeat(32) + '"'));
  }
  // A store only wrangler sees, carrying one of HQ's ids, is refused too. A
  // line-based parser files these keys under the table above them, here
  // [env.preview.ai], and drops a quoted key, so it would read no store at all.
  const ai = '\n[env.preview.ai]\nbinding = "AI"\n';
  assert.ok(toml.includes(ai), 'live [env.preview.ai] mutation target');
  for (const [hidden, hq] of [
    ['[[ env.preview.kv_namespaces ]]\nbinding = "EXTRA"\nid      = ', hqTokensId],
    ['[[env."preview".kv_namespaces]]\nbinding = "EXTRA"\nid      = ', hqTokensId],
    ['[[ env.preview.d1_databases ]]\nbinding       = "EXTRA_DB"\ndatabase_name = "extra"\ndatabase_id   = ', hqD1Id],
  ]) {
    assert.throws(() => checkMcpDeployment(toml.replace(ai, ai + '\n' + hidden + '"' + hq + '"\n')), refusesHqStore, hidden);
    checkMcpDeployment(toml.replace(ai, ai + '\n' + hidden + '"' + 'e'.repeat(32) + '"\n'));
  }
  assert.throws(() => checkMcpDeployment(toml.replace(tokens, tokens + '\n"preview_id" = "' + hqTokensId + '"')), refusesHqStore, 'a quoted preview_id');
  // A store HQ binds in only one of its two scopes is still HQ's.
  const extra = 'd'.repeat(32);
  for (const scope of ['', 'env.production.']) {
    const hqOnly = toml.replace('[[' + scope + 'kv_namespaces]]', '[[' + scope + 'kv_namespaces]]\nbinding = "EXTRA"\nid      = "' + extra + '"\n\n[[' + scope + 'kv_namespaces]]');
    assert.notEqual(hqOnly, toml, 'live ' + (scope || 'top-level') + ' KV mutation target');
    checkMcpDeployment(hqOnly);
    assert.throws(() => checkMcpDeployment(hqOnly.replace(tokens, stores[1][0] + '"' + extra + '"')), refusesHqStore);
  }
  checkMcpDeployment(toml);
});

test('D681 every scope wrangler resolves: none declares `unsafe`, and an environment added beside production and preview keeps preview\'s rule', () => {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const hqD1Id = hqStoreId(toml, 'd1_databases', 'DB', 'database_id');
  const refusesUnsafe = (e: any) => e instanceof assert.AssertionError && /declares `unsafe`/.test(e.message);
  const refusesHqStore = (e: any) => e instanceof assert.AssertionError && /HQ's/.test(e.message);
  const refusesUnreadable = (e: any) => e instanceof assert.AssertionError && /wrangler cannot read/.test(e.message);
  const own = 'e'.repeat(32);
  // unsafe metadata bindings inline in [env.preview], naming HQ's D1 and OAuth namespace.
  const head = '\n[env.preview]\nname = "studioos-preview"\n';
  assert.ok(toml.includes(head), 'live [env.preview] mutation target');
  const inline = 'unsafe = { metadata = { bindings = [{ type = "d1", name = "HQ_DB", id = "' + hqD1Id + '" }, '
    + '{ type = "kv_namespace", name = "HQ_OAUTH", namespace_id = "' + HQ_MCP_STORE_ID + '" }] } }\n';
  assert.throws(() => checkMcpDeployment(toml.replace(head, head + inline)), refusesUnsafe, 'inline unsafe.metadata.bindings');
  // The [env.preview.unsafe] table form, with unsafe.bindings.
  const ai = '\n[env.preview.ai]\nbinding = "AI"\n';
  assert.ok(toml.includes(ai), 'live [env.preview.ai] mutation target');
  const table = '\n[env.preview.unsafe]\nbindings = [{ name = "HQ_OAUTH", type = "kv_namespace", namespace_id = "' + HQ_MCP_STORE_ID + '" }]\n';
  assert.throws(() => checkMcpDeployment(toml.replace(ai, ai + table)), refusesUnsafe, '[env.preview.unsafe]');
  // An environment the guard did not name before, on HQ's OAuth namespace.
  const inspector = (flag: string, id: string) => toml + '\n[env.inspector]\nname = "studioos-inspector"\n\n[env.inspector.vars]\n'
    + 'MCP_SERVER_ENABLED = "' + flag + '"\n\n[[env.inspector.kv_namespaces]]\nbinding = "OAUTH_KV"\nid      = "' + id + '"\n';
  for (const flag of ['true', 'false']) {
    assert.throws(() => checkMcpDeployment(inspector(flag, HQ_MCP_STORE_ID)), refusesHqStore, '[env.inspector] on HQ\'s OAuth namespace, MCP ' + flag);
  }
  assert.throws(() => checkMcpDeployment(inspector('true', own)), /MCP flag in \[env\.inspector\]/);
  checkMcpDeployment(inspector('false', own));
  // A D1 binding named only by database_name resolves to HQ's database at deploy.
  const inspectorD1 = (lines: string) => toml + '\n[env.inspector]\nname = "studioos-inspector"\n\n[env.inspector.vars]\n'
    + 'MCP_SERVER_ENABLED = "false"\n\n[[env.inspector.d1_databases]]\nbinding = "DB"\n' + lines;
  assert.throws(() => checkMcpDeployment(inspectorD1('database_name = "studioos-db"\n')), /names its database_id/, '[env.inspector] D1 by HQ\'s name, no id');
  assert.throws(() => checkMcpDeployment(inspectorD1('database_name = "inspector-db"\ndatabase_id = ""\n')), /names its database_id/, '[env.inspector] D1 with an empty id');
  assert.throws(() => checkMcpDeployment(inspectorD1('database_name = "studioos-db"\ndatabase_id = "' + own + '"\n')), /HQ's database_name/, '[env.inspector] D1 under HQ\'s name');
  assert.throws(() => checkMcpDeployment(toml + '\n[env.inspector]\nname = "studioos-inspector"\n\n[env.inspector.vars]\nMCP_SERVER_ENABLED = "false"\n\n[[env.inspector.kv_namespaces]]\nbinding = "OAUTH_KV"\n'), /names its id/, '[env.inspector] KV with no id');
  checkMcpDeployment(inspectorD1('database_name = "inspector-db"\ndatabase_id = "' + own + '"\n'));
  // An environment wrangler cannot read fails rather than passing unread.
  assert.throws(() => checkMcpDeployment(toml + '\n[env.inspector]\nname = 5\n'), refusesUnreadable);
  checkMcpDeployment(toml);
});

test('wrangler.toml: /mcp and both discovery paths run the Worker first, no MCP route was added and the Worker entry stays the same', () => {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const rwf = [...toml.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(rwf.length, 2, 'the top-level and production [assets] blocks ([env.preview] has none)');
  for (const list of rwf) {
    assert.ok(list.includes('/.well-known/oauth-authorization-server*'));
    assert.ok(list.includes('/.well-known/oauth-protected-resource*'));
    assert.ok(list.includes('/api/*'));
    // D784: the MCP server is not under /api, so the SPA's fallback must not answer it.
    assert.ok(list.includes('/mcp'), '/mcp runs the Worker first');
    assert.ok(list.includes('/mcp/*'), '/mcp/* runs the Worker first');
  }
  assert.doesNotMatch(toml, /pattern\s*=\s*"[^"]*(\/mcp|well-known|oauth)/, 'no route for the MCP paths');
  assert.match(toml, /^main = "cloudflare-worker\/src\/index\.ts"$/m);
});

// D669's regression probes reuse the real OAuth/SQLite fixture.
export { fixture, register, authorize, asUser, requestIdOf, connect, mcp, callTool, toolJson };
