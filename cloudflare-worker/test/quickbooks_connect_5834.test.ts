/**
 * D5834 part 2 (#5834) — QuickBooks Online connect, token rotation, revoke and
 * the founder's sync route. Intuit is a fake serving the token, revoke and
 * report hosts: no test reaches a real host. Every id and token is invented.
 *
 *  1. The descriptor, scope, authorize URL, page and metadata; not ready, and
 *     nothing sent, without the owner's approval flag.
 *  2. Sign in end to end: the realm from Intuit's callback, the venture from
 *     the signed state (a forged one on the callback is ignored), the
 *     environment from the deployment; the client secret only in a Basic header.
 *  3. No venture, a venture the member cannot edit, and a missing or
 *     malformed realm connect nothing.
 *  4. Rotation: a fresh token costs no call; an expired one refreshes once
 *     under concurrency, keeps the rotated refresh token and never sends a
 *     spent one; a revoked grant says so and records its code alone.
 *  5. The route: the connection read hides the realm id; a sync writes the
 *     statements; a stranger's connection, another venture and a revoked
 *     grant are refused with their own codes.
 *  6. Disconnect revokes at Intuit; a failed revoke keeps the connection.
 *  7. No token, secret or realm id in any response.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import quickbooks, { QUICKBOOKS_SENTENCES } from '../src/routes/quickbooks.ts';
import { quickbooksAccessToken, quickbooksEnvironment } from '../src/integrations/providers/quickbooks.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { _clearOauthCredsCache, MANAGED_PROVIDERS, PROVIDER_ENV_VARS } from '../src/services/providerOauthKeys.ts';
import { AUTHORIZE_URL, QUICKBOOKS_SCOPES, REVOKE_URL, TOKEN_URL, quickbooksAuthorizeUrl } from '../src/integrations/quickbooksOAuth.ts';
import { HOSTS } from '../src/services/financialStatements/quickbooksClient.ts';
import { personalFixture } from './_mercury_personal_d713.ts';

const COMPANY = 77;
const KEY = 'quickbooks';
const REALM = '9130350000000001';
const CLIENT_SECRET = 'fixture-intuit-secret';
const MIGRATION = readFileSync(`cloudflare-worker/sql/migrations/${readdirSync('cloudflare-worker/sql/migrations').find((f) => /_5833_financial_statement_snapshots\.sql$/.test(f))}`, 'utf8');
const fixture = (name: string) => readFileSync(new URL(`./fixtures/accounting/${name}.json`, import.meta.url), 'utf8');
const BS = fixture('quickbooks_balance_sheet'), PL = fixture('quickbooks_profit_and_loss');

function intuitFake() {
  const s = {
    revoked: false,
    revokeStatus: 200,
    issued: 0,
    /** Refresh tokens Intuit has accepted once; a second use is refused, as rotation requires. */
    spent: new Set<string>(),
    calls: [] as Array<{ url: string; method: string; body: string | null; auth: string | null }>,
  };
  const fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const body = init.body ? String(init.body) : null;
    const auth = init.headers?.Authorization ?? null;
    s.calls.push({ url: url.toString(), method: init.method ?? 'GET', body, auth });
    const basicOk = auth === `Basic ${btoa(`fixture-intuit-client:${CLIENT_SECRET}`)}`;
    if (url.toString() === TOKEN_URL) {
      if (!basicOk) return Response.json({ error: 'invalid_client' }, { status: 401 });
      const f = new URLSearchParams(body ?? '');
      if (s.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (f.get('grant_type') === 'refresh_token') {
        const rt = f.get('refresh_token')!;
        if (s.spent.has(rt) || !rt.startsWith('qb-refresh-')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        s.spent.add(rt);
      } else if (f.get('code') !== 'fixture-code') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      const n = ++s.issued;
      return Response.json({ access_token: `qb-access-${n}`, refresh_token: `qb-refresh-${n}`, token_type: 'bearer', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 });
    }
    if (url.toString() === REVOKE_URL) {
      if (!basicOk) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (s.revokeStatus === 200) s.revoked = true;
      return new Response(null, { status: s.revokeStatus });
    }
    if (url.origin === HOSTS.sandbox || url.origin === HOSTS.production) {
      if (s.revoked || !String(auth).startsWith('Bearer qb-access-')) return Response.json({ fault: 'auth' }, { status: 401 });
      if (url.pathname === `/v3/company/${REALM}/reports/BalanceSheet`) return new Response(BS, { status: 200 });
      if (url.pathname === `/v3/company/${REALM}/reports/ProfitAndLoss`) return new Response(PL, { status: 200 });
      return Response.json({ fault: 'nope' }, { status: 403 });
    }
    throw new Error(`unexpected host ${url.origin}`);
  }) as typeof globalThis.fetch;
  return Object.assign(s, { fetch });
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
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (12, 'founder', 'Fixture stranger', 'stranger@example.test', 300)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (12, ${COMPANY})`);
  db.exec(MIGRATION);
  Object.assign(env, {
    RATE_LIMITS: memoryKv(), OAUTH_CALLBACK_BASE_URL: 'https://app.example.test',
    QUICKBOOKS_APP_APPROVED: '1', QUICKBOOKS_CLIENT_ID: 'fixture-intuit-client', QUICKBOOKS_CLIENT_SECRET: CLIENT_SECRET, ...env0,
  });
  const qb = intuitFake();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.route('/api/quickbooks', quickbooks);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return { db, env, qb, app };
}
type T = Awaited<ReturnType<typeof setup>>;

async function req(t: T, who: number, path: string, o: { method?: string; body?: unknown } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(t.env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'X-Company-Id': String(COMPANY) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const real = globalThis.fetch;
  globalThis.fetch = t.qb.fetch;
  try {
    const res = await t.app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, t.env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location') };
  } finally { globalThis.fetch = real; }
}

const row = (t: T, user = 10) => t.db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const start = (t: T, who = 10, project: number | null = 1) => req(t, who, `/api/connectors/oauth/${KEY}/start${project ? `?project_id=${project}` : ''}`);
const callback = (t: T, who: number, state: string, extra = `&realmId=${REALM}`) =>
  req(t, who, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&state=${encodeURIComponent(state)}${extra}`);

async function connected(t: T, who = 10) {
  const s = await start(t, who);
  assert.equal(s.status, 200, s.text);
  const back = await callback(t, who, s.body.state);
  assert.doesNotMatch(back.location ?? '', /error/, back.location ?? back.text);
  return row(t, who);
}
const leak = (text: string) => assert.doesNotMatch(text, /qb-(access|refresh)-|fixture-intuit-secret|9130350000000001/, 'no token, secret or realm id');
const expire = async (t: T, r: any) => {
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  const enc = await encryptCredentials(t.env, r.uid, { ...creds, expires_at: Date.now() - 1000 });
  t.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(enc, r.id);
};

test('1. descriptor, scope and authorize URL; not ready, and nothing sent, without the approval flag', async () => {
  const url = new URL(quickbooksAuthorizeUrl('client-x', 'https://app.example.test/cb', 'signed+state='));
  assert.equal(url.origin + url.pathname, AUTHORIZE_URL);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'client-x', response_type: 'code', scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: 'https://app.example.test/cb', state: 'signed+state=',
  });
  const d = getDescriptor(KEY)!;
  assert.equal(d.auth_type, 'oauth2');
  assert.deepEqual(d.oauth_scopes, [...QUICKBOOKS_SCOPES]);
  assert.ok(CONNECTOR_METADATA[KEY] && CONNECTOR_PAGES[KEY]);
  assert.equal(writesProjectData(KEY), true);
  assert.ok((MANAGED_PROVIDERS as string[]).includes(KEY));
  assert.deepEqual(PROVIDER_ENV_VARS.quickbooks, { id: 'QUICKBOOKS_CLIENT_ID', secret: 'QUICKBOOKS_CLIENT_SECRET' });
  assert.equal(quickbooksEnvironment({}), 'sandbox');
  assert.equal(quickbooksEnvironment({ QUICKBOOKS_ENVIRONMENT: 'Production' }), 'sandbox');
  assert.equal(quickbooksEnvironment({ QUICKBOOKS_ENVIRONMENT: 'production' }), 'production');

  const t = await setup({ QUICKBOOKS_APP_APPROVED: '' });
  assert.equal(await getProviderImpl(KEY)!.ready!(t.env), false);
  assert.equal((await start(t)).status, 503);
  assert.equal(t.qb.calls.length, 0);
});

test('2. sign in end to end: realm from the callback, venture from the state, environment from the deployment', async () => {
  const t = await setup();
  const s = await start(t);
  assert.equal(new URL(s.body.authorize_url).origin + new URL(s.body.authorize_url).pathname, AUTHORIZE_URL);
  assert.equal(new URL(s.body.authorize_url).searchParams.get('redirect_uri'), `https://app.example.test/api/integrations/oauth/${KEY}/callback`);
  // A forged venture and environment on the callback are ignored: the state named project 1.
  await callback(t, 10, s.body.state, `&realmId=${REALM}&project_id=2&quickbooks_project_id=2&environment=production`);
  const r = row(t);
  assert.equal(r.status, 'active');
  assert.equal(r.external_account_id, REALM);
  assert.deepEqual(JSON.parse(r.config_json), { project_id: 1, environment: 'sandbox' });
  assert.deepEqual(JSON.parse(r.scopes_json), ['com.intuit.quickbooks.accounting']);
  const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
  assert.equal(creds!.refresh_token, 'qb-refresh-1');
  assert.ok(typeof creds!.refresh_expires_at === 'number');
  const tokenCall = t.qb.calls.find((c) => c.url === TOKEN_URL)!;
  assert.ok(!tokenCall.url.includes(CLIENT_SECRET) && !tokenCall.body!.includes(CLIENT_SECRET), 'the secret travels only in the Basic header');
  assert.equal(new URLSearchParams(tokenCall.body!).get('redirect_uri'), `https://app.example.test/api/integrations/oauth/${KEY}/callback`);

  const prod = await setup({ QUICKBOOKS_ENVIRONMENT: 'production' });
  await connected(prod);
  assert.equal(JSON.parse(row(prod).config_json).environment, 'production');
});

test('3. no venture, a venture the member cannot edit, and a missing or malformed realm connect nothing', async () => {
  for (const [who, project, extra, reason] of [
    [10, null, `&realmId=${REALM}`, 'quickbooks_venture_required'],
    [12, 1, `&realmId=${REALM}`, 'quickbooks_venture_refused'],
    [10, 1, '', 'quickbooks_realm_missing'],
    [10, 1, '&realmId=1234%2Freports', 'quickbooks_realm_missing'],
    [10, 1, '&realmId=abc', 'quickbooks_realm_missing'],
  ] as const) {
    const t = await setup();
    const s = await start(t, who, project);
    const back = await callback(t, who, s.body.state, extra);
    assert.match(back.location ?? '', new RegExp(`oauth=error.*reason=${reason}`), `${who} ${project} ${extra}`);
    assert.equal(row(t, who), undefined);
    assert.equal(t.qb.calls.filter((c) => c.url === TOKEN_URL).length, 0, 'no code is exchanged');
  }
});

test('4. rotation: one refresh under concurrency, the rotated token kept, a spent one never sent; a revoked grant says so', async () => {
  const t = await setup();
  const r = await connected(t);
  const real = globalThis.fetch;
  const before = t.qb.calls.length;
  assert.equal(await quickbooksAccessToken(t.env, r, t.qb.fetch), 'qb-access-1');
  assert.equal(t.qb.calls.length, before, 'a fresh token costs no call');

  await expire(t, r);
  const results = await Promise.allSettled([quickbooksAccessToken(t.env, r, t.qb.fetch), quickbooksAccessToken(t.env, r, t.qb.fetch)]);
  const refreshes = t.qb.calls.filter((c) => c.url === TOKEN_URL && new URLSearchParams(c.body!).get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1, 'one refresh, not two');
  assert.ok(results.some((x) => x.status === 'fulfilled' && x.value === 'qb-access-2'));
  for (const x of results) if (x.status === 'rejected') assert.equal((x.reason as any).code, 'quickbooks_refresh_busy');
  const stored = await decryptCredentials(t.env, r.uid, row(t).credentials_enc);
  assert.equal(stored!.refresh_token, 'qb-refresh-2', 'the rotated refresh token is kept');

  await expire(t, row(t));
  assert.equal(await quickbooksAccessToken(t.env, r, t.qb.fetch), 'qb-access-3');
  const sent = t.qb.calls.filter((c) => c.url === TOKEN_URL && new URLSearchParams(c.body!).get('grant_type') === 'refresh_token')
    .map((c) => new URLSearchParams(c.body!).get('refresh_token'));
  assert.deepEqual(sent, ['qb-refresh-1', 'qb-refresh-2'], 'a spent refresh token is never sent again');

  t.qb.revoked = true;
  await expire(t, row(t));
  await assert.rejects(quickbooksAccessToken(t.env, r, t.qb.fetch), (e: any) => e.code === 'quickbooks_grant_revoked');
  assert.equal(row(t).last_error, 'quickbooks_grant_revoked');
  globalThis.fetch = real;
});

test('5. the route: the read hides the realm; a sync writes; refusals keep their own codes', async () => {
  const t = await setup();
  const r = await connected(t);
  const read = await req(t, 10, '/api/quickbooks/connection');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.connection, {
    id: r.id, status: 'active', realm_bound: true, project_id: 1, environment: 'sandbox',
    last_complete_sync_at: null, last_error: null, connected_at: r.created_at,
  });
  leak(read.text);
  assert.deepEqual((await req(t, 12, '/api/quickbooks/connection')).body, { connection: null });

  const both = { statements: [{ report: 'balance_sheet', period: { as_of: '2026-09-30' } }, { report: 'profit_and_loss', period: { start: '2026-01-01', end: '2026-09-30' } }], basis: 'accrual' };
  const sync = await req(t, 10, `/api/quickbooks/connection/${r.id}/sync`, { method: 'POST', body: { project_id: 1, ...both } });
  assert.equal(sync.status, 200, sync.text);
  assert.equal(sync.body.state, 'complete');
  assert.deepEqual(sync.body.written.map((w: any) => [w.report, w.state]), [['balance_sheet', 'created'], ['profit_and_loss', 'created']]);
  leak(sync.text);
  assert.ok(row(t).last_synced_at);
  assert.ok(t.qb.calls.filter((c) => c.url.startsWith(HOSTS.sandbox)).every((c) => c.method === 'GET'));

  const wrong = await req(t, 10, `/api/quickbooks/connection/${r.id}/sync`, { method: 'POST', body: { project_id: 2, ...both } });
  assert.deepEqual([wrong.status, wrong.body.error, wrong.body.message], [409, 'realm_not_bound_to_venture', QUICKBOOKS_SENTENCES.realm_not_bound_to_venture]);
  const stranger = await req(t, 12, `/api/quickbooks/connection/${r.id}/sync`, { method: 'POST', body: { project_id: 1, ...both } });
  assert.deepEqual([stranger.status, stranger.body.error], [404, 'connection_not_found']);
  assert.equal((await req(t, 10, `/api/quickbooks/connection/${r.id}/sync`, { method: 'POST', body: both })).body.error, 'project_required');
  assert.equal((await req(t, 10, `/api/quickbooks/connection/abc/sync`, { method: 'POST', body: { project_id: 1, ...both } })).status, 404);

  t.qb.revoked = true;
  await expire(t, row(t));
  const revoked = await req(t, 10, `/api/quickbooks/connection/${r.id}/sync`, { method: 'POST', body: { project_id: 1, ...both } });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.state, 'incomplete');
  assert.deepEqual([revoked.body.failed.code, revoked.body.failed.message], ['quickbooks_grant_revoked', QUICKBOOKS_SENTENCES.quickbooks_grant_revoked]);
  leak(revoked.text);
});

test('6. disconnect revokes at Intuit; a failed revoke keeps the connection; an unknown token counts as revoked', async () => {
  const t = await setup();
  const r = await connected(t);
  t.qb.revokeStatus = 503;
  const kept = await req(t, 10, `/api/connectors/${r.uid}`, { method: 'DELETE' });
  assert.deepEqual([kept.status, kept.body.error], [503, 'quickbooks_revocation_failed']);
  assert.ok(row(t), 'the connection stays until Intuit confirms');

  t.qb.revokeStatus = 200;
  const gone = await req(t, 10, `/api/connectors/${r.uid}`, { method: 'DELETE' });
  assert.equal(gone.status, 200, gone.text);
  assert.equal(row(t), undefined);
  const revoke = t.qb.calls.filter((c) => c.url === REVOKE_URL).at(-1)!;
  assert.deepEqual(JSON.parse(revoke.body!), { token: 'qb-refresh-1' });
  assert.equal(t.qb.revoked, true);

  const u = await setup();
  const r2 = await connected(u);
  u.qb.revokeStatus = 400;
  assert.equal((await req(u, 10, `/api/connectors/${r2.uid}`, { method: 'DELETE' })).status, 200);
  assert.equal(row(u), undefined);
});

test('7. the flag is checked again at the callback; a fresh token needs no lease; a refresh finished meanwhile is reused', async () => {
  const t = await setup();
  const s = await start(t);
  t.env.QUICKBOOKS_APP_APPROVED = '';
  const back = await callback(t, 10, s.body.state);
  assert.match(back.location ?? '', /oauth=error.*reason=quickbooks_unavailable/);
  assert.equal(row(t), undefined);
  assert.equal(t.qb.calls.length, 0, 'no code is exchanged once approval is withdrawn');

  const u = await setup();
  const r = await connected(u);
  // Another worker holds the lease: a fresh token is still answered, without waiting on it.
  await u.env.RATE_LIMITS.put(`quickbooks:refresh:${r.uid}`, 'someone-else');
  assert.equal(await quickbooksAccessToken(u.env, r, u.qb.fetch), 'qb-access-1');
  await u.env.RATE_LIMITS.delete(`quickbooks:refresh:${r.uid}`);

  // This caller read an expired token; by the time it holds the lease, another refresh has stored a fresh one.
  await expire(u, row(u));
  const fresh = await encryptCredentials(u.env, r.uid, { access_token: 'qb-access-other', refresh_token: 'qb-refresh-other', expires_at: Date.now() + 3_600_000 });
  const kv = u.env.RATE_LIMITS;
  let swapped = false;
  u.env.RATE_LIMITS = { ...kv, get: async (k: string) => {
    if (!swapped) { swapped = true; u.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(fresh, r.id); }
    return kv.get(k);
  } };
  const before = u.qb.calls.length;
  assert.equal(await quickbooksAccessToken(u.env, r, u.qb.fetch), 'qb-access-other');
  assert.equal(u.qb.calls.length, before, 'no second refresh');
});
