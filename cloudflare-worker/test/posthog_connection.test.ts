/**
 * D1385 (#3731, #2409 part 1) — a founder's own PostHog, through PostHog's
 * hosted MCP server, against the fake (`_posthog_mcp_fake.mjs`). No test
 * reaches a real provider host. Every value is invented.
 *
 *  1. The record: 19 read tools, none forbidden; six read scopes, the
 *     identity scopes accepted; the fixed headers; the CIMD document with its
 *     scope ceiling.
 *  2. Sign in end to end: the six scopes asked for; one `oauth_mcp` row.
 *  3. A write scope in the grant is refused with `scope_refused` and revoked.
 *  4. A support session is refused at sign-in, at connect and on the project
 *     routes; a token paste is refused; a support session may disconnect.
 *  5. The typed reads: read-only and tools mode on every request, the project
 *     header only when pinned; no person or visit identifier leaves reads.ts.
 *  6. Read-only: a forbidden tool is refused before any request; a query of
 *     another kind, HogQL and a bad id are refused before any request.
 *  7. Refresh: rotated and stored; a refused refresh marks the row `error`.
 *  8. "Your PostHog projects": the ventures and choices; link, change and
 *     unlink; one project per venture, a teammate named; a project the
 *     member's PostHog does not list is refused; a failed read blanks the
 *     choices only; nothing named is logged.
 *  9. The source and the shared registrations hold PostHog.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_connection.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { createMcpOauthRouter, CSRF_COOKIE } from '../src/routes/connector_mcp_oauth.ts';
import integrations from '../src/routes/integrations.ts';
import { createPosthogRouter } from '../src/routes/posthog.ts';
import '../src/integrations/providers/posthog.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { openMcpSession, McpClientError } from '../src/integrations/mcpClient.ts';
import { genericMcpProvider, mcpCimdUrl } from '../src/integrations/mcpSignIn.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { POSTHOG_FEEDS } from '../src/integrations/posthogFeeds.ts';
import { CATEGORY_ORDER, CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { POSTHOG_MCP_URL, POSTHOG_READ_TOOLS, PosthogReadError, posthogReadsFor, scrub } from '../src/services/posthog/reads.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { mig } from './_mercury_d713.ts';
import {
  FAKE_POSTHOG_FORBIDDEN_TOOLS, INSIGHT_A, ORG_A, PERSON, POSTHOG_ISSUER, PROJECT_A, PROJECT_B, READ_TOOLS, SURVEY_A, posthogFake,
} from './_posthog_mcp_fake.mjs';

const POSTHOG = MCP_PROVIDERS.posthog;
const BASE = '/api/integrations/mcp/posthog';
const COMPANY = 77;
const SIX = ['organization:read', 'insight:read', 'query:read', 'experiment:read', 'survey:read', 'feature_flag:read'];

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(opts: { scope?: string | null } = {}) {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  // A co-founder on the same ventures, and a venture in a company PostHog is not switched on for.
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (3, 'Elsewhere', 100, 88)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY}), (10, 88)`);
  db.exec(mig('657_posthog_project_links.sql'));
  env.RATE_LIMITS = memoryKv();
  const fake = posthogFake({ scope: opts.scope });
  return { db, env, fake };
}

const ROLES: Record<number, string> = { 10: 'founder', 11: 'founder', 20: 'partner', 1: 'admin' };

async function bearer(env: any, who: number, impersonated = false) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  return `Bearer ${jwt}`;
}

function appFor(fake: any) {
  const app = new Hono<any>();
  // The real record, routes and registry: only the network is the fake's.
  app.route('/api/integrations/mcp', createMcpOauthRouter({ fetcher: fake.fetch }));
  app.route('/api/connectors', createPosthogRouter({ fetcher: fake.fetch }));
  app.route('/api/connectors', integrations);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return app;
}

async function req(app: Hono<any>, env: any, who: number, path: string, o: { method?: string; cookie?: string; impersonated?: boolean; company?: number; body?: unknown } = {}) {
  const headers: Record<string, string> = { Authorization: await bearer(env, who, o.impersonated) };
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.company) headers['X-Company-Id'] = String(o.company);
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a redirect */ }
  return { status: res.status, body, text, location: res.headers.get('Location'), setCookie: res.headers.get('Set-Cookie') };
}

async function signIn(app: Hono<any>, env: any, fake: any, who = 10) {
  const start = await req(app, env, who, `${BASE}/start`, { company: COMPANY });
  assert.equal(start.status, 200, start.text);
  const u = new URL(start.body.authorize_url);
  const p = Object.fromEntries(u.searchParams);
  const cookie = new RegExp(`${CSRF_COOKIE}=([^;]+)`).exec(start.setCookie || '')![1];
  const { code } = fake.authorize({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge });
  const cb = await req(app, env, who, `${BASE}/callback?${new URLSearchParams({ code, state: p.state })}`, { cookie: `${CSRF_COOKIE}=${cookie}` });
  return { start, params: p, url: u, cb };
}

const row = (db: any, user = 10) => db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'posthog'").get(user) as any;
const enable = (db: any, integrationId: number, company = COMPANY) =>
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1').run(integrationId, company);

test('1. the record: 19 read tools and none forbidden; six read scopes; fixed headers; the CIMD document and its ceiling', async () => {
  assert.deepEqual([...POSTHOG.read_tools], READ_TOOLS);
  assert.equal(POSTHOG.read_tools.length, 19);
  assert.equal(POSTHOG_READ_TOOLS, POSTHOG.read_tools, 'reads.ts re-exports the record, not a copy');
  for (const t of POSTHOG.read_tools) {
    assert.doesNotMatch(t, /-actors|actors-|^exec$|execute-sql|persons|recording|cohort|-create|-update|-delete|-partial/, t);
  }
  for (const t of FAKE_POSTHOG_FORBIDDEN_TOOLS) assert.ok(!POSTHOG.read_tools.includes(t), t);
  assert.deepEqual([...POSTHOG.write_tools], []);
  assert.equal(POSTHOG.publish_issue, null);
  assert.deepEqual([...POSTHOG.scopes], SIX);
  assert.deepEqual([...POSTHOG.accepted_scopes].sort(), [...SIX, 'openid', 'profile', 'email'].sort());
  assert.ok(!POSTHOG.accepted_scopes.some((s) => /:write$/.test(s)), 'no write scope is accepted');
  assert.deepEqual({ ...POSTHOG.headers }, { 'x-posthog-read-only': 'true', 'x-posthog-mcp-mode': 'tools' });
  assert.deepEqual(Object.keys(POSTHOG.connection_headers!), ['x-posthog-project-id']);
  assert.deepEqual([...POSTHOG.resources], [POSTHOG_MCP_URL]);
  assert.deepEqual([...POSTHOG.registration], ['cimd', 'dcr']);
  assert.equal(POSTHOG.cimd_url, mcpCimdUrl('posthog'));
  assert.equal(genericMcpProvider(MCP_PROVIDERS, 'posthog'), POSTHOG, 'the generic sign-in serves PostHog');

  const doc = await (await createMcpOauthRouter().request('/posthog/client.json')).json() as any;
  assert.equal(doc.client_id, POSTHOG.cimd_url);
  assert.equal(doc.scope, SIX.join(' '));
  assert.equal(doc['com.posthog.scopes'], SIX.join(' '), 'the scope ceiling is declared');
  assert.deepEqual(doc.redirect_uris, ['https://axal.vc/api/integrations/mcp/posthog/callback', 'https://app.axal.vc/api/integrations/mcp/posthog/callback']);
  const notion = await (await createMcpOauthRouter().request('/notion/client.json')).json() as any;
  assert.equal(notion['com.posthog.scopes'], undefined, 'another record\'s document carries no PostHog field');
});

test('2. sign in end to end: the six scopes asked for, identity scopes accepted, one oauth_mcp row', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  const first = await signIn(app, env, fake);
  assert.equal(first.url.origin, POSTHOG_ISSUER);
  assert.deepEqual(first.url.searchParams.get('scope')!.split(' '), SIX);
  assert.equal(first.url.searchParams.get('resource'), POSTHOG_MCP_URL);
  assert.equal(new URL(first.cb.location!, 'https://axal.vc').searchParams.get('oauth'), 'ok', first.cb.location!);
  const r = row(db);
  assert.equal(r.auth_type, 'oauth_mcp');
  assert.equal(r.status, 'active');
  assert.doesNotMatch(r.credentials_enc, /fake-access|fake-refresh/);
  const creds = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  assert.equal(creds.resource, POSTHOG_MCP_URL);
  assert.deepEqual([...creds.scopes].sort(), [...SIX, 'openid', 'email'].sort());
  await signIn(app, env, fake);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'posthog'").get().n, 1, 'one row per member');
});

test('3. a grant with a write scope is refused with scope_refused and revoked', async () => {
  const { db, env, fake } = await setup({ scope: `${SIX.join(' ')} insight:write` });
  const { cb } = await signIn(appFor(fake), env, fake);
  const back = new URL(cb.location!, 'https://axal.vc').searchParams;
  assert.equal(back.get('oauth'), 'error');
  assert.equal(back.get('reason'), 'scope_refused');
  assert.equal(row(db), undefined);
  assert.ok(fake.state.revoked.length > 0, 'the grant is revoked');
});

test('4. a support session is refused at sign-in, connect and the project routes; a paste is refused; it may disconnect', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  const before = fake.calls.length;
  const start = await req(app, env, 10, `${BASE}/start`, { impersonated: true, company: COMPANY });
  assert.equal(start.status, 403);
  assert.equal(start.body.error ?? start.body.code, 'support_session_refused');
  assert.equal(fake.calls.length, before, 'nothing reached PostHog');
  const support = await req(app, env, 10, '/api/connectors/connect', { method: 'POST', impersonated: true, company: COMPANY, body: { provider_key: 'posthog', api_key: 'fixture-not-a-key' } });
  assert.equal(support.status, 403, support.text);
  const paste = await req(app, env, 10, '/api/connectors/connect', { method: 'POST', company: COMPANY, body: { provider_key: 'posthog', api_key: 'fixture-not-a-key' } });
  assert.equal(paste.status, 410, paste.text);
  assert.equal(paste.body.code ?? paste.body.error, 'sign_in_only');
  assert.equal(row(db), undefined, 'nothing was stored');

  await signIn(app, env, fake);
  const r = row(db);
  enable(db, r.id);
  const n = fake.calls.length;
  for (const method of ['GET', 'PUT']) {
    const out = await req(app, env, 10, `/api/connectors/${r.uid}/posthog-projects`, { method, impersonated: true, body: method === 'PUT' ? { project_id: 1, posthog_project_id: PROJECT_A } : undefined });
    assert.equal(out.status, 403, `${method} ${out.text}`);
    assert.equal(out.body.error, 'support_session_refused');
  }
  assert.equal(fake.calls.length, n, 'nothing reached PostHog for a support session');
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch as any;
  try {
    const out = await req(app, env, 10, `/api/connectors/${r.uid}`, { method: 'DELETE', impersonated: true });
    assert.equal(out.status, 200, out.text);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(fake.state.revoked.sort(), ['access_token', 'refresh_token']);
  assert.equal(row(db), undefined, 'the row is deleted');
});

test('5. the typed reads: read-only and tools mode on every request, the project pinned only when given, no person leaves reads.ts', async () => {
  const { db, env, fake } = await setup();
  await signIn(appFor(fake), env, fake);
  const open = await posthogReadsFor(env, row(db), { fetcher: fake.fetch });
  assert.deepEqual([...open.offered].sort(), [...READ_TOOLS].sort(), 'the server offers more; only the 19 are usable');
  assert.deepEqual(await open.organizations(), [{ id: ORG_A, name: 'Fixture Org' }]);
  assert.deepEqual(await open.projects(), [
    { id: PROJECT_A, name: 'Fixture web app', organization_id: ORG_A, region: 'EU' },
    { id: PROJECT_B, name: 'Fixture mobile', organization_id: ORG_A, region: 'US' },
  ], 'a project whose id is not digits is dropped');
  assert.ok(fake.sent.length > 0);
  assert.ok(fake.sent.every((h: any) => h.readOnly === 'true' && h.mode === 'tools'), 'read-only and tools mode on every request');
  assert.ok(fake.sent.every((h: any) => h.project === null), 'no project header unless pinned');

  fake.sent.length = 0;
  const reads = await posthogReadsFor(env, row(db), { fetcher: fake.fetch, projectId: PROJECT_A });
  assert.ok(fake.sent.every((h: any) => h.project === PROJECT_A && h.readOnly === 'true'), 'the pinned project rides every request');
  assert.deepEqual((await reads.insights('  weekly  ')).map((i) => [i.short_id, i.kind]), [[INSIGHT_A, 'TrendsQuery']]);
  assert.deepEqual(fake.args.at(-1), { tool: 'insights-list', args: { search: 'weekly' } });
  const insight = await reads.insight(INSIGHT_A);
  assert.equal(insight.name, 'Weekly active users');
  const everything = JSON.stringify([
    await reads.runInsight(INSIGHT_A),
    await reads.trends({ series: [{ event: '$pageview' }] }),
    await reads.funnel({}), await reads.retention({}), await reads.lifecycle({}),
    await reads.webOverview({ date_from: '-7d' }),
    await reads.experiments(), await reads.experiment('7'), await reads.experimentResults(7),
    await reads.surveys(), await reads.survey(SURVEY_A), await reads.surveyStats(SURVEY_A), await reads.surveyResponses(SURVEY_A),
    await reads.flags(), await reads.flag(3),
  ]);
  for (const id of ['d-1', 'd-2', 'd-3', 'd-4', 's-1', 's-2', PERSON, '203.0.113.9', 'distinct_id', 'session_id']) {
    assert.ok(!everything.includes(id), `${id} left reads.ts`);
  }
  assert.deepEqual(await reads.surveyResponses(SURVEY_A), [{ at: '2026-10-21T09:00:00Z', answers: { $survey_response: 'We\'d pay if it synced with our calendar.' } }], 'an answer and its time, never who gave it');
  assert.deepEqual(await reads.flags(), [{ id: '3', key: 'new-onboarding', name: 'New onboarding', active: true, rollout_percentage: 25 }]);
  const sentKinds = fake.args.filter((a: any) => a.tool.startsWith('query-') && a.tool !== 'query-web-overview').map((a: any) => [a.tool, a.args.query.kind]);
  assert.deepEqual(sentKinds, [['query-trends', 'TrendsQuery'], ['query-funnel', 'FunnelsQuery'], ['query-retention', 'RetentionQuery'], ['query-lifecycle', 'LifecycleQuery']]);
  assert.equal(new Set(fake.args.map((a: any) => a.tool)).size, 19, 'every read tool was called through its typed read');
  // A caller's `kind: undefined` never strips the read's own kind.
  await reads.trends({ kind: undefined, series: [] } as any);
  assert.equal(fake.args.at(-1).args.query.kind, 'TrendsQuery');
  assert.deepEqual(scrub({ a: { distinct_id: 'x', b: [{ $session_id: 'y', c: 1 }], persons: [1] } }), { a: { b: [{ c: 1 }] } });
});

test('6. read-only: forbidden tools, another query kind, HogQL and bad ids are refused before any request', async () => {
  const { db, env, fake } = await setup();
  await signIn(appFor(fake), env, fake);
  const reads = await posthogReadsFor(env, row(db), { fetcher: fake.fetch, projectId: PROJECT_A });
  const creds = await decryptCredentials(env, row(db).uid, row(db).credentials_enc) as any;
  const session = await openMcpSession(POSTHOG, { accessToken: creds.access_token, fetcher: fake.fetch, resource: POSTHOG_MCP_URL });
  const calls = fake.calls.length;
  for (const name of FAKE_POSTHOG_FORBIDDEN_TOOLS) {
    await assert.rejects(session.callTool(name, {}), (e: any) => e instanceof McpClientError && e.code === 'path_not_allowed', name);
  }
  assert.equal(fake.calls.length, calls, 'refused before any request');
  const refused: Array<[() => Promise<unknown>, string]> = [
    [() => reads.trends({ kind: 'HogQLQuery', query: 'select * from persons' }), 'bad_query'],
    [() => reads.funnel({ kind: 'TrendsQuery' }), 'bad_query'],
    [() => reads.retention({ series: [{ query: 'select 1' }] }), 'bad_query'],
    [() => reads.webOverview({ date_from: 'yesterday; drop' }), 'bad_query'],
    [() => reads.insight('../secrets'), 'bad_id'],
    [() => reads.survey('svy 1'), 'bad_id'],
    [() => reads.flag('3?x=1'), 'bad_id'],
  ];
  for (const [fn, code] of refused) {
    const n = fake.calls.length;
    await assert.rejects(fn(), (e: any) => e instanceof PosthogReadError && e.code === code);
    assert.equal(fake.calls.length, n, 'nothing was sent');
  }
  // A connection header off its pattern, or one standing in for read-only mode, is refused before any request.
  for (const headers of [{ 'x-posthog-project-id': '42; drop' }, { 'x-posthog-read-only': 'false' }, { 'x-posthog-organization-id': ORG_A }]) {
    const n = fake.calls.length;
    await assert.rejects(openMcpSession(POSTHOG, { accessToken: creds.access_token, fetcher: fake.fetch, headers }), (e: any) => e instanceof McpClientError && e.code === 'path_not_allowed', JSON.stringify(headers));
    assert.equal(fake.calls.length, n);
  }
  await assert.rejects(posthogReadsFor(env, row(db), { fetcher: fake.fetch, projectId: '42abc' }), (e: any) => e instanceof PosthogReadError && e.code === 'bad_id');
  assert.deepEqual(fake.forbiddenCalls(), [], 'no forbidden tool was ever called');
});

test('7. refresh: a token about to expire is refreshed and stored; a refused refresh marks the row error', async () => {
  const { db, env, fake } = await setup();
  await signIn(appFor(fake), env, fake);
  const r = row(db);
  const old = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(env, r.uid, { ...old, expires_at: Date.now() + 1000 }), r.id);
  await posthogReadsFor(env, row(db), { fetcher: fake.fetch });
  const fresh = await decryptCredentials(env, r.uid, row(db).credentials_enc) as any;
  assert.notEqual(fresh.refresh_token, old.refresh_token, 'the rotated refresh token is stored');
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(env, r.uid, { ...fresh, expires_at: Date.now() + 1000 }), r.id);
  fake.state.access.delete(fresh.access_token);
  fake.state.failRefresh = 2;
  await assert.rejects(posthogReadsFor(env, row(db), { fetcher: fake.fetch }), (e: any) => e instanceof PosthogReadError && e.code === 'unauthorized');
  assert.equal(row(db).status, 'error');
  await assert.rejects(posthogReadsFor(env, { ...row(db), auth_type: 'api_key' }, { fetcher: fake.fetch }), (e: any) => e instanceof PosthogReadError && e.code === 'not_connected');
});

test('8. Your PostHog projects: link, change, unlink; one project per venture with the teammate named; refusals; nothing named logged', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  await signIn(app, env, fake);
  const mine = row(db);
  const path = `/api/connectors/${mine.uid}/posthog-projects`;

  // Sign-in switched PostHog on for the active company; switched off, there is no venture to link.
  db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(mine.id);
  let got = await req(app, env, 10, path);
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.body.ventures, []);
  enable(db, mine.id);
  got = await req(app, env, 10, path);
  assert.deepEqual(got.body.ventures.map((v: any) => [v.project_id, v.name, v.link, v.served_by]), [[2, 'Second', null, null], [1, 'Venture', null, null]], 'only the switched-on company\'s ventures');
  assert.deepEqual(got.body.choices.map((c: any) => c.id), [PROJECT_A, PROJECT_B]);
  assert.equal(got.body.choices_error, null);

  // Link, then change.
  let put = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 1, posthog_project_id: PROJECT_A } });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual([put.body.link.posthog_project_id, put.body.link.name, put.body.link.region], [PROJECT_A, 'Fixture web app', 'EU']);
  put = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 1, posthog_project_id: PROJECT_B } });
  assert.equal(put.body.link.posthog_project_id, PROJECT_B);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posthog_project_links WHERE project_id = 1').get().n, 1, 'one link per venture');

  // The co-founder's own PostHog: the venture is named as served, and cannot be taken over.
  await signIn(app, env, fake, 11);
  const theirs = row(db, 11);
  enable(db, theirs.id);
  const theirPath = `/api/connectors/${theirs.uid}/posthog-projects`;
  const seen = await req(app, env, 11, theirPath);
  const v1 = seen.body.ventures.find((v: any) => v.project_id === 1);
  assert.deepEqual([v1.link, v1.served_by], [null, { name: 'Founder' }], 'the teammate is named, never their project');
  const taken = await req(app, env, 11, theirPath, { method: 'PUT', body: { project_id: 1, posthog_project_id: PROJECT_A } });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'venture_served');
  assert.equal(db.prepare('SELECT integration_id FROM posthog_project_links WHERE project_id = 1').get().integration_id, mine.id);
  const unlinkTheirs = await req(app, env, 11, theirPath, { method: 'PUT', body: { project_id: 1, posthog_project_id: null } });
  assert.equal(unlinkTheirs.status, 409, 'another member\'s link is never unlinked by them');

  // Refusals: a project the member's PostHog does not list; a bad id; a venture in a company not switched on; someone else's connection.
  const notListed = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 2, posthog_project_id: '9999' } });
  assert.deepEqual([notListed.status, notListed.body.error], [400, 'project_not_yours']);
  const bad = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 2, posthog_project_id: '42; drop' } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'bad_id']);
  const elsewhere = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 3, posthog_project_id: PROJECT_A } });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [409, 'company_not_enabled']);
  const notMine = await req(app, env, 11, path);
  assert.deepEqual([notMine.status, notMine.body.error], [404, 'not_found']);

  // Unlink.
  const unlink = await req(app, env, 10, path, { method: 'PUT', body: { project_id: 1, posthog_project_id: null } });
  assert.deepEqual([unlink.status, unlink.body.link], [200, null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posthog_project_links').get().n, 0);

  // A failed PostHog read blanks the choices only.
  fake.state.status = 500;
  const sick = await req(app, env, 10, path);
  assert.equal(sick.status, 200, sick.text);
  assert.equal(sick.body.ventures.length, 2, 'the ventures still answer');
  assert.equal(sick.body.choices, null);
  assert.ok(sick.body.choices_error?.detail, 'and say why');
  fake.state.status = null;

  // Logged: ids and outcomes only.
  const logs = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'posthog_%'").all() as any[];
  assert.deepEqual(logs.map((l) => l.action), ['posthog_project_linked', 'posthog_project_linked', 'posthog_project_unlinked']);
  for (const l of logs) assert.doesNotMatch(l.details, /Fixture|web app|mobile|4242|5151/, 'no project name or PostHog id is logged');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('9. the source: only reads.ts opens a PostHog session and calls no forbidden tool; the shared lines hold PostHog', () => {
  const ROOT = process.cwd();
  const files = walk(resolve(ROOT, 'cloudflare-worker/src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  const sessions = files.filter((f) => /MCP_PROVIDERS\.posthog|mcpProviderFor\('posthog'\)/.test(f.text) && /openMcpSession\(/.test(f.text)).map((f) => f.path);
  assert.deepEqual(sessions, ['cloudflare-worker/src/services/posthog/reads.ts']);
  for (const f of files) for (const t of FAKE_POSTHOG_FORBIDDEN_TOOLS) assert.ok(!f.text.includes(`call('${t}'`) && !f.text.includes(`callTool('${t}'`), `${f.path} calls ${t}`);

  const d = getDescriptor('posthog')!;
  assert.deepEqual([d.status, d.auth_type, d.audience_rule, d.integration_type], ['beta', 'oauth_mcp', 'venture', 'data_feed']);
  assert.equal(CONNECTOR_METADATA.posthog.category, 'Analytics');
  assert.ok(CATEGORY_ORDER.includes('Analytics'));
  assert.deepEqual(CONNECTOR_METADATA.posthog.sends, []);
  assert.deepEqual(POSTHOG_FEEDS, [], 'part 1 lands nothing; parts 3–6 add their feeds');
  assert.deepEqual(CONNECTOR_METADATA.posthog.feeds, []);
  assert.equal(writesProjectData('posthog'), true);
  const page = CONNECTOR_PAGES.posthog as any;
  assert.equal(page.sign_in.kind, 'mcp');
  assert.ok(page.tools.every((t: any) => t.access === 'read'));
  const named = new Set(page.tools.flatMap((t: any) => t.calls.map((c: string) => /call\('([^']+)'/.exec(c)![1])));
  assert.deepEqual([...named].sort(), [...READ_TOOLS].sort(), 'the page names every tool called, and only those');
  assert.ok(getProviderImpl('posthog')?.disconnect && getProviderImpl('posthog')?.revokeGranted && getProviderImpl('posthog')?.ready);
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /^import '\.\/integrations\/providers\/posthog';$/m);
  assert.ok(index.indexOf("app.route('/api/connectors', posthogRoutes)") < index.indexOf("app.route('/api/connectors', integrations)"), 'mounted ahead of the generic routes');
});
