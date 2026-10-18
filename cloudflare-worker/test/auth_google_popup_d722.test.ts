/**
 * D722 — "Continue with Google" through Google's own window: GET /config and
 * POST /popup, the shared account and session helpers /callback now uses too,
 * the redirect fallback's state cookie (its Domain, and that it is the only
 * binding), the switch, Google's authority over an address, and the two
 * rate-limit entries.
 *
 * HOW IT IS DRIVEN. The real `auth_google.ts` router over HTTP, against a
 * node:sqlite database whose tables are sliced verbatim from
 * `schema_baseline.sql` (plus migration 282's `security_events`, off disk).
 * `globalThis.fetch` is swapped for a recorder that plays Google: the token
 * endpoint answers an id_token signed with a real RS256 key, and the certs URL
 * answers that key's public JWK under its `kid`. Any other outbound call fails
 * the test. The env is production-shaped (`ENVIRONMENT: 'production'`), so the
 * origin rule under test is the strict one.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_google_popup_d722.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { Hono } from 'hono';

import authGoogle, { __testing as stateTesting } from '../src/routes/auth_google.ts';
import { rateLimitMiddleware } from '../src/middleware/rateLimit.ts';
import { requireFactor, requireStepUp, createJWT } from '../src/auth.ts';
import { GOOGLE_CERTS_URL, __testing as jwksTesting } from '../src/services/googleIdToken.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d722-0123456789-abcdef';
const CLIENT = 'test-client-id';
const SECRET = 'test-client-secret';
const IP = '198.51.100.72';
const ORIGIN = 'https://axal.vc';
const STATE = 'A'.repeat(21) + '_' + 'b'.repeat(20) + '-'; // 43 base64url characters
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const KID = 'kid-d722-route';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION_282 = read('cloudflare-worker/sql/migrations/282_security_events.sql');

/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

const TABLES = ['users', 'user_sessions', 'activity_logs', 'user_google_links', 'onboarding_progress'];

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  db.exec(MIGRATION_282);
  return db;
}

function kv() {
  const m = new Map<string, string>();
  return {
    m,
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

function envFor(db: any, over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db), RATE_LIMITS: kv(), TOKENS: kv(),
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc', OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc',
    GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_AUTH_CLIENT_SECRET: SECRET, GOOGLE_SIGNIN_POPUP: 'on',
    ...over,
  } as any;
}

// ─────────────────────────────────────────────────────────── Google ──

const pair = await generateKeyPair('RS256', { extractable: true });
const stranger = await generateKeyPair('RS256', { extractable: true });
const JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

const nowSec = () => Math.floor(Date.now() / 1000);
function claims(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT,
    sub: '111222333444555666777', email: 'founder.d722@example.test', email_verified: true,
    // example.test plays a Google Workspace domain, so Google is authoritative
    // for these addresses (rules 2 and 4 apply). The consumer-account case is
    // its own test, with `hd: undefined`.
    hd: 'example.test',
    name: 'Ada Founder', iat: nowSec() - 5, exp: nowSec() + 3595, ...over,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return base;
}
async function idToken(over: Record<string, unknown> = {}, { key = pair.privateKey, kid = KID } = {}) {
  return new SignJWT(claims(over)).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).sign(key);
}

type Calls = { token: URLSearchParams[]; certs: number; other: string[] };

/**
 * Play Google for one request. `tokenAnswer` is the token endpoint's reply:
 * an id_token string, or a Response for the failure cases.
 */
async function withGoogle<T>(
  tokenAnswer: string | Response | null,
  fn: (calls: Calls) => Promise<T>,
  { certs: certsAnswer }: { certs?: () => Response } = {},
): Promise<T> {
  const calls: Calls = { token: [], certs: 0, other: [] };
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url === TOKEN_URL) {
      calls.token.push(new URLSearchParams(String(init?.body ?? '')));
      if (tokenAnswer instanceof Response) return tokenAnswer;
      return new Response(JSON.stringify({ id_token: tokenAnswer, access_token: 'ya29.unused', token_type: 'Bearer' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === GOOGLE_CERTS_URL) {
      calls.certs += 1;
      if (certsAnswer) return certsAnswer();
      return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'content-type': 'application/json' } });
    }
    calls.other.push(url);
    throw new Error(`unexpected outbound call to ${url}`);
  }) as typeof fetch;
  try {
    const out = await fn(calls);
    assert.deepEqual(calls.other, [], 'the route called something other than Google');
    return out;
  } finally {
    globalThis.fetch = real;
  }
}

// ─────────────────────────────────────────────────────────── requests ──

function popupHeaders(over: Record<string, string | null> = {}) {
  const h: Record<string, string | null> = {
    host: 'axal.vc',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XmlHttpRequest',
    'content-type': 'application/json',
    cookie: `studioos_google_popup=${STATE}`,
    'cf-connecting-ip': IP,
    ...over,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== null) out[k] = v;
  return out;
}

async function popup(env: any, body: unknown = { code: '4/0AQSTgQ-test-code', state: STATE }, headers: Record<string, string | null> = {}) {
  const res = await authGoogle.fetch(new Request(`${ORIGIN}/popup`, {
    method: 'POST',
    headers: popupHeaders(headers),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any, res };
}

const setCookies = (res: Response) => res.headers.getSetCookie();
const count = (db: any, sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as any).n);
const events = (db: any) => db.prepare('SELECT kind, factor, outcome, detail, user_id FROM security_events ORDER BY id').all()
  .map((r: any) => [r.kind, r.factor, r.outcome, r.detail, r.user_id]);

function seedUser(db: any, { id, email, verified = 1, active = 1, role = 'founder' }: { id: number; email: string; verified?: number; active?: number; role?: string }) {
  db.prepare('INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, 'Seeded Person', role, verified, active);
}

// ─────────────────────────────────────────────────────────── /config ──

async function config(env: any, query = '') {
  const res = await authGoogle.fetch(new Request(`${ORIGIN}/config${query}`), env);
  return { status: res.status, body: await res.json() as any, res };
}

test('/config: unconfigured, configured with the window off, and on', async () => {
  const off = await config({ ENVIRONMENT: 'production' });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { configured: false, popup: false, client_id: null });
  // The flag alone does not make a client: both the ID and the secret are needed.
  const half = await config({ GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_SIGNIN_POPUP: 'on' });
  assert.deepEqual(half.body, { configured: false, popup: false, client_id: null });

  const flagOff = await config({ GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_AUTH_CLIENT_SECRET: SECRET, GOOGLE_SIGNIN_POPUP: 'off' });
  assert.deepEqual(flagOff.body, { configured: true, popup: false, client_id: null }, 'the client ID is handed out only when the window is on');
  const unset = await config({ GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_AUTH_CLIENT_SECRET: SECRET });
  assert.deepEqual(unset.body, { configured: true, popup: false, client_id: null }, 'unset is off');

  const on = await config({ GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_AUTH_CLIENT_SECRET: SECRET, GOOGLE_SIGNIN_POPUP: 'on' });
  assert.deepEqual(on.body, { configured: true, popup: true, client_id: CLIENT });
  for (const r of [off, flagOff, on]) {
    assert.equal(r.res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(setCookies(r.res), [], '/config set a cookie');
  }
  // No DB, no KV bound at all — it answers from env alone. The secret is
  // never in the answer.
  assert.ok(!JSON.stringify(on.body).includes(SECRET));
});

test('/config canary: the window is offered only to a page that asks with ?canary=1', async () => {
  const env = { GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_AUTH_CLIENT_SECRET: SECRET, GOOGLE_SIGNIN_POPUP: 'canary' };
  assert.deepEqual((await config(env)).body, { configured: true, popup: false, client_id: null }, 'canary offered the window to everyone');
  assert.deepEqual((await config(env, '?canary=0')).body, { configured: true, popup: false, client_id: null });
  assert.deepEqual((await config(env, '?canary=1')).body, { configured: true, popup: true, client_id: CLIENT });
  // ?canary=1 cannot switch the window on where the switch is off...
  const off = { ...env, GOOGLE_SIGNIN_POPUP: 'off' };
  assert.deepEqual((await config(off, '?canary=1')).body, { configured: true, popup: false, client_id: null });
  // ...nor where the client is not configured.
  assert.deepEqual((await config({ GOOGLE_AUTH_CLIENT_ID: CLIENT, GOOGLE_SIGNIN_POPUP: 'canary' }, '?canary=1')).body,
    { configured: false, popup: false, client_id: null });
  // "on" serves everyone, with or without the query.
  const on = { ...env, GOOGLE_SIGNIN_POPUP: 'on' };
  assert.equal((await config(on, '?canary=1')).body.popup, true);
});

test('the switch closes POST /popup itself: off (or unset) is 503 popup_off before Google or the database is touched; canary accepts', async () => {
  for (const flag of ['off', undefined, 'yes']) {
    const db = freshDb();
    await withGoogle(await idToken(), async (calls) => {
      const r = await popup(envFor(db, { GOOGLE_SIGNIN_POPUP: flag }));
      assert.equal(r.status, 503, String(flag));
      assert.equal(r.body.code, 'popup_off', String(flag));
      assert.equal(typeof r.body.error, 'string');
      assert.ok(!setCookies(r.res).some((x) => x.startsWith('studioos_auth=')));
      assert.equal(calls.token.length, 0, 'the switch was off and the code still went to Google');
      assert.equal(calls.certs, 0);
    });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
    assert.deepEqual(events(db), []);
  }
  const db = freshDb();
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db, { GOOGLE_SIGNIN_POPUP: 'canary' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

// ─────────────────────────────────────────────── refusals before Google ──

test('a foreign Origin, a missing X-Requested-With, or Sec-Fetch-Site cross-site is 403 and nothing leaves for Google', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withGoogle(await idToken(), async (calls) => {
    for (const [label, over] of [
      ['foreign origin', { origin: 'https://evil.example' }],
      ['the other host', { origin: 'https://app.axal.vc' }],
      ['no origin', { origin: null }],
      ['no X-Requested-With', { 'x-requested-with': null }],
      ['a different X-Requested-With', { 'x-requested-with': 'fetch' }],
      ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site' }],
      ['same-site fetch metadata', { 'sec-fetch-site': 'same-site' }],
    ] as Array<[string, Record<string, string | null>]>) {
      const r = await popup(env, undefined, over);
      assert.equal(r.status, 403, label);
      assert.equal(r.body.code, 'bad_origin', label);
      assert.equal(typeof r.body.error, 'string', label);
    }
    assert.equal(calls.token.length, 0, 'a refused request still reached the token endpoint');
    assert.equal(calls.certs, 0);
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0);
  assert.deepEqual(events(db), [], 'a bad origin is not a refused credential and is not recorded');
});

test('outside production the dev servers are admitted, and a missing Sec-Fetch-Site is tolerated in production', async () => {
  const db = freshDb();
  await withGoogle(await idToken(), async () => {
    const dev = await popup(envFor(db, { ENVIRONMENT: 'development' }), undefined,
      { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' });
    assert.equal(dev.status, 200, JSON.stringify(dev.body));
  });
  const db2 = freshDb();
  await withGoogle(await idToken(), async () => {
    const prod = await popup(envFor(db2), undefined, { 'sec-fetch-site': null });
    assert.equal(prod.status, 200, JSON.stringify(prod.body));
    const devInProd = await popup(envFor(db2), undefined, { origin: 'http://localhost:5173' });
    assert.equal(devInProd.status, 403, 'production admitted a localhost origin');
  });
});

test('a body that is not the expected JSON is 400; a missing or different state cookie is bad_state — before any exchange', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withGoogle(await idToken(), async (calls) => {
    for (const body of ['not json', { state: STATE }, { code: 'x', state: 'short' }, { code: 'has space', state: STATE }, { code: 'x'.repeat(1025), state: STATE }]) {
      const r = await popup(env, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.code, 'bad_request');
    }
    const none = await popup(env, undefined, { cookie: null });
    assert.equal(none.status, 403);
    assert.equal(none.body.code, 'bad_state');
    const other = await popup(env, undefined, { cookie: `studioos_google_popup=${'Z'.repeat(43)}` });
    assert.equal(other.body.code, 'bad_state');
    // The right value under another name is not the cookie.
    const renamed = await popup(env, undefined, { cookie: `studioos_google_state=${STATE}` });
    assert.equal(renamed.body.code, 'bad_state');
    assert.equal(calls.token.length, 0);
  });
  assert.deepEqual(events(db), [], 'a stale attempt is not a refused credential');
});

test('unconfigured is 503 not_configured, not a 401', async () => {
  const r = await popup(envFor(freshDb(), { GOOGLE_AUTH_CLIENT_SECRET: undefined }));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'not_configured');
});

test('a token endpoint refusal is 502 exchange_failed and recorded; the exchange names redirect_uri=postmessage', async () => {
  const db = freshDb();
  const env = envFor(db);
  await withGoogle(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }), async (calls) => {
    const r = await popup(env);
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'exchange_failed');
    assert.equal(calls.token.length, 1);
    const sent = calls.token[0];
    assert.equal(sent.get('redirect_uri'), 'postmessage');
    assert.equal(sent.get('grant_type'), 'authorization_code');
    assert.equal(sent.get('client_id'), CLIENT);
    assert.equal(sent.get('client_secret'), SECRET);
    assert.equal(sent.get('code'), '4/0AQSTgQ-test-code');
    // The attempt is spent: the state cookie is cleared on the refusal too.
    assert.ok(setCookies(r.res).some((s) => /^studioos_google_popup=;/.test(s) && /Max-Age=0/.test(s)));
  });
  assert.deepEqual(events(db), [['signin', 'google', 'refused', 'exchange_failed', null]]);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
});

// ─────────────────────────────────────────────── the token, one change each ──

test('each id_token mutation is refused, and none signs anyone in', async () => {
  const cases: Array<[string, () => Promise<string>, number, string]> = [
    ['foreign key', () => idToken({}, { key: stranger.privateKey }), 502, 'token_invalid'],
    ['unknown kid', () => idToken({}, { key: stranger.privateKey, kid: 'kid-nobody-published' }), 502, 'token_invalid'],
    ['wrong iss', () => idToken({ iss: 'https://accounts.example.test' }), 502, 'token_invalid'],
    ['foreign aud', () => idToken({ aud: 'someone-elses-client' }), 502, 'token_invalid'],
    ['foreign azp', () => idToken({ azp: 'someone-elses-client' }), 502, 'token_invalid'],
    ['expired', () => idToken({ exp: nowSec() - 400 }), 502, 'token_invalid'],
    ['iat in the future', () => idToken({ iat: nowSec() + 400 }), 502, 'token_invalid'],
    ['email not verified', () => idToken({ email_verified: false }), 403, 'email_unverified_at_google'],
    ['no sub', () => idToken({ sub: undefined }), 502, 'token_invalid'],
  ];
  for (const [label, make, status, code] of cases) {
    const db = freshDb();
    await withGoogle(await make(), async () => {
      const r = await popup(envFor(db));
      assert.equal(r.status, status, label);
      assert.equal(r.body.code, code, label);
      assert.ok(!setCookies(r.res).some((s) => s.startsWith('studioos_auth=')), `${label} set a session cookie`);
    });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0, label);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0, label);
    assert.deepEqual(events(db).map((e: any[]) => e[3]), [code === 'token_invalid' ? 'token_invalid' : 'email_unverified'], label);
  }
});

// ─────────────────────────────────────────────────────────── mapping ──

test('rule 1: a known sub signs that user in, whatever email Google now reports', async () => {
  const db = freshDb();
  seedUser(db, { id: 41, email: 'work.address@example.test' });
  db.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (41, ?)').run('111222333444555666777');
  await withGoogle(await idToken({ email: 'personal@example.test' }), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, 41);
    assert.equal(r.body.new_signup, false);
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 1, 'a second account was created');
});

test('rule 2: a verified row matched case-insensitively is linked to the sub and signed in', async () => {
  const db = freshDb();
  seedUser(db, { id: 42, email: 'Founder.D722@Example.test' });
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, 42);
  });
  assert.deepEqual(db.prepare('SELECT user_id, google_sub FROM user_google_links').all().map((x: any) => ({ ...x })),
    [{ user_id: 42, google_sub: '111222333444555666777' }]);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'google_account_auto_linked'`), 1);
});

test('rule 3: an unverified row is 409, with no link, no session and no new account', async () => {
  const db = freshDb();
  seedUser(db, { id: 43, email: 'founder.d722@example.test', verified: 0 });
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'link_blocked_unverified');
    assert.match(r.body.error, /Email me a sign-in link/);
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 1);
  assert.deepEqual(events(db), [['signin', 'google', 'refused', 'link_blocked_unverified', 43]]);
});

test('rule 4: an unknown email gets an exploring account, verified, with its onboarding row, link and lane', async () => {
  const db = freshDb();
  await withGoogle(await idToken({ email: 'New.Person@Example.test', name: 'New Person' }), async () => {
    const r = await popup(envFor(db), { code: '4/0AQSTgQ-test-code', state: STATE, lane: 'Founder' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.new_signup, true);
    assert.equal(r.body.user.email, 'new.person@example.test');
    assert.equal(r.body.user.role, 'exploring');
  });
  const u = db.prepare('SELECT id, email, name, role, email_verified FROM users').all().map((x: any) => ({ ...x }));
  assert.equal(u.length, 1);
  assert.deepEqual({ ...u[0], id: undefined }, { id: undefined, email: 'new.person@example.test', name: 'New Person', role: 'exploring', email_verified: 1 });
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM onboarding_progress WHERE user_id = ? AND flow = 'licence'`, u[0].id), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links WHERE user_id = ? AND google_sub = ?', u[0].id, '111222333444555666777'), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_registered_google'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_login_google_signup'`), 1);
  assert.equal((db.prepare('SELECT suggested_role FROM user_role_review WHERE user_id = ?').get(u[0].id) as any)?.suggested_role, 'founder');
});

test('an inactive account is refused before it is linked — by email and by sub', async () => {
  const db = freshDb();
  seedUser(db, { id: 44, email: 'founder.d722@example.test', active: 0 });
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'account_inactive');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0, 'the inactive account was linked');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
  assert.deepEqual(events(db), [['signin', 'google', 'refused', 'inactive', 44]]);

  const db2 = freshDb();
  seedUser(db2, { id: 45, email: 'other@example.test', active: 0 });
  db2.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (45, ?)').run('111222333444555666777');
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db2));
    assert.equal(r.body.code, 'account_inactive');
  });
  assert.equal(count(db2, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
});

test('different_account: the typed email is neither Google’s nor the matched account’s, so nothing is created', async () => {
  const db = freshDb();
  await withGoogle(await idToken({ email: 'personal.d722@example.test' }), async () => {
    const r = await popup(envFor(db), { code: '4/0AQSTgQ-test-code', state: STATE, expected_email: 'Work.D722@Example.test' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'different_account');
    assert.equal(r.body.google_email, 'personal.d722@example.test');
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0, 'a chooser mistake opened an application');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0);
  assert.deepEqual(events(db), [], 'a different account is not a refused credential');

  // The typed address equal to Google's, in any case, is fine.
  await withGoogle(await idToken({ email: 'personal.d722@example.test' }), async () => {
    const r = await popup(envFor(db), { code: 'c', state: STATE, expected_email: 'PERSONAL.d722@example.test' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
  // ...and so is the matched account's own address when Google reports another.
  const db2 = freshDb();
  seedUser(db2, { id: 46, email: 'work.d722@example.test' });
  db2.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (46, ?)').run('111222333444555666777');
  await withGoogle(await idToken({ email: 'personal.d722@example.test' }), async () => {
    const r = await popup(envFor(db2), { code: 'c', state: STATE, expected_email: 'work.d722@example.test' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, 46);
  });
  // A malformed typed address is ignored, not used to refuse.
  const db3 = freshDb();
  await withGoogle(await idToken(), async () => {
    const r = await popup(envFor(db3), { code: 'c', state: STATE, expected_email: 'not-an-email' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

// ─────────────────────────────────────────────────────────── the session ──

test('the session: factor google, no assurance, passkey-shaped answer, three cookies, and the gates still refuse it', async () => {
  const db = freshDb();
  seedUser(db, { id: 47, email: 'founder.d722@example.test', role: 'founder' });
  db.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (47, ?)').run('111222333444555666777');
  const env = envFor(db);
  const r = await withGoogle(await idToken(), () => popup(env));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['csrf_token', 'expires_in', 'new_signup', 'token', 'user']);
  assert.deepEqual(r.body.user, { id: 47, email: 'founder.d722@example.test', name: 'Seeded Person', role: 'founder' });
  assert.equal(r.body.expires_in, 86400);
  assert.equal(r.body.new_signup, false);

  const rows = db.prepare('SELECT user_id, factor, assurance_level, step_up_due_at, ip FROM user_sessions').all().map((x: any) => ({ ...x }));
  assert.deepEqual(rows, [{ user_id: 47, factor: 'google', assurance_level: null, step_up_due_at: null, ip: IP }]);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_login_google'`), 1);

  const cookies = setCookies(r.res);
  const auth = cookies.find((s) => s.startsWith('studioos_auth='));
  const csrf = cookies.find((s) => s.startsWith('studioos_csrf='));
  const cleared = cookies.find((s) => s.startsWith('studioos_google_popup='));
  assert.ok(auth && /HttpOnly/.test(auth) && /Domain=\.axal\.vc/.test(auth), String(auth));
  assert.ok(csrf && csrf.includes(r.body.csrf_token) && /Domain=\.axal\.vc/.test(csrf), String(csrf));
  assert.ok(cleared && /^studioos_google_popup=;/.test(cleared) && /Max-Age=0/.test(cleared) && /Path=\/api\/auth\/google/.test(cleared), String(cleared));
  assert.ok(auth!.includes(r.body.token), 'the cookie and the token are different sessions');

  // One factor, never a TOTP substitute, never a step-up (the D200 gate pattern).
  const gate = new Hono();
  const run = (fn: (c: any) => Promise<unknown>) => async (c: any) => {
    try { await fn(c); return c.json({ ok: true }); } catch (e) { return c.json({ error: (e as Error).message }, 403); }
  };
  gate.get('/factor', run((c) => requireFactor(c, 'totp')));
  gate.get('/stepup', run((c) => requireStepUp(c)));
  const call = async (path: string) => {
    const res = await gate.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${r.body.token}`, 'cf-connecting-ip': IP } }), env);
    return { status: res.status, body: await res.json() as any };
  };
  assert.deepEqual(await call('/factor'), { status: 403, body: { error: 'TOTP required' } });
  assert.deepEqual(await call('/stepup'), { status: 403, body: { error: 'step_up_required' } });
});

test('the certs are fetched once for two sign-ins', async () => {
  jwksTesting.resetJwks();
  const db = freshDb();
  seedUser(db, { id: 48, email: 'founder.d722@example.test' });
  let certs = 0;
  await withGoogle(await idToken(), async (calls) => { assert.equal((await popup(envFor(db))).status, 200); certs += calls.certs; });
  await withGoogle(await idToken(), async (calls) => { assert.equal((await popup(envFor(db))).status, 200); certs += calls.certs; });
  assert.equal(certs, 1, 'every sign-in refetched Google’s keys');
});

test('an unexpected throw is 500 internal_error, and the message is not echoed', async () => {
  const db = freshDb();
  const env = envFor(db);
  env.DB = { prepare() { throw new Error('secret-ish internal detail'); } };
  const r = await withGoogle(await idToken(), () => popup(env));
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'internal_error');
  assert.ok(!JSON.stringify(r.body).includes('secret-ish'));
});

// ─────────────────────────────────────── the redirect fallback, unchanged ──

const NONCE = 'n'.repeat(22);

async function startedState(env: any, extra: Partial<{ redirect: string; lane: string }> = {}) {
  return stateTesting.signState(env, {
    n: NONCE, ts: Math.floor(Date.now() / 1000), action: 'signin', redirect: extra.redirect || '/dashboard', lane: extra.lane,
  } as any);
}

/** The browser that ran /start: it carries the nonce in `studioos_google_state`. */
async function callback(env: any, state: string, cookie: string | null = `studioos_google_state=${NONCE}`) {
  return authGoogle.fetch(new Request(`https://app.axal.vc/callback?code=cb-code&state=${encodeURIComponent(state)}`, {
    headers: { host: 'app.axal.vc', 'cf-connecting-ip': IP, ...(cookie ? { cookie } : {}) },
  }), env);
}

test('/callback, through the shared helpers, still lands on ?google=ok and exchanges with its registered URI', async () => {
  const db = freshDb();
  seedUser(db, { id: 49, email: 'founder.d722@example.test' });
  const env = envFor(db);
  const state = await startedState(env);
  const res = await withGoogle(await idToken(), async (calls) => {
    const out = await callback(env, state);
    assert.equal(calls.token[0].get('redirect_uri'), 'https://app.axal.vc/api/auth/google/callback');
    return out;
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://axal.vc/dashboard?google=ok');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = 49 AND factor = 'google'`), 1);
  assert.ok(setCookies(res).some((s) => s.startsWith('studioos_auth=')));

  // A fresh signup still goes to onboarding with the signup marker.
  const db2 = freshDb();
  const env2 = envFor(db2);
  const state2 = await startedState(env2);
  const res2 = await withGoogle(await idToken({ email: 'brand.new@example.test' }), () => callback(env2, state2));
  assert.equal(res2.headers.get('location'), 'https://axal.vc/onboarding?google=ok&google_signup=1');
  assert.equal((db2.prepare('SELECT role FROM users').get() as any).role, 'exploring');
});

test('/callback now refuses an inactive account before linking it, and keeps its unverified refusal', async () => {
  const db = freshDb();
  seedUser(db, { id: 50, email: 'founder.d722@example.test', active: 0 });
  const env = envFor(db);
  const res = await withGoogle(await idToken(), async () => callback(env, await startedState(env)));
  assert.equal(res.headers.get('location'), 'https://axal.vc/login?google_error=account_inactive');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0, '/callback linked an inactive account before refusing it');

  const db2 = freshDb();
  seedUser(db2, { id: 51, email: 'founder.d722@example.test', verified: 0 });
  const env2 = envFor(db2);
  const res2 = await withGoogle(await idToken(), async () => callback(env2, await startedState(env2)));
  assert.equal(res2.headers.get('location'), 'https://axal.vc/login?google_error=link_blocked_unverified');
});

test('/start puts the session Domain on the state cookie on HQ, and stays host-only on localhost', async () => {
  const start = async (host: string) => {
    const env = envFor(freshDb());
    const res = await authGoogle.fetch(new Request(`https://${host}/start?redirect=/studio`, {
      headers: { host, accept: 'application/json', 'cf-connecting-ip': IP },
    }), env);
    assert.equal(res.status, 200);
    return setCookies(res).find((s) => s.startsWith('studioos_google_state='))!;
  };
  const hq = await start('axal.vc');
  assert.match(hq, /Path=\/api\/auth\/google; Domain=\.axal\.vc;/);
  assert.match(hq, /HttpOnly/);
  const local = await start('localhost');
  assert.ok(!/Domain=/.test(local), local);
});

test('/callback signs in only the browser that ran /start: the state cookie is the binding, and KV is not consulted', async () => {
  // Login CSRF, as the review's probe ran it: the attacker runs /start in
  // their own browser, completes Google with their own account, and opens the
  // callback URL in the victim's browser. The victim's browser has no cookie,
  // or another attempt's.
  for (const [label, cookie] of [
    ['no cookie', null],
    ['another attempt’s cookie', `studioos_google_state=${'x'.repeat(22)}`],
    ['the right value under another name', `studioos_google_popup=${NONCE}`],
    ['a prefix of the nonce', `studioos_google_state=${NONCE.slice(0, 21)}`],
  ] as Array<[string, string | null]>) {
    const db = freshDb();
    const env = envFor(db);
    const state = await startedState(env);
    // Even a KV record shaped exactly like the one /start used to write
    // must not stand in for the cookie.
    await env.TOKENS.put(`gstate:${state.slice(state.indexOf('.') + 1)}`, NONCE);
    const res = await withGoogle(await idToken({ email: 'attacker.d722@example.test', sub: '4242' }), async (calls) => {
      const out = await callback(env, state, cookie);
      assert.equal(calls.token.length, 0, `${label}: the code went to Google`);
      return out;
    });
    assert.equal(res.status, 302, label);
    assert.equal(res.headers.get('location'), 'https://axal.vc/login?google_error=bad_state', label);
    assert.ok(!setCookies(res).some((x) => x.startsWith('studioos_auth=')), `${label}: a session cookie was set`);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0, label);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0, label);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0, label);
  }

  // The browser that ran /start — a real /start, read back from its own
  // Set-Cookie — is signed in, and /start no longer writes KV at all.
  const db = freshDb();
  seedUser(db, { id: 52, email: 'founder.d722@example.test' });
  const env = envFor(db);
  const started = await authGoogle.fetch(new Request('https://axal.vc/start?redirect=/dashboard', {
    headers: { host: 'axal.vc', accept: 'application/json', 'cf-connecting-ip': IP },
  }), env);
  assert.equal(env.TOKENS.m.size, 0, '/start still writes a KV record nothing reads');
  const state = new URL(((await started.json()) as any).url).searchParams.get('state')!;
  const set = setCookies(started).find((x) => x.startsWith('studioos_google_state='))!;
  const nonce = set.slice('studioos_google_state='.length, set.indexOf(';'));
  const res = await withGoogle(await idToken(), () => callback(env, state, `studioos_google_state=${nonce}`));
  assert.equal(res.headers.get('location'), 'https://axal.vc/dashboard?google=ok');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = 52'), 1);
  const cleared = setCookies(res).filter((x) => x.startsWith('studioos_google_state=;'));
  assert.equal(cleared.length, 2, 'clear both the Domain cookie and any host-only one left from before');
  assert.ok(cleared.some((x) => /Domain=\.axal\.vc/.test(x)));
});

test('/callback accepts the matching cookie beside a stale host-only one, in either order', async () => {
  for (const cookie of [
    `studioos_google_state=${'s'.repeat(22)}; studioos_google_state=${NONCE}`,
    `studioos_google_state=${NONCE}; studioos_google_state=${'s'.repeat(22)}`,
  ]) {
    const db = freshDb();
    seedUser(db, { id: 53, email: 'founder.d722@example.test' });
    const env = envFor(db);
    const res = await withGoogle(await idToken(), async () => callback(env, await startedState(env), cookie));
    assert.equal(res.headers.get('location'), 'https://axal.vc/dashboard?google=ok', cookie);
  }
});

// ───────────────────────────────────── Google's authority over an address ──

test('rules 2 and 4 need Google to be authoritative for the address: a consumer account on an address Google does not host is refused', async () => {
  // Rule 2: a verified Axal row with that address. A former holder of the
  // inbox with a consumer Google account on it must not be linked into it.
  const db = freshDb();
  seedUser(db, { id: 60, email: 'ops.d722@company.example' });
  await withGoogle(await idToken({ email: 'ops.d722@company.example', hd: undefined }), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'link_requires_email_proof');
    assert.match(r.body.error, /Email me a sign-in link/);
    assert.match(r.body.error, /Link Google/);
    assert.ok(!setCookies(r.res).some((x) => x.startsWith('studioos_auth=')));
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_google_links'), 0, 'the consumer account was linked');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
  assert.deepEqual(events(db), [['signin', 'google', 'refused', 'link_requires_email_proof', 60]]);

  // Rule 4: no row. The account is not pre-created for the real owner to walk into.
  const db2 = freshDb();
  await withGoogle(await idToken({ email: 'role.d722@company.example', hd: undefined }), async () => {
    const r = await popup(envFor(db2));
    assert.equal(r.body.code, 'link_requires_email_proof');
  });
  assert.equal(count(db2, 'SELECT COUNT(*) AS n FROM users'), 0, 'an account was created on an address Google cannot vouch for');
  assert.equal(count(db2, 'SELECT COUNT(*) AS n FROM user_google_links'), 0);

  // The redirect fallback follows the same rule through the same helper.
  const db3 = freshDb();
  seedUser(db3, { id: 61, email: 'ops.d722@company.example' });
  const env3 = envFor(db3);
  const res = await withGoogle(await idToken({ email: 'ops.d722@company.example', hd: undefined }), async () => callback(env3, await startedState(env3)));
  assert.equal(res.headers.get('location'), 'https://axal.vc/login?google_error=link_requires_email_proof');
  assert.equal(count(db3, 'SELECT COUNT(*) AS n FROM user_google_links'), 0);
});

test('Google is authoritative for gmail.com and for a Workspace account, and rule 1 never asks', async () => {
  // gmail.com with no hd: rule 4 creates the account.
  const db = freshDb();
  await withGoogle(await idToken({ email: 'ada.d722@gmail.com', hd: undefined }), async () => {
    const r = await popup(envFor(db));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.new_signup, true);
  });
  // A Workspace account (hd set) on another of the org's domains: rule 2 links.
  const db2 = freshDb();
  seedUser(db2, { id: 62, email: 'ada.d722@alias.example' });
  await withGoogle(await idToken({ email: 'ada.d722@alias.example', hd: 'company.example' }), async () => {
    const r = await popup(envFor(db2));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, 62);
  });
  assert.equal(count(db2, 'SELECT COUNT(*) AS n FROM user_google_links WHERE user_id = 62'), 1);
  // A sub already linked (through Settings, inside an email-link session)
  // signs in whatever the address.
  const db3 = freshDb();
  seedUser(db3, { id: 63, email: 'ops.d722@company.example' });
  db3.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (63, ?)').run('111222333444555666777');
  await withGoogle(await idToken({ email: 'ops.d722@company.example', hd: undefined }), async () => {
    const r = await popup(envFor(db3));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, 63);
  });
});

// ──────────────────────────────── the previous person's session is revoked ──

test('a sign-in revokes the previous person’s session the request carried — Bearer on /popup, cookie on /callback (Task #4)', async () => {
  for (const via of ['popup', 'callback'] as const) {
    const db = freshDb();
    seedUser(db, { id: 99, email: 'previous.d722@example.test', role: 'admin' });
    seedUser(db, { id: 47, email: 'founder.d722@example.test' });
    db.prepare('INSERT INTO user_google_links (user_id, google_sub) VALUES (47, ?)').run('111222333444555666777');
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor) VALUES (99, 'jti-previous-d722', 'totp')").run();
    const env = envFor(db);
    const stale = await createJWT(env, 99, 'previous.d722@example.test', 'admin', undefined, 'jti-previous-d722');
    await withGoogle(await idToken(), async () => {
      if (via === 'popup') {
        const r = await popup(env, undefined, { authorization: `Bearer ${stale}` });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.user.id, 47);
      } else {
        const res = await callback(env, await startedState(env), `studioos_google_state=${NONCE}; studioos_auth=${stale}`);
        assert.equal(res.headers.get('location'), 'https://axal.vc/dashboard?google=ok');
      }
    });
    const row = db.prepare("SELECT revoked_at FROM user_sessions WHERE jti = 'jti-previous-d722'").get() as any;
    assert.ok(row.revoked_at, `${via}: the previous person's session is still live`);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'session_revoked_on_signin'`), 1, via);
    // The new person's own session is untouched.
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = 47 AND revoked_at IS NULL'), 1, via);
  }
});

// ─────────────────────────────── Google's keys not answering is not recorded ──

test('Google’s certs not answering is 502 token_invalid and is NOT recorded as a refused credential (D200)', async () => {
  jwksTesting.resetJwks();
  try {
    const db = freshDb();
    await withGoogle(await idToken(), async (calls) => {
      const r = await popup(envFor(db));
      assert.equal(r.status, 502);
      assert.equal(r.body.code, 'token_invalid');
      assert.ok(calls.certs >= 1, 'the certs were never asked');
    }, { certs: () => new Response('unavailable', { status: 503 }) });
    assert.deepEqual(events(db), [], 'a keys outage was written to security_events as if the token were bad');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_sessions'), 0);
    // The control: a token Google's keys do refuse IS recorded, so the empty
    // ledger above is the outage rule and not a ledger that records nothing.
    jwksTesting.resetJwks();
    const db2 = freshDb();
    await withGoogle(await idToken({}, { key: stranger.privateKey }), async () => {
      assert.equal((await popup(envFor(db2))).body.code, 'token_invalid');
    });
    assert.deepEqual(events(db2).map((e: any[]) => e[3]), ['token_invalid']);
  } finally { jwksTesting.resetJwks(); }
});

// ─────────────────────────────────────────────────────────── the limiter ──

function limited() {
  const app = new Hono();
  let handled = 0;
  app.use('/api/*', rateLimitMiddleware());
  app.all('/api/*', (c) => { handled += 1; return c.json({ ok: true }); });
  const store = new Map<string, string>();
  let touched = 0;
  const env: any = {
    RATE_LIMITS: {
      get: async (k: string) => { touched += 1; return store.get(k); },
      put: async (k: string, v: string) => { touched += 1; store.set(k, v); },
    },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null }) }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
  const req = (method: string, path: string, ip = IP) =>
    app.request(path, { method, headers: { 'cf-connecting-ip': ip } }, env, ctx);
  return { env, req, handled: () => handled, touched: () => touched };
}

test('google_popup: the sixty-first POST in a minute from one IP is 429; nothing else is in the bucket', async () => {
  const previousNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const l = limited();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await l.req('POST', '/api/auth/google/popup')).status);
    assert.deepEqual(statuses, [...Array(60).fill(200), 429]);
    const blocked = await l.req('POST', '/api/auth/google/popup');
    assert.equal(blocked.headers.get('x-ratelimit-bucket'), 'google_popup');
    // Another IP, a GET, and the sibling routes are not in this bucket.
    assert.equal((await l.req('POST', '/api/auth/google/popup', '203.0.113.9')).status, 200);
    assert.equal((await l.req('GET', '/api/auth/google/popup')).status, 200);
    assert.equal((await l.req('GET', '/api/auth/google/start')).status, 200);
    assert.equal((await l.req('POST', '/api/auth/google/popupx')).status, 200);
  } finally { Date.now = previousNow; }
});

test('google_popup is fail-open like every other sign-in path; /config is exempt and never touches KV', async () => {
  // A KV outage (the 2026-09-12 shape) must not close the main way in while
  // the redirect beside it, which creates accounts by the same rules, stays up.
  const l = limited();
  l.env.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
  const r = await l.req('POST', '/api/auth/google/popup');
  assert.equal(r.status, 200, 'a KV outage refused Google sign-in');
  assert.equal(l.handled(), 1);

  // Exempt means the limiter never reads or writes KV for it at all — a
  // healthy store, so a non-exempt path's generic buckets WOULD touch it...
  const ok = limited();
  const cfg = await ok.req('GET', '/api/auth/google/config');
  assert.equal(cfg.status, 200);
  assert.equal(ok.touched(), 0, '/config reached the limiter');
  // ...and the sibling it is not: /start is still counted (D74).
  assert.equal((await ok.req('GET', '/api/auth/google/start')).status, 200);
  assert.ok(ok.touched() > 0, 'the control path did not touch KV, so the exemption check above proves nothing');
  // A KV outage cannot turn the window off either.
  const down = limited();
  down.env.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
  assert.equal((await down.req('GET', '/api/auth/google/config')).status, 200, 'a KV outage turned the window off');
});

test('/config skips the cold-start role-schema repair; both wrangler blocks declare the same popup switch', () => {
  const index = read('cloudflare-worker/src/index.ts');
  const list = index.slice(index.indexOf('const ROLE_SCHEMA_SAFE_ANONYMOUS_READS'), index.indexOf('function requiresBlockingRoleSchemaBootstrap'));
  assert.ok(list.includes("'/api/auth/google/config'"));
  assert.ok(!list.includes("'/api/auth/google/popup'"), 'the sign-in write must not skip the schema repair');

  const toml = read('wrangler.toml');
  const block = (name: string) => {
    const at = toml.indexOf(`\n[${name}]\n`);
    assert.ok(at >= 0, `[${name}] is missing`);
    const next = toml.indexOf('\n[', at + 2);
    return toml.slice(at, next < 0 ? undefined : next);
  };
  const flag = (b: string) => (b.match(/^GOOGLE_SIGNIN_POPUP\s*=\s*"([^"]*)"/m) || [])[1];
  const top = flag(block('vars'));
  const prod = flag(block('env.production.vars'));
  assert.ok(top === 'on' || top === 'canary' || top === 'off', `top-level GOOGLE_SIGNIN_POPUP is ${top}`);
  assert.equal(prod, top, 'production and the top level disagree on the popup switch — flip both in one PR');
});

test('every /popup refusal is a sentence with a code, and none is a 401', () => {
  const src = codeOnly(read('cloudflare-worker/src/routes/auth_google.ts'));
  const at = src.indexOf("authGoogle.post('/popup'");
  assert.ok(at > 0);
  const handler = src.slice(at, src.indexOf('\n});', at));
  const refusals = [...handler.matchAll(/popupRefuse\(c,\s*(\d+),\s*'([a-z_]+)'/g)].map((m) => [Number(m[1]), m[2]]);
  assert.ok(refusals.length >= 10, `found ${refusals.length} refusals`);
  for (const [status, code] of refusals) assert.notEqual(status, 401, `${code} answers 401`);
  assert.ok(!/c\.json\(\s*\{\s*error/.test(handler), 'a refusal bypasses popupRefuse');
});
