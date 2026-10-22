/**
 * D841 (#2464) — member API keys: the one-time secret, the stored hash,
 * verification (valid, wrong secret, unknown id, revoked, expired, inactive
 * account, "sign out everywhere"), no escalation of scopes or companies,
 * rotation, the live-key cap, the flag, and no secret in any log.
 * Real SQLite (migration 523) through the D1 shim.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/member_api_keys_d841.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { developerKeys } from '../src/routes/developer_keys.ts';
import {
  MAX_LIVE_KEYS, constantTimeEqual, createKey, revokeKey, sha256Hex, verifyKey, touchLastUsed,
} from '../src/services/apiKeys.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/523_member_api_keys.sql'), 'utf8');
const FOUNDER = 10, OTHER = 20, ADMIN = 30;
const P = 1, P2 = 2, P_OTHER = 3;

function fixture({ enabled = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P2}, 'Second', 1001), (${P_OTHER}, 'Beta', 1002)`);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(enabled ? { API_KEYS_ENABLED: 'true' } : {}) };
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/developer/keys', developerKeys);

async function tokenFor(who: number, extra: Record<string, unknown> = {}) {
  return new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder', ...extra }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

/** Capture console output while `f` runs, so a test can prove no secret was printed. */
async function captured<T>(f: () => Promise<T>): Promise<{ value: T; out: string }> {
  const lines: string[] = [];
  const saved = [console.log, console.warn, console.error, console.info];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
  try { return { value: await f(), out: lines.join('\n') }; } finally { [console.log, console.warn, console.error, console.info] = saved; }
}

async function call(env: any, method: string, path: string, { who = FOUNDER, body, bearer, claims }: { who?: number; body?: unknown; bearer?: string; claims?: Record<string, unknown> } = {}) {
  const auth = bearer ?? await tokenFor(who, claims);
  const res = await app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const create = (env: any, over: Record<string, unknown> = {}, who = FOUNDER) =>
  call(env, 'POST', '/api/developer/keys', { who, body: { name: 'CI agent', scopes: ['validate:read'], companies: [P], ...over } });

test('flag off: every route answers 404', async () => {
  const { env } = fixture({ enabled: false });
  assert.equal((await call(env, 'GET', '/api/developer/keys')).status, 404);
  assert.equal((await create(env)).status, 404);
});

test('a created key is returned once; the row stores only the id and the hash of the secret', async () => {
  const { env, db } = fixture();
  const { value: r, out } = await captured(() => create(env));
  assert.equal(r.status, 201);
  const secret: string = r.body.secret;
  assert.match(secret, /^axk_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
  assert.equal(r.body.key.prefix, `axk_${r.body.key.key_id}`);
  assert.deepEqual(r.body.key.scopes, ['validate:read']);
  assert.deepEqual(r.body.key.companies, [{ id: P, name: 'Acme', still_owned: true }]);
  const row: any = db.prepare('SELECT * FROM member_api_keys').get();
  const secretPart = secret.slice(4 + 12 + 1);
  assert.equal(row.secret_sha256, await sha256Hex(secretPart));
  assert.ok(!JSON.stringify(row).includes(secretPart), 'the secret is not stored');
  // The list never carries a secret or the hash.
  const list = await call(env, 'GET', '/api/developer/keys');
  assert.equal(list.status, 200);
  const listed = JSON.stringify(list.body);
  assert.ok(!listed.includes(secretPart) && !listed.includes(row.secret_sha256));
  assert.equal(list.body.keys.length, 1);
  // Every scope the MCP server defines is offered, each labelled; only validate:write changes data.
  assert.deepEqual(list.body.scopes_available.map((o: any) => [o.name, o.write]),
    [['validate:read', false], ['validate:write', true], ['build:read', false], ['raise:read', false], ['connectors:read', false]]);
  assert.ok(list.body.scopes_available.every((o: any) => o.label !== o.name), 'every scope has a label of its own');
  assert.ok(list.body.scopes_available.every((o: any) => typeof o.label === 'string' && o.label.length > 0));
  // Nothing printed or logged carries the secret.
  const logs = JSON.stringify(db.prepare('SELECT * FROM activity_logs').all());
  assert.ok(!out.includes(secretPart) && !logs.includes(secretPart));
  assert.match(logs, /api_key_created/);
});

test('verifyKey: valid, wrong secret, unknown id and malformed all fail closed as invalid_key', async () => {
  const { env } = fixture();
  const { secret } = (await create(env)).body;
  const ok = await verifyKey(env, secret);
  assert.equal(ok.ok, true);
  const flip = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
  assert.deepEqual(await verifyKey(env, flip), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await verifyKey(env, 'axk_zzzzzzzzzzzz_' + 'a'.repeat(43)), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await verifyKey(env, 'axk_short'), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await verifyKey(env, ''), { ok: false, reason: 'invalid_key' });
});

test('revoked, expired, inactive and signed-out-everywhere keys are refused', async () => {
  const { env, db } = fixture();
  const a = (await create(env)).body;
  const revoked = await call(env, 'POST', `/api/developer/keys/${a.key.uid}/revoke`);
  assert.equal(revoked.status, 200);
  assert.ok(revoked.body.key.revoked_at);
  assert.deepEqual(await verifyKey(env, a.secret), { ok: false, reason: 'revoked_key' });

  const b = (await create(env, { expires_in_days: 1 })).body;
  assert.equal((await verifyKey(env, b.secret)).ok, true);
  assert.deepEqual(await verifyKey(env, b.secret, new Date(Date.now() + 2 * 86_400_000)), { ok: false, reason: 'expired_key' });

  const c = (await create(env)).body;
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 5, FOUNDER);
  assert.deepEqual(await verifyKey(env, c.secret), { ok: false, reason: 'revoked_key' });
  db.prepare('UPDATE users SET jwt_min_iat = NULL, is_active = 0 WHERE id = ?').run(FOUNDER);
  assert.deepEqual(await verifyKey(env, c.secret), { ok: false, reason: 'revoked_key' });
});

test('no escalation: scopes must be grantable and companies owned', async () => {
  const { env } = fixture();
  assert.equal((await create(env, { scopes: ['admin:all'] })).body.code, 'invalid_scopes');
  assert.equal((await create(env, { scopes: [] })).body.code, 'invalid_scopes');
  assert.equal((await create(env, { companies: [P_OTHER] })).body.code, 'invalid_companies');
  assert.equal((await create(env, { companies: [P, P_OTHER] })).body.code, 'invalid_companies');
  assert.equal((await create(env, { companies: [] })).body.code, 'invalid_companies');
  assert.equal((await create(env, { name: '' })).body.code, 'invalid_name');
  assert.equal((await create(env, { expires_in_days: 0 })).body.code, 'invalid_expiry');
  assert.equal((await create(env, { monthly_limit_microusd: 1.5 })).body.code, 'invalid_limit');
  // The other founder cannot reach Acme either.
  assert.equal((await create(env, {}, OTHER)).body.code, 'invalid_companies');
  assert.equal((await create(env, { companies: [P_OTHER] }, OTHER)).status, 201);
});

test('one member cannot list, revoke or rotate another member\'s key', async () => {
  const { env } = fixture();
  const mine = (await create(env)).body;
  const theirs = await call(env, 'GET', '/api/developer/keys', { who: OTHER });
  assert.equal(theirs.body.keys.length, 0);
  assert.equal((await call(env, 'POST', `/api/developer/keys/${mine.key.uid}/revoke`, { who: OTHER })).status, 404);
  assert.equal((await call(env, 'POST', `/api/developer/keys/${mine.key.uid}/rotate`, { who: OTHER })).status, 404);
  assert.equal((await verifyKey(env, mine.secret)).ok, true);
});

test('a key cannot manage keys, and a support session cannot change them', async () => {
  const { env } = fixture();
  const k = (await create(env)).body;
  const r = await call(env, 'GET', '/api/developer/keys', { bearer: k.secret });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'session_required');
  const s = await call(env, 'POST', '/api/developer/keys', { claims: { impersonated_by: ADMIN }, body: { name: 'x', scopes: ['validate:read'], companies: [P] } });
  assert.equal(s.status, 403);
});

test('rotation leaves exactly one live key with the same settings, and the old secret stops working', async () => {
  const { env, db } = fixture();
  const old = (await create(env, { scopes: ['validate:read', 'validate:write'], companies: [P, P2], monthly_limit_microusd: 5_000_000 })).body;
  const { value: r, out } = await captured(() => call(env, 'POST', `/api/developer/keys/${old.key.uid}/rotate`));
  assert.equal(r.status, 201);
  assert.notEqual(r.body.secret, old.secret);
  assert.equal(r.body.replaced.uid, old.key.uid);
  assert.deepEqual(r.body.key.scopes, ['validate:read', 'validate:write']);
  assert.deepEqual(r.body.key.companies.map((c: any) => c.id), [P, P2]);
  assert.equal(r.body.key.monthly_limit_microusd, 5_000_000);
  assert.deepEqual(await verifyKey(env, old.secret), { ok: false, reason: 'revoked_key' });
  assert.equal((await verifyKey(env, r.body.secret)).ok, true);
  const live: any[] = db.prepare('SELECT uid FROM member_api_keys WHERE revoked_at IS NULL').all() as any[];
  assert.deepEqual(live.map((x) => x.uid), [r.body.key.uid]);
  assert.ok(!out.includes(r.body.secret.slice(17)));
  // A revoked key cannot be rotated again.
  assert.equal((await call(env, 'POST', `/api/developer/keys/${old.key.uid}/rotate`)).status, 409);
});

test('the live-key cap counts only live keys', async () => {
  const { env } = fixture();
  for (let i = 0; i < MAX_LIVE_KEYS; i++) assert.equal((await create(env, { name: `k${i}` })).status, 201);
  const over = await create(env, { name: 'one more' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'too_many_keys');
  const first = (await call(env, 'GET', '/api/developer/keys')).body.keys[0];
  await call(env, 'POST', `/api/developer/keys/${first.uid}/revoke`);
  assert.equal((await create(env, { name: 'after a revoke' })).status, 201);
});

test('last use is written at most once a minute', async () => {
  const { env, db } = fixture();
  const { row } = await createKey(env, FOUNDER, { name: 'x', scopes: ['validate:read'], companies: [P], expiresInDays: null, limit: null });
  const t0 = new Date('2026-10-21T10:00:00Z');
  await touchLastUsed(env, row.uid, t0);
  await touchLastUsed(env, row.uid, new Date('2026-10-21T10:00:30Z'));
  assert.equal((db.prepare('SELECT last_used_at AS v FROM member_api_keys').get() as any).v, '2026-10-21 10:00:00');
  await touchLastUsed(env, row.uid, new Date('2026-10-21T10:01:01Z'));
  assert.equal((db.prepare('SELECT last_used_at AS v FROM member_api_keys').get() as any).v, '2026-10-21 10:01:01');
  // revokeKey on someone else's uid changes nothing.
  assert.equal(await revokeKey(env, OTHER, row.uid), null);
});

test('PATCH changes a live key\'s name or cap only; a lost company reads still_owned false', async () => {
  const { env, db } = fixture();
  const k = (await create(env, { companies: [P, P2] })).body;
  const r = await call(env, 'PATCH', `/api/developer/keys/${k.key.uid}`, { body: { name: 'Renamed', monthly_limit_microusd: 2_000_000, scopes: ['validate:write'] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.key.name, 'Renamed');
  assert.equal(r.body.key.monthly_limit_microusd, 2_000_000);
  assert.deepEqual(r.body.key.scopes, ['validate:read'], 'scopes never change through PATCH');
  assert.equal((await call(env, 'PATCH', `/api/developer/keys/${k.key.uid}`, { body: { monthly_limit_microusd: null } })).body.key.monthly_limit_microusd, null);
  assert.equal((await call(env, 'PATCH', `/api/developer/keys/${k.key.uid}`, { body: { name: '' } })).body.code, 'invalid_name');
  assert.equal((await call(env, 'PATCH', `/api/developer/keys/${k.key.uid}`, { who: OTHER, body: { name: 'x' } })).status, 404);
  db.prepare('UPDATE projects SET founder_id = 1002 WHERE id = ?').run(P2);
  const listed = (await call(env, 'GET', '/api/developer/keys')).body.keys[0];
  assert.deepEqual(listed.companies.map((c: any) => [c.id, c.still_owned]), [[P, true], [P2, false]]);
  await call(env, 'POST', `/api/developer/keys/${k.key.uid}/revoke`);
  assert.equal((await call(env, 'PATCH', `/api/developer/keys/${k.key.uid}`, { body: { name: 'late' } })).status, 409);
});

test('constantTimeEqual compares whole strings', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
});
