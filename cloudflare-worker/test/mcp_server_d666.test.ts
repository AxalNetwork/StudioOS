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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st8', resource: `${ORIGIN}/api/mcp`, scope: 'validate:read interviews:submit' });
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
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: `${ORIGIN}/api/mcp` }) });
  assert.equal(t.status, 200, await t.clone().text());
  return { token: (await t.json() as any).access_token as string, clientId };
}

let rpcId = 0;
async function mcp(env: any, token: string | null, method: string, params: unknown = {}) {
  const r = await hit(env, '/api/mcp', { method: 'POST', headers: {
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
    for (const path of ['/api/mcp', '/api/oauth/authorize', '/api/oauth/token', '/api/oauth/register',
      '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/api/mcp']) {
      for (const method of ['GET', 'POST']) assert.equal((await hit(env, path, { method })).status, 404, `${method} ${path}`);
    }
    assert.equal((await asUser(env, FOUNDER, 'GET', '/api/mcp/consent/' + 'a'.repeat(32))).status, 404);
    assert.equal((await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).status, 404);
  }
  assert.equal(isMcpPath('/api/mcp/consent/abc'), false, 'consent is the SPA\'s, through the app');
  assert.equal(isMcpPath('/api/connectors'), false);
});

// ── Discovery and the resource ─────────────────────────────────────────────

test('discovery names https://axal.vc/api/mcp and S256 only; an unauthenticated call gets 401 naming the metadata', async () => {
  const { env } = fixture();
  const as = await (await hit(env, '/.well-known/oauth-authorization-server')).json() as any;
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.token_endpoint, `${ORIGIN}/api/oauth/token`);
  assert.equal(as.registration_endpoint, `${ORIGIN}/api/oauth/register`);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/api/oauth/authorize`);
  const pr = await (await hit(env, '/.well-known/oauth-protected-resource/api/mcp')).json() as any;
  assert.equal(pr.resource, `${ORIGIN}/api/mcp`);
  assert.deepEqual(pr.authorization_servers, [ORIGIN]);
  const r = await mcp(env, null, 'tools/list');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/axal\.vc\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
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

test('consent: the page reads name, host and grantable companies; approve refuses a company the caller cannot write to', async () => {
  const { env } = fixture();
  const id = requestIdOf(await authorize(env, await register(env, 'Claude')));
  const read = await asUser(env, FOUNDER, 'GET', `/api/mcp/consent/${id}`);
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.client_name, read.body.redirect_host], ['Claude', 'client.example']);
  assert.deepEqual(read.body.companies.map((c: any) => c.id), [P, P2], 'only the founder\'s own companies');
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [P, P_OTHER] })).status, 403);
  assert.equal((await asUser(env, FOUNDER, 'POST', `/api/mcp/consent/${id}/approve`, { companies: [] })).status, 400);
  // An admin can write to every project, but is offered none: staff are not founders of these.
  assert.deepEqual((await asUser(env, ADMIN, 'GET', `/api/mcp/consent/${id}`)).body.companies, []);
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
  assert.deepEqual(list.body.result.tools.map((t: any) => t.name).sort(), ['get_interview_guide', 'get_validate_context', 'list_companies']);
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
  assert.match(toolJson(lost).error, /can no longer write to that company/);
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

test('wrangler.toml: the two discovery paths run the Worker first, the flag is "false" everywhere, OAUTH_KV is pending in all three blocks, and no route was added', () => {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const rwf = [...toml.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(rwf.length, 2, 'the top-level and production [assets] blocks ([env.preview] has none)');
  for (const list of rwf) {
    assert.ok(list.includes('/.well-known/oauth-authorization-server*'));
    assert.ok(list.includes('/.well-known/oauth-protected-resource*'));
    assert.ok(list.includes('/api/*'));
  }
  assert.deepEqual([...toml.matchAll(/^MCP_SERVER_ENABLED = "(.*)"$/gm)].map((m) => m[1]), ['false', 'false', 'false']);
  for (const env of ['', 'env.production.', 'env.preview.']) {
    assert.ok(toml.includes(`# [[${env}kv_namespaces]]\n# binding = "OAUTH_KV"`), `OAUTH_KV pending in ${env || 'top-level'}`);
  }
  assert.equal((toml.match(/OAUTH_KV-PENDING/g) || []).length, 3);
  assert.doesNotMatch(toml, /pattern\s*=\s*"[^"]*(\/api\/mcp|well-known|oauth)/, 'no route for the MCP paths');
  assert.match(toml, /^main = "cloudflare-worker\/src\/index\.ts"$/m);
});
