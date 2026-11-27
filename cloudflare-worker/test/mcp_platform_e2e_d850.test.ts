/**
 * D850 (#2473) — the MCP platform end to end, through the real Worker
 * (`worker.fetch`): a member creates an API key, uses it on `/mcp`, is
 * charged for a priced tool on the one AI token ledger, reads the usage
 * report, revokes the key, and is refused on the next call. Nothing printed
 * or logged on the way carries the secret.
 *
 * THIS FILE GROWS WITH ITS DEPENDENCIES (#2463's backend phase). Each step is
 * written once the task that builds it is on `main`:
 *   1. create a key                      — #2464 (D841), on main
 *   2. `initialize`, `tools/list`        — #2470 (D842)
 *   3. call a test-priced tool           — #2470 (D842), #2466 (D844)
 *   4. hold, settle, the usage row       — #2466 (D844), #2465 (D843)
 *   5. read the report                   — #2471 (D845, inside #2465's PR)
 *   6. revoke                            — #2464 (D841), on main
 *   7. 401 on the next call              — #2470 (D842)
 *   8. no secret in the captured logs    — every step
 * Until a step's task merges, the test asserts what `main` does at that point
 * of the flow, never a stand-in.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mcp_platform_e2e_d850.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import worker from '../src/index.ts';
import { verifyKey } from '../src/services/apiKeys.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (f: string) => readFileSync(resolve(ROOT, `cloudflare-worker/sql/migrations/${f}`), 'utf8');
const ORIGIN = 'https://axal.vc';
const FOUNDER = 10;
const P = 1;

/** The D666 fixture's stores, plus the keys table (523). Invented people and companies only. */
function fixture({ keys = true, mcp = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(sqlOf('523_member_api_keys.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)')
    .run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001)`);
  const env: any = {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    RATE_LIMITS: memKV(), TOKENS: memKV(), OAUTH_KV: memKV(),
    ...(mcp ? { MCP_SERVER_ENABLED: 'true' } : {}),
    ...(keys ? { API_KEYS_ENABLED: 'true' } : {}),
  };
  return { db, env };
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };

/** Everything the Worker prints while `f` runs, so a step can prove no secret was printed. */
const printed: string[] = [];
async function capture<T>(f: () => Promise<T>): Promise<T> {
  const saved = [console.log, console.info, console.warn, console.error];
  const grab = (...a: unknown[]) => { printed.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); };
  console.log = grab; console.info = grab; console.warn = grab; console.error = grab;
  try { return await f(); } finally { [console.log, console.info, console.warn, console.error] = saved; }
}

const hit = (env: any, path: string, init: RequestInit = {}) =>
  capture(() => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx));

async function session(who = FOUNDER) {
  return new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

/** A signed-in member's call to the Worker's `/api`. */
async function api(env: any, method: string, path: string, body?: unknown) {
  const r = await hit(env, path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await session()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

let rpcId = 0;
/** One JSON-RPC message to `/mcp`, as an external MCP client sends it with an API key. */
async function mcp(env: any, bearer: string, method: string, params: unknown = {}) {
  const r = await hit(env, '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

/** The part of a key no one but its holder may ever see again. */
const secretPart = (secret: string) => secret.slice('axk_'.length + 12 + 1);

/** Step 8: no printed line and no stored activity line carries the secret, or the whole key. */
function assertNoSecretLeft(db: DatabaseSync, secret: string) {
  const s = secretPart(secret);
  const out = printed.join('\n');
  const logs = JSON.stringify(db.prepare('SELECT * FROM activity_logs').all());
  const keyRows = JSON.stringify(db.prepare('SELECT * FROM member_api_keys').all());
  for (const [where, text] of [['console', out], ['activity_logs', logs], ['member_api_keys', keyRows]] as const) {
    assert.ok(!text.includes(s), `the secret reached ${where}`);
    assert.ok(!text.includes(secret), `the whole key reached ${where}`);
  }
}

test('the flow: create a key, revoke it, and leave no secret behind', async () => {
  printed.length = 0;
  const { db, env } = fixture();

  // 1. Create a key. The secret is in this one response and nowhere else.
  const created = await api(env, 'POST', '/api/developer/keys', { name: 'E2E agent', scopes: ['validate:read'], companies: [P] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const secret: string = created.body.secret;
  const uid: string = created.body.key.uid;
  assert.match(secret, /^axk_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
  const listed = await api(env, 'GET', '/api/developer/keys');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.keys.map((k: any) => [k.uid, k.revoked_at]), [[uid, null]]);
  assert.ok(!JSON.stringify(listed.body).includes(secretPart(secret)), 'the list carries no secret');
  assert.equal((await verifyKey(env, secret)).ok, true);

  // 2–5 join here when #2470 (keys on /mcp), #2465 (usage rows), #2466
  // (metering) and #2471 (reports) are on main.

  // 6. Revoke. It is immediate: the next verification refuses the key.
  const revoked = await api(env, 'POST', `/api/developer/keys/${uid}/revoke`);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.ok(revoked.body.key.revoked_at, 'the key says when it was revoked');
  assert.deepEqual(await verifyKey(env, secret), { ok: false, reason: 'revoked_key' });

  // 7 joins here with #2470: the revoked key's next /mcp call answers 401 revoked_key.

  // 8. Nothing on the way kept the secret.
  assertNoSecretLeft(db, secret);
  assert.match(JSON.stringify(db.prepare('SELECT action FROM activity_logs').all()), /api_key_created/);
});

test('rollback (the runbook\'s flag off): the key routes are 404 and /mcp never serves an axk_ bearer', async () => {
  printed.length = 0;
  // A key made while the flag was on…
  const on = fixture();
  const { secret } = (await api(on.env, 'POST', '/api/developer/keys', { name: 'E2E agent', scopes: ['validate:read'], companies: [P] })).body;
  assert.ok(secret);
  // …and the same database once the flag is switched off.
  const env = { ...on.env, API_KEYS_ENABLED: 'false' };
  assert.equal((await api(env, 'GET', '/api/developer/keys')).status, 404);
  assert.equal((await api(env, 'POST', '/api/developer/keys', { name: 'x', scopes: ['validate:read'], companies: [P] })).status, 404);
  const init = await mcp(env, secret, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' },
  });
  assert.equal(init.status, 401, 'an axk_ bearer is refused with the flag off');
  assert.ok(!JSON.stringify(init.body ?? '').includes(secretPart(secret)), 'the refusal does not echo the key');
  assertNoSecretLeft(on.db, secret);
});
