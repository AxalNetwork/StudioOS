/**
 * D840 (#2346) — Sign in with Mercury, end to end against the fake servers.
 *
 *  1. Sign in: discovery, one registration, PKCE, the callback, and an
 *     `oauth_mcp` row with its tokens encrypted.
 *  2. The existing feeds read through the sign-in: a founder's credits, an
 *     investor's proof-of-funds accounts, a partner's matches.
 *  3. Refresh: an expired access token is refreshed and stored; a refused
 *     refresh marks the row and asks the member to sign in again.
 *  4. Disconnect revokes the grant and deletes the row; a pasted token
 *     replaces a sign-in and revokes it.
 *  5. State and CSRF: another user's state, a replayed state, a forged state,
 *     no cookie, a wrong cookie, and Mercury's own error are all refused, and
 *     no code is exchanged.
 *  6. The grant: a scope beyond `read offline_access`, or an Axal entity's
 *     organization, is revoked and stores nothing.
 *  7. Who: an admin is answered 404, an investor off HQ and a support session 403.
 *  8. No token, code or verifier reaches a log, a log row or a response.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_oauth_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import revenue from '../src/routes/revenue.ts';
import mercuryPersonal from '../src/routes/mercury_personal.ts';
import mercuryAttestations from '../src/routes/mercury_attestations.ts';
import mercuryOauth, { CALLBACK_REASONS, CSRF_COOKIE } from '../src/routes/mercury_oauth.ts';
import { decryptCredentials } from '../src/integrations/secrets.ts';
import '../src/integrations/providers/mercury.ts';
import { count, personalFixture } from './_mercury_personal_d713.ts';
import { ddl, mig } from './_mercury_d713.ts';
import { FAKE_ACC_A, fakeTx, mercuryMcpFake } from './_mercury_mcp_fake.mjs';

const app = new Hono<any>();
app.route('/api/integrations/mercury/oauth', mercuryOauth);
app.route('/api/integrations', integrations);
app.route('/api/revenue', revenue);
app.route('/api/mercury/personal', mercuryPersonal);
app.route('/api/mercury/attestations', mercuryAttestations);
app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));

const ROLES: Record<number, string> = { 10: 'founder', 20: 'partner', 30: 'investor', 1: 'admin' };

async function req(env: any, who: number, path: string, opts: { method?: string; cookie?: string; impersonated?: boolean; branch?: boolean; body?: unknown } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(opts.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await app.request(path, { method: opts.method ?? 'GET', headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) },
    opts.branch ? { ...env, BRANCH_CODE: 'ldn' } : env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a redirect */ }
  return { status: res.status, body, text, location: res.headers.get('Location'), setCookie: res.headers.get('Set-Cookie') };
}

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup() {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  env.RATE_LIMITS = memoryKv();
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (1, 'Own venture', 10, NULL) ON CONFLICT(id) DO NOTHING");
  const fake = mercuryMcpFake();
  const off = fake.install();
  return { db, env, fake, off };
}

/** The member's browser: start, Mercury's consent, and the callback with the cookie. */
async function signIn(env: any, fake: any, who: number, tamper: { cookie?: string | null; state?: (s: string) => string; as?: number; error?: boolean } = {}) {
  const start = await req(env, who, '/api/integrations/mercury/oauth/start');
  assert.equal(start.status, 200, start.text);
  const u = new URL(start.body.authorize_url);
  const p = Object.fromEntries(u.searchParams);
  const cookie = /__Host-axal_mercury_oauth=([^;]+)/.exec(start.setCookie || '')![1];
  const { code } = fake.authorize({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge, scope: p.scope });
  const state = tamper.state ? tamper.state(p.state) : p.state;
  const q = tamper.error ? `error=access_denied&state=${encodeURIComponent(state)}` : `code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  const jar = tamper.cookie === null ? undefined : `${CSRF_COOKIE}=${tamper.cookie ?? cookie}`;
  const cb = await req(env, tamper.as ?? who, `/api/integrations/mercury/oauth/callback?${q}`, { cookie: jar });
  return { start, params: p, cookie, code, state: p.state, cb };
}

const outcome = (location: string | null) => Object.fromEntries(new URL(location!, 'https://axal.vc').searchParams);
const row = (db: any, user: number) => db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury'").get(user) as any;

test('1. sign in: discovery, one registration, PKCE, the callback, an oauth_mcp row with encrypted tokens', async () => {
  const { db, env, fake, off } = await setup();
  try {
    const { start, params, cb } = await signIn(env, fake, 10);
    assert.equal(new URL(start.body.authorize_url).origin + new URL(start.body.authorize_url).pathname, 'https://mcp.mercury.com/authorize');
    assert.equal(params.scope, 'read offline_access');
    assert.equal(params.code_challenge_method, 'S256');
    assert.equal(params.resource, 'https://mcp.mercury.com/mcp');
    assert.equal(params.redirect_uri, 'http://localhost/api/integrations/mercury/oauth/callback');
    assert.match(start.setCookie!, /^__Host-axal_mercury_oauth=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    const reg = fake.calls.filter((c: any) => c.path === '/register');
    assert.equal(reg.length, 1);
    assert.deepEqual(reg[0].registration, { client_name: 'Axal VC', redirect_uris: [params.redirect_uri], token_endpoint_auth_method: 'none', scope: 'read offline_access' });
    assert.equal(cb.status, 302);
    assert.deepEqual(outcome(cb.location), { oauth: 'ok', provider: 'mercury' });
    assert.match(cb.setCookie!, /Max-Age=0/);
    const r = row(db, 10);
    assert.equal(r.auth_type, 'oauth_mcp');
    assert.equal(r.status, 'active');
    assert.equal(r.external_account_name, 'Own Venture Inc');
    assert.deepEqual(JSON.parse(r.scopes_json), ['read', 'offline_access']);
    assert.ok(!/fake-access|fake-refresh/.test(r.credentials_enc), 'the tokens are ciphertext at rest');
    const creds = await decryptCredentials(env, r.uid, r.credentials_enc) as any;
    assert.ok(fake.state.access.has(creds.access_token));
    assert.ok(fake.state.refresh.has(creds.refresh_token));
    // A second sign-in reuses this environment's client.
    await signIn(env, fake, 20);
    assert.equal(fake.calls.filter((c: any) => c.path === '/register').length, 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM platform_settings WHERE key LIKE 'mercury_mcp_client:%'"), 1);
    assert.deepEqual(fake.toolCalls().sort(), ['getAccounts', 'getAccounts', 'getOrganization', 'getOrganization']);
  } finally { off(); }
});

test('2. the existing feeds read through the sign-in: credits, proof-of-funds accounts and matches', async () => {
  const { db, env, fake, off } = await setup();
  try {
    const today = new Date().toISOString().slice(0, 10);
    fake.state.data.transactions = [{ id: fakeTx(1), accountId: FAKE_ACC_A, amount: 250, postedAt: `${today}T12:00:00Z`, createdAt: `${today}T10:00:00Z`, status: 'sent', kind: 'externalTransfer', counterpartyName: 'Customer Co' }];
    await signIn(env, fake, 10);
    const credits = await req(env, 10, '/api/revenue/projects/1/mercury-credits');
    assert.equal(credits.status, 200, credits.text);
    assert.deepEqual(credits.body.credits.map((i: any) => [i.transaction_id, i.amount_cents, i.last_four]), [[fakeTx(1), 25000, '4242']]);
    await signIn(env, fake, 30);
    const accounts = await req(env, 30, '/api/mercury/attestations/accounts');
    assert.equal(accounts.status, 200, accounts.text);
    assert.deepEqual(accounts.body.accounts.map((a: any) => a.last_four), ['4242', '1357']);
    ddl(db, 'engagements'); db.exec(mig('188_engagement_invoices.sql'));
    await signIn(env, fake, 20);
    const matches = await req(env, 20, '/api/mercury/personal/matches?target=invoice');
    assert.equal(matches.status, 200, matches.text);
    assert.deepEqual(fake.toolCalls().filter((t: string) => !['getOrganization', 'getAccounts', 'listTransactions'].includes(t)), []);
    assert.equal(fake.calls.filter((c: any) => c.method === 'GET' && c.path.startsWith('/api/v1')).length, 0, 'the banking API was not called');
  } finally { off(); }
});

test('3. refresh: an expired token is refreshed and stored; a refused refresh asks the member to sign in again', async () => {
  const { db, env, fake, off } = await setup();
  try {
    await signIn(env, fake, 30);
    const before = await decryptCredentials(env, row(db, 30).uid, row(db, 30).credentials_enc) as any;
    fake.expireAccess();
    const ok = await req(env, 30, '/api/mercury/attestations/accounts');
    assert.equal(ok.status, 200, ok.text);
    assert.equal(fake.calls.filter((c: any) => c.grant_type === 'refresh_token').length, 1);
    const after = await decryptCredentials(env, row(db, 30).uid, row(db, 30).credentials_enc) as any;
    assert.notEqual(after.access_token, before.access_token);
    assert.notEqual(after.refresh_token, before.refresh_token);
    assert.ok(fake.state.access.has(after.access_token));
    // An access token that is about to expire is refreshed before the first call.
    db.prepare('UPDATE integrations SET credentials_enc = ? WHERE uid = ?').run(
      await (await import('../src/integrations/secrets.ts')).encryptCredentials(env, row(db, 30).uid, { ...after, expires_at: Date.now() + 1000 }), row(db, 30).uid);
    const n = fake.calls.filter((c: any) => c.rpc === 'initialize').length;
    assert.equal((await req(env, 30, '/api/mercury/attestations/accounts')).status, 200);
    assert.equal(fake.calls.filter((c: any) => c.grant_type === 'refresh_token').length, 2);
    assert.equal(fake.calls.filter((c: any) => c.rpc === 'initialize').length, n + 1, 'no 401 round trip');

    fake.expireAccess();
    fake.state.failRefresh = 1;
    const refused = await req(env, 30, '/api/mercury/attestations/accounts');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code ?? refused.body.error, 'mercury_reconnect_required');
    assert.match(refused.body.message, /Sign in with Mercury again/);
    assert.equal(row(db, 30).status, 'error');
    assert.equal(row(db, 30).last_error, 'token_rejected');

    // The refresh itself marks the row, whatever its caller does next.
    const { refreshCredentials, mcpCredentialsOf } = await import('../src/services/mercury/oauth.ts');
    db.prepare("UPDATE integrations SET status = 'active', last_error = NULL WHERE user_id = 30").run();
    fake.state.failRefresh = 1;
    assert.equal(await refreshCredentials(env, row(db, 30), (await mcpCredentialsOf(env, row(db, 30)))!), null);
    assert.equal(row(db, 30).status, 'error');
  } finally { off(); }
});

test('4. disconnect revokes the grant and deletes the row; a pasted token no longer replaces a sign-in (D881)', async () => {
  const { db, env, fake, off } = await setup();
  try {
    await signIn(env, fake, 20);
    const uid = row(db, 20).uid;
    const del = await req(env, 20, `/api/integrations/${uid}`, { method: 'DELETE' });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);
    assert.equal(row(db, 20), undefined);
    assert.equal(fake.state.access.size, 0);

    await signIn(env, fake, 10);
    const signedUid = row(db, 10).uid;
    // D881 (#2554): a token is refused before anything is read, and the sign-in stands, unrevoked.
    const pasted = await req(env, 10, '/api/integrations/connect', { method: 'POST', body: { provider_key: 'mercury', api_key: 'fixture-not-a-token-9', config: { confirm_read_only: true } } });
    assert.deepEqual([pasted.status, pasted.body?.error], [410, 'token_connect_retired'], pasted.text);
    assert.equal(row(db, 10).uid, signedUid, 'the same row');
    assert.equal(row(db, 10).auth_type, 'oauth_mcp');
    assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token'], 'only the disconnect revoked');
  } finally { off(); }
});

test('5. state and CSRF: each forgery is refused before any code is exchanged', async () => {
  const { db, env, fake, off } = await setup();
  try {
    const exchanged = () => fake.calls.filter((c: any) => c.grant_type === 'authorization_code').length;
    const cases: Array<[string, Parameters<typeof signIn>[3], string]> = [
      ['another user\'s state', { as: 20 }, 'invalid_state'],
      ['a forged signature', { state: (s) => `${s.split('.')[0]}.AAAA` }, 'invalid_state'],
      ['no cookie', { cookie: null }, 'csrf_mismatch'],
      ['another browser\'s cookie', { cookie: 'not-the-cookie' }, 'csrf_mismatch'],
      ['Mercury\'s own error', { error: true }, 'access_denied'],
    ];
    for (const [name, tamper, reason] of cases) {
      const { cb } = await signIn(env, fake, 10, tamper);
      assert.equal(cb.status, 302, name);
      assert.deepEqual(outcome(cb.location), { oauth: 'error', provider: 'mercury', reason }, name);
      assert.ok(CALLBACK_REASONS.includes(reason as any));
    }
    assert.equal(exchanged(), 0);
    assert.equal(row(db, 10), undefined);
    assert.equal(row(db, 20), undefined);

    const ok = await signIn(env, fake, 10);
    assert.deepEqual(outcome(ok.cb.location).oauth, 'ok');
    const replay = await req(env, 10, `/api/integrations/mercury/oauth/callback?code=${encodeURIComponent(ok.code)}&state=${encodeURIComponent(ok.state)}`, { cookie: `${CSRF_COOKIE}=${ok.cookie}` });
    assert.deepEqual(outcome(replay.location), { oauth: 'error', provider: 'mercury', reason: 'invalid_state' });
    assert.equal(exchanged(), 1, 'the replay exchanged nothing');
    // A state is consumed even when the callback fails, so the honest retry cannot reuse it.
    const err = await signIn(env, fake, 20, { error: true });
    const after = await req(env, 20, `/api/integrations/mercury/oauth/callback?code=${encodeURIComponent(err.code)}&state=${encodeURIComponent(err.state)}`, { cookie: `${CSRF_COOKIE}=${err.cookie}` });
    assert.equal(outcome(after.location).reason, 'invalid_state');
  } finally { off(); }
});

test('6. the grant: a scope beyond read, or an Axal entity\'s organization, is revoked and stores nothing', async () => {
  const { db, env, fake, off } = await setup();
  try {
    fake.state.scope = 'read write';
    const wide = await signIn(env, fake, 10);
    assert.equal(outcome(wide.cb.location).reason, 'scope_refused');
    assert.equal(row(db, 10), undefined);
    assert.deepEqual(fake.state.revoked, ['refresh_token', 'access_token']);

    fake.state.scope = 'read offline_access';
    fake.state.data.organization = { id: 'org-axal', legalBusinessName: 'Axal VC Management, LLC' };
    const entity = await signIn(env, fake, 10);
    assert.equal(outcome(entity.cb.location).reason, 'mercury_entity_account');
    assert.equal(row(db, 10), undefined);
    assert.equal(fake.state.revoked.length, 4);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'integration_oauth_failed'"), 2);
  } finally { off(); }
});

test('7. who: an admin is answered 404 and a support session 403, and nothing reaches Mercury; an investor signs in on a branch too (D884)', async () => {
  const { env, fake, off } = await setup();
  try {
    assert.equal((await req(env, 1, '/api/integrations/mercury/oauth/start')).status, 404);
    const support = await req(env, 10, '/api/integrations/mercury/oauth/start', { impersonated: true });
    assert.equal(support.status, 403);
    assert.equal(support.body.code ?? support.body.error, 'support_session_refused');
    assert.equal(fake.calls.length, 0);
    for (const who of [10, 20, 30]) assert.equal((await req(env, who, '/api/integrations/mercury/oauth/start', { branch: true })).status, 200, `role ${who} on a branch`);
    assert.equal((await req(env, 30, '/api/integrations/mercury/oauth/start')).status, 200);
  } finally { off(); }
});

test('8. no token, code or verifier reaches a log, a log row or a response', async () => {
  const logged: string[] = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(keep) as Array<keyof typeof keep>) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); };
  const { db, env, fake, off } = await setup();
  const responses: string[] = [];
  try {
    const a = await signIn(env, fake, 10);
    responses.push(a.start.text, a.cb.text, a.cb.location!);
    fake.expireAccess();
    responses.push((await req(env, 10, '/api/revenue/projects/1/mercury-credits')).text);
    fake.state.scope = 'read write';
    const b = await signIn(env, fake, 20);
    responses.push(b.cb.text, b.cb.location!);
    responses.push((await req(env, 10, `/api/integrations/${row(db, 10).uid}`, { method: 'DELETE' })).text);
  } finally { off(); Object.assign(console, keep); }
  const rows = JSON.stringify([
    db.prepare('SELECT * FROM integration_logs').all(),
    db.prepare('SELECT * FROM activity_logs').all(),
  ]);
  const secrets = /fake-access-|fake-refresh-|fake-code-/;
  for (const line of logged) assert.doesNotMatch(line, secrets, 'a log line');
  assert.doesNotMatch(rows, secrets, 'a log row');
  for (const r of responses) assert.doesNotMatch(r ?? '', secrets, 'a response');
  assert.doesNotMatch(rows, /code_verifier|pkce/i);
});

test('9. mercuryAccessFor: the member\'s own active sign-in, read through the MCP server; null for a token, no row or an error row', async () => {
  const { mercuryAccessFor } = await import('../src/services/mercury/oauth.ts');
  const { openMercuryReads } = await import('../src/services/mercury/reads.ts');
  const { db, env, fake, off } = await setup();
  try {
    assert.equal(await mercuryAccessFor(env, 10), null, 'no row');
    await signIn(env, fake, 10);
    const access = await mercuryAccessFor(env, 10);
    assert.ok(access);
    assert.deepEqual(access!.scopes, ['read', 'offline_access']);
    assert.equal((await (await openMercuryReads(access!)).organization()).legal_name, 'Own Venture Inc');
    assert.equal(await mercuryAccessFor(env, 20), null, 'another member\'s sign-in is never this one\'s');
    const { connected } = await import('./_mercury_personal_d713.ts');
    await connected(db, env, 20);
    assert.equal(await mercuryAccessFor(env, 20), null, 'a pasted token is not a sign-in');
    db.prepare("UPDATE integrations SET status = 'error' WHERE user_id = 10").run();
    assert.equal(await mercuryAccessFor(env, 10), null, 'a row needing attention');
  } finally { off(); }
});
