/**
 * D6957 (#6957) — Sign in with Apple: /config, /start, the form_post
 * /callback, account resolution, linking, and the middleware entries.
 *
 * HOW IT IS DRIVEN. The real `auth_apple.ts` router over HTTP, against a
 * node:sqlite database whose tables are sliced verbatim from
 * `schema_baseline.sql`, plus migration 282 (`security_events`) and this
 * task's own migration, both read off disk. `globalThis.fetch` plays Apple:
 * its keys URL answers a real RS256 public key and its token endpoint answers
 * an id_token signed with the private half. Any other outbound call fails.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_apple_6957.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT, generateKeyPair, exportJWK, exportPKCS8, jwtVerify, decodeProtectedHeader } from 'jose';
import { Hono } from 'hono';

import authApple, { __testing as stateTesting, nameFromAppleUser } from '../src/routes/auth_apple.ts';
import {
  APPLE_KEYS_URL, APPLE_TOKEN_URL, appleClientSecret, appleIsAuthoritative, hashNonce,
  __testing as jwksTesting,
} from '../src/services/appleIdToken.ts';
import { createJWT } from '../src/auth.ts';
import { csrfMiddleware } from '../src/middleware/csrf.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6957-0123456789-abcdef';
const SERVICES_ID = 'vc.axal.web.signin';
const TEAM_ID = 'TEAM123456';
const KEY_ID = 'KEY7654321';
const ORIGIN = 'https://axal.vc';
const KID = 'apple-kid-6957';
const SUB = '001234.abcdef0123456789abcdef0123456789.1234';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION_282 = read('cloudflare-worker/sql/migrations/282_security_events.sql');
const MIGRATION_APPLE = read('cloudflare-worker/sql/migrations/202611161900_6957_user_apple_links.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'activity_logs', 'onboarding_progress', 'limited_partners']) db.exec(ddl(t));
  db.exec(MIGRATION_282);
  db.exec(MIGRATION_APPLE);
  return db;
}

function kv() {
  const m = new Map<string, string>();
  return { m, async get(k: string) { return m.get(k) ?? null; }, async put(k: string, v: string) { m.set(k, v); }, async delete(k: string) { m.delete(k); } };
}

const signingKey = await generateKeyPair('ES256', { extractable: true });
const P8 = await exportPKCS8(signingKey.privateKey);

function envFor(db: any, over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db), RATE_LIMITS: kv(), TOKENS: kv(),
    APP_URL: ORIGIN, PUBLIC_BASE_URL: ORIGIN,
    APPLE_SIGNIN_SERVICES_ID: SERVICES_ID, APPLE_SIGNIN_TEAM_ID: TEAM_ID,
    APPLE_SIGNIN_KEY_ID: KEY_ID, APPLE_SIGNIN_PRIVATE_KEY: P8,
    ...over,
  } as any;
}

// ─────────────────────────────────────────────────────────── Apple ──

const pair = await generateKeyPair('RS256', { extractable: true });
const stranger = await generateKeyPair('RS256', { extractable: true });
const JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
// A fixed clock (D5614): the route, the verifier and the tokens all read Date.
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-16T12:00:00.000Z') });
const nowSec = () => Math.floor(Date.now() / 1000);

function claims(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    iss: 'https://appleid.apple.com', aud: SERVICES_ID, sub: SUB,
    email: 'x7k2p9@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true',
    iat: nowSec() - 5, exp: nowSec() + 595, ...over,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return base;
}
const idToken = (over: Record<string, unknown> = {}, key = pair.privateKey) =>
  new SignJWT(claims(over)).setProtectedHeader({ alg: 'RS256', kid: KID }).sign(key);

type Calls = { token: URLSearchParams[]; keys: number; other: string[] };

async function withApple<T>(tokenAnswer: string | Response, fn: (calls: Calls) => Promise<T>): Promise<T> {
  const calls: Calls = { token: [], keys: 0, other: [] };
  const real = globalThis.fetch;
  jwksTesting.resetJwks();
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url === APPLE_TOKEN_URL) {
      calls.token.push(new URLSearchParams(String(init?.body ?? '')));
      if (tokenAnswer instanceof Response) return tokenAnswer;
      return new Response(JSON.stringify({ id_token: tokenAnswer, access_token: 'unused', token_type: 'Bearer' }), { headers: { 'content-type': 'application/json' } });
    }
    if (url === APPLE_KEYS_URL) {
      calls.keys += 1;
      return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'content-type': 'application/json' } });
    }
    calls.other.push(url);
    throw new Error(`unexpected outbound call to ${url}`);
  }) as typeof fetch;
  try {
    const out = await fn(calls);
    assert.deepEqual(calls.other, [], 'the route called something other than Apple');
    return out;
  } finally {
    globalThis.fetch = real;
  }
}

// ─────────────────────────────────────────────────────────── requests ──

const setCookies = (res: Response) => res.headers.getSetCookie();
const count = (db: any, sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as any).n);
const NONCE = 'n0nce-for-this-browser-6957';

async function stateFor(env: any, over: Record<string, unknown> = {}) {
  return stateTesting.signState(env, { n: NONCE, ts: nowSec(), action: 'signin', redirect: '/dashboard', ...over } as any);
}

async function callback(env: any, fields: Record<string, string>, { cookie = `studioos_apple_state=${NONCE}` }: { cookie?: string | null } = {}) {
  const headers: Record<string, string> = {
    host: 'axal.vc', 'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://appleid.apple.com', 'cf-connecting-ip': '198.51.100.9',
  };
  if (cookie) headers.cookie = cookie;
  const res = await authApple.fetch(new Request(`${ORIGIN}/callback`, { method: 'POST', headers, body: new URLSearchParams(fields).toString() }), env);
  return { status: res.status, location: res.headers.get('location') || '', res };
}

async function goodFields(env: any, tokenOver: Record<string, unknown> = {}, stateOver: Record<string, unknown> = {}) {
  return {
    code: 'c0de-from-apple.0.abcd',
    state: await stateFor(env, stateOver),
    id_token: await idToken({ nonce: await hashNonce(NONCE), ...tokenOver }),
  };
}

function seedUser(db: any, { id, email, verified = 1, active = 1 }: { id: number; email: string; verified?: number; active?: number }) {
  db.prepare('INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, 'Seeded Person', 'founder', verified, active);
}

function assertNothingWritten(db: any, label: string, users = 0) {
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), users, `${label}: users changed`);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_apple_links'), 0, `${label}: a link was written`);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0, `${label}: a session was minted`);
}
const noSession = (res: Response) => !setCookies(res).some((c) => c.startsWith('studioos_auth=') && !c.includes('Max-Age=0'));

// ─────────────────────────────────────────────────────────── /config ──

test('/config answers configured only with all four settings, from env alone', async () => {
  const get = async (env: any) => {
    const res = await authApple.fetch(new Request(`${ORIGIN}/config`), env);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return res.json() as Promise<any>;
  };
  assert.deepEqual(await get({}), { configured: false });
  assert.deepEqual(await get({ APPLE_SIGNIN_SERVICES_ID: SERVICES_ID, APPLE_SIGNIN_TEAM_ID: TEAM_ID, APPLE_SIGNIN_KEY_ID: KEY_ID }), { configured: false });
  const on = await get(envFor(freshDb()));
  assert.deepEqual(on, { configured: true });
  assert.ok(!JSON.stringify(on).includes('PRIVATE'));
});

// ─────────────────────────────────────────────────────────── /start ──

test('/start: Apple form_post URL, a SameSite=None one-shot cookie, nonce = SHA-256 of the cookie', async () => {
  const env = envFor(freshDb());
  const res = await authApple.fetch(new Request(`${ORIGIN}/start?redirect=%2Fgrow%2Finvite%2Fabc&lane=investor`, { headers: { host: 'axal.vc' } }), env);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('location')!);
  assert.equal(url.origin + url.pathname, 'https://appleid.apple.com/auth/authorize');
  assert.equal(url.searchParams.get('client_id'), SERVICES_ID);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://axal.vc/api/auth/apple/callback');
  assert.equal(url.searchParams.get('response_type'), 'code id_token');
  assert.equal(url.searchParams.get('response_mode'), 'form_post');
  assert.equal(url.searchParams.get('scope'), 'name email');
  const cookie = setCookies(res).find((c) => c.startsWith('studioos_apple_state='))!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/, 'a Lax cookie is not sent on Apple\'s cross-site POST');
  assert.match(cookie, /Path=\/api\/auth\/apple/);
  assert.match(cookie, /Max-Age=600/);
  const nonce = cookie.split(';')[0].split('=')[1];
  assert.equal(url.searchParams.get('nonce'), await hashNonce(nonce));
  const st = await stateTesting.verifyState(env, url.searchParams.get('state')!);
  assert.equal(st?.n, nonce);
  assert.equal(st?.redirect, '/grow/invite/abc');
  assert.equal(st?.lane, 'investor');
  assert.equal(st?.action, 'signin');
});

test('/start: a disallowed destination becomes /dashboard; JSON callers get the URL; link needs a session', async () => {
  const env = envFor(freshDb());
  for (const bad of ['https://evil.example/x', '//evil.example', '/x\u0001y']) {
    const res = await authApple.fetch(new Request(`${ORIGIN}/start?redirect=${encodeURIComponent(bad)}`, { headers: { host: 'axal.vc' } }), env);
    const st = await stateTesting.verifyState(env, new URL(res.headers.get('location')!).searchParams.get('state')!);
    assert.equal(st?.redirect, '/dashboard', bad);
  }
  const json = await authApple.fetch(new Request(`${ORIGIN}/start`, { headers: { host: 'axal.vc', accept: 'application/json' } }), env);
  assert.equal(json.status, 200);
  assert.match((await json.json() as any).url, /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
  const link = await authApple.fetch(new Request(`${ORIGIN}/start?action=link`, { headers: { host: 'axal.vc' } }), env);
  assert.equal(link.status, 401);
});

test('/start unconfigured: back to the chooser with not_configured (JSON: 503), no cookie', async () => {
  const res = await authApple.fetch(new Request(`${ORIGIN}/start`, { headers: { host: 'axal.vc' } }), { PUBLIC_BASE_URL: ORIGIN } as any);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://axal.vc/login?apple_error=not_configured');
  assert.deepEqual(setCookies(res), []);
  const json = await authApple.fetch(new Request(`${ORIGIN}/start`, { headers: { accept: 'application/json' } }), {} as any);
  assert.equal(json.status, 503);
  assert.equal((await json.json() as any).code, 'not_configured');
});

// ─────────────────────────────────────────────────────── new accounts ──

test('a Hide My Email first sign-in creates the account, links it, mints an apple session and lands on onboarding', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async (calls) => {
    const fields = { ...(await goodFields(env)), user: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' }, email: 'x7k2p9@privaterelay.appleid.com' }) };
    const r = await callback(env, fields);
    assert.equal(r.status, 303);
    assert.equal(r.location, 'https://axal.vc/onboarding?apple=ok&apple_signup=1');
    assert.ok(setCookies(r.res).some((c) => c.startsWith('studioos_auth=') && !c.includes('Max-Age=0')), 'no session cookie');
    assert.ok(setCookies(r.res).some((c) => c.startsWith('studioos_apple_state=;') && c.includes('Max-Age=0')), 'the nonce cookie was not cleared');
    // The exchange: our Services ID, the registered return URL, and an ES256 client secret.
    assert.equal(calls.token.length, 1);
    const sent = calls.token[0];
    assert.equal(sent.get('client_id'), SERVICES_ID);
    assert.equal(sent.get('redirect_uri'), 'https://axal.vc/api/auth/apple/callback');
    assert.equal(sent.get('grant_type'), 'authorization_code');
    assert.equal(sent.get('code'), 'c0de-from-apple.0.abcd');
    assert.equal(decodeProtectedHeader(sent.get('client_secret')!).kid, KEY_ID);
  });
  const u = db.prepare('SELECT * FROM users').get() as any;
  assert.equal(u.email, 'x7k2p9@privaterelay.appleid.com');
  assert.equal(u.name, 'Ada Lovelace');
  assert.equal(u.role, 'exploring');
  assert.equal(Number(u.email_verified), 1);
  const link = db.prepare('SELECT * FROM user_apple_links').get() as any;
  assert.equal(link.apple_sub, SUB);
  assert.equal(Number(link.user_id), Number(u.id));
  assert.equal(Number(link.private_email), 1);
  assert.equal((db.prepare('SELECT factor FROM user_sessions').get() as any).factor, 'apple');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM onboarding_progress WHERE user_id = ?', u.id), 1);
});

test('returning with the same Apple ID, with no name and no email, reuses the account', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async () => { assert.equal((await callback(env, await goodFields(env))).status, 303); });
  db.prepare('DELETE FROM user_sessions').run();
  const noEmail = { email: undefined, email_verified: undefined, is_private_email: undefined };
  await withApple(await idToken(noEmail), async () => {
    const r = await callback(env, await goodFields(env, noEmail, { redirect: '/portfolio/7' }));
    assert.equal(r.location, 'https://axal.vc/portfolio/7?apple=ok', 'a returning member goes to the original destination');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 1);
});

test('a new account keeps an explicit destination (an invitation) instead of onboarding', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async () => {
    const r = await callback(env, await goodFields(env, {}, { redirect: '/grow/invite/abc?x=1' }));
    assert.equal(r.location, 'https://axal.vc/grow/invite/abc?x=1&apple=ok&apple_signup=1');
  });
});

// D4580 part 2 (#4580): a kept Grow destination with a fragment. The marker goes in the query, the fragment stays
// last, so the SPA reads `apple=ok` and probes /me for the cookie-only session instead of sending the person to /login.
test('#4580: a destination with a fragment keeps the marker in the query and the fragment last', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async () => {
    const r = await callback(env, await goodFields(env, {}, { redirect: '/grow/talent?tab=open#roles' }));
    assert.equal(r.location, 'https://axal.vc/grow/talent?tab=open&apple=ok&apple_signup=1#roles');
  });
  db.prepare('DELETE FROM user_sessions').run();
  await withApple(await idToken(), async () => {
    const r = await callback(env, await goodFields(env, {}, { redirect: '/grow/talent#roles' }));
    assert.equal(r.location, 'https://axal.vc/grow/talent?apple=ok#roles');
  });
});

// ─────────────────────────────────────────────── existing accounts ──

test('an existing verified account with an iCloud address is linked on first Apple sign-in', async () => {
  const db = freshDb();
  seedUser(db, { id: 41, email: 'ada@icloud.com' });
  const env = envFor(db);
  const real = { email: 'Ada@iCloud.com', is_private_email: 'false' };
  await withApple(await idToken(real), async () => {
    const r = await callback(env, await goodFields(env, real));
    assert.equal(r.location, 'https://axal.vc/dashboard?apple=ok');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 1);
  assert.equal(Number((db.prepare('SELECT user_id FROM user_apple_links').get() as any).user_id), 41);
});

test('ownership is not assumed: a non-Apple address, an unverified account or an inactive account writes nothing', async () => {
  const cases: Array<[string, (db: any) => void, Record<string, unknown>, string, number]> = [
    ['gmail on an existing account', (db) => seedUser(db, { id: 5, email: 'ada@gmail.com' }), { email: 'ada@gmail.com', is_private_email: false }, 'link_requires_email_proof', 1],
    ['gmail with no account', () => {}, { email: 'new@gmail.com', is_private_email: false }, 'link_requires_email_proof', 0],
    ['unverified Axal account', (db) => seedUser(db, { id: 6, email: 'ada@icloud.com', verified: 0 }), { email: 'ada@icloud.com', is_private_email: false }, 'link_blocked_unverified', 1],
    ['inactive account', (db) => seedUser(db, { id: 7, email: 'ada@icloud.com', active: 0 }), { email: 'ada@icloud.com', is_private_email: false }, 'account_inactive', 1],
    ['no email and no link', () => {}, { email: undefined, email_verified: undefined, is_private_email: undefined }, 'email_missing', 0],
  ];
  for (const [label, seed, over, code, users] of cases) {
    const db = freshDb();
    seed(db);
    const env = envFor(db);
    await withApple(await idToken(over), async () => {
      const r = await callback(env, await goodFields(env, over, { redirect: '/grow/x' }));
      assert.equal(r.location, `https://axal.vc/login?apple_error=${code}&next=%2Fgrow%2Fx`, label);
      assert.ok(noSession(r.res), `${label}: session cookie`);
    });
    assertNothingWritten(db, label, users);
    const ev = db.prepare('SELECT factor, outcome, detail FROM security_events').all() as any[];
    assert.deepEqual(ev.map((e) => [e.factor, e.outcome, e.detail]), [['apple', 'refused', code]], label);
  }
});

test('an inactive account found by its linked Apple ID is refused', async () => {
  const db = freshDb();
  seedUser(db, { id: 9, email: 'x7k2p9@privaterelay.appleid.com', active: 0 });
  db.prepare('INSERT INTO user_apple_links (user_id, apple_sub) VALUES (9, ?)').run(SUB);
  const env = envFor(db);
  await withApple(await idToken(), async () => {
    const r = await callback(env, await goodFields(env));
    assert.equal(r.location, 'https://axal.vc/login?apple_error=account_inactive');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
});

// ─────────────────────────────────────────── refusals before Apple ──

test('cancellation and provider errors return to a usable chooser, keeping the destination, with no call to Apple', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async (calls) => {
    const r = await callback(env, { error: 'user_cancelled_authorize', state: await stateFor(env, { redirect: '/grow/x' }) });
    assert.equal(r.location, 'https://axal.vc/login?apple_error=cancelled&next=%2Fgrow%2Fx');
    const p = await callback(env, { error: 'invalid_request', state: 'junk' });
    assert.equal(p.location, 'https://axal.vc/login?apple_error=provider_error');
    assert.equal(calls.token.length, 0);
    assert.equal(calls.keys, 0);
  });
  assertNothingWritten(db, 'cancel');
});

test('invalid or stale callbacks and replay: no exchange, no account, no session', async () => {
  const db = freshDb();
  const env = envFor(db);
  const other = envFor(db, { JWT_SECRET: 'some-other-secret-0123456789-abcdefghij' });
  const nonce = await hashNonce(NONCE);
  const cases: Array<[string, () => Promise<Record<string, string>>, string | null, string]> = [
    ['forged state', async () => ({ ...(await goodFields(env)), state: await stateFor(other) }), `studioos_apple_state=${NONCE}`, 'bad_state'],
    ['stale state', async () => ({ ...(await goodFields(env)), state: await stateFor(env, { ts: nowSec() - 601 }) }), `studioos_apple_state=${NONCE}`, 'bad_state'],
    ['no nonce cookie (another browser, or a replay)', async () => goodFields(env), null, 'bad_state'],
    ['a different browser\'s cookie', async () => goodFields(env), 'studioos_apple_state=someone-elses-nonce', 'bad_state'],
    ['no code', async () => { const f = await goodFields(env); return { state: f.state, id_token: f.id_token }; }, `studioos_apple_state=${NONCE}`, 'missing_code'],
  ];
  await withApple(await idToken(), async (calls) => {
    for (const [label, fields, cookie, code] of cases) {
      const r = await callback(env, await fields(), { cookie });
      assert.ok(r.location.startsWith(`https://axal.vc/login?apple_error=${code}`), `${label}: ${r.location}`);
      assert.ok(noSession(r.res), label);
    }
    assert.equal(calls.token.length, 0, 'a refused callback still exchanged the code');
  });
  assertNothingWritten(db, 'refusals');
  void nonce;
});

test('id_token checks: nonce, audience, issuer, expiry and signature are each refused before the exchange', async () => {
  const db = freshDb();
  const env = envFor(db);
  const nonce = await hashNonce(NONCE);
  const bad: Array<[string, () => Promise<string>]> = [
    ['nonce', () => idToken({ nonce: 'someone-elses-nonce' })],
    ['no nonce', () => idToken({})],
    ['audience', () => idToken({ nonce, aud: 'another.services.id' })],
    ['issuer', () => idToken({ nonce, iss: 'https://evil.example' })],
    ['expired', () => idToken({ nonce, iat: nowSec() - 4000, exp: nowSec() - 3000 })],
    ['signature', () => idToken({ nonce }, stranger.privateKey)],
  ];
  await withApple(await idToken(), async (calls) => {
    for (const [label, tok] of bad) {
      const r = await callback(env, { code: 'c', state: await stateFor(env), id_token: await tok() });
      assert.equal(r.location, 'https://axal.vc/login?apple_error=token_invalid', label);
    }
    assert.equal(calls.token.length, 0);
  });
  assertNothingWritten(db, 'token checks');
});

test('a failed exchange, or a token endpoint answer for another subject, writes nothing', async () => {
  for (const [label, answer, code] of [
    ['invalid_grant', new Response('{"error":"invalid_grant"}', { status: 400 }), 'exchange_failed'],
    ['other subject', null, 'token_invalid'],
    ['other nonce', 'nonce', 'token_invalid'],
  ] as const) {
    const db = freshDb();
    const env = envFor(db);
    const tokenAnswer = answer === null ? await idToken({ sub: '009999.other' })
      : answer === 'nonce' ? await idToken({ nonce: 'another-attempt' }) : answer;
    await withApple(tokenAnswer as any, async (calls) => {
      const r = await callback(env, await goodFields(env));
      assert.equal(r.location, `https://axal.vc/login?apple_error=${code}`, label);
      assert.equal(calls.token.length, 1);
    });
    assertNothingWritten(db, label);
  }
});

test('replaying a successful POST in the same browser fails: the nonce cookie was cleared', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withApple(await idToken(), async (calls) => {
    const fields = await goodFields(env);
    const first = await callback(env, fields);
    assert.equal(first.status, 303);
    assert.ok(first.location.includes('apple=ok'));
    // The browser applied Max-Age=0, so the replay arrives without the cookie.
    const replay = await callback(env, fields, { cookie: null });
    assert.equal(replay.location, 'https://axal.vc/login?apple_error=bad_state');
    assert.equal(calls.token.length, 1);
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 1);
});

// ─────────────────────────────────────────────────────────── linking ──

test('link from Settings: ownership is the signed-in session; already linked and owned-by-other are refused', async () => {
  const db = freshDb();
  seedUser(db, { id: 21, email: 'ada@gmail.com' });
  seedUser(db, { id: 22, email: 'bob@example.test' });
  const env = envFor(db);
  // /start?action=link reads the session.
  const jti = 'jti-link-6957';
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor) VALUES (21, ?, 'magic_link')").run(jti);
  const jwt = await createJWT(env, 21, 'ada@gmail.com', 'founder', undefined, jti);
  const start = await authApple.fetch(new Request(`${ORIGIN}/start?action=link&redirect=%2Faccount%2Fsecurity`, { headers: { host: 'axal.vc', cookie: `studioos_auth=${jwt}` } }), env);
  assert.equal(start.status, 302, await start.clone().text());
  const st = await stateTesting.verifyState(env, new URL(start.headers.get('location')!).searchParams.get('state')!);
  assert.equal(st?.action, 'link');
  assert.equal(st?.uid, 21);

  const gmail = { email: 'ada@gmail.com', is_private_email: false };
  await withApple(await idToken(gmail), async () => {
    const r = await callback(env, await goodFields(env, gmail, { action: 'link', uid: 21, redirect: '/account/security' }));
    assert.equal(r.location, 'https://axal.vc/account/security?apple_linked=1');
    assert.ok(noSession(r.res), 'a link mints no new session');
  });
  assert.equal(Number((db.prepare('SELECT user_id FROM user_apple_links WHERE apple_sub = ?').get(SUB) as any).user_id), 21);
  // Now the same Apple ID signs in to that account, even though Apple is not authoritative for gmail.
  db.prepare('DELETE FROM user_sessions').run();
  await withApple(await idToken(gmail), async () => {
    assert.equal((await callback(env, await goodFields(env, gmail))).location, 'https://axal.vc/dashboard?apple=ok');
  });
  await withApple(await idToken(gmail), async () => {
    const again = await callback(env, await goodFields(env, gmail, { action: 'link', uid: 21 }));
    assert.equal(again.location, 'https://axal.vc/account/security?apple_error=already_linked');
    const other = await callback(env, await goodFields(env, gmail, { action: 'link', uid: 22 }));
    assert.equal(other.location, 'https://axal.vc/account/security?apple_error=sub_owned_by_other');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_apple_links'), 1);
});

// ─────────────────────────────────────────────────────── pure pieces ──

test('the client secret is the ES256 JWT Apple specifies', async () => {
  const now = nowSec();
  const secret = await appleClientSecret({ servicesId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: P8.replace(/\n/g, '\\n') }, now);
  const { payload, protectedHeader } = await jwtVerify(secret, signingKey.publicKey, { algorithms: ['ES256'] });
  assert.equal(protectedHeader.kid, KEY_ID);
  assert.equal(payload.iss, TEAM_ID);
  assert.equal(payload.sub, SERVICES_ID);
  assert.equal(payload.aud, 'https://appleid.apple.com');
  assert.equal(payload.iat, now);
  assert.ok(Number(payload.exp) - now <= 300);
});

test('Apple is authoritative for relay and iCloud mailboxes only; the first-authorization name is bounded', () => {
  assert.equal(appleIsAuthoritative('a@privaterelay.appleid.com', true), true);
  for (const e of ['a@icloud.com', 'a@me.com', 'a@mac.com']) assert.equal(appleIsAuthoritative(e, false), true, e);
  for (const e of ['a@gmail.com', 'a@icloud.com.evil.example', 'a@privaterelay.appleid.com.evil.example', '']) {
    assert.equal(appleIsAuthoritative(e, true), false, e);
  }
  assert.equal(nameFromAppleUser(JSON.stringify({ name: { firstName: ' Ada ', lastName: 'L' } })), 'Ada L');
  assert.equal(nameFromAppleUser('{not json'), null);
  assert.equal(nameFromAppleUser(undefined), null);
  assert.equal(nameFromAppleUser(JSON.stringify({ name: {} })), null);
});

test('the callback is exempt from cookie CSRF; other auth POSTs with a session cookie are not', async () => {
  const app = new Hono();
  app.use('/api/*', csrfMiddleware());
  app.post('/api/auth/apple/callback', (c) => c.text('ok'));
  app.post('/api/auth/google/popup', (c) => c.text('ok'));
  const headers = { cookie: 'studioos_auth=some.jwt.value' };
  assert.equal((await app.fetch(new Request('https://axal.vc/api/auth/apple/callback', { method: 'POST', headers }), {} as any)).status, 200);
  assert.equal((await app.fetch(new Request('https://axal.vc/api/auth/google/popup', { method: 'POST', headers }), {} as any)).status, 403);
});

test('the rate limiter knows the callback bucket and exempts /config', () => {
  const src = read('cloudflare-worker/src/middleware/rateLimit.ts');
  assert.match(src, /name: 'apple_callback',[\s\S]{0,120}p === '\/api\/auth\/apple\/callback'/);
  assert.match(src, /RATE_LIMIT_EXEMPT = \[[\s\S]*'\/api\/auth\/apple\/config'/);
});
