/**
 * D1085 (#2950, #2405 part 1) — a founder's own Notion, through Notion's
 * hosted MCP server, against the fake (`_notion_mcp_fake.mjs`). No test
 * reaches a real provider host.
 *
 *  1. The record: Notion's three read tools, no write tool, no scope, served
 *     by the generic sign-in with its client ID metadata document.
 *  2. Sign in end to end through the real routes and the real record: one
 *     `oauth_mcp` row with its tokens encrypted; a second sign-in updates it.
 *  3. A support session is refused at sign-in and at connect; a token paste is
 *     refused; the support session may disconnect, which revokes and deletes.
 *  4. The typed reads: search, a page with its fingerprint, children, a data
 *     source's schema, rows a page at a time, as rows or through a view.
 *  5. Read-only: a write tool the fake offers is never called, whatever a
 *     page says; SQL mode is never sent; a tool off the list is refused
 *     before any request; an id that is not Notion's is refused before any
 *     request.
 *  6. Refresh: a token about to expire is refreshed and the rotated refresh
 *     token stored; a refused refresh marks the row `error`.
 *  7. The source: only `reads.ts` opens a Notion session, and no source file
 *     names a Notion write tool. The shared registrations hold Notion's line.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/notion_connection.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { createMcpOauthRouter, CSRF_COOKIE } from '../src/routes/connector_mcp_oauth.ts';
import integrations from '../src/routes/integrations.ts';
import '../src/integrations/providers/notion.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { openMcpSession, McpClientError } from '../src/integrations/mcpClient.ts';
import { genericMcpProvider, mcpCimdUrl } from '../src/integrations/mcpSignIn.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { FED_LEDGER_PROVIDERS, MODULE_LABELS } from '../src/integrations/fed.ts';
import { MODULE_HREFS } from '../src/integrations/moduleLabels.ts';
import { NOTION_FEEDS } from '../src/integrations/notionFeeds.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { NOTION_MCP_URL, NOTION_READ_TOOLS, NotionReadError, notionId, notionReadsFor } from '../src/services/notion/reads.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { DATA_SOURCE_A, CHILD_A, FAKE_NOTION_WRITE_TOOLS, NOTION_ISSUER, PAGE_A, PAGE_TEXT, ROW_A, VIEW_A, notionFake } from './_notion_mcp_fake.mjs';

const NOTION = MCP_PROVIDERS.notion;
const BASE = '/api/integrations/mcp/notion';
const COMPANY = 77;

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(opts: { scope?: string | null } = {}) {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS user_company_links (user_id INTEGER NOT NULL, company_id INTEGER NOT NULL)');
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY})`);
  env.RATE_LIMITS = memoryKv();
  const fake = notionFake({ scope: opts.scope });
  return { db, env, fake };
}

const ROLES: Record<number, string> = { 10: 'founder', 20: 'partner', 1: 'admin' };

async function bearer(env: any, who: number, impersonated = false) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  return `Bearer ${jwt}`;
}

function signInApp(fake: any) {
  const app = new Hono<any>();
  // The real record and the real registry: only the network is the fake's.
  app.route('/api/integrations/mcp', createMcpOauthRouter({ fetcher: fake.fetch }));
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

const row = (db: any, user = 10) => db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'notion'").get(user) as any;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

test('1. the record: three read tools, no write tool, no scope, served by the generic sign-in with its CIMD document', () => {
  assert.deepEqual([...NOTION.read_tools], ['notion-search', 'notion-fetch', 'notion-query-data-sources']);
  assert.equal(NOTION_READ_TOOLS, NOTION.read_tools, 'reads.ts re-exports the record, not a copy');
  assert.deepEqual([...NOTION.write_tools], []);
  assert.equal(NOTION.publish_issue, null);
  assert.deepEqual([...NOTION.resources], [NOTION_MCP_URL]);
  assert.deepEqual([...NOTION.registration], ['cimd', 'dcr']);
  assert.equal(NOTION.cimd_url, mcpCimdUrl('notion'));
  assert.deepEqual([...NOTION.scopes], []);
  assert.deepEqual([...NOTION.accepted_scopes], []);
  assert.equal(NOTION.tool_pins, null, 'pinned at the first live sign-in');
  assert.equal(genericMcpProvider(MCP_PROVIDERS, 'notion'), NOTION, 'the generic sign-in serves Notion');
  for (const t of FAKE_NOTION_WRITE_TOOLS) assert.ok(!NOTION.read_tools.includes(t), t);
});

test('2. sign in end to end: no scope sent, one oauth_mcp row with encrypted tokens, a second sign-in updates it', async () => {
  const { db, env, fake } = await setup();
  const app = signInApp(fake);
  const first = await signIn(app, env, fake);
  assert.equal(first.url.origin, NOTION_ISSUER);
  assert.equal(first.url.searchParams.has('scope'), false, 'no scope is asked for');
  assert.equal(first.url.searchParams.get('resource'), NOTION_MCP_URL);
  const reg = fake.calls.find((c: any) => c.path === '/register');
  assert.equal(reg.registration.scope, undefined, 'the registration asks for no scope');
  assert.equal(new URL(first.cb.location!, 'https://axal.vc').searchParams.get('oauth'), 'ok', first.cb.location!);
  const r = row(db);
  assert.equal(r.auth_type, 'oauth_mcp');
  assert.equal(r.status, 'active');
  assert.doesNotMatch(r.credentials_enc, /fake-access|fake-refresh/);
  const creds = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  assert.equal(creds.resource, NOTION_MCP_URL);
  assert.deepEqual(creds.scopes, []);
  assert.equal(fake.writeCalls().length, 0);
  await signIn(app, env, fake);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'notion'").get().n, 1, 'one row per member');
});

test('2b. a grant that reports any scope is refused and revoked: Notion\'s scopes are unverified, so none is accepted yet', async () => {
  const { db, env, fake } = await setup({ scope: 'read write' });
  const { cb } = await signIn(signInApp(fake), env, fake);
  const back = new URL(cb.location!, 'https://axal.vc').searchParams;
  assert.equal(back.get('oauth'), 'error');
  assert.equal(back.get('reason'), 'scope_refused');
  assert.equal(row(db), undefined);
  assert.ok(fake.state.revoked.length > 0, 'the grant is revoked');
});

test('3. a support session is refused at sign-in and at connect; a token paste is refused; a support session may disconnect', async () => {
  const { db, env, fake } = await setup();
  const app = signInApp(fake);
  const before = fake.calls.length;
  const start = await req(app, env, 10, `${BASE}/start`, { impersonated: true, company: COMPANY });
  assert.equal(start.status, 403);
  assert.equal(start.body.error ?? start.body.code, 'support_session_refused');
  assert.equal(fake.calls.length, before, 'nothing reached Notion');
  const support = await req(app, env, 10, '/api/connectors/connect', { method: 'POST', impersonated: true, company: COMPANY, body: { provider_key: 'notion', api_key: 'fixture-not-a-token' } });
  assert.equal(support.status, 403, support.text);
  assert.equal(support.body.code ?? support.body.error, 'support_session_refused');
  const paste = await req(app, env, 10, '/api/connectors/connect', { method: 'POST', company: COMPANY, body: { provider_key: 'notion', api_key: 'fixture-not-a-token' } });
  assert.equal(paste.status, 410, paste.text);
  assert.equal(paste.body.code ?? paste.body.error, 'sign_in_only');
  assert.equal(row(db), undefined, 'nothing was stored');

  await signIn(app, env, fake);
  const r = row(db);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch as any;
  try {
    const out = await req(app, env, 10, `/api/connectors/${r.uid}`, { method: 'DELETE', impersonated: true });
    assert.equal(out.status, 200, out.text);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(fake.state.revoked.sort(), ['access_token', 'refresh_token']);
  assert.equal(row(db), undefined, 'the row is deleted');
});

test('4. the typed reads: search, a page with its fingerprint, children, a schema, rows a page at a time', async () => {
  const { db, env, fake } = await setup();
  await signIn(signInApp(fake), env, fake);
  const reads = await notionReadsFor(env, row(db), { fetcher: fake.fetch });
  assert.deepEqual([...reads.offered].sort(), [...NOTION_READ_TOOLS].sort(), 'the server offers more; only the three are usable');

  const found = await reads.searchSources('  roadmap  ');
  assert.deepEqual(found.map((s) => [s.id, s.kind, s.title]), [[PAGE_A, 'page', 'Fixture roadmap'], [DATA_SOURCE_A, 'data_source', 'Fixture feedback']], 'an answer whose id is not Notion\'s is dropped');
  assert.deepEqual(fake.args.at(-1), { tool: 'notion-search', args: { query: 'roadmap' } });

  const page = await reads.fetchPage(PAGE_A);
  assert.equal(page.markdown, PAGE_TEXT, 'page text is returned as it is: data');
  assert.equal(page.fingerprint, sha(PAGE_TEXT));
  assert.equal(page.title, 'Fixture roadmap');
  assert.match(page.url!, /^https:\/\/www\.notion\.so\//);
  assert.equal(page.last_edited, '2026-10-20T10:00:00.000Z');

  assert.deepEqual(await reads.listChildren(PAGE_A), [{ id: CHILD_A, kind: 'page', title: 'Fixture child' }, { id: DATA_SOURCE_A, kind: 'data_source', title: 'Fixture feedback' }]);
  const schema = await reads.dataSourceSchema(DATA_SOURCE_A);
  assert.deepEqual(schema.properties, [{ name: 'Name', type: 'title' }, { name: 'Votes', type: 'number' }, { name: 'Done', type: 'checkbox' }, { name: 'Tags', type: 'multi_select' }]);

  const first = await reads.queryRows(DATA_SOURCE_A);
  assert.deepEqual(first.rows.map((r) => [r.id, r.properties]), [[ROW_A, { Name: 'Fixture idea', Votes: 3, Done: false, Tags: 'speed, export' }]]);
  assert.equal(first.next_cursor, 'cursor-2');
  const second = await reads.queryRows(DATA_SOURCE_A, { cursor: first.next_cursor });
  assert.equal(second.next_cursor, null);
  await reads.queryRows(DATA_SOURCE_A, { view: VIEW_A });
  const queries = fake.args.filter((a: any) => a.tool === 'notion-query-data-sources').map((a: any) => a.args);
  assert.deepEqual(queries, [
    { data_source_id: DATA_SOURCE_A, mode: 'rows' },
    { data_source_id: DATA_SOURCE_A, mode: 'rows', cursor: 'cursor-2' },
    { data_source_id: DATA_SOURCE_A, mode: 'view', view_id: VIEW_A },
  ]);
});

test('5. read-only: no write tool is called whatever a page says; SQL is never sent; an off-list tool and a bad id are refused before any request', async () => {
  const { db, env, fake } = await setup();
  await signIn(signInApp(fake), env, fake);
  const reads = await notionReadsFor(env, row(db), { fetcher: fake.fetch });
  await reads.fetchPage(PAGE_A); // its text says to call notion-update-page
  await (reads.queryRows as any)(DATA_SOURCE_A, { mode: 'sql', sql: 'DROP TABLE rows', view: null });
  assert.deepEqual(fake.writeCalls(), [], 'no write tool was ever called');
  for (const a of fake.args) {
    assert.equal('sql' in a.args, false, 'no SQL argument');
    if (a.tool === 'notion-query-data-sources') assert.ok(['rows', 'view'].includes(a.args.mode), a.args.mode);
  }

  // The session itself refuses a write tool and an unlisted tool before any request.
  const creds = await decryptCredentials(env, row(db).uid, row(db).credentials_enc) as any;
  const session = await openMcpSession(NOTION, { accessToken: creds.access_token, fetcher: fake.fetch, resource: NOTION_MCP_URL });
  const calls = fake.calls.length;
  for (const name of [...FAKE_NOTION_WRITE_TOOLS, 'notion-get-users']) {
    await assert.rejects(session.callTool(name, {}), (e: any) => e instanceof McpClientError && e.code === 'path_not_allowed', name);
  }
  assert.equal(fake.calls.length, calls, 'refused before any request');

  for (const bad of ['../secrets', 'https://www.notion.so/x', `${PAGE_A}?x=1`, '', 'g'.repeat(32)]) {
    const n = fake.calls.length;
    await assert.rejects(reads.fetchPage(bad), (e: any) => e instanceof NotionReadError && e.code === 'bad_id', bad);
    await assert.rejects(reads.queryRows(DATA_SOURCE_A, { view: bad || 'x' }), (e: any) => e instanceof NotionReadError && e.code === 'bad_id', bad);
    assert.equal(fake.calls.length, n, `${bad}: nothing was sent`);
  }
  assert.equal(notionId(PAGE_A.replace(/-/g, '').toUpperCase()), PAGE_A.replace(/-/g, ''));
});

test('6. refresh: a token about to expire is refreshed and the rotated refresh token stored; a refused refresh marks the row error', async () => {
  const { db, env, fake } = await setup();
  await signIn(signInApp(fake), env, fake);
  const r = row(db);
  const old = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  // About to expire: the access token is refreshed before the session opens.
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(env, r.uid, { ...old, expires_at: Date.now() + 1000 }), r.id);
  await notionReadsFor(env, row(db), { fetcher: fake.fetch });
  const fresh = await decryptCredentials(env, r.uid, row(db).credentials_enc) as any;
  assert.notEqual(fresh.refresh_token, old.refresh_token, 'the rotated refresh token is stored');
  assert.notEqual(fresh.access_token, old.access_token);
  assert.equal(fake.state.refresh.has(old.refresh_token), false, 'the old refresh token is spent');

  // The server now refuses the refresh: the row is error / token_rejected and the read is unauthorized.
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(env, r.uid, { ...fresh, expires_at: Date.now() + 1000 }), r.id);
  fake.state.access.delete(fresh.access_token);
  fake.state.failRefresh = 2;
  await assert.rejects(notionReadsFor(env, row(db), { fetcher: fake.fetch }), (e: any) => e instanceof NotionReadError && e.code === 'unauthorized');
  assert.equal(row(db).status, 'error');
  assert.equal(row(db).last_error, 'token_rejected');

  await assert.rejects(notionReadsFor(env, { ...row(db), auth_type: 'api_key' }, { fetcher: fake.fetch }), (e: any) => e instanceof NotionReadError && e.code === 'not_connected');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('7. the source: only reads.ts opens a Notion session; no source names a Notion write tool; the shared lines hold Notion', () => {
  const ROOT = process.cwd();
  const files = walk(resolve(ROOT, 'cloudflare-worker/src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  const sessions = files.filter((f) => /MCP_PROVIDERS\.notion|mcpProviderFor\('notion'\)/.test(f.text) && /openMcpSession\(/.test(f.text)).map((f) => f.path);
  assert.deepEqual(sessions, ['cloudflare-worker/src/services/notion/reads.ts']);
  for (const f of files) for (const t of FAKE_NOTION_WRITE_TOOLS) assert.ok(!f.text.includes(t), `${f.path} names ${t}`);
  assert.doesNotMatch(readFileSync('cloudflare-worker/src/services/notion/reads.ts', 'utf8'), /mode:\s*'sql'|'sql'/, 'reads.ts never names SQL mode');

  const d = getDescriptor('notion')!;
  assert.deepEqual([d.status, d.auth_type, d.audience_rule, d.docs_url], ['beta', 'oauth_mcp', 'venture', 'https://developers.notion.com/docs/mcp']);
  assert.deepEqual(CONNECTOR_METADATA.notion.sends, []);
  // Parts 3–6 each add their feeds (D1087 Validate, D1088 Build, D1089 Raise, D1090 Grow); the registry reads the list, nothing else.
  assert.deepEqual(CONNECTOR_METADATA.notion.feeds, [...new Set(NOTION_FEEDS.map((f) => f.module))], 'the registry\'s feeds are the list\'s modules');
  assert.deepEqual(NOTION_FEEDS.map((f) => [f.module, f.decision]), [['customer_research', 'D1087'], ['market_intelligence', 'D1087'],
    ['product_roadmap', 'D1088'], ['prototype_mvp', 'D1088'], ['solution_design', 'D1088'],
    ['capital_relationships', 'D1089'], ['data_room', 'D1089'], ['distribution', 'D1090'], ['product_improvement', 'D1090']]);
  for (const f of NOTION_FEEDS) assert.ok(MODULE_LABELS[f.module], `${f.key} lands in a labelled module`);
  for (const f of NOTION_FEEDS) for (const t of f.tools) assert.ok((NOTION_READ_TOOLS as readonly string[]).includes(t), `${f.key} calls only a read tool`);
  assert.equal(writesProjectData('notion'), true);
  assert.equal(FED_LEDGER_PROVIDERS.has('notion'), true);
  assert.equal(MODULE_LABELS.product_improvement, 'Product improvement');
  assert.equal(MODULE_HREFS.product_improvement, '/grow/product-improvement');
  const page = CONNECTOR_PAGES.notion as any;
  assert.equal(page.sign_in.kind, 'mcp');
  assert.deepEqual(page.tools.map((t: any) => t.access), ['read', 'read', 'read']);
  assert.ok(page.never_does.length >= 3);
  assert.ok(getProviderImpl('notion')?.disconnect && getProviderImpl('notion')?.revokeGranted && getProviderImpl('notion')?.ready);
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /^import '\.\/integrations\/providers\/notion';$/m);
});
