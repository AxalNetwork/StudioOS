/**
 * D1361 — the connector API (`/api/connector/v1`) for a Lovable custom
 * connector: a member API key (D841) is the only credential; every data route
 * runs the existing MCP tool through `callTool`, so scope, company grant, the
 * member's live access and the call log apply unchanged.
 *
 * Runs on D666's fixture (in-memory KV, SQLite D1) with migration 523.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/connector_api_d1361.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import worker from '../src/index.ts';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { providerOptions } from '../src/mcp/oauth.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { createKey, revokeKey } from '../src/services/apiKeys.ts';
import { bumpJwtMinIat } from '../src/auth.ts';
import { SignJWT } from 'jose';
import { fixture as d666Fixture } from './mcp_server_d666.test.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { adminConnectorClients, LOVABLE_CLIENT_KEY, LOVABLE_STATE_KEY, LOVABLE_REDIRECT_URI } from '../src/routes/admin_connector_clients.ts';

const FOUNDER = 10, OTHER = 20;
const P = 1, P2 = 2, P_OTHER = 3;
const INTERVIEWEE = 'Zelda Quintanilla-Marsh';
const BASE = 'https://axal.vc/api/connector/v1';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/523_member_api_keys.sql'), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fixture({ enabled = true } = {}) {
  const f = d666Fixture();
  f.db.exec(MIGRATION);
  f.db.exec(tableFromBaseline(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/241_advisor_money_model.sql'), 'utf8'), 'platform_settings'));
  if (enabled) f.env.API_KEYS_ENABLED = 'true';
  return f;
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
let ipSeq = 0;
/** One request to the connector API, from its own IP unless given, with console output captured. */
async function get(env: any, path: string, token: string | null, { method = 'GET', ip = `198.51.100.${(++ipSeq % 250) + 1}` } = {}) {
  const said: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
  try {
    const r = await worker.fetch(new Request(`${BASE}${path}`, { method, headers: {
      Accept: 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } }), env, ctx);
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any, said };
  } finally { [console.log, console.warn, console.error] = saved; }
}

async function key(env: any, spec: Partial<{ scopes: string[]; companies: number[]; expiresInDays: number | null }> = {}, user = FOUNDER) {
  return createKey(env, user, { name: 'Lovable', scopes: ['validate:read', 'build:read'], companies: [P], expiresInDays: null, limit: null, ...spec });
}
const secretPart = (secret: string) => /^axk_[a-z0-9]{12}_(.+)$/.exec(secret)![1];

// ── The connection test ─────────────────────────────────────────────────────

test('GET /me with a valid key: 200, the key\'s own name, prefix, scopes and its approved companies; no email, no secret', async () => {
  const { env, db } = fixture();
  const { row, secret } = await key(env);
  const r = await get(env, '/me', secret);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    connected: true, service: 'Axal VC',
    credential: { type: 'api_key', name: 'Lovable', prefix: `axk_${row.key_id}`, scopes: ['validate:read', 'build:read'], expires_at: null },
    companies: [{ id: P, name: 'Acme' }],
  });
  const text = JSON.stringify(r.body) + r.said.join('\n');
  for (const word of ['fay@example.test', secretPart(secret), 'secret_sha256']) assert.ok(!text.includes(word), `no ${word}`);
  const used = db.prepare('SELECT last_used_at FROM member_api_keys WHERE uid = ?').get(row.uid) as any;
  assert.ok(used.last_used_at, 'the key records its use');
});

test('no credential, a malformed, unknown or wrong-secret key: 401 invalid_key, never a hint', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  const wrong = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
  for (const token of [null, 'axk_short', 'axk_zzzzzzzzzzzz_' + 'a'.repeat(43), wrong]) {
    const r = await get(env, '/me', token);
    assert.equal(r.status, 401, String(token));
    assert.equal(r.body.error, 'invalid_key');
    assert.match(String(r.headers.get('WWW-Authenticate')), /^Bearer error="invalid_token", error_description="invalid_key"$/);
  }
});

test('a revoked key, an expired key and a key made before "sign out everywhere" are refused; the flag off refuses every key', async () => {
  const { env, db } = fixture();
  const revoked = await key(env);
  await revokeKey(env, FOUNDER, revoked.row.uid);
  assert.equal((await get(env, '/me', revoked.secret)).body.error, 'revoked_key');
  const expired = await key(env, { expiresInDays: 1 });
  db.prepare(`UPDATE member_api_keys SET expires_at = datetime('now', '-1 minute') WHERE uid = ?`).run(expired.row.uid);
  const e = await get(env, '/me', expired.secret);
  assert.deepEqual([e.status, e.body.error], [401, 'expired_key']);
  const live = await key(env);
  db.prepare(`UPDATE member_api_keys SET created_at = datetime('now', '-1 hour') WHERE uid = ?`).run(live.row.uid);
  await bumpJwtMinIat(env, FOUNDER);
  const out = await get(env, '/me', live.secret);
  assert.deepEqual([out.status, out.body.error], [401, 'revoked_key']);

  const off = fixture({ enabled: false });
  const k = await key(off.env);
  const r = await get(off.env, '/me', k.secret);
  assert.deepEqual([r.status, r.body.error], [401, 'invalid_key']);
});

test('an IP that keeps failing is throttled before the lookup', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  let last: any;
  for (let i = 0; i < 12; i++) last = await get(env, '/me', 'axk_zzzzzzzzzzzz_' + 'b'.repeat(43), { ip: '192.0.2.9' });
  assert.deepEqual([last.status, last.body.error, last.headers.get('Retry-After')], [429, 'rate_limited', '60']);
  assert.equal((await get(env, '/me', secret, { ip: '192.0.2.9' })).status, 429, 'even a good key from that IP waits');
});

// ── The data routes ─────────────────────────────────────────────────────────

test('GET /companies and /companies/:id/validate-context answer the tool\'s own data, with an execution id; interviewees are never named', async () => {
  const { env, db } = fixture();
  const { row, secret } = await key(env);
  const list = await get(env, '/companies', secret);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { companies: [{ id: P, name: 'Acme' }] });
  assert.match(String(list.headers.get('X-Axal-Execution-Id')), UUID);
  const ctx1 = await get(env, `/companies/${P}/validate-context`, secret);
  assert.equal(ctx1.status, 200, JSON.stringify(ctx1.body));
  assert.equal(ctx1.body.company, 'Acme');
  assert.ok(Array.isArray(ctx1.body.hypotheses));
  assert.ok(!JSON.stringify(ctx1.body).includes(INTERVIEWEE), 'no interviewee name');
  const logged = db.prepare(`SELECT details FROM activity_logs WHERE action = 'mcp_tool_call'`).all() as any[];
  assert.deepEqual(logged.map((l) => JSON.parse(l.details).tool), ['list_companies', 'get_validate_context']);
  assert.ok(logged.every((l) => JSON.parse(l.details).api_key_uid === row.uid), 'each call is logged against the key');
});

test('GET /companies/:id/interview-guide answers questions, narrowed by ?hypothesis; a filter over 200 characters is 400', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  const r = await get(env, `/companies/${P}/interview-guide?hypothesis=H1`, secret);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.questions) && r.body.questions.length > 0);
  assert.ok(r.body.questions.every((q: any) => typeof q.question === 'string' && typeof q.why === 'string'));
  const long = await get(env, `/companies/${P}/interview-guide?hypothesis=${'x'.repeat(201)}`, secret);
  assert.deepEqual([long.status, long.body.error], [400, 'invalid_hypothesis']);
});

test('cross-user and outside-the-key access: another founder\'s company, the member\'s own company not on the key, and a lost venture are refused', async () => {
  const { env, db } = fixture();
  const { secret } = await key(env);
  for (const id of [P_OTHER, P2, 999]) {
    const r = await get(env, `/companies/${id}/validate-context`, secret);
    assert.deepEqual([r.status, r.body.error], [403, 'refused'], String(id));
    assert.ok(!JSON.stringify(r.body).includes('Beta'), 'another founder\'s company is never named');
  }
  // Another founder's own key never reaches Acme.
  const theirs = await key(env, { companies: [P_OTHER] }, OTHER);
  const r = await get(env, `/companies/${P}/validate-context`, theirs.secret);
  assert.deepEqual([r.status, r.body.error], [403, 'refused']);
  assert.ok(!JSON.stringify(r.body).includes(INTERVIEWEE));
  // The venture changes hands: the key can no longer read it, and /me stops listing it.
  db.prepare('UPDATE projects SET founder_id = 1002 WHERE id = ?').run(P);
  const lost = await get(env, `/companies/${P}/validate-context`, secret);
  assert.deepEqual([lost.status, lost.body.error], [403, 'refused']);
  assert.deepEqual((await get(env, '/me', secret)).body.companies, []);
});

test('a key without the scope is 403 insufficient_scope; Build progress with no GitHub connection is refused, not invented', async () => {
  const { env } = fixture();
  const narrow = await key(env, { scopes: ['connectors:read'] });
  const r = await get(env, '/companies', narrow.secret);
  assert.deepEqual([r.status, r.body.error], [403, 'insufficient_scope']);
  assert.match(r.body.message, /validate:read/);
  assert.equal((await get(env, '/me', narrow.secret)).status, 200, 'the connection test needs no data scope');
  const { secret } = await key(env);
  const b = await get(env, `/companies/${P}/build-progress`, secret);
  assert.deepEqual([b.status, b.body.error], [403, 'refused']);
});

test('invalid input and unknown operations: a bad company id is 400, an unknown path or a write method is 404', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  for (const id of ['abc', '0', '-1', '1.5', '12345678901']) {
    const r = await get(env, `/companies/${id}/validate-context`, secret);
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_company'], id);
  }
  for (const [path, method] of [['/admin', 'GET'], ['/companies/1/raise', 'GET'], ['/me', 'POST'], ['/companies', 'DELETE']] as const) {
    const r = await get(env, path, secret, { method });
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'], `${method} ${path}`);
  }
  // Unauthenticated, an unknown path is still 401: nothing is listed before the key.
  assert.equal((await get(env, '/admin', null)).status, 401);
});

// ── OAuth: the Lovable custom connector's own sign-in ───────────────────────

const ADMIN = 30;
const BASELINE_SQL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const VERIFIER = 'w'.repeat(64);

async function session(env: any, who: number, role: string) {
  return new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}
async function http(env: any, path: string, init: RequestInit = {}) {
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try {
    const r = await worker.fetch(new Request(`https://axal.vc${path}`, init), env, ctx);
    return { status: r.status, headers: r.headers, body: await r.clone().json().catch(() => null) as any };
  } finally { [console.log, console.warn, console.error] = saved; }
}
function superAdmin(f: any) {
  f.db.exec(tableFromBaseline(BASELINE_SQL, 'super_admins'));
  f.db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
}

/** The whole Lovable flow: mint the client, sign in, approve companies, exchange the code with the secret. */
async function lovableToken(f: any, companies = [P]) {
  superAdmin(f);
  const admin = await session(f.env, ADMIN, 'admin');
  const made = await http(f.env, '/api/admin/connector-clients/lovable', { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER))).toString('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: made.body.client_id, redirect_uri: LOVABLE_REDIRECT_URI, state: 'lv1',
    scope: 'validate:read build:read', code_challenge: challenge, code_challenge_method: 'S256' });
  const auth = await http(f.env, `/api/oauth/authorize?${q}`);
  assert.equal(auth.status, 302);
  const id = new URL(auth.headers.get('location')!).searchParams.get('request')!;
  const founder = await session(f.env, FOUNDER, 'founder');
  const ok = await http(f.env, `/api/mcp/consent/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${founder}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ companies }) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const redirect = new URL(ok.body.redirectTo);
  assert.equal(`${redirect.origin}${redirect.pathname}`, LOVABLE_REDIRECT_URI, 'the code goes only to Lovable');
  const basic = Buffer.from(`${made.body.client_id}:${made.body.client_secret}`).toString('base64');
  const t = await http(f.env, '/api/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, redirect_uri: LOVABLE_REDIRECT_URI, code_verifier: VERIFIER }) });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return { token: t.body.access_token as string, client: made.body };
}

test('OAuth: a Super Admin mints the Lovable client; a founder signs in, approves a company, and the token reads only that company', async () => {
  const f = fixture({ enabled: false });
  const { token, client } = await lovableToken(f);
  assert.equal(client.redirect_uri, LOVABLE_REDIRECT_URI);
  assert.equal(client.authorization_url, 'https://axal.vc/api/oauth/authorize');
  assert.equal(client.token_url, 'https://axal.vc/api/oauth/token');
  assert.equal(client.scopes, 'validate:read build:read');
  const me = await get(f.env, '/me', token);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.credential.type, 'oauth');
  assert.deepEqual(me.body.credential.scopes.sort(), ['build:read', 'validate:read']);
  assert.deepEqual(me.body.companies, [{ id: P, name: 'Acme' }]);
  assert.ok(!JSON.stringify(me.body).includes('fay@example.test'));
  const ctx1 = await get(f.env, `/companies/${P}/validate-context`, token);
  assert.equal(ctx1.status, 200, JSON.stringify(ctx1.body));
  for (const id of [P2, P_OTHER]) assert.deepEqual((await get(f.env, `/companies/${id}/validate-context`, token)).body.error, 'refused');
  // API keys stay off here (the flag), and the OAuth path does not need them.
  assert.equal(f.env.API_KEYS_ENABLED, undefined);
});

test('OAuth: a forged, revoked or MCP-off token is 401 invalid_token; the client route is Super Admin only and never reads back the secret', async () => {
  const f = fixture();
  const { token, client } = await lovableToken(f);
  const forged = token.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'));
  const bad = await get(f.env, '/me', forged);
  assert.deepEqual([bad.status, bad.body.error], [401, 'invalid_token']);
  assert.match(String(bad.headers.get('WWW-Authenticate')), /invalid_token/);
  assert.deepEqual((await get(f.env, '/me', 'not-a-token')).body.error, 'invalid_token');
  // Read back: the id and the settings, never the secret.
  const admin = await session(f.env, ADMIN, 'admin');
  const read = await http(f.env, '/api/admin/connector-clients/lovable', { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(read.status, 200);
  assert.equal(read.body.client_id, client.client_id);
  assert.ok(!JSON.stringify(read.body).includes(client.client_secret), 'the secret is shown once');
  // A founder cannot mint or read it.
  const founder = await session(f.env, FOUNDER, 'founder');
  for (const method of ['GET', 'POST']) {
    const r = await http(f.env, '/api/admin/connector-clients/lovable', { method, headers: { Authorization: `Bearer ${founder}`, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.ok([401, 403].includes(r.status), `${method} ${r.status}`);
  }
  // Rotating replaces the client: the old one is gone.
  const again = await http(f.env, '/api/admin/connector-clients/lovable', { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.deepEqual([again.status, again.body.replaced], [201, true]);
  assert.notEqual(again.body.client_id, client.client_id);
  assert.equal(await f.env.OAUTH_KV.get(`client:${client.client_id}`), null, 'the old client no longer exists');
  assert.equal((await get(f.env, '/me', token)).status, 401, 'the provider also revokes the old client token');
  // With the OAuth server off, OAuth tokens are refused here too.
  const off = { ...f.env, MCP_SERVER_ENABLED: 'false' };
  assert.deepEqual((await get(off, '/me', token)).body.error, 'invalid_token');
});

// Replacement uses D1's atomic claim, not KV read-after-write or an isolate lock.
async function adminRequest(f: any, method = 'GET', env = f.env) {
  const token = await session(f.env, ADMIN, 'admin');
  const r = await adminConnectorClients.request('/lovable', { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  }, env);
  return { status: r.status, body: await r.json() as any };
}
const clientIds = async (env: any) => (await env.OAUTH_KV.list({ prefix: 'client:' })).keys.map((k: any) => k.name);
const storedState = (f: any) => JSON.parse(f.db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(LOVABLE_STATE_KEY).value);

for (const replacing of [false, true]) test(`OAuth client replacement: overlapping ${replacing ? 'rotations' : 'first creates'} mint only one client, with D1 authoritative over stale KV`, async () => {
  const f = fixture(); superAdmin(f);
  const first = replacing ? await adminRequest(f, 'POST') : null;
  if (replacing) await f.env.OAUTH_KV.put(LOVABLE_CLIENT_KEY, JSON.stringify({ client_id: 'stale-client', created_at: '2020-01-01' }));
  const realPut = f.env.OAUTH_KV.put.bind(f.env.OAUTH_KV);
  let reached!: () => void, release!: () => void;
  const reachedWrite = new Promise<void>((r) => { reached = r; });
  const allowWrite = new Promise<void>((r) => { release = r; });
  let mints = 0;
  f.env.OAUTH_KV.put = async (k: string, ...args: any[]) => {
    if (k.startsWith('client:')) { mints++; reached(); await allowWrite; }
    return realPut(k, ...args);
  };
  const one = adminRequest(f, 'POST');
  let two: any;
  try {
    await Promise.race([reachedWrite, one.then(() => { throw new Error('replacement finished before reaching the provider write'); })]);
    const other = adminRequest(f, 'POST', { ...f.env, DB: d1Over(f.db) });
    let timer: ReturnType<typeof setTimeout>;
    try {
      two = await Promise.race([other, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('overlapping replacement was not refused')), 5000); })]);
    } finally { clearTimeout(timer!); }
    assert.deepEqual([two.status, two.body.error], [409, 'connector_client_busy']);
    assert.equal((await adminRequest(f)).status, 503, 'a partial replacement is unreadable');
  } finally { release(); }
  const winner = await one;
  assert.deepEqual([winner.status, winner.body.replaced], [201, replacing]);
  assert.equal(mints, 1, 'the loser never mints a client');
  assert.deepEqual(await clientIds(f.env), [`client:${winner.body.client_id}`]);
  if (first) assert.equal(await f.env.OAUTH_KV.get(`client:${first.body.client_id}`), null);
  assert.deepEqual(storedState(f), { state: 'ready', current: { client_id: winner.body.client_id, created_at: winner.body.created_at } });
  assert.equal((await adminRequest(f)).body.client_id, winner.body.client_id);
  const row = f.db.prepare('SELECT value, updated_by FROM platform_settings WHERE key = ?').get(LOVABLE_STATE_KEY);
  assert.equal(row.updated_by, String(ADMIN));
  assert.ok(!row.value.includes(winner.body.client_secret), 'the journal never stores the secret');
  const audit = f.db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'lovable_connector_client_replaced' ORDER BY id").all() as any[];
  assert.equal(audit.length, replacing ? 2 : 1, 'one standard audit entry per successful act, none for the refused overlap');
  assert.equal(audit.at(-1).user_id, ADMIN);
  const details = JSON.parse(audit.at(-1).details);
  assert.equal(details.client_id, winner.body.client_id);
  assert.equal(details.previous_client_id, first?.body.client_id ?? null);
  assert.match(details.operation, UUID);
  const governance = f.db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'lovable_connector_client_replaced'").all();
  assert.equal(governance.length, audit.length);
  assert.ok(!JSON.stringify([audit, governance]).includes(winner.body.client_secret), 'no secret in either audit store');
});

test('OAuth client read: confirmed empty and legacy clients remain readable; D1, KV and provider errors are 503 without a false empty client', async () => {
  const empty = fixture(); superAdmin(empty);
  assert.deepEqual((await adminRequest(empty)).body.client_id, null);
  const made = await getOAuthApi(providerOptions(empty.env), empty.env).createClient({ redirectUris: [LOVABLE_REDIRECT_URI] });
  await empty.env.OAUTH_KV.put(LOVABLE_CLIENT_KEY, JSON.stringify({ client_id: made.clientId, created_at: '2026-10-28' }));
  assert.equal((await adminRequest(empty)).body.client_id, made.clientId, 'pre-fix KV client can still be read');
  const rotated = await adminRequest(empty, 'POST');
  assert.equal(rotated.status, 201);
  assert.equal(rotated.body.replaced, true);
  assert.equal(await empty.env.OAUTH_KV.get(`client:${made.clientId}`), null, 'first D1 rotation retires the legacy client');
  for (const failure of ['database', 'legacy', 'provider']) {
    const f = fixture(); superAdmin(f);
    if (failure === 'provider') assert.equal((await adminRequest(f, 'POST')).status, 201);
    if (failure === 'database') {
      const originalDB = f.env.DB;
      f.env.DB = { ...originalDB, prepare(sql: string) {
        if (sql.includes('platform_settings')) throw new Error('private-failure-detail');
        return originalDB.prepare(sql);
      } };
    }
    else {
      const originalGet = f.env.OAUTH_KV.get.bind(f.env.OAUTH_KV);
      f.env.OAUTH_KV.get = async (key: string, ...args: any[]) => {
        if (failure === 'legacy' ? key === LOVABLE_CLIENT_KEY : key.startsWith('client:')) throw new Error('private-failure-detail');
        return originalGet(key, ...args);
      };
    }
    const read = await adminRequest(f);
    assert.deepEqual([read.status, read.body.error], [503, 'connector_client_unreadable'], failure);
    assert.equal('client_id' in read.body, false, 'no false confirmed-empty response');
    assert.ok(!JSON.stringify(read.body).includes('private-failure-detail'));
    if (failure !== 'provider') {
      const write = await adminRequest(f, 'POST');
      assert.equal(write.status, 503, failure);
      assert.deepEqual(await clientIds(f.env), [], 'read failures cannot mint credentials');
    }
  }
});

test('OAuth client replacement: failed retirement keeps the journal blocked, returns no secret, and a retry cannot mint again', async () => {
  const f = fixture(); superAdmin(f);
  const first = await adminRequest(f, 'POST');
  const realDelete = f.env.OAUTH_KV.delete.bind(f.env.OAUTH_KV);
  f.env.OAUTH_KV.delete = async (key: string) => {
    if (key === `client:${first.body.client_id}`) throw new Error('private-retirement-error');
    return realDelete(key);
  };
  const failed = await adminRequest(f, 'POST');
  assert.deepEqual([failed.status, failed.body.error], [503, 'connector_client_unreadable']);
  assert.equal('client_secret' in failed.body, false);
  assert.ok(!JSON.stringify(failed.body).includes('private-retirement-error'));
  const pending = storedState(f);
  assert.equal(pending.state, 'rotating');
  assert.equal(pending.previous.client_id, first.body.client_id);
  assert.ok(pending.candidate.client_id && pending.candidate.client_id !== first.body.client_id);
  assert.ok(!JSON.stringify(pending).includes(first.body.client_secret));
  assert.equal((await adminRequest(f)).status, 503);
  const count = (await clientIds(f.env)).length;
  assert.equal((await adminRequest(f, 'POST')).status, 409);
  assert.equal((await clientIds(f.env)).length, count, 'blocked retries create no extra client');
});

test('OAuth client replacement: failed or zero-change claim, journal and commit never return a secret or allow an unsafe retry', async () => {
  for (const stage of ['claim', 'journal', 'commit']) for (const outcome of ['throw', 'false', 'noop']) {
    const f = fixture(); superAdmin(f);
    const original = stage === 'claim' ? null : await adminRequest(f, 'POST');
    const originalDB = f.env.DB;
    f.env.DB = { ...originalDB, prepare(sql: string) {
      const matches = stage === 'claim' ? sql.startsWith('INSERT OR IGNORE INTO platform_settings')
        : stage === 'journal' ? sql.startsWith('UPDATE platform_settings SET value = ? WHERE')
        : sql.startsWith('UPDATE platform_settings SET value = ?, updated_at');
      const stmt = originalDB.prepare(sql);
      if (!matches) return stmt;
      return { ...stmt, bind(...args: any[]) {
        const bound = stmt.bind(...args);
        if (stage === 'commit' && JSON.parse(args[0]).state !== 'ready') return bound;
        return { ...bound, async run() {
          if (outcome === 'throw') throw new Error('private-storage-error');
          return { success: outcome !== 'false', meta: { changes: outcome === 'noop' ? 0 : 1 } };
        } };
      } };
    } };
    const r = await adminRequest(f, 'POST');
    assert.equal(r.status, stage === 'claim' && outcome === 'noop' ? 409 : 503, `${stage}/${outcome}`);
    assert.equal('client_secret' in r.body, false);
    assert.ok(!JSON.stringify(r.body).includes('private-storage-error'));
    if (stage === 'claim') assert.deepEqual(await clientIds(f.env), [], 'failed claim never mints');
    else {
      if (stage === 'journal') assert.ok(await f.env.OAUTH_KV.get(`client:${original!.body.client_id}`), 'failed journaling must not retire the existing client');
      assert.equal(storedState(f).state, 'rotating', 'partial work remains fenced');
      assert.equal((await adminRequest(f)).status, 503);
      const count = (await clientIds(f.env)).length;
      assert.equal((await adminRequest(f, 'POST')).status, 409);
      assert.equal((await clientIds(f.env)).length, count);
    }
  }
});

test('OAuth client replacement: two stale ready snapshots contend on the real D1 conditional update', async () => {
  const f = fixture(); superAdmin(f);
  assert.equal((await adminRequest(f, 'POST')).status, 201);
  let reads = 0, release!: () => void;
  const bothRead = new Promise<void>((r) => { release = r; });
  const originalDB = f.env.DB;
  const env = { ...f.env, DB: { ...originalDB, prepare(sql: string) {
    const stmt = originalDB.prepare(sql);
    if (!sql.startsWith('SELECT value FROM platform_settings')) return stmt;
    return { ...stmt, bind(...args: any[]) {
      const bound = stmt.bind(...args);
      return { ...bound, async first() {
        const row = await bound.first();
        if (++reads === 2) release();
        await bothRead;
        return row;
      } };
    } };
  } } };
  const results = await Promise.all([adminRequest(f, 'POST', env), adminRequest(f, 'POST', { ...env })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results.find((r) => r.status === 201)!;
  assert.deepEqual(await clientIds(f.env), [`client:${winner.body.client_id}`], 'the CAS loser never creates a provider client');
  assert.equal(storedState(f).current.client_id, winner.body.client_id);
});

test('OAuth connection test: bad credentials are throttled by hash while valid credentials on a shared gateway stay usable', async () => {
  const f = fixture();
  const { token } = await lovableToken(f);
  const ip = '192.0.2.81';
  const now = Date.now;
  const fixed = now();
  Date.now = () => fixed;
  try {
    for (let i = 0; i < 10; i++) assert.equal((await get(f.env, '/me', 'invalid:grant:token', { ip })).status, 401);
    const realGet = f.env.OAUTH_KV.get.bind(f.env.OAUTH_KV);
    let reads = 0;
    f.env.OAUTH_KV.get = async (...args: any[]) => { reads++; return realGet(...args); };
    const limited = await get(f.env, '/me', 'invalid:grant:token', { ip });
    assert.deepEqual([limited.status, limited.body.error, limited.headers.get('Retry-After')], [429, 'rate_limited', '60']);
    assert.equal(reads, 0, 'the throttled credential never reaches the provider');
    assert.equal((await get(f.env, '/me', token, { ip })).status, 200, 'another valid member on that gateway is unaffected');
    assert.equal((await get(f.env, '/me', 'another:invalid:token', { ip })).status, 401, 'another credential has its own counter');
    const keys = [...f.env.RATE_LIMITS._map.keys()].join(' ');
    assert.match(keys, /mcp_keyfail:connector_oauth:[a-f0-9]{64}:/);
    assert.ok(!keys.includes('invalid:grant:token') && !keys.includes(token), 'no raw bearer in counter keys');
    f.env.RATE_LIMITS.get = async () => { throw new Error('counter unavailable'); };
    assert.equal((await get(f.env, '/me', token, { ip: '192.0.2.82' })).status, 429, 'counter failure closes the gate');
  } finally { Date.now = now; }
});

test('OAuth connection test: /me shares the existing grant and member minute limits without double-counting tool reads', async () => {
  const f = fixture();
  const { token } = await lovableToken(f);
  const now = Date.now;
  const fixed = now();
  Date.now = () => fixed;
  try {
    for (let i = 0; i < 59; i++) assert.equal((await get(f.env, '/me', token)).status, 200);
    assert.equal((await get(f.env, '/companies', token)).status, 200, 'one tool call consumes the 60th grant call once');
    const limited = await get(f.env, '/me', token);
    assert.deepEqual([limited.status, limited.body.error, limited.headers.get('Retry-After')], [429, 'rate_limited', '60']);
    const [member, grant] = token.split(':');
    const minute = Math.floor(fixed / 60000);
    await f.env.RATE_LIMITS.put(`mcp_rl:${grant}:${minute}`, '0');
    await f.env.RATE_LIMITS.put(`mcp_rl:user:${member}:${minute}`, '120');
    assert.equal((await get(f.env, '/me', token)).status, 429, 'the member-wide limit also applies');
  } finally { Date.now = now; }
});
