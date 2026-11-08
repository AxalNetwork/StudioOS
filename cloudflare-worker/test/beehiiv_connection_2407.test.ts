/**
 * D2407 (#2407 part 1) — a founder's own Beehiiv, through Beehiiv's hosted
 * MCP server, against the fake (`_beehiiv_mcp_fake.mjs`). No test reaches a
 * real provider host. Every value is invented.
 *
 *  1. The record: four read tools, the one draft tool under `publish_issue`,
 *     no scope asked for or accepted; `mcp.ts` re-exports both lists frozen.
 *  2. Sign in end to end: one `oauth_mcp` row, switched on for the company.
 *  3. A grant that reports any scope is refused with `scope_refused` and revoked.
 *  4. A support session is refused at sign-in, at connect and on the picker
 *     before any Beehiiv request; a key paste is refused; it may disconnect.
 *  5. The allowlist: every tool off the record, the draft tool included, is
 *     refused before any request; only the four are offered.
 *  6. The draft list is unreachable: nothing in the source imports it or
 *     names the draft tool at a call site; only `reads.ts` opens a session.
 *  7. `services/beehiiv/*` never imports Axal VC's own newsletters.
 *  8. The typed reads: a bad id is dropped or refused before any request;
 *     both rate shapes come back as fractions; no address leaves reads.ts.
 *  9. The picker: link, change, unlink; one publication per venture, a
 *     teammate named; refusals; a failed read blanks the choices only;
 *     nothing named is logged.
 * 10. Disconnect revokes the grant and removes the links; landed figures stay.
 * 11. The shared lines hold Beehiiv: registry, scope, page, provider, index.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/beehiiv_connection_2407.test.ts
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
import cycleGrow from '../src/routes/cycle_grow.ts';
import '../src/integrations/providers/beehiiv.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { openMcpSession, McpClientError } from '../src/integrations/mcpClient.ts';
import { genericMcpProvider, mcpCimdUrl } from '../src/integrations/mcpSignIn.ts';
import { decryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { FED_LEDGER_PROVIDERS } from '../src/integrations/fed.ts';
import { CATEGORY_ORDER, CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { BEEHIIV_DRAFT_TOOLS, BEEHIIV_MCP_URL, BEEHIIV_READ_TOOLS } from '../src/services/beehiiv/mcp.ts';
import { BeehiivReadError, beehiivReadsFor } from '../src/services/beehiiv/reads.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { mig } from './_mercury_d713.ts';
import {
  BEEHIIV_ISSUER, DRAFT_TOOL, FAKE_BEEHIIV_FORBIDDEN_TOOLS, PERSON, PUB_A, PUB_A_NAME, PUB_B, READ_TOOLS, beehiivFake,
} from './_beehiiv_mcp_fake.mjs';

const BEEHIIV = MCP_PROVIDERS.beehiiv;
const BASE = '/api/integrations/mcp/beehiiv';
const COMPANY = 77;
const MIGRATION = readdirSync('cloudflare-worker/sql/migrations').find((f) => /^\d{12}_beehiiv_connector\.sql$/.test(f))!;

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(opts: { scope?: string | null } = {}) {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  // A co-founder on the same ventures, and a venture in a company Beehiiv is not switched on for.
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (3, 'Elsewhere', 100, 88)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY}), (10, 88)`);
  db.exec('CREATE TABLE IF NOT EXISTS growth_channels (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, name TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS publish_sends (id INTEGER PRIMARY KEY)');
  db.exec(mig(MIGRATION));
  env.RATE_LIMITS = memoryKv();
  const fake = beehiivFake({ scope: opts.scope });
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
  app.route('/api/cycles/grow', cycleGrow);
  app.route('/api/connectors', integrations);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return app;
}

/** Every request through the fake: the picker and the disconnect read Beehiiv with the global fetch. */
async function req(app: Hono<any>, env: any, fake: any, who: number, path: string, o: { method?: string; cookie?: string; impersonated?: boolean; company?: number; body?: unknown } = {}) {
  const headers: Record<string, string> = { Authorization: await bearer(env, who, o.impersonated) };
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.company) headers['X-Company-Id'] = String(o.company);
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch as any;
  try {
    const res = await app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location'), setCookie: res.headers.get('Set-Cookie') };
  } finally { globalThis.fetch = real; }
}

async function signIn(app: Hono<any>, env: any, fake: any, who = 10) {
  const start = await req(app, env, fake, who, `${BASE}/start`, { company: COMPANY });
  assert.equal(start.status, 200, start.text);
  const u = new URL(start.body.authorize_url);
  const p = Object.fromEntries(u.searchParams);
  const cookie = new RegExp(`${CSRF_COOKIE}=([^;]+)`).exec(start.setCookie || '')![1];
  const { code } = fake.authorize({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge });
  const cb = await req(app, env, fake, who, `${BASE}/callback?${new URLSearchParams({ code, state: p.state })}`, { cookie: `${CSRF_COOKIE}=${cookie}` });
  return { start, url: u, cb };
}

const row = (db: any, user = 10) => db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'beehiiv'").get(user) as any;
const enable = (db: any, integrationId: number, company = COMPANY) =>
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1').run(integrationId, company);
const PICK = '/api/cycles/grow/beehiiv/publications';
const LINK = '/api/cycles/grow/beehiiv/publication';

test('1. the record: four read tools, the draft tool under its publishing issue, no scope; mcp.ts re-exports both lists frozen', async () => {
  assert.deepEqual([...BEEHIIV.read_tools], READ_TOOLS);
  assert.equal(BEEHIIV_READ_TOOLS, BEEHIIV.read_tools, 'mcp.ts re-exports the record, not a copy');
  assert.equal(BEEHIIV_DRAFT_TOOLS, BEEHIIV.write_tools);
  assert.deepEqual([...BEEHIIV_DRAFT_TOOLS], [DRAFT_TOOL]);
  assert.ok(Object.isFrozen(BEEHIIV_READ_TOOLS) && Object.isFrozen(BEEHIIV_DRAFT_TOOLS));
  assert.equal(BEEHIIV.publish_issue, 2407);
  for (const t of BEEHIIV.read_tools) assert.doesNotMatch(t, /subscri|publish|send|schedule|create|update|delete|automation|segment/, t);
  for (const t of FAKE_BEEHIIV_FORBIDDEN_TOOLS.filter((x) => x !== DRAFT_TOOL)) assert.ok(!BEEHIIV.read_tools.includes(t) && !BEEHIIV.write_tools.includes(t), t);
  assert.deepEqual([...BEEHIIV.scopes], []);
  assert.deepEqual([...BEEHIIV.accepted_scopes], []);
  assert.deepEqual([...BEEHIIV.resources], [BEEHIIV_MCP_URL]);
  assert.deepEqual([...BEEHIIV.registration], ['cimd', 'dcr']);
  assert.equal(BEEHIIV.cimd_url, mcpCimdUrl('beehiiv'));
  assert.equal(genericMcpProvider(MCP_PROVIDERS, 'beehiiv'), BEEHIIV, 'the generic sign-in serves Beehiiv');
  const doc = await (await createMcpOauthRouter().request('/beehiiv/client.json')).json() as any;
  assert.equal(doc.client_id, BEEHIIV.cimd_url);
  assert.deepEqual(doc.redirect_uris, ['https://axal.vc/api/integrations/mcp/beehiiv/callback', 'https://app.axal.vc/api/integrations/mcp/beehiiv/callback']);
});

test('2. sign in end to end: one oauth_mcp row, switched on for the active company', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  const first = await signIn(app, env, fake);
  assert.equal(first.url.origin, BEEHIIV_ISSUER);
  assert.equal(first.url.searchParams.get('scope'), null, 'no scope is asked for');
  assert.equal(new URL(first.cb.location!, 'https://axal.vc').searchParams.get('oauth'), 'ok', first.cb.location!);
  const r = row(db);
  assert.deepEqual([r.auth_type, r.status], ['oauth_mcp', 'active']);
  assert.doesNotMatch(r.credentials_enc, /fake-access|fake-refresh/);
  const creds = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
  assert.equal(creds.resource, BEEHIIV_MCP_URL);
  assert.equal(db.prepare('SELECT enabled FROM integration_companies WHERE integration_id = ? AND company_id = ?').get(r.id, COMPANY)?.enabled, 1);
  await signIn(app, env, fake);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'beehiiv'").get().n, 1, 'one row per member');
});

test('3. a grant that reports any scope is refused with scope_refused and revoked', async () => {
  const { db, env, fake } = await setup({ scope: 'posts:write subscriptions:read' });
  const { cb } = await signIn(appFor(fake), env, fake);
  const back = new URL(cb.location!, 'https://axal.vc').searchParams;
  assert.deepEqual([back.get('oauth'), back.get('reason')], ['error', 'scope_refused']);
  assert.equal(row(db), undefined);
  assert.ok(fake.state.revoked.length > 0, 'the grant is revoked');
});

test('4. a support session is refused at sign-in, connect and the picker before any request; a paste is refused; it may disconnect', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  const before = fake.calls.length;
  const start = await req(app, env, fake, 10, `${BASE}/start`, { impersonated: true, company: COMPANY });
  assert.equal(start.status, 403);
  assert.equal(start.body.error ?? start.body.code, 'support_session_refused');
  assert.equal(fake.calls.length, before, 'nothing reached Beehiiv');
  const support = await req(app, env, fake, 10, '/api/connectors/connect', { method: 'POST', impersonated: true, company: COMPANY, body: { provider_key: 'beehiiv', api_key: 'fixture-not-a-key' } });
  assert.equal(support.status, 403, support.text);
  const paste = await req(app, env, fake, 10, '/api/connectors/connect', { method: 'POST', company: COMPANY, body: { provider_key: 'beehiiv', api_key: 'fixture-not-a-key' } });
  assert.equal(paste.status, 410, paste.text);
  assert.equal(paste.body.code ?? paste.body.error, 'sign_in_only');
  assert.equal(row(db), undefined, 'nothing was stored');

  await signIn(app, env, fake);
  const n = fake.calls.length;
  for (const [method, path, body] of [['GET', `${PICK}?project=1`, undefined], ['PUT', LINK, { project: 1, publication_id: PUB_A }], ['POST', '/api/cycles/grow/beehiiv/sync', { project: 1 }]] as const) {
    const out = await req(app, env, fake, 10, path, { method, impersonated: true, body });
    assert.deepEqual([out.status, out.body.error], [403, 'support_session_refused'], `${method} ${path}`);
  }
  assert.equal(fake.calls.length, n, 'nothing reached Beehiiv for a support session');
  const out = await req(app, env, fake, 10, `/api/connectors/${row(db).uid}`, { method: 'DELETE', impersonated: true });
  assert.equal(out.status, 200, out.text);
  assert.equal(row(db), undefined, 'the support session disconnected it');
});

test('5. the allowlist: every off-list tool, the draft tool included, is refused before any request; only the four are offered', async () => {
  const { db, env, fake } = await setup();
  await signIn(appFor(fake), env, fake);
  const creds = await decryptCredentials(env, row(db).uid, row(db).credentials_enc) as any;
  const session = await openMcpSession(BEEHIIV, { accessToken: creds.access_token, fetcher: fake.fetch, resource: BEEHIIV_MCP_URL });
  assert.deepEqual([...session.offered].sort(), [...READ_TOOLS].sort(), 'the server offers more; only the four are usable');
  const calls = fake.calls.length;
  for (const name of FAKE_BEEHIIV_FORBIDDEN_TOOLS) {
    await assert.rejects(session.callTool(name, { title: 'x' }), (e: any) => e instanceof McpClientError && e.code === 'path_not_allowed', name);
  }
  assert.equal(fake.calls.length, calls, 'refused before any request');
  assert.deepEqual(fake.forbiddenCalls(), [], 'no forbidden tool was ever called');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const ROOT = process.cwd();
/** Source with its comments removed, so a sentence about a store is not a use of it. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC_FILES = () => walk(resolve(ROOT, 'cloudflare-worker/src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

test('6. the draft list is unreachable: nothing imports it or calls the draft tool; only reads.ts opens a Beehiiv session', () => {
  const files = SRC_FILES();
  const drafts = files.filter((f) => /BEEHIIV_DRAFT_TOOLS/.test(f.text)).map((f) => f.path);
  assert.deepEqual(drafts, ['cloudflare-worker/src/services/beehiiv/mcp.ts'], 'only mcp.ts names the draft list');
  for (const f of files) {
    assert.ok(!f.text.includes(`'${DRAFT_TOOL}'`) || f.path === 'cloudflare-worker/src/integrations/mcpProviders.ts', `${f.path} names the draft tool`);
    assert.doesNotMatch(f.text, /MCP_PROVIDERS\.beehiiv\.write_tools|beehiiv[^\n]*\.write_tools/, `${f.path} reaches Beehiiv's write tools`);
  }
  const importers = files.filter((f) => (f.path.startsWith('cloudflare-worker/src/services/beehiiv/') && /from '\.\/mcp'/.test(f.text)) || /beehiiv\/mcp'/.test(f.text)).map((f) => f.path);
  assert.deepEqual(importers, ['cloudflare-worker/src/services/beehiiv/reads.ts'], 'only reads.ts imports mcp.ts');
  const sessions = files.filter((f) => /MCP_PROVIDERS\.beehiiv|mcpProviderFor\('beehiiv'\)/.test(f.text) && /openMcpSession\(/.test(f.text)).map((f) => f.path);
  assert.deepEqual(sessions, ['cloudflare-worker/src/services/beehiiv/reads.ts']);
  // The one route file that reads Beehiiv takes no draft path: no publish route mentions Beehiiv.
  for (const f of files.filter((x) => /routes\/publish/.test(x.path))) assert.doesNotMatch(f.text, /beehiiv/i, f.path);
});

test('7. services/beehiiv/* never imports Axal VC\'s own newsletters, and nothing in it names their stores', () => {
  const files = SRC_FILES().filter((f) => f.path.startsWith('cloudflare-worker/src/services/beehiiv/'));
  assert.deepEqual(files.map((f) => f.path.split('/').pop()).sort(), ['grow.ts', 'mcp.ts', 'reads.ts']);
  for (const f of files) {
    // Every import form: `import x from '…'`, a bare `import '…'`, an `export … from '…'` and a dynamic `import('…')`.
    for (const m of code(f.text).matchAll(/(?:\bimport\s*(?:[^'"]*?\bfrom\s*)?|\bexport\s[^'"]*?\bfrom\s*|\bimport\(\s*)['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(m[1], /newsletter|mail_link|notify/i, `${f.path} imports ${m[1]}`);
    }
    assert.doesNotMatch(code(f.text), /newsletter_subscribers|email_suppressions|MAIL_LINK_SECRET/, f.path);
  }
  const provider = readFileSync('cloudflare-worker/src/integrations/providers/beehiiv.ts', 'utf8');
  assert.doesNotMatch(provider, /from\s+'[^']*newsletter/);
});

test('8. the typed reads: bad ids dropped or refused before any request; both rate shapes become fractions; no address leaves reads.ts', async () => {
  const { db, env, fake } = await setup();
  await signIn(appFor(fake), env, fake);
  const reads = await beehiivReadsFor(env, row(db), { fetcher: fake.fetch });
  assert.deepEqual([...reads.offered].sort(), [...READ_TOOLS].sort());
  assert.deepEqual(await reads.publications(), [{ id: PUB_A, name: PUB_A_NAME }, { id: PUB_B, name: 'Northwind Changelog' }], 'a publication whose id is not Beehiiv\'s is dropped');
  const audience = await reads.audience(PUB_A);
  assert.deepEqual(audience, { subscribers_active: 1284, subscribers_free: 1188, subscribers_premium: 96, open_rate_avg: 0.482, click_rate_avg: 0.061 });
  const posts = await reads.posts(PUB_A);
  assert.equal(posts.length, 3);
  assert.deepEqual(fake.args.find((a: any) => a.tool === 'list_posts').args, { publication_id: PUB_A, status: 'confirmed', limit: 20, order_by: 'publish_date', direction: 'desc' });
  assert.deepEqual([posts[0].open_rate, posts[0].click_rate, posts[0].has_stats], [0.51, 0.07, true]);
  assert.equal(posts[0].sent_at, new Date(1760918400 * 1000).toISOString(), 'epoch seconds read as a date');
  assert.equal(posts[1].has_stats, false, 'a post with no figures says so');
  assert.deepEqual([posts[2].open_rate, posts[2].click_rate], [0.005, 0], 'a 0.5 whose counts say 1 of 200 is 0.5%; a missing click rate comes from its counts');
  const b = await reads.postStats(PUB_A, posts[1].id);
  assert.deepEqual([b.recipients, b.open_rate, b.click_rate], [1198, 0.46, 0.09]);
  assert.ok(!JSON.stringify([audience, posts, b]).includes(PERSON), 'no subscriber\'s address left reads.ts');
  for (const bad of ['../x', 'pub a', '', 'x'.repeat(81)]) {
    const n = fake.calls.length;
    await assert.rejects(reads.audience(bad), (e: any) => e instanceof BeehiivReadError && e.code === 'bad_id', bad);
    assert.equal(fake.calls.length, n, 'nothing was sent');
  }
  await assert.rejects(beehiivReadsFor(env, { ...row(db), auth_type: 'api_key' }, { fetcher: fake.fetch }), (e: any) => e instanceof BeehiivReadError && e.code === 'not_connected');
});

test('9. the picker: link, change, unlink; one publication per venture with the teammate named; refusals; nothing named logged', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  await signIn(app, env, fake);
  const mine = row(db);

  let got = await req(app, env, fake, 10, `${PICK}?project=1`);
  assert.equal(got.status, 200, got.text);
  assert.deepEqual([got.body.link, got.body.served_by, got.body.choices.map((p: any) => p.id)], [null, null, [PUB_A, PUB_B]]);

  let put = await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 1, publication_id: PUB_A } });
  assert.deepEqual([put.status, put.body.link], [200, { publication_id: PUB_A, name: PUB_A_NAME }], put.text);
  db.prepare("UPDATE beehiiv_publication_links SET channel_state = 'dismissed' WHERE project_id = 1").run();
  put = await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 1, publication_id: PUB_A } });
  assert.equal(put.status, 200, put.text);
  assert.equal(db.prepare('SELECT channel_state FROM beehiiv_publication_links WHERE project_id = 1').get().channel_state, 'dismissed', 'relinking the same publication keeps its decision');
  put = await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 1, publication_id: PUB_B } });
  assert.equal(put.body.link.publication_id, PUB_B);
  const l = db.prepare('SELECT COUNT(*) AS n, MAX(channel_state) AS s FROM beehiiv_publication_links WHERE project_id = 1').get();
  assert.deepEqual([l.n, l.s], [1, 'none'], 'one link per venture; a new publication starts its proposal afresh');

  // The co-founder's own Beehiiv: the venture is named as served, and cannot be taken over or unlinked.
  await signIn(app, env, fake, 11);
  enable(db, row(db, 11).id);
  const seen = await req(app, env, fake, 11, `${PICK}?project=1`);
  assert.deepEqual([seen.body.link, seen.body.served_by], [null, { name: 'Founder' }]);
  for (const publication_id of [PUB_A, null]) {
    const taken = await req(app, env, fake, 11, LINK, { method: 'PUT', body: { project: 1, publication_id } });
    assert.deepEqual([taken.status, taken.body.error], [409, 'venture_served'], String(publication_id));
  }
  assert.equal(db.prepare('SELECT integration_id FROM beehiiv_publication_links WHERE project_id = 1').get().integration_id, mine.id);

  const refused: Array<[number, unknown, number, string]> = [
    [2, 'pub_not-listed', 400, 'publication_not_yours'],
    [2, '42; drop', 400, 'bad_id'],
    [3, PUB_A, 409, 'company_not_enabled'],
  ];
  for (const [project, publication_id, status, error] of refused) {
    const out = await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project, publication_id } });
    assert.deepEqual([out.status, out.body.error], [status, error], String(publication_id));
  }
  db.prepare("UPDATE integrations SET status = 'disconnected' WHERE id = ?").run(row(db, 11).id);
  const gone = await req(app, env, fake, 11, `${PICK}?project=2`);
  assert.deepEqual([gone.status, gone.body.error], [409, 'beehiiv_not_connected']);

  const unlink = await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 1, publication_id: null } });
  assert.deepEqual([unlink.status, unlink.body.link], [200, null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM beehiiv_publication_links').get().n, 0);

  fake.state.status = 500;
  const sick = await req(app, env, fake, 10, `${PICK}?project=1`);
  assert.equal(sick.status, 200, sick.text);
  assert.equal(sick.body.choices, null);
  assert.equal(sick.body.choices_error.code, 'beehiiv_unreadable');
  fake.state.status = null;

  const logs = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'grow_beehiiv_%'").all() as any[];
  assert.deepEqual(logs.map((x) => x.action), ['grow_beehiiv_publication_linked', 'grow_beehiiv_publication_linked', 'grow_beehiiv_publication_linked', 'grow_beehiiv_publication_unlinked']);
  for (const x of logs) assert.doesNotMatch(x.details, /Northwind|Letter|Changelog|pub_/, 'no publication name or Beehiiv id is logged');
});

test('10. disconnect revokes the grant and removes the links; landed figures and the ledger stay', async () => {
  const { db, env, fake } = await setup();
  const app = appFor(fake);
  await signIn(app, env, fake);
  const r = row(db);
  await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 1, publication_id: PUB_A } });
  await req(app, env, fake, 10, LINK, { method: 'PUT', body: { project: 2, publication_id: PUB_B } });
  db.prepare("INSERT INTO beehiiv_grow_facts (integration_id, project_id, publication_id, module, kind, period, count, as_of) VALUES (?, 1, ?, 'distribution', 'subscribers_free', '2026-11-07', 10, '2026-11-07')").run(r.id, PUB_A);
  db.prepare("INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (?, 1, 'distribution', 'beehiiv_subscribers_free', 'beehiiv:fact:1:subscribers_free:2026-11-07', 'beehiiv_grow_facts', NULL)").run(r.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM beehiiv_publication_links').get().n, 2);
  const out = await req(app, env, fake, 10, `/api/connectors/${r.uid}`, { method: 'DELETE' });
  assert.equal(out.status, 200, out.text);
  assert.deepEqual(fake.state.revoked.sort(), ['access_token', 'refresh_token'], 'both tokens revoked at Beehiiv');
  assert.equal(row(db), undefined, 'the row is deleted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM beehiiv_publication_links').get().n, 0, 'every link of the connection is removed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM beehiiv_grow_facts').get().n, 1, 'a landed figure stays, dated, for the founder to delete');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE external_id LIKE 'beehiiv:%'").get().n, 1, 'the ledger stays');
});

test('11. the shared lines hold Beehiiv: registry, company scope, the ledger, the page, the provider and the index', () => {
  const d = getDescriptor('beehiiv')!;
  assert.deepEqual([d.status, d.auth_type, d.audience_rule, d.integration_type], ['beta', 'oauth_mcp', 'venture', 'data_feed']);
  assert.equal(CONNECTOR_METADATA.beehiiv.category, 'Marketing');
  assert.ok(CATEGORY_ORDER.includes('Marketing'));
  assert.deepEqual(CONNECTOR_METADATA.beehiiv.sends, [], 'nothing is sent: drafts are part 3');
  assert.equal(writesProjectData('beehiiv'), true);
  assert.equal(FED_LEDGER_PROVIDERS.has('beehiiv'), true);
  const page = CONNECTOR_PAGES.beehiiv as any;
  assert.deepEqual([page.sign_in.kind, page.sign_in.label, page.endpoints.sign_in], ['mcp', 'Sign in with Beehiiv', BEEHIIV_MCP_URL]);
  assert.ok(page.tools.every((t: any) => t.access === 'read'), 'no write tool on the page');
  const named = new Set(page.tools.flatMap((t: any) => t.calls.map((c: string) => /call\('([^']+)'/.exec(c)![1])));
  assert.deepEqual([...named].sort(), [...READ_TOOLS].sort(), 'the page names every tool called, and only those');
  assert.ok(page.long_description[0].includes('Never reads your subscribers’ addresses.'));
  assert.ok(page.long_description.some((p: string) => p.includes('Drafts are not built yet.') && p.includes('Drafts need a paid plan.')));
  const impl = getProviderImpl('beehiiv');
  assert.ok(impl?.connect && impl.disconnect && impl.revokeGranted && impl.ready);
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /^import '\.\/integrations\/providers\/beehiiv';$/m);
});
