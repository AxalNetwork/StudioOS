/**
 * D1316 (#3474) — Builder part 1, the Worker: the assistants overview read,
 * the grants read that grows (scopes, the recognised assistant, each company's
 * still_owned, the last call and 30-day counts from the call log), and the
 * grant and refusal reason the call log keeps. The OAuth flow runs for real
 * against @cloudflare/workers-oauth-provider over an in-memory KV and SQLite
 * D1, as D666's test does.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/developer_assistants_d1316.test.ts
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
import { developerAssistants } from '../src/routes/developer_assistants.ts';
import { callTool as runTool, registeredTools, TOOL_TIMEOUT_MS } from '../src/mcp/server.ts';
import { GRANT_CALLS_PER_MINUTE, USER_CALLS_PER_MINUTE, REFUSAL_REASONS } from '../src/mcp/grants.ts';
import { LIMITS, ToolError } from '../src/services/assistantInterviews.ts';
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
spa.route('/api/developer/assistants', developerAssistants);
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


const logLines = (db: any) => db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'mcp_tool_call' ORDER BY id").all()
  .map((r: any) => ({ user: r.user_id, ...JSON.parse(r.details) }));

// ── The overview ───────────────────────────────────────────────────────────

test('overview: 404 with the flag off, 401 signed out; the server, scopes, tools by their listed name, the limits in force', async () => {
  assert.equal((await asUser(fixture({ enabled: false }).env, FOUNDER, 'GET', '/api/developer/assistants/overview')).status, 404);
  const { env } = fixture();
  assert.equal((await quiet(() => spa.request('/api/developer/assistants/overview', {}, env))).status, 401);
  const r = await asUser(env, FOUNDER, 'GET', '/api/developer/assistants/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.server_url, 'https://axal.vc/mcp');
  assert.deepEqual(r.body.scopes.map((s: any) => s.scope), ['validate:read', 'validate:write', 'build:read', 'raise:read', 'connectors:read']);
  assert.ok(r.body.scopes.every((s: any) => typeof s.label === 'string' && s.label.length > 0));
  const names = r.body.tools.map((t: any) => t.name);
  assert.deepEqual(names, registeredTools().map((t) => t.name));
  assert.ok(names.includes('structure_with_axalvc'));
  assert.ok(!names.includes('structure_with_studioos'), 'an alias is never listed');
  const write = r.body.tools.find((t: any) => t.name === 'structure_with_axalvc');
  assert.deepEqual([write.required_scope, write.read_only], ['validate:write', false]);
  assert.equal(r.body.tools.find((t: any) => t.name === 'list_companies').read_only, true);
  assert.deepEqual(r.body.limits, {
    window_seconds: 60, per_connection_per_minute: GRANT_CALLS_PER_MINUTE, per_member_per_minute: USER_CALLS_PER_MINUTE,
    tool_timeout_ms: TOOL_TIMEOUT_MS, interview_submissions_per_day: LIMITS.submissionsPerDay, placements_per_day: LIMITS.placementsPerDay,
  });
  assert.deepEqual([r.body.can_grant, r.body.grantable_count], [true, 2]);
  const admin = await asUser(env, ADMIN, 'GET', '/api/developer/assistants/overview');
  assert.deepEqual([admin.body.can_grant, admin.body.grantable_count], [false, 0], 'no venture of their own to connect');
});

// ── The call log keeps the grant and the refusal reason ────────────────────

const probe = (o: Record<string, unknown> = {}) => ({
  name: 'probe_tool', requiredScope: 'validate:read', source: 'axal', version: '1.0.0', title: 'Probe', description: 'A test tool.',
  inputSchema: {}, company: true, readOnly: true, run: async () => ({ ok: true }), ...o,
}) as any;
const props = (o: Record<string, unknown> = {}) => ({
  userId: FOUNDER, clientId: 'c1', companies: [P, P_OTHER], clientName: 'Claude', redirectHost: 'client.example', redirectUri: REDIRECT,
  grantedAt: Math.floor(Date.now() / 1000) - 10, ...o,
}) as any;

test('call log: each call names its grant; a refusal its reason; an API key call no grant; never an argument', async () => {
  const { db, env } = fixture();
  const secret = 'Zelda-said-something-private';
  await quiet(() => runTool(env, props(), 'grant-1', probe(), { company: P, note: secret }, ['validate:read']));
  await quiet(() => runTool(env, props(), 'grant-1', probe(), { company: P2 }, ['validate:read']));
  await quiet(() => runTool(env, props(), 'grant-1', probe(), { company: P_OTHER }, ['validate:read']));
  await quiet(() => runTool(env, props(), 'grant-1', probe({ requiredScope: 'build:read' }), { company: P }, ['validate:read']));
  await quiet(() => runTool(env, props(), 'grant-1', probe({ company: false, run: async () => { throw new ToolError(429, 'daily_limit', 'Try tomorrow.'); } }), {}, ['validate:read']));
  await quiet(() => runTool(env, props({ keyUid: 'key-1', clientId: 'apikey:key-1' }), null, probe(), { company: P }, ['validate:read']));
  const lines = logLines(db);
  assert.deepEqual(lines.map((l: any) => [l.outcome, l.grant ?? null, l.reason ?? null]), [
    ['ok', 'grant-1', null],
    ['refused', 'grant-1', 'not_granted'],
    ['refused', 'grant-1', 'not_owned'],
    ['refused', 'grant-1', 'scope'],
    ['refused', 'grant-1', 'daily_limit'],
    ['ok', null, null],
  ]);
  assert.equal(lines[5].api_key_uid, 'key-1', 'a key\'s call names the key, not a grant');
  assert.ok(!JSON.stringify(lines).includes(secret), 'no argument is logged');
  for (const l of lines) if (l.reason) assert.ok((REFUSAL_REASONS as readonly string[]).includes(l.reason));
});

// ── The grants read grows ──────────────────────────────────────────────────

test('grants: scopes, the recognised assistant, each company\'s still_owned, the last call and 30-day counts from the call log', async () => {
  const { db, env } = fixture();
  const { token } = await connect(env, [P, P2]);
  await callTool(env, token, 'list_companies');
  await callTool(env, token, 'get_validate_context', { company: P });
  await callTool(env, token, 'get_validate_context', { company: P_OTHER });
  // Tenancy: another member's line that names this grant is never counted.
  const gid = (await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants[0].id;
  db.prepare("INSERT INTO activity_logs (user_id, action, details) VALUES (?, 'mcp_tool_call', ?)")
    .run(OTHER, JSON.stringify({ tool: 'x', outcome: 'ok', grant: gid }));
  // The founder leaves the second venture.
  db.exec(`UPDATE projects SET founder_id = 1002 WHERE id = ${P2}`);
  const g = (await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants[0];
  assert.deepEqual(g.scopes, ['validate:read', 'validate:write']);
  assert.deepEqual([g.verified_assistant, g.assistant_label], [null, 'Unverified assistant'], 'recognised from the callback, never the self-declared name');
  assert.deepEqual(g.companies.map((c: any) => [c.name, c.still_owned]), [['Acme', true], ['Second', false]]);
  assert.match(g.last_call_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(g.last_call_source, 'call_log');
  assert.deepEqual(g.calls_30d, { total: 3, ok: 2, refused: 1, rate_limited: 0, failed: 0 });
  assert.ok(!JSON.stringify(g).includes(token.split(':')[2]), 'no token');
  // A line older than 30 days is the last call only if nothing newer exists, and is never counted.
  db.exec("UPDATE activity_logs SET created_at = '2020-01-01 00:00:00' WHERE action = 'mcp_tool_call'");
  const old = (await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants[0];
  assert.equal(old.last_call_at, '2020-01-01T00:00:00Z');
  assert.equal(old.calls_30d.total, 0);
  // Another member sees none of it.
  assert.deepEqual((await asUser(env, OTHER, 'GET', '/api/connectors/assistants')).body.grants, []);
});

test('grants: a recognised assistant by its callback; before any logged call the last use is the KV key; an unreadable log is null, never 0', async () => {
  const { db, env } = fixture();
  const { token } = await connect(env, [P]);
  // A grant whose callback is Claude's own is recognised as Claude.
  const helpers = (await import('../src/mcp/oauth.ts')).oauthHelpers(env);
  const page = await helpers.listUserGrants(String(FOUNDER));
  const { assistantIdentity } = await import('../src/mcp/assistantIdentity.ts');
  assert.deepEqual(assistantIdentity('https://claude.ai/api/mcp/auth_callback'), { verified_assistant: 'Claude', assistant_label: 'Claude' });
  assert.equal(page.items.length, 1);
  await callTool(env, token, 'list_companies');
  db.exec("DELETE FROM activity_logs WHERE action = 'mcp_tool_call'");
  const kv = (await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants[0];
  assert.equal(kv.last_call_source, 'last_use');
  assert.match(kv.last_call_at, /^\d{4}-/);
  assert.deepEqual(kv.calls_30d, { total: 0, ok: 0, refused: 0, rate_limited: 0, failed: 0 });
  db.exec('DROP TABLE activity_logs');
  const gone = (await asUser(env, FOUNDER, 'GET', '/api/connectors/assistants')).body.grants[0];
  assert.equal(gone.calls_30d, null, 'an unreadable log is not zero calls');
  assert.equal(gone.last_call_source, 'last_use');
});

// ── The admin panel is retired ─────────────────────────────────────────────

test('the admin panel\'s three routes and their three clients are gone together', () => {
  const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
  const settings = read('cloudflare-worker/src/routes/settings.ts');
  assert.doesNotMatch(settings, /settings\.(get|put|post)\('\/developer/);
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /\/settings\/developer/);
  assert.throws(() => read('frontend/src/pages/account/AccountDeveloper.jsx'));
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/developer\/assistants', developerAssistants\);/);
  assert.match(read('frontend/src/lib/api/assistants.js'), /overview: \(\) => request\('\/developer\/assistants\/overview'\)/);
});
