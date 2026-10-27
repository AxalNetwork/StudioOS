/**
 * D1320 (#2481) — the two reads the API usage page and its request drawer
 * add to D845: the events history narrowed to one assistant connection
 * (`grant=`), and one request by its execution id. Both read only the
 * caller's own rows; another member's grant reads as none, and another
 * member's request reads exactly as one that does not exist.
 *
 * Real SQLite through the D1 shim, driven through the real route with a
 * signed session, as `developer_usage_d845.test.ts`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/developer_usage_d1320.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { developerUsage } from '../src/routes/developer_usage.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M419 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/419_ai_caps_topups.sql'), 'utf8');
const M524 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/524_api_usage_events.sql'), 'utf8');
const M523 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/523_member_api_keys.sql'), 'utf8');

const A = 10, B = 20;
const KEY_A = 'key-a-1', KEY_A2 = 'key-a-2', KEY_B = 'key-b-1';
const DAY1 = '2026-10-01', DAY2 = '2026-10-02';
const RANGE = `from=${DAY1}&to=2026-10-31`;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(tableFromBaseline(BASELINE, 'users'));
  db.exec(tableFromBaseline(M419, 'ai_budget_reservations'));
  db.exec(M524);
  db.exec(M523);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(A, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(B, 'founder', 'Bo Other', 'bo@example.test', 1002);
  key(db, KEY_A, A, 'CI agent', 1000, '2026-09-01 00:00:00');
  key(db, KEY_A2, A, 'Laptop', null, '2026-09-02 00:00:00');
  key(db, KEY_B, B, 'Bo key', 500, '2026-09-03 00:00:00');
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { db, env };
}

let seq = 0;
/** A key row as D841 stores it. The hash is a fake fixture value; no secret exists. */
function key(db: InstanceType<typeof DatabaseSync>, uid: string, user: number, name: string, limit: number | null,
  createdAt: string, { revoked = null as string | null, expires = null as string | null } = {}) {
  seq += 1;
  db.prepare(`INSERT INTO member_api_keys (uid, user_id, key_id, secret_sha256, name, scopes_json, companies_json,
      monthly_limit_microusd, expires_at, revoked_at, revoked_reason, created_at) VALUES (?, ?, ?, ?, ?, '["validate:read"]', '[]', ?, ?, ?, ?, ?)`)
    .run(uid, user, `kid${String(seq).padStart(9, '0')}`, '0'.repeat(64), name, limit, expires, revoked, revoked ? 'revoked' : null, createdAt);
}
interface Ev {
  user?: number; key?: string | null; grant?: string | null; at?: string; operation?: string; outcome?: string;
  category?: string | null; ms?: number; provider?: string | null; connector?: string | null; model?: string | null;
  company?: number | null; surface?: string; reservation?: string | null; charged?: number | null; held?: number | null;
}
function ev(db: InstanceType<typeof DatabaseSync>, e: Ev = {}) {
  seq += 1;
  const outcome = e.outcome ?? 'ok';
  db.prepare(`INSERT INTO api_usage_events (execution_id, user_id, api_key_uid, grant_id, surface, operation, outcome,
      error_category, duration_ms, reservation_uid, held_microusd, charged_microusd, model, provider, connector, company_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `exec-${seq}`, e.user ?? A, e.key === undefined ? KEY_A : e.key, e.grant ?? null, e.surface ?? 'mcp', e.operation ?? 'tool_read',
    outcome, outcome === 'ok' ? null : (e.category ?? 'internal'), e.ms ?? 100, e.reservation ?? null, e.held ?? null,
    e.charged === undefined ? null : e.charged, e.model ?? null, e.provider ?? null, e.connector ?? null, e.company ?? null,
    e.at ?? `${DAY1} 12:00:00`,
  );
}
function hold(db: InstanceType<typeof DatabaseSync>, uid: string, user: number, reserved: number, actual: number | null, status = 'settled') {
  const settled = status === 'settled' || status === 'refunded';
  db.prepare(`INSERT INTO ai_budget_reservations (uid, user_id, day_key, month_key, included_microusd, topup_microusd, status,
      settlement_uid, actual_included_microusd, actual_topup_microusd, expires_at) VALUES (?, ?, '2026-10-01', '2026-10', ?, 0, ?, ?, ?, ?, '2026-12-01 00:00:00')`)
    .run(uid, user, reserved, status, settled ? `s-${uid}` : null, settled ? actual : null, settled ? 0 : null);
}

const app = new Hono<any>();
app.route('/api/developer/usage', developerUsage);

async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function get(env: any, path: string, who = A) {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${await tokenFor(who)}` } }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}


test('events: grant= narrows to one assistant connection, and another member\'s grant reads as none', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'a', key: null, grant: 'grant-a', at: `${DAY1} 01:00:00` });
  ev(db, { operation: 'b', key: null, grant: 'grant-a2', at: `${DAY1} 02:00:00` });
  ev(db, { operation: 'c', at: `${DAY1} 03:00:00` });
  ev(db, { user: B, operation: 'd', key: null, grant: 'grant-b', at: `${DAY1} 04:00:00` });
  const ops = async (q: string, who = A) => (await get(env, `/api/developer/usage/events?${RANGE}&${q}`, who)).body.events.map((e: any) => e.operation);
  assert.deepEqual(await ops('grant=grant-a'), ['a']);
  assert.deepEqual(await ops('grant=grant-a2'), ['b']);
  assert.deepEqual(await ops('grant='), ['c', 'b', 'a'], 'an empty grant is no filter');
  assert.deepEqual(await ops('grant=grant-b'), [], 'another member\'s grant reads as none');
  assert.deepEqual(await ops('grant=grant-b', B), ['d']);
  assert.equal((await get(env, `/api/developer/usage/events?${RANGE}&grant=${'g'.repeat(201)}`)).status, 400);
});

test('one request by its execution id: the history\'s columns, the caller\'s own only', async () => {
  const { db, env } = fixture();
  hold(db, 'h1', A, 10_000, 4_000);
  ev(db, { operation: 'structure_with_axalvc', reservation: 'h1', provider: 'p1', connector: 'c1', company: 7, ms: 420 });
  ev(db, { user: B, operation: 'theirs' });
  const [mine, theirs] = ['exec-' + (seq - 1), 'exec-' + seq];
  const r = await get(env, `/api/developer/usage/events/${mine}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.event.execution_id, mine);
  assert.equal(r.body.event.operation, 'structure_with_axalvc');
  assert.deepEqual([r.body.event.reserved_microusd, r.body.event.charged_microusd, r.body.event.refunded_microusd], [10_000, 4_000, 6_000]);
  assert.equal(r.body.event.duration_ms, 420);
  const list = (await get(env, `/api/developer/usage/events?${RANGE}`)).body.events[0];
  assert.deepEqual(Object.keys(r.body.event).sort(), Object.keys(list).sort(), 'the same columns as the history');
  assert.ok(!JSON.stringify(r.body).includes('provider_cost'), 'provider cost is HQ\'s');

  const other = await get(env, `/api/developer/usage/events/${theirs}`);
  const none = await get(env, '/api/developer/usage/events/exec-does-not-exist');
  assert.equal(other.status, 404);
  assert.deepEqual(other.body, none.body, 'another member\'s request reads exactly as one that does not exist');
  assert.equal(other.body.error, 'unknown_request');
  assert.equal((await get(env, `/api/developer/usage/events/${theirs}`, B)).status, 200);
  assert.equal((await get(env, `/api/developer/usage/events/${'x'.repeat(81)}`)).status, 404);
  const anon = await app.request(`/api/developer/usage/events/${mine}`, {}, env);
  assert.equal(anon.status, 401);
});

test('events: outcome=failed is every call that did not succeed', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'ok1', at: `${DAY1} 01:00:00` });
  ev(db, { operation: 'ref', outcome: 'refused', category: 'scope', at: `${DAY1} 02:00:00` });
  ev(db, { operation: 'low', outcome: 'refused', category: 'insufficient_tokens', at: `${DAY1} 03:00:00` });
  ev(db, { operation: 'err', outcome: 'error', category: 'timeout', at: `${DAY1} 04:00:00` });
  ev(db, { operation: 'rl', outcome: 'rate_limited', category: 'rate_limited', at: `${DAY1} 05:00:00` });
  const ops = async (q: string) => (await get(env, `/api/developer/usage/events?${RANGE}&${q}`)).body.events.map((e: any) => e.operation);
  assert.deepEqual(await ops('outcome=failed'), ['rl', 'err', 'low', 'ref']);
  assert.deepEqual(await ops('outcome=ok'), ['ok1']);
  assert.deepEqual(await ops('outcome=refused'), ['ref'], 'the other outcomes are unchanged');
});

test('group=category: the reasons calls did not succeed, which add up to the failures', async () => {
  const { db, env } = fixture();
  ev(db, {});
  ev(db, { outcome: 'refused', category: 'scope' });
  ev(db, { outcome: 'refused', category: 'scope' });
  ev(db, { outcome: 'error', category: 'timeout' });
  ev(db, { user: B, outcome: 'error', category: 'provider' });
  const r = (await get(env, `/api/developer/usage?${RANGE}&group=category`)).body;
  const by = Object.fromEntries(r.groups.map((g: any) => [g.key, g.calls]));
  assert.deepEqual(by, { null: 1, scope: 2, timeout: 1 }, 'another member\'s reason is not here');
  const failed = r.groups.filter((g: any) => g.key !== null).reduce((n: number, g: any) => n + g.calls, 0);
  assert.equal(failed, r.totals.errors);
});
