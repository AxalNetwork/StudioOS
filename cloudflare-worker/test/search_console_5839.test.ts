/**
 * D5839 (#5839) — Search Console, read only, through its own Google OAuth
 * client, and the one property each venture reads. Google is a fake: no test
 * reaches a real host. Every id, token and property is invented.
 *
 *  1. Consent asks for `webmasters.readonly` alone, offline, with consent, on
 *     Search Console's own client; the record, scope and pages hold it.
 *  2. Not ready without the owner's approval flag; ready with it and a client.
 *  3. Sign in end to end; a grant broader than the one scope is revoked and
 *     refused; a grant with no refresh token is revoked and refused.
 *  4. Property ids: domain and URL-prefix kept exactly; malformed refused.
 *  5. The picker lists what Google lists, unusable levels marked; no token in
 *     any response; restricted, full and owner bind; unverified is refused.
 *  6. Malformed, not listed and mismatched selections bind nothing.
 *  7. Two ventures, two bindings; a teammate's binding is never replaced.
 *  8. The check: lost access marks the selection `denied` (D5840's state), regained access clears it.
 *  9. A revoked grant asks to sign in again; a refresh is behind the lease.
 * 10. A support session, a non-member and an unswitched company are refused.
 * 11. Disconnect revokes only this client's grant and removes the bindings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import searchConsole from '../src/routes/search_console.ts';
import { searchConsoleAccessTokenForUser } from '../src/integrations/providers/google_search_console.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import {
  SEARCH_CONSOLE_SCOPE, isPropertyId, searchConsoleAuthorizeUrl,
} from '../src/integrations/searchConsoleOAuth.ts';
import { personalFixture } from './_mercury_personal_d713.ts';

const COMPANY = 77;
const KEY = 'google_search_console';
// D5840's tables: the selection this picker writes is the one its sync reads.
const MIGRATION = readFileSync('cloudflare-worker/sql/migrations/202611150136_5840_search_console_sync.sql', 'utf8');
const DOMAIN = 'sc-domain:example.test';
const PREFIX = 'https://shop.example.test/';
const RESTRICTED = 'https://blog.example.test/';
const UNVERIFIED = 'https://unverified.example.test/';
const OTHERS = 'sc-domain:elsewhere.test';

interface GoogleState {
  sites: Array<{ siteUrl: string; permissionLevel: string }>;
  scope: string;
  refresh: boolean;
  revoked: boolean;
  /** `sites.get` answers for a different property than asked. */
  mismatch: boolean;
  calls: Array<{ host: string; path: string; method: string; body: string | null; auth: string | null }>;
}

function google(): GoogleState & { fetch: typeof fetch } {
  const s: GoogleState = {
    sites: [
      { siteUrl: DOMAIN, permissionLevel: 'siteOwner' },
      { siteUrl: PREFIX, permissionLevel: 'siteFullUser' },
      { siteUrl: RESTRICTED, permissionLevel: 'siteRestrictedUser' },
      { siteUrl: UNVERIFIED, permissionLevel: 'siteUnverifiedUser' },
    ],
    scope: SEARCH_CONSOLE_SCOPE, refresh: true, revoked: false, mismatch: false, calls: [],
  };
  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const body = init.body ? String(init.body) : null;
    s.calls.push({ host: url.host, path: url.pathname, method: init.method ?? 'GET', body, auth: init.headers?.Authorization ?? null });
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
      if (s.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const form = new URLSearchParams(body ?? '');
      const refreshing = form.get('grant_type') === 'refresh_token';
      return Response.json({
        access_token: refreshing ? 'fixture-access-2' : 'fixture-access-1', expires_in: 3599, scope: s.scope, token_type: 'Bearer',
        ...(s.refresh && !refreshing ? { refresh_token: 'fixture-refresh-1' } : {}),
      });
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') {
      s.revoked = true;
      return new Response(null, { status: 200 });
    }
    if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/webmasters/v3/sites')) {
      if (s.revoked) return Response.json({ error: { code: 401 } }, { status: 401 });
      const rest = url.pathname.slice('/webmasters/v3/sites'.length);
      if (!rest) return Response.json({ siteEntry: s.sites });
      const asked = decodeURIComponent(rest.slice(1));
      const site = s.sites.find((x) => x.siteUrl === asked);
      if (!site) return Response.json({ error: { code: 403 } }, { status: 403 });
      return Response.json(s.mismatch ? { ...site, siteUrl: OTHERS } : site);
    }
    throw new Error(`unexpected host ${url.origin}`);
  }) as typeof fetch;
  return Object.assign(s, { fetch: f });
}

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(env0: Record<string, string> = {}) {
  _clearOauthCredsCache();
  const { db, env } = await personalFixture();
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY})`);
  db.exec(MIGRATION);
  Object.assign(env, {
    RATE_LIMITS: memoryKv(), OAUTH_CALLBACK_BASE_URL: 'https://app.example.test',
    GOOGLE_SEARCH_CONSOLE_APPROVED: '1', GOOGLE_SEARCH_CONSOLE_CLIENT_ID: 'fixture-client.apps.example.test',
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: 'fixture-client-secret', ...env0,
  });
  const g = google();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.route('/api/search-console', searchConsole);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return { db, env, g, app };
}

const ROLES: Record<number, string> = { 10: 'founder', 11: 'founder', 20: 'partner', 30: 'investor' };

async function req(t: Awaited<ReturnType<typeof setup>>, who: number, path: string, o: { method?: string; body?: unknown; impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(o.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(t.env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'X-Company-Id': String(COMPANY) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const real = globalThis.fetch;
  globalThis.fetch = t.g.fetch;
  try {
    const res = await t.app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, t.env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location') };
  } finally { globalThis.fetch = real; }
}

const row = (t: any, user = 10) => t.db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const enable = (t: any, integrationId: number) =>
  t.db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1').run(integrationId, COMPANY);

async function signIn(t: Awaited<ReturnType<typeof setup>>, who = 10) {
  const start = await req(t, who, `/api/connectors/oauth/${KEY}/start`);
  assert.equal(start.status, 200, start.text);
  const back = await req(t, who, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&state=${encodeURIComponent(start.body.state)}`);
  return { start, back };
}

/** Signed in and switched on for the company. */
async function connected(t: Awaited<ReturnType<typeof setup>>, who = 10) {
  const r = await signIn(t, who);
  assert.match(r.back.location ?? '', /integration=ok|oauth=ok|connected/, r.back.location ?? r.back.text);
  const id = row(t, who).id;
  enable(t, id);
  return id as number;
}

const PICK = '/api/search-console/properties';
const BIND = '/api/search-console/property';
const CHECK = '/api/search-console/property/check';
const noToken = (text: string) => assert.doesNotMatch(text, /fixture-(access|refresh)|fixture-client-secret/, 'no token or secret reaches the browser');

test('1. consent asks for webmasters.readonly alone, offline, on its own client; the record holds it', () => {
  const url = new URL(searchConsoleAuthorizeUrl('client-x', 'https://app.example.test/cb', 'signed+state='));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'client-x', redirect_uri: 'https://app.example.test/cb', state: 'signed+state=', response_type: 'code',
    scope: 'https://www.googleapis.com/auth/webmasters.readonly', access_type: 'offline', prompt: 'consent',
  });
  assert.equal(url.searchParams.has('include_granted_scopes'), false, 'never folds in other Google grants');
  const d = getDescriptor(KEY)!;
  assert.equal(d.auth_type, 'oauth2');
  assert.deepEqual(d.oauth_scopes, [SEARCH_CONSOLE_SCOPE]);
  assert.equal(d.status, 'beta');
  assert.ok(CONNECTOR_METADATA[KEY] && CONNECTOR_PAGES[KEY], 'metadata and page');
  assert.equal(writesProjectData(KEY), true, 'a connection serves only companies it is switched on for');
  assert.notEqual(KEY, 'google_workspace');
});

test('2. not ready without the approval flag; ready with it and the client', async () => {
  const impl = getProviderImpl(KEY)!;
  const a = await setup({ GOOGLE_SEARCH_CONSOLE_APPROVED: '' });
  assert.equal(await impl.ready!(a.env), false);
  const r = await req(a, 10, `/api/connectors/oauth/${KEY}/start`);
  assert.equal(r.status, 503);
  assert.equal(a.g.calls.length, 0, 'nothing sent to Google');
  const b = await setup();
  assert.equal(await impl.ready!(b.env), true);
});

test('3. sign in end to end; broader or offline-less grants are revoked and refused', async () => {
  const t = await setup();
  const { start, back } = await signIn(t);
  const consent = new URL(start.body.authorize_url);
  assert.equal(consent.searchParams.get('client_id'), 'fixture-client.apps.example.test');
  assert.equal(consent.searchParams.get('redirect_uri'), `https://app.example.test/api/integrations/oauth/${KEY}/callback`);
  assert.doesNotMatch(back.location ?? '', /error/, back.location ?? '');
  const r = row(t);
  assert.equal(r.status, 'active');
  assert.deepEqual(JSON.parse(r.scopes_json), [SEARCH_CONSOLE_SCOPE]);
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  assert.equal(creds!.refresh_token, 'fixture-refresh-1');
  assert.doesNotMatch(r.credentials_enc, /fixture-refresh/, 'stored encrypted');

  const broad = await setup();
  broad.g.scope = `${SEARCH_CONSOLE_SCOPE} https://www.googleapis.com/auth/drive.readonly`;
  const b = await signIn(broad);
  assert.match(b.back.location ?? '', /reason=scope_overreach/);
  assert.equal(row(broad), undefined, 'no row');
  assert.ok(broad.g.calls.some((c) => c.path === '/revoke'), 'the broader grant is revoked');

  const online = await setup();
  online.g.refresh = false;
  const o = await signIn(online);
  assert.match(o.back.location ?? '', /error/);
  assert.equal(row(online), undefined);
  assert.ok(online.g.calls.some((c) => c.path === '/revoke'));
});

test('4. property ids: domain and URL-prefix exactly; anything else refused', () => {
  for (const ok of [DOMAIN, PREFIX, 'http://legacy.example.test/', 'https://example.test/path/']) assert.equal(isPropertyId(ok), true, ok);
  for (const bad of ['', 'example.test', 'sc-domain:', 'sc-domain:bad host', 'https://example.test', ' https://example.test/', 'ftp://example.test/', 'sc-domain:example.test\n', 42, null]) {
    assert.equal(isPropertyId(bad), false, String(bad));
  }
});

test('5. the picker lists what Google lists, marks unusable levels, and binds restricted, full and owner', async () => {
  const t = await setup();
  await connected(t);
  const pick = await req(t, 10, `${PICK}?project=1`);
  assert.equal(pick.status, 200, pick.text);
  noToken(pick.text);
  assert.deepEqual(pick.body.capability, { connected: true, company_enabled: true, can_bind: true });
  assert.equal(pick.body.binding, null);
  assert.deepEqual(pick.body.choices.map((s: any) => [s.site_url, s.property_kind, s.usable]), [
    [DOMAIN, 'domain', true], [PREFIX, 'url_prefix', true], [RESTRICTED, 'url_prefix', true], [UNVERIFIED, 'url_prefix', false],
  ]);
  for (const [site, level] of [[RESTRICTED, 'siteRestrictedUser'], [PREFIX, 'siteFullUser'], [DOMAIN, 'siteOwner']]) {
    const b = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: site } });
    assert.equal(b.status, 200, b.text);
    noToken(b.text);
    assert.equal(b.body.binding.site_url, site, 'the identifier exactly as Google wrote it');
    assert.equal(b.body.binding.permission_level, level);
    assert.equal(b.body.binding.access_state, 'ok');
  }
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM search_console_selections').get().n, 1, 'one property per venture');
  const verified = t.g.calls.filter((c) => c.path === `/webmasters/v3/sites/${encodeURIComponent(DOMAIN)}`);
  assert.equal(verified.length, 1, 'verified with sites.get on the exact id');
  const unv = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: UNVERIFIED } });
  assert.equal(unv.status, 409);
  assert.equal(unv.body.error, 'property_unusable');
  assert.equal(t.db.prepare('SELECT site_url FROM search_console_selections WHERE project_id = 1').get().site_url, DOMAIN, 'the refusal changed nothing');
  const off = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: null } });
  assert.equal(off.status, 200);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM search_console_selections').get().n, 0);
  const logged = t.db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'search_console_%' ORDER BY id").all() as any[];
  assert.deepEqual(logged.map((l) => l.action), ['search_console_property_bound', 'search_console_property_changed', 'search_console_property_changed', 'search_console_property_unbound']);
  for (const l of logged) assert.doesNotMatch(l.details, /example\.test/, 'no property name is logged');
});

test('6. malformed, not listed and mismatched selections bind nothing', async () => {
  const t = await setup();
  await connected(t);
  const before = t.g.calls.length;
  for (const bad of ['example.test', 'https://shop.example.test', { url: PREFIX }, 7]) {
    const r = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'property_malformed');
  }
  assert.equal(t.g.calls.length, before, 'a malformed id is refused before Google is asked');
  const unknown = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: OTHERS } });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.error, 'property_not_accessible');
  t.g.mismatch = true;
  const mm = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: PREFIX } });
  assert.equal(mm.status, 502);
  assert.equal(mm.body.error, 'property_mismatch');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM search_console_selections').get().n, 0);
});

test('7. two ventures, two bindings; a teammate never replaces a binding', async () => {
  const t = await setup();
  await connected(t, 10);
  await connected(t, 11);
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } })).status, 200);
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 2, site_url: PREFIX } })).status, 200);
  const rows = t.db.prepare('SELECT project_id, site_url FROM search_console_selections ORDER BY project_id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.project_id, r.site_url]), [[1, DOMAIN], [2, PREFIX]]);
  const theirs = await req(t, 11, BIND, { method: 'PUT', body: { project: 1, site_url: RESTRICTED } });
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.error, 'venture_served');
  const unbind = await req(t, 11, BIND, { method: 'PUT', body: { project: 1, site_url: null } });
  assert.equal(unbind.status, 409);
  const seen = await req(t, 11, `${PICK}?project=1`);
  assert.equal(seen.body.capability.can_bind, false);
  assert.equal(seen.body.binding.own, false);
  assert.equal(seen.body.served_by.name, 'Founder');
  const check = await req(t, 11, CHECK, { method: 'POST', body: { project: 1 } });
  assert.equal(check.status, 403);
  assert.equal(check.body.error, 'not_your_binding');
});

test('8. the check marks lost access and clears it once access returns', async () => {
  const t = await setup();
  await connected(t);
  await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: PREFIX } });
  t.g.sites = t.g.sites.filter((s) => s.siteUrl !== PREFIX);
  const lost = await req(t, 10, CHECK, { method: 'POST', body: { project: 1 } });
  assert.equal(lost.status, 200, lost.text);
  assert.equal(lost.body.binding.access_state, 'denied');
  assert.equal(lost.body.binding.site_url, PREFIX, 'the binding stays, marked');
  t.g.sites.push({ siteUrl: PREFIX, permissionLevel: 'siteUnverifiedUser' });
  assert.equal((await req(t, 10, CHECK, { method: 'POST', body: { project: 1 } })).body.binding.access_state, 'denied', 'unverified is still denied');
  t.g.sites[t.g.sites.length - 1].permissionLevel = 'siteRestrictedUser';
  const back = await req(t, 10, CHECK, { method: 'POST', body: { project: 1 } });
  assert.equal(back.body.binding.access_state, 'ok');
  assert.equal(back.body.binding.permission_level, 'siteRestrictedUser');
  const none = await req(t, 10, CHECK, { method: 'POST', body: { project: 2 } });
  assert.equal(none.body.error, 'not_bound');
});

test('9. an expired token refreshes once behind the lease; a revoked grant asks to sign in again', async () => {
  const t = await setup();
  const id = await connected(t);
  const r = row(t);
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  t.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?')
    .run(await encryptCredentials(t.env, r.uid, { ...creds!, expires_at: 1 }), id); // long past
  const pick = await req(t, 10, `${PICK}?project=1`);
  assert.equal(pick.status, 200);
  assert.equal(t.g.calls.filter((c) => c.path === '/token').length, 2, 'the exchange, then one refresh');
  const listed = t.g.calls.find((c) => c.path === '/webmasters/v3/sites');
  assert.equal(listed!.auth, 'Bearer fixture-access-2');
  const kept = await decryptCredentials(t.env, r.uid, row(t).credentials_enc);
  assert.equal(kept!.refresh_token, 'fixture-refresh-1', 'Google keeps the refresh token unless it rotates one');
  t.g.revoked = true;
  const gone = await req(t, 10, `${PICK}?project=1`);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.choices, null);
  assert.equal(gone.body.choices_error.code, 'sign_in_again');
  const bind = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  assert.equal(bind.body.error, 'sign_in_again');
});

test('10. a support session, a non-member and an unswitched company are refused', async () => {
  const t = await setup();
  await signIn(t);
  // Sign-in switches the connection on for the active company; the founder switches it off.
  assert.equal(t.db.prepare('SELECT enabled FROM integration_companies WHERE integration_id = ?').get(row(t).id).enabled, 1);
  t.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(row(t).id);
  const off = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  assert.equal(off.status, 409);
  assert.equal(off.body.error, 'company_not_enabled');
  const pick = await req(t, 10, `${PICK}?project=1`);
  assert.deepEqual(pick.body.capability, { connected: true, company_enabled: false, can_bind: false });
  assert.equal(pick.body.choices, null, 'nothing listed for a company it is not switched on for');
  enable(t, row(t).id);
  const before = t.g.calls.length;
  const support = await req(t, 10, `${PICK}?project=1`, { impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  assert.equal(t.g.calls.length, before, 'refused before any Google request');
  const stranger = await req(t, 30, `${PICK}?project=1`);
  assert.equal(stranger.status, 403);
  const none = await req(t, 11, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  assert.equal(none.body.error, 'not_connected');
  const bad = await req(t, 10, `${PICK}?project=abc`);
  assert.equal(bad.status, 400);
});

test('11. disconnect revokes only this grant and removes the bindings', async () => {
  const t = await setup();
  await connected(t);
  await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  const uid = row(t).uid;
  const r = await req(t, 10, `/api/connectors/${uid}`, { method: 'DELETE' });
  assert.equal(r.status, 200, r.text);
  const revoke = t.g.calls.filter((c) => c.path === '/revoke');
  assert.equal(revoke.length, 1);
  assert.equal(new URLSearchParams(revoke[0].body!).get('token'), 'fixture-refresh-1', 'the refresh token revokes the whole Search Console grant');
  assert.equal(row(t), undefined);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM search_console_selections').get().n, 0);
  // A reconnect starts clean: the venture binds again, verified again.
  t.g.revoked = false;
  await connected(t);
  const again = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  assert.equal(again.status, 200, again.text);
});

test('12. the selection D5840\'s sync reads, and the token its accessToken dep gets for that member', async () => {
  // Mutation checked: writing another table, or keying the selection by anything but the member, fails here.
  const t = await setup();
  await connected(t);
  await req(t, 10, BIND, { method: 'PUT', body: { project: 1, site_url: DOMAIN } });
  const sel = t.db.prepare('SELECT project_id, user_id, site_url, property_kind, permission_level, access_state FROM search_console_selections').all() as any[];
  assert.deepEqual(sel.map((r) => ({ ...r })), [{ project_id: 1, user_id: 10, site_url: DOMAIN, property_kind: 'domain', permission_level: 'siteOwner', access_state: 'ok' }]);
  const real = globalThis.fetch;
  globalThis.fetch = t.g.fetch;
  try {
    assert.equal(await searchConsoleAccessTokenForUser(t.env, 10), 'fixture-access-1');
    await assert.rejects(searchConsoleAccessTokenForUser(t.env, 11), /search_console_grant_revoked/, 'no connection reads as a revoked grant');
  } finally { globalThis.fetch = real; }
});
