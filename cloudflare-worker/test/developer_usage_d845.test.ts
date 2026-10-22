/**
 * D845 (#2471) — a member's own usage reports over `api_usage_events` (D843):
 * the groupings and the two-way split, totals equal to the sum of the groups,
 * NULL charges kept NULL, the hold join, p50, the refusal split, the
 * cross-tenant matrix and cursor paging through 1,000 rows.
 *
 * Real SQLite through the D1 shim: `users` from the baseline, migration 524
 * and `ai_budget_reservations` from migration 419, driven through the real
 * route with a signed session.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/developer_usage_d845.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { developerUsage } from '../src/routes/developer_usage.ts';
import { MAX_RANGE_DAYS, P50_MIN_CALLS, parseRange } from '../src/services/apiUsageReport.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M419 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/419_ai_caps_topups.sql'), 'utf8');
const M524 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/524_api_usage_events.sql'), 'utf8');

const A = 10, B = 20;
const KEY_A = 'key-a-1', KEY_A2 = 'key-a-2', KEY_B = 'key-b-1';
const DAY1 = '2026-10-01', DAY2 = '2026-10-02';
const RANGE = `from=${DAY1}&to=2026-10-31`;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(tableFromBaseline(BASELINE, 'users'));
  db.exec(tableFromBaseline(M419, 'ai_budget_reservations'));
  db.exec(M524);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(A, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(B, 'founder', 'Bo Other', 'bo@example.test', 1002);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { db, env };
}

let seq = 0;
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

const SUMMED = ['calls', 'ok', 'errors', 'refused', 'rate_limited', 'insufficient_tokens', 'error', 'metered_calls'] as const;
function assertTotalsAreSums(body: any) {
  for (const f of SUMMED) {
    assert.equal(body.totals[f], body.groups.reduce((s: number, g: any) => s + g[f], 0), `totals.${f} = sum of groups`);
  }
  for (const f of ['charged_microusd', 'refunded_microusd'] as const) {
    const known = body.groups.filter((g: any) => g[f] !== null);
    assert.equal(body.totals[f], known.length ? known.reduce((s: number, g: any) => s + g[f], 0) : null, `totals.${f}`);
  }
}

test('ranges are UTC days, 30 by default and 92 at most', () => {
  const now = new Date('2026-10-21T15:00:00Z');
  assert.deepEqual(parseRange(undefined, undefined, now),
    { from: '2026-09-22', to: '2026-10-21', fromTs: '2026-09-22 00:00:00', toTs: '2026-10-22 00:00:00' });
  assert.equal(parseRange('2026-07-22', '2026-10-21', now).from, '2026-07-22', '92 days, both ends included');
  assert.throws(() => parseRange('2026-07-21', '2026-10-21', now), /range_too_long/);
  assert.equal(MAX_RANGE_DAYS, 92);
  assert.throws(() => parseRange('2026-02-30', undefined, now), /invalid_from/);
  assert.throws(() => parseRange('2026-10-05', '2026-10-01', now), /invalid_range/);
});

test('every grouping: totals equal the sum of the groups, and the split adds up to errors', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'search', provider: 'openai', model: 'm-1', connector: 'notion', at: `${DAY1} 01:00:00` });
  ev(db, { operation: 'search', outcome: 'refused', category: 'scope', provider: 'openai', at: `${DAY1} 02:00:00` });
  ev(db, { operation: 'write', outcome: 'refused', category: 'insufficient_tokens', key: KEY_A2, at: `${DAY2} 03:00:00` });
  ev(db, { operation: 'write', outcome: 'rate_limited', category: 'rate_limited', key: null, grant: 'g-1', at: `${DAY2} 04:00:00` });
  ev(db, { operation: 'write', outcome: 'error', category: 'provider', connector: 'notion', model: 'm-2', at: `${DAY2} 05:00:00` });
  ev(db, { user: B, key: KEY_B, operation: 'search', at: `${DAY1} 06:00:00` });

  for (const group of ['day', 'key', 'provider', 'connector', 'tool', 'model']) {
    const r = await get(env, `/api/developer/usage?${RANGE}&group=${group}`);
    assert.equal(r.status, 200, group);
    assert.equal(r.body.totals.calls, 5, `${group}: only A's five calls`);
    assertTotalsAreSums(r.body);
  }
  const t = (await get(env, `/api/developer/usage?${RANGE}`)).body.totals;
  assert.deepEqual([t.ok, t.refused, t.insufficient_tokens, t.rate_limited, t.error, t.errors], [1, 1, 1, 1, 1, 4]);

  const byDay = (await get(env, `/api/developer/usage?${RANGE}&group=day`)).body;
  assert.deepEqual(byDay.groups.map((g: any) => [g.key, g.calls]), [[DAY1, 2], [DAY2, 3]]);
  const byTool = (await get(env, `/api/developer/usage?${RANGE}&group=tool`)).body;
  assert.deepEqual(byTool.groups.map((g: any) => [g.key, g.label, g.calls]), [['write', 'write', 3], ['search', 'search', 2]]);
  const byKey = (await get(env, `/api/developer/usage?${RANGE}&group=key`)).body;
  assert.deepEqual(byKey.groups.map((g: any) => [g.key, g.calls]).sort(), [[KEY_A, 3], [KEY_A2, 1], [null, 1]].sort());
  assert.ok(byKey.groups.every((g: any) => g.label === null), 'a key\'s uid is not its name: the label waits for the keys table');
});

test('group=day&by=…: a two-way report whose cells add up to the totals', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'search', at: `${DAY1} 01:00:00` });
  ev(db, { operation: 'write', at: `${DAY1} 02:00:00` });
  ev(db, { operation: 'write', at: `${DAY2} 03:00:00` });
  ev(db, { operation: 'write', at: `${DAY2} 04:00:00` });
  const r = await get(env, `/api/developer/usage?${RANGE}&group=day&by=tool`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.groups.map((g: any) => [g.key, g.by_key, g.by_label, g.calls]),
    [[DAY1, 'search', 'search', 1], [DAY1, 'write', 'write', 1], [DAY2, 'write', 'write', 2]]);
  assertTotalsAreSums(r.body);
  assert.equal((await get(env, `/api/developer/usage?${RANGE}&group=tool&by=key`)).status, 400, 'only days split');
  assert.equal((await get(env, `/api/developer/usage?${RANGE}&group=day&by=model`)).status, 400);
  assert.equal((await get(env, `/api/developer/usage?${RANGE}&group=nope`)).status, 400);
});

test('NULL charges stay NULL; the settled hold is the charge; refunds come from the hold', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'unmetered' });
  ev(db, { operation: 'unmetered' });
  let r = (await get(env, `/api/developer/usage?${RANGE}&group=tool`)).body;
  assert.equal(r.totals.charged_microusd, null, 'nothing metered is NULL, never 0');
  assert.equal(r.totals.refunded_microusd, null);
  assert.equal(r.totals.metered_calls, 0);
  assert.equal(r.groups[0].charged_microusd, null);

  hold(db, 'h-settled', A, 5000, 3000);
  hold(db, 'h-pending', A, 4000, null, 'pending');
  hold(db, 'h-other', B, 9000, 9000);
  ev(db, { operation: 'metered', reservation: 'h-settled', charged: 1 });
  ev(db, { operation: 'metered', reservation: 'h-pending' });
  ev(db, { operation: 'metered', reservation: 'h-other' });
  ev(db, { operation: 'free', charged: 0 });
  r = (await get(env, `/api/developer/usage?${RANGE}&group=tool`)).body;
  const by = Object.fromEntries(r.groups.map((g: any) => [g.key, g]));
  assert.equal(by.metered.charged_microusd, 3000, 'the settled hold\'s charge, not the row\'s copy');
  assert.equal(by.metered.refunded_microusd, 2000);
  assert.equal(by.metered.metered_calls, 1, 'a pending hold and another member\'s hold are not metered');
  assert.equal(by.free.charged_microusd, 0, 'a known zero stays 0');
  assert.equal(by.unmetered.charged_microusd, null);
  assert.equal(r.totals.charged_microusd, 3000);
  assertTotalsAreSums(r);

  const events = (await get(env, `/api/developer/usage/events?${RANGE}&operation=metered`)).body.events;
  const own = events.find((e: any) => e.reservation_uid === 'h-settled');
  assert.deepEqual([own.reserved_microusd, own.charged_microusd, own.refunded_microusd], [5000, 3000, 2000]);
  const foreign = events.find((e: any) => e.reservation_uid === 'h-other');
  assert.deepEqual([foreign.reserved_microusd, foreign.charged_microusd], [null, null], 'another member\'s hold is never joined');
});

test('p50 is the lower median per group, NULL under five calls', async () => {
  const { db, env } = fixture();
  for (const ms of [50, 10, 40, 20, 30, 60]) ev(db, { operation: 'six', ms });
  for (const ms of [5, 7, 9, 11]) ev(db, { operation: 'four', ms });
  const r = (await get(env, `/api/developer/usage?${RANGE}&group=tool`)).body;
  const by = Object.fromEntries(r.groups.map((g: any) => [g.key, g]));
  assert.equal(P50_MIN_CALLS, 5);
  assert.equal(by.six.p50_ms, 30);
  assert.equal(by.four.p50_ms, null);
  assert.equal(r.totals.p50_ms, 11, 'ten calls (5, 7, 9, 10, 11, 20, …): the fifth smallest');
});

test('cross-tenant: no parameter returns another member\'s rows', async () => {
  const { db, env } = fixture();
  ev(db, { user: A, key: KEY_A, operation: 'a_tool', provider: 'p', connector: 'c', company: 1 });
  ev(db, { user: B, key: KEY_B, operation: 'b_tool', provider: 'p', connector: 'c', company: 1 });
  const bWould = [
    `/api/developer/usage?${RANGE}&key=${KEY_B}`,
    `/api/developer/usage/events?${RANGE}&key=${KEY_B}`,
  ];
  for (const p of bWould) {
    const r = await get(env, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error, 'unknown_key');
    assert.deepEqual(r.body, (await get(env, p.replace(KEY_B, 'no-such-key'))).body, 'B\'s key reads as one that does not exist');
  }
  for (const q of ['', '&operation=b_tool', '&provider=p', '&connector=c', '&company=1', '&surface=mcp', '&outcome=ok']) {
    const r = (await get(env, `/api/developer/usage/events?${RANGE}${q}`)).body;
    assert.ok(r.events.every((e: any) => e.api_key_uid !== KEY_B && e.operation !== 'b_tool'), q);
  }
  for (const group of ['day', 'key', 'provider', 'connector', 'tool', 'model']) {
    const r = (await get(env, `/api/developer/usage?${RANGE}&group=${group}`)).body;
    assert.equal(r.totals.calls, 1, group);
    assert.ok(!r.groups.some((g: any) => g.key === KEY_B || g.key === 'b_tool'), group);
  }
  const mine = (await get(env, `/api/developer/usage?${RANGE}&key=${KEY_A}`)).body;
  assert.equal(mine.totals.calls, 1);
});

test('events: the nine filters, no arguments, results or provider cost', async () => {
  const { db, env } = fixture();
  ev(db, { operation: 'x', provider: 'p1', connector: 'c1', company: 7, surface: 'api', at: `${DAY1} 01:00:00` });
  ev(db, { operation: 'y', outcome: 'refused', category: 'insufficient_tokens', at: `${DAY2} 01:00:00` });
  ev(db, { operation: 'z', key: KEY_A2, outcome: 'error', category: 'provider', at: '2026-09-15 01:00:00' });
  const ids = async (q: string) => (await get(env, `/api/developer/usage/events?${q}`)).body.events.map((e: any) => e.operation);
  assert.deepEqual(await ids(RANGE), ['y', 'x']);
  assert.deepEqual(await ids('from=2026-09-01&to=2026-10-31'), ['y', 'x', 'z']);
  assert.deepEqual(await ids(`from=${DAY2}&to=${DAY2}`), ['y']);
  assert.deepEqual(await ids('from=2026-09-01&to=2026-10-31&key=key-a-2'), ['z']);
  assert.deepEqual(await ids(`${RANGE}&outcome=insufficient_tokens`), ['y']);
  assert.deepEqual(await ids(`${RANGE}&outcome=refused`), [], 'an insufficient_tokens refusal is not counted twice');
  assert.deepEqual(await ids(`${RANGE}&surface=api`), ['x']);
  assert.deepEqual(await ids(`${RANGE}&operation=y`), ['y']);
  assert.deepEqual(await ids(`${RANGE}&provider=p1`), ['x']);
  assert.deepEqual(await ids(`${RANGE}&connector=c1`), ['x']);
  assert.deepEqual(await ids(`${RANGE}&company=7`), ['x']);
  for (const bad of ['outcome=nope', 'surface=web', 'company=abc', 'cursor=garbage']) {
    assert.equal((await get(env, `/api/developer/usage/events?${RANGE}&${bad}`)).status, 400, bad);
  }
  assert.equal((await get(env, '/api/developer/usage/events?from=2026-1-1')).status, 400);
  assert.equal((await get(env, '/api/developer/usage/events?from=2026-01-01&to=2026-10-31')).body.error, 'range_too_long');
  const e = (await get(env, `/api/developer/usage/events?${RANGE}`)).body.events[0];
  assert.deepEqual(Object.keys(e).sort(), [
    'api_key_uid', 'charged_microusd', 'client', 'company_id', 'connector', 'created_at', 'duration_ms', 'error_category',
    'execution_id', 'grant_id', 'model', 'operation', 'outcome', 'provider', 'refunded_microusd', 'reservation_uid',
    'reserved_microusd', 'surface',
  ]);
  const report = await get(env, `/api/developer/usage?${RANGE}&group=tool`);
  assert.ok(!JSON.stringify(report.body).includes('provider_cost'), 'provider cost is HQ\'s');
});

test('the events cursor pages 1,000 rows with no duplicate and no gap, ties broken by id', async () => {
  const { db, env } = fixture();
  db.exec('BEGIN');
  for (let i = 0; i < 1000; i += 1) {
    // Seven rows share each second, so a page edge falls inside a second and the order must fall back to the id.
    const s = Math.floor(i / 7);
    ev(db, { at: `${DAY1} ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:00`, operation: `op-${i}` });
  }
  for (let i = 0; i < 5; i += 1) ev(db, { user: B, key: KEY_B, at: `${DAY1} 00:00:30` });
  db.exec('COMMIT');
  const seen = new Set<string>();
  let cursor: string | null = null, pages = 0;
  do {
    const r = await get(env, `/api/developer/usage/events?${RANGE}${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200);
    pages += 1;
    assert.ok(r.body.events.length <= 100);
    for (const e of r.body.events) {
      assert.ok(!seen.has(e.execution_id), `duplicate ${e.execution_id}`);
      seen.add(e.execution_id);
    }
    cursor = r.body.next_cursor;
  } while (cursor && pages < 20);
  assert.equal(seen.size, 1000, 'every row of A\'s, once');
  assert.equal(pages, 10);
});

test('recorded, recorded_since and an empty report', async () => {
  const { db, env } = fixture();
  let r = (await get(env, `/api/developer/usage?${RANGE}`)).body;
  assert.deepEqual([r.recorded, r.recorded_since, r.groups.length, r.totals.calls, r.totals.charged_microusd, r.totals.p50_ms],
    [false, null, 0, 0, null, null]);
  ev(db, { user: B, key: KEY_B, at: '2026-09-20 10:00:00' });
  ev(db, { at: `${DAY2} 10:00:00` });
  r = (await get(env, `/api/developer/usage?${RANGE}`)).body;
  assert.equal(r.recorded, true);
  assert.equal(r.recorded_since, '2026-09-20', 'the platform\'s first row: recording began then, for everyone');
  const none = (await get(env, `/api/developer/usage?${RANGE}`, B)).body;
  assert.equal(none.totals.calls, 0, 'B has nothing in October');
  assert.equal(none.recorded, true);
});

test('groups page at 100 with a cursor', async () => {
  const { db, env } = fixture();
  db.exec('BEGIN');
  for (let i = 0; i < 130; i += 1) ev(db, { operation: `tool-${String(i).padStart(3, '0')}` });
  db.exec('COMMIT');
  const first = (await get(env, `/api/developer/usage?${RANGE}&group=tool`)).body;
  assert.equal(first.groups.length, 100);
  assert.equal(first.totals.calls, 130, 'totals cover every group, not the page');
  const second = (await get(env, `/api/developer/usage?${RANGE}&group=tool&cursor=${first.next_cursor}`)).body;
  assert.equal(second.groups.length, 30);
  assert.equal(second.next_cursor, null);
  const keys = [...first.groups, ...second.groups].map((g: any) => g.key);
  assert.equal(new Set(keys).size, 130);
  assert.equal((await get(env, `/api/developer/usage?${RANGE}&group=tool&cursor=g0x`)).status, 400);
});

test('a request with no session is refused', async () => {
  const { env } = fixture();
  const res = await app.request(`/api/developer/usage?${RANGE}`, {}, env);
  assert.equal(res.status, 401);
});
