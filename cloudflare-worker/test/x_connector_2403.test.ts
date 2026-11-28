/**
 * D2403 part 2 (#2403) — a founder's own X connection, through the HQ-owned
 * founders app. X is a fake: no test reaches a real host. Every id, token and
 * handle is invented.
 *
 *  1. The record: read set first, the union listed, paid plans only, Social,
 *     switched on per company, its own managed key (never HQ's X_CLIENT_ID),
 *     only the feeds part 3a built (D8815) claimed.
 *  2. Not ready without the founders app (HQ's posting app alone is not it).
 *  3. Connect end to end asks for the read set only and records what X granted.
 *  4. A read sign-in that comes back with a write scope is revoked and refused.
 *  5. "Turn on publishing" asks for the publish set; only then is publishing granted.
 *  6. A free founder plan is refused before any sign-in state.
 *  7. Refresh behind the lease writes both rotated tokens; a refused refresh
 *     marks the row; a held lease calls nothing.
 *  8. Disconnect revokes both tokens, and deletes the row even when X fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { _clearOauthCredsCache, PROVIDER_ENV_VARS } from '../src/services/providerOauthKeys.ts';
import { assertPublishGranted, xFounderAccessToken } from '../src/integrations/providers/x.ts';
import { X_PUBLISH_SCOPES, X_READ_SCOPES } from '../src/integrations/xScopes.ts';
import { X_BUILT_FEEDS, X_FEED_LIST, X_FEEDS } from '../src/integrations/xFeeds.ts';
import { personalFixture } from './_mercury_personal_d713.ts';

const COMPANY = 77;
const KEY = 'x';
const READ = 'tweet.read users.read offline.access';
const PUBLISH = `${READ} tweet.write media.write`;

interface XState {
  /** The scope X answers with; null answers whatever was asked. */
  scope: string | null;
  refuseRefresh: boolean;
  failRevoke: boolean;
  refreshes: number;
  calls: Array<{ path: string; method: string; body: string; auth: string | null }>;
}

function fakeX(): XState & { fetch: typeof fetch; asked: string } {
  const s: XState & { asked: string } = { scope: null, refuseRefresh: false, failRevoke: false, refreshes: 0, calls: [], asked: READ };
  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.x.com') throw new Error(`unexpected host ${url.origin}`);
    const body = init.body ? String(init.body) : '';
    const headers = new Headers(init.headers || {});
    s.calls.push({ path: url.pathname, method: init.method ?? 'GET', body, auth: headers.get('authorization') });
    if (url.pathname === '/2/oauth2/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'refresh_token') {
        if (s.refuseRefresh) return Response.json({ error: 'invalid_request' }, { status: 400 });
        s.refreshes += 1;
        return Response.json({ token_type: 'bearer', expires_in: 7200, access_token: `fixture-access-r${s.refreshes}`, refresh_token: `fixture-refresh-r${s.refreshes}`, scope: s.scope ?? s.asked });
      }
      return Response.json({ token_type: 'bearer', expires_in: 7200, access_token: 'fixture-access-1', refresh_token: 'fixture-refresh-1', scope: s.scope ?? s.asked });
    }
    if (url.pathname === '/2/oauth2/revoke') return s.failRevoke ? new Response('no', { status: 503 }) : Response.json({ revoked: true });
    if (url.pathname === '/2/users/me') return Response.json({ data: { id: '4242', name: 'Fixture Venture', username: 'fixture_venture' } });
    throw new Error(`unexpected path ${url.pathname}`);
  }) as typeof fetch;
  return Object.assign(s, { fetch: f });
}

function memoryKv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(env0: Record<string, string> = {}) {
  _clearOauthCredsCache();
  const { db, env } = await personalFixture();
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY})`);
  const kv = memoryKv();
  Object.assign(env, {
    RATE_LIMITS: kv, OAUTH_CALLBACK_BASE_URL: 'https://app.example.test',
    X_FOUNDERS_CLIENT_ID: 'fixture-founders-client', X_FOUNDERS_CLIENT_SECRET: 'fixture-founders-secret', ...env0,
  });
  const x = fakeX();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return { db, env, x, app, kv };
}
type T = Awaited<ReturnType<typeof setup>>;

async function req(t: T, who: number, path: string, o: { method?: string } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(t.env.JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = t.x.fetch;
  try {
    const res = await t.app.request(path, { method: o.method ?? 'GET', headers: { Authorization: `Bearer ${jwt}`, 'X-Company-Id': String(COMPANY) } }, t.env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location') };
  } finally { globalThis.fetch = real; }
}

const row = (t: T, user = 10) => t.db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const noToken = (text: string) => assert.doesNotMatch(text, /fixture-(access|refresh|founders-secret)/, 'no token or secret reaches the browser');

async function signIn(t: T, opts: { publish?: boolean; who?: number } = {}) {
  t.x.asked = opts.publish ? PUBLISH : READ;
  const start = await req(t, opts.who ?? 10, `/api/connectors/oauth/${KEY}/start${opts.publish ? '?publish=1' : ''}`);
  assert.equal(start.status, 200, start.text);
  noToken(start.text);
  const back = await req(t, opts.who ?? 10, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&state=${encodeURIComponent(start.body.state)}`);
  noToken(back.text);
  return { start, back, consent: new URL(start.body.authorize_url) };
}

async function withFetch<R>(t: T, fn: () => Promise<R>): Promise<R> {
  const real = globalThis.fetch;
  globalThis.fetch = t.x.fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('1. the record: read first, union listed, paid plans only, Social, per company, its own key, the built feeds only', () => {
  assert.deepEqual([...X_READ_SCOPES], ['tweet.read', 'users.read', 'offline.access']);
  assert.deepEqual([...X_PUBLISH_SCOPES], [...X_READ_SCOPES, 'tweet.write', 'media.write']);
  const d = getDescriptor(KEY)!;
  assert.equal(d.auth_type, 'oauth2');
  assert.equal(d.audience_rule, 'venture');
  assert.equal(d.tier, 'growth', 'owner decision 4: paid founder plans only');
  assert.deepEqual(d.oauth_scopes, [...X_PUBLISH_SCOPES], 'the union, so either grant passes the overreach check');
  assert.equal(CONNECTOR_METADATA[KEY].category, 'Social');
  assert.deepEqual(CONNECTOR_METADATA[KEY].sends, [], 'publishing is never a sends row');
  assert.equal(writesProjectData(KEY), true);
  assert.deepEqual(PROVIDER_ENV_VARS.x, { id: 'X_FOUNDERS_CLIENT_ID', secret: 'X_FOUNDERS_CLIENT_SECRET' }, 'owner decision 2B: never HQ\'s app');
  // D8815 (part 3a) lands the two facts; the channel proposal waits. The registry, the feed list and the page agree.
  assert.deepEqual(X_BUILT_FEEDS.map((f) => f.key), ['audience', 'posts']);
  assert.equal(X_FEED_LIST.length, 3);
  assert.deepEqual(CONNECTOR_METADATA[KEY].pulls, X_BUILT_FEEDS.map((f) => ({ what: f.what, module: f.module })));
  assert.deepEqual(CONNECTOR_METADATA[KEY].feeds, [...X_FEEDS]);
  const page = CONNECTOR_PAGES[KEY] as any;
  assert.deepEqual(page.tools.map((x: any) => x.name), X_BUILT_FEEDS.map((f) => f.key));
  assert.equal(page.sign_in.kind, 'oauth');
});

test('2. not ready without the founders app; HQ\'s posting app alone is not it', async () => {
  const impl = getProviderImpl(KEY)!;
  const t = await setup({ X_FOUNDERS_CLIENT_ID: '', X_FOUNDERS_CLIENT_SECRET: '', X_CLIENT_ID: 'hq-client', X_CLIENT_SECRET: 'hq-secret' });
  assert.equal(await impl.ready!(t.env), false);
  const r = await req(t, 10, `/api/connectors/oauth/${KEY}/start`);
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.code ?? r.body.error, 'oauth_unconfigured');
  assert.equal(t.x.calls.length, 0, 'nothing sent to X');
  const states = t.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'oauth_state_tokens'").get() as any;
  assert.equal(states.n ? (t.db.prepare('SELECT COUNT(*) AS n FROM oauth_state_tokens').get() as any).n : 0, 0, 'no state written');
  const ok = await setup();
  assert.equal(await impl.ready!(ok.env), true);
});

test('3. connect asks for the read set only, on the founders app, and records what X granted', async () => {
  const t = await setup();
  const { consent, back } = await signIn(t);
  assert.equal(consent.origin + consent.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(consent.searchParams.get('client_id'), 'fixture-founders-client');
  assert.equal(consent.searchParams.get('scope'), READ);
  assert.equal(consent.searchParams.get('redirect_uri'), 'https://app.example.test/api/integrations/oauth/x/callback');
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.ok((consent.searchParams.get('code_challenge') || '').length >= 43, 'PKCE challenge from the signed state');
  assert.doesNotMatch(back.location ?? '', /error/, back.location ?? '');
  const r = row(t);
  assert.equal(r.status, 'active');
  assert.equal(r.external_account_name, '@fixture_venture');
  assert.deepEqual(JSON.parse(r.scopes_json), [...X_READ_SCOPES]);
  assert.deepEqual(JSON.parse(r.config_json), { x_user_id: '4242', handle: 'fixture_venture', granted_scopes: [...X_READ_SCOPES], publish_on: false });
  assert.doesNotMatch(r.credentials_enc, /fixture-(access|refresh)/, 'stored encrypted');
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  assert.equal(creds!.refresh_token, 'fixture-refresh-1');
  const token = t.x.calls.find((c) => c.path === '/2/oauth2/token')!;
  assert.match(token.auth ?? '', /^Basic /, 'the founders app authenticates the exchange');
  const verifier = new URLSearchParams(token.body).get('code_verifier') ?? '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const s256 = Buffer.from(digest).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(consent.searchParams.get('code_challenge'), s256, 'the consent carries the S256 of the verifier the exchange sends');
  assert.equal(t.db.prepare('SELECT enabled FROM integration_companies WHERE integration_id = ? AND company_id = ?').get(r.id, COMPANY)?.enabled, 1);
  assert.throws(() => assertPublishGranted(r), (e: any) => e.code === 'x_publish_not_granted');
});

test('4. a read sign-in that comes back with a write scope is revoked and refused', async () => {
  const t = await setup();
  t.x.scope = PUBLISH;
  const { back } = await signIn(t);
  assert.match(back.location ?? '', /reason=x_publish_not_requested/, back.location ?? '');
  assert.equal(row(t), undefined, 'no row');
  const revoked = t.x.calls.filter((c) => c.path === '/2/oauth2/revoke').map((c) => new URLSearchParams(c.body).get('token'));
  assert.deepEqual(revoked, ['fixture-access-1', 'fixture-refresh-1'], 'both tokens revoked');

  // A revoke X refuses never hides the refusal it follows.
  const down = await setup();
  down.x.scope = PUBLISH;
  down.x.failRevoke = true;
  const d = await signIn(down);
  assert.match(d.back.location ?? '', /reason=x_publish_not_requested/, d.back.location ?? '');
  assert.equal(row(down), undefined);

  const wide = await setup();
  wide.x.scope = `${PUBLISH} dm.write`;
  const w = await signIn(wide, { publish: true });
  assert.match(w.back.location ?? '', /reason=scope_overreach/);
  assert.equal(row(wide), undefined);

  const narrow = await setup();
  narrow.x.scope = 'tweet.read offline.access';
  const n = await signIn(narrow);
  assert.match(n.back.location ?? '', /oauth=error/);
  assert.equal(row(narrow), undefined, 'without users.read nothing is saved');
});

test('5. "Turn on publishing" asks for the publish set; only then is publishing granted', async () => {
  const t = await setup();
  const { consent } = await signIn(t, { publish: true });
  assert.equal(consent.searchParams.get('scope'), PUBLISH);
  const r = row(t);
  assert.equal(JSON.parse(r.config_json).publish_on, true);
  assert.doesNotThrow(() => assertPublishGranted(r));
  // A forged ?publish=1 on the callback cannot widen a read sign-in: the request rides in the signed state.
  const forged = await setup();
  const start = await req(forged, 10, `/api/connectors/oauth/${KEY}/start`);
  forged.x.scope = PUBLISH;
  const back = await req(forged, 10, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&publish=1&state=${encodeURIComponent(start.body.state)}`);
  assert.match(back.location ?? '', /oauth=error/);
  assert.equal(row(forged), undefined);
});

test('6. a free founder plan is refused before any sign-in state', async () => {
  const t = await setup();
  const r = await req(t, 11, `/api/connectors/oauth/${KEY}/start`);
  assert.equal(r.status, 402, r.text);
  assert.equal(r.body.error, 'tier_required');
  assert.equal(t.x.calls.length, 0);
});

test('7. refresh behind the lease writes both rotated tokens; a refusal marks the row; a held lease calls nothing', async () => {
  const t = await setup();
  await signIn(t);
  const r = row(t);
  const expire = async () => {
    const c = await decryptCredentials(t.env, r.uid, row(t).credentials_enc);
    t.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(t.env, r.uid, { ...c!, expires_at: 0 }), r.id);
  };
  await expire();
  t.x.calls.length = 0;
  assert.equal(await withFetch(t, () => xFounderAccessToken(t.env, r)), 'fixture-access-r1');
  const sent = new URLSearchParams(t.x.calls[0].body);
  assert.equal(sent.get('refresh_token'), 'fixture-refresh-1');
  const stored = await decryptCredentials(t.env, r.uid, row(t).credentials_enc);
  assert.equal(stored!.access_token, 'fixture-access-r1');
  assert.equal(stored!.refresh_token, 'fixture-refresh-r1', 'the rotated refresh token is kept');
  assert.equal(t.kv.m.size, 0, 'the lease is released');
  t.x.calls.length = 0;
  assert.equal(await withFetch(t, () => xFounderAccessToken(t.env, r)), 'fixture-access-r1', 'a fresh token is used as is');
  assert.equal(t.x.calls.length, 0);

  await expire();
  t.kv.m.set(`x_founder:refresh:${r.uid}`, 'another-holder');
  await assert.rejects(withFetch(t, () => xFounderAccessToken(t.env, r)), (e: any) => e.code === 'x_refresh_busy');
  assert.equal(t.x.calls.length, 0, 'a held lease calls nothing');
  t.kv.m.clear();

  t.x.refuseRefresh = true;
  await assert.rejects(withFetch(t, () => xFounderAccessToken(t.env, r)), (e: any) => e.code === 'x_oauth_refresh_failed');
  const after = row(t);
  assert.equal(after.status, 'error');
  assert.equal(after.last_error, 'x_refresh_refused');
});

test('8. disconnect revokes both tokens, and deletes the row even when X fails', async () => {
  const t = await setup();
  await signIn(t);
  t.x.calls.length = 0;
  const d = await req(t, 10, `/api/connectors/${row(t).uid}`, { method: 'DELETE' });
  assert.equal(d.status, 200, d.text);
  assert.deepEqual(t.x.calls.filter((c) => c.path === '/2/oauth2/revoke').map((c) => new URLSearchParams(c.body).get('token')), ['fixture-access-1', 'fixture-refresh-1']);
  assert.equal(row(t), undefined);

  const down = await setup();
  await signIn(down);
  down.x.failRevoke = true;
  const id = row(down).id;
  const e = await req(down, 10, `/api/connectors/${row(down).uid}`, { method: 'DELETE' });
  assert.equal(e.status, 200, 'best effort: the row goes whether or not X answered');
  assert.equal(row(down), undefined);
  assert.equal(down.db.prepare('SELECT COUNT(*) AS n FROM integration_companies WHERE integration_id = ?').get(id)?.n, 0);
});
