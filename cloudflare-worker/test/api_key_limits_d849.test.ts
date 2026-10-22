/**
 * D849 (#2472) part 2 — a member API key's own monthly cap (`key_limit_reached`)
 * and the two key alerts, on the one AI token ledger. Real SQLite: the AI
 * budget fixture (419, 430, 486, 505, 508, 509) with 510, 523, 524 and 525.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/api_key_limits_d849.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { memKV } from './_mem_kv.mjs';
import { reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { MeteringRefused, holdKey, meteredCall, toolOperation } from '../src/services/metering.ts';
import {
  FAILURE_WINDOW_CALLS, KEY_LIMIT_SENTENCE, keyHoldKey, keyMonthSpend, keysMonthSpend, noteKeyFailures, noteKeyLimitThresholds,
} from '../src/services/apiKeyLimits.ts';
import { callTool } from '../src/mcp/server.ts';

const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-21T12:00:00Z');
const KEY = 'k-capped-0000-0000-0000-000000000001', OTHER_KEY = 'k-free-0000-0000-0000-000000000002', B_KEY = 'k-memb3-0000-0000-0000-000000000003';

function fixture({ allowance = 10_000_000, limit = 1_000_000 as number | null } = {}) {
  const f = aiBudgetFixture();
  f.db.exec(migration('510_member_ai_pauses.sql') + migration('523_member_api_keys.sql') + migration('524_api_usage_events.sql') + migration('525_ai_reservation_idempotency.sql'));
  setFixtureAllowance(f.db, allowance);
  const k = f.db.prepare(`INSERT INTO member_api_keys(uid,user_id,key_id,secret_sha256,name,scopes_json,companies_json,monthly_limit_microusd)
    VALUES(?,?,?,?,?,'["validate:read"]','[]',?)`);
  k.run(KEY, 2, 'capkey000001', 'a'.repeat(64), 'CI agent', limit);
  k.run(OTHER_KEY, 2, 'freekey00002', 'b'.repeat(64), 'Laptop', null);
  k.run(B_KEY, 3, 'membkey00003', 'c'.repeat(64), 'Other member', 100_000);
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', RATE_LIMITS: memKV() };
  return { ...f, env };
}
const holds = (db: any) => db.prepare('SELECT status, idempotency_key, included_microusd + topup_microusd AS held, COALESCE(actual_included_microusd,0) + COALESCE(actual_topup_microusd,0) AS charged FROM ai_budget_reservations ORDER BY rowid').all();
const notices = (db: any) => { try { return db.prepare('SELECT user_id, type, title, payload FROM notifications_inbox ORDER BY id').all(); } catch { return []; } };
let n = 0;
const call = (env: any, over: Record<string, unknown> = {}, run: () => Promise<unknown> = async () => 'ran') =>
  meteredCall(env, { userId: 2, executionId: `exec-${++n}`, operation: 'mcp.tool.paid', quoteMicrousd: 300_000, apiKeyUid: KEY, now: NOW, ...over }, run);

test('a call through a key holds under the key, and the key\'s month spend is its own holds only', async () => {
  const f = fixture();
  try {
    await call(f.env, { executionId: 'e1' });
    await call(f.env, { executionId: 'e2', apiKeyUid: OTHER_KEY });
    await call(f.env, { executionId: 'e3', apiKeyUid: null });
    assert.deepEqual(holds(f.db).map((h: any) => h.idempotency_key), [keyHoldKey(KEY, 'e1', 'mcp.tool.paid'), keyHoldKey(OTHER_KEY, 'e2', 'mcp.tool.paid'), holdKey('e3', 'mcp.tool.paid')]);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 300_000);
    assert.equal(await keyMonthSpend(f.env, 2, OTHER_KEY, NOW), 300_000);
    assert.equal(await keyMonthSpend(f.env, 3, KEY, NOW), 0, 'another member never counts this key');
    assert.equal(await keyMonthSpend(f.env, 2, KEY, new Date('2026-11-02T00:00:00Z')), 0, 'a new month starts at 0');
    // A pending hold counts at what it holds; a refunded one at nothing; a review at its recorded cost when higher.
    const pending = await reserveAiBudget(f.env, 2, 100_000, NOW, { idempotencyKey: keyHoldKey(KEY, 'p', 'x') });
    assert.ok(pending.ok);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 400_000);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW, keyHoldKey(KEY, 'p', 'x')), 300_000, 'a call\'s own hold can be left out');
    const refunded = await reserveAiBudget(f.env, 2, 50_000, NOW, { idempotencyKey: keyHoldKey(KEY, 'r', 'x') });
    assert.ok(refunded.ok);
    await settleAiReservation(f.env, refunded.reservation, 0, true);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 400_000, 'a refunded hold costs nothing');
    await assert.rejects(() => settleAiReservation(f.env, pending.reservation, 250_000), /exceeds reservation/);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 550_000, 'in review at the recorded cost');
  } finally { f.db.close(); }
});

test('key_limit_reached: the call that would pass the cap is refused before it runs or holds; another key and no cap are not', async () => {
  const f = fixture({ limit: 1_000_000 });
  try {
    for (let i = 0; i < 3; i++) await call(f.env);
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 900_000);
    let ran = 0;
    const before = holds(f.db).length;
    await assert.rejects(() => call(f.env, {}, async () => { ran++; return 'x'; }),
      (e: any) => e instanceof MeteringRefused && e.code === 'key_limit_reached' && e.sentence === KEY_LIMIT_SENTENCE);
    assert.equal(ran, 0, 'refused before the run');
    assert.equal(holds(f.db).length, before, 'refused before the hold');
    // A smaller call that fits still runs: 900000 + 100000 is the cap exactly.
    await call(f.env, { quoteMicrousd: 100_000 });
    await assert.rejects(() => call(f.env, { quoteMicrousd: 1 }), (e: any) => e.code === 'key_limit_reached');
    // The member's other key, with no cap, and a call with no key, are not this key's.
    await call(f.env, { apiKeyUid: OTHER_KEY });
    await call(f.env, { apiKeyUid: null });
    // A free call holds nothing and is never refused by a cap.
    await call(f.env, { quoteMicrousd: 0 });
  } finally { f.db.close(); }
});

test('the re-check after the hold: calls racing past the cap together are released, never both charged', async () => {
  const f = fixture({ limit: 1_000_000 });
  try {
    const results = await Promise.allSettled([1, 2].map(() => call(f.env, { quoteMicrousd: 600_000 })));
    const refused = results.filter((r) => r.status === 'rejected');
    assert.ok(refused.length >= 1, 'at least one is refused');
    assert.ok(refused.every((r: any) => r.reason?.code === 'key_limit_reached'));
    assert.ok(await keyMonthSpend(f.env, 2, KEY, NOW) <= 1_000_000, 'never past the cap');
    assert.ok(holds(f.db).every((h: any) => h.status !== 'pending'), 'every refused hold is released');
  } finally { f.db.close(); }
});

test('the re-check releases a hold when another writer passed the cap between the check and the hold', async () => {
  const f = fixture({ limit: 1_000_000 });
  try {
    await call(f.env, { quoteMicrousd: 600_000 });
    // 600000 + 300000 passes the first check. A racer's 300000 hold under the same key lands just before this call's hold.
    const realPrepare = f.env.DB.prepare.bind(f.env.DB);
    let raced = false;
    f.env.DB.prepare = (sql: string) => {
      if (!raced && /INSERT INTO ai_budget_reservations\(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at,idempotency_key\)/.test(sql)) {
        raced = true;
        f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at,idempotency_key)
          VALUES('racer',2,'2026-10-21','2026-10',300000,0,'2099-01-01 00:00:00',?)`).run(keyHoldKey(KEY, 'racer', 'x'));
      }
      return realPrepare(sql);
    };
    let ran = 0;
    await assert.rejects(() => call(f.env, { executionId: 'late', quoteMicrousd: 300_000 }, async () => { ran++; return 'x'; }), (e: any) => e.code === 'key_limit_reached');
    assert.ok(raced, 'the racer landed');
    assert.equal(ran, 0, 'nothing ran');
    const late = holds(f.db).find((h: any) => h.idempotency_key === keyHoldKey(KEY, 'late', 'mcp.tool.paid'));
    assert.deepEqual([late.status, late.charged], ['refunded', 0], 'the late hold was taken, then released');
  } finally { f.db.close(); }
});

test('a replay of a call in flight is not counted twice against its own key', async () => {
  const f = fixture({ limit: 500_000 });
  try {
    const first = await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: keyHoldKey(KEY, 'same', 'mcp.tool.paid') });
    assert.ok(first.ok);
    const r = await call(f.env, { executionId: 'same' });
    assert.equal(r.value, 'ran');
    assert.equal(holds(f.db).length, 1, 'the one hold');
    assert.equal(await keyMonthSpend(f.env, 2, KEY, NOW), 300_000);
  } finally { f.db.close(); }
  // The re-check never releases the hold the first attempt still runs under: here the key's other hold
  // and that first hold together pass a cap the replay's own quote fits.
  const g = fixture({ limit: 300_000 });
  try {
    assert.ok((await reserveAiBudget(g.env, 2, 150_000, NOW, { idempotencyKey: keyHoldKey(KEY, 'other', 'x') })).ok);
    // 150000 other + 100000 replay fits 300000; with the first attempt's 200000 the key holds 350000.
    const first = await reserveAiBudget(g.env, 2, 200_000, NOW, { idempotencyKey: keyHoldKey(KEY, 'same', 'mcp.tool.paid') });
    assert.ok(first.ok);
    const r = await meteredCall(g.env, { userId: 2, executionId: 'same', operation: 'mcp.tool.paid', quoteMicrousd: 100_000, apiKeyUid: KEY, now: NOW }, async () => 'ran');
    assert.equal(r.value, 'ran');
    const own = holds(g.db).find((h: any) => h.idempotency_key === keyHoldKey(KEY, 'same', 'mcp.tool.paid'));
    assert.notEqual(own.status, 'refunded', 'the first attempt\'s hold is never released by its replay');
  } finally { g.db.close(); }
});

test('fails closed: a key that cannot be read runs nothing', async () => {
  const f = fixture();
  try {
    let ran = 0;
    await assert.rejects(() => call(f.env, { apiKeyUid: 'k-missing' }, async () => { ran++; return 'x'; }), /API key unreadable/);
    await assert.rejects(() => call(f.env, { apiKeyUid: 'bad key!' }, async () => { ran++; return 'x'; }), /Metering key unreadable/);
    assert.equal(ran, 0);
    assert.equal(holds(f.db).length, 0);
  } finally { f.db.close(); }
});

test('api_key_limit: notified once at 80% and once at 100% of the cap; another key and another member are not', async () => {
  const f = fixture({ limit: 1_000_000 });
  try {
    await call(f.env, { quoteMicrousd: 400_000 });
    assert.equal(notices(f.db).length, 0, '40% notifies nothing');
    await call(f.env, { quoteMicrousd: 400_000 });
    await call(f.env, { quoteMicrousd: 50_000 });
    await call(f.env, { quoteMicrousd: 150_000 });
    await call(f.env, { apiKeyUid: OTHER_KEY, quoteMicrousd: 900_000 });
    const n1 = notices(f.db);
    assert.deepEqual(n1.map((r: any) => [r.user_id, r.type, JSON.parse(r.payload).threshold]), [[2, 'api_key_limit', 80], [2, 'api_key_limit', 100]]);
    assert.match(n1[0].title, /^Your API key "CI agent" \(axk_capkey000001…\) has used 80% of its monthly limit$/);
    assert.match(n1[1].title, /has reached its monthly limit$/);
    assert.equal(JSON.parse(n1[1].payload).used_microusd, 1_000_000);
    // Again this month: nothing new. A direct re-run of the check is a no-op.
    assert.equal(await noteKeyLimitThresholds(f.env, 2, KEY, NOW), null);
    assert.equal(notices(f.db).length, 2);
    // A first charge that jumps straight past both sends only the top one, and marks the lower.
    const g = fixture({ limit: 1_000_000 });
    try {
      await meteredCall(g.env, { userId: 2, executionId: 'jump', operation: 'mcp.tool.paid', quoteMicrousd: 1_000_000, apiKeyUid: KEY, now: NOW }, async () => 'x');
      assert.deepEqual(notices(g.db).map((r: any) => JSON.parse(r.payload).threshold), [100]);
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test('the limits read carries each key\'s month spend; unknown is null', async () => {
  const f = fixture();
  try {
    await call(f.env, { quoteMicrousd: 250_000 });
    const m = await keysMonthSpend(f.env, 2, [KEY, OTHER_KEY], NOW);
    assert.deepEqual([...m.entries()], [[KEY, 250_000], [OTHER_KEY, 0]]);
    f.db.exec('DROP TABLE ai_budget_reservations');
    const broken = await keysMonthSpend(f.env, 2, [KEY], NOW);
    assert.equal(broken.get(KEY), null);
  } finally { f.db.close(); }
});

test('api_key_failures: more than 20% failed over at least 50 calls in an hour, once an hour, per key', async () => {
  const f = fixture();
  try {
    const add = (uid: string, outcome: string, count: number, user = 2, ago = 0) => {
      for (let i = 0; i < count; i++) {
        f.db.prepare(`INSERT INTO api_usage_events(execution_id,user_id,api_key_uid,surface,operation,outcome,duration_ms,created_at)
          VALUES(?,?,?,'mcp','list_companies',?,1,datetime('now', ?))`).run(`${uid}-${outcome}-${Math.random()}`, user, uid, outcome, `-${ago} minutes`);
      }
    };
    add(KEY, 'ok', 40); add(KEY, 'error', 10);
    assert.equal(await noteKeyFailures(f.env, 2, KEY), false, '10 of 50 is 20%, not more');
    add(KEY, 'refused', 1);
    assert.equal(await noteKeyFailures(f.env, 2, KEY), false, 'a refusal is not a failure');
    add(KEY, 'error', 1);
    assert.equal(await noteKeyFailures(f.env, 2, KEY), true, '11 of 52');
    assert.equal(await noteKeyFailures(f.env, 2, KEY), false, 'once an hour');
    const rows = notices(f.db);
    assert.deepEqual(rows.map((r: any) => [r.user_id, r.type]), [[2, 'api_key_failures']]);
    assert.deepEqual(JSON.parse(rows[0].payload), { key_uid: KEY, calls: 52, failed: 11, window_minutes: 60 });
    // Too few calls, calls over an hour old, and another key's or member's failures are not counted.
    add(OTHER_KEY, 'error', FAILURE_WINDOW_CALLS - 1);
    assert.equal(await noteKeyFailures(f.env, 2, OTHER_KEY), false, '49 calls');
    add(OTHER_KEY, 'error', 30, 2, 90);
    assert.equal(await noteKeyFailures(f.env, 2, OTHER_KEY), false, 'an hour and a half ago is outside');
    add(B_KEY, 'error', 60, 3);
    assert.equal(await noteKeyFailures(f.env, 2, B_KEY), false, 'not member 2\'s key');
    assert.equal(await noteKeyFailures(f.env, 3, B_KEY), true);
  } finally { f.db.close(); }
});

test('callTool through a key: the cap is an MCP error result with key_limit_reached, and a failing call checks the failure rate', async () => {
  const f = fixture({ limit: 500_000 });
  try {
    for (const col of ['founder_id INTEGER', 'spinout_lab_active INTEGER', 'jwt_min_iat INTEGER', 'deletion_requested_at TEXT']) f.db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    const props = { userId: 2, companies: [], clientId: `apikey:${KEY}`, clientName: 'CI agent', redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000) - 10, keyUid: KEY };
    const tool = (name: string, run: () => Promise<unknown> = async () => ({ ran: name })) => ({ name, requiredScope: 'validate:read' as const, title: name, description: name, inputSchema: {}, company: false, run });
    const priced = { version: 'test-1', operations: { [toolOperation('paid_tool')]: { price_microusd: 300_000, unit: 'call' as const }, [toolOperation('broken_tool')]: { price_microusd: 0, unit: 'call' as const } } };
    const json = (r: any) => JSON.parse(r.content[0].text);
    assert.deepEqual(json(await callTool(f.env, props, null, tool('paid_tool'), {}, ['validate:read'], priced)), { ran: 'paid_tool' });
    const refused = await callTool(f.env, props, null, tool('paid_tool'), {}, ['validate:read'], priced);
    assert.equal(refused.isError, true);
    assert.deepEqual(json(refused), { error: KEY_LIMIT_SENTENCE, code: 'key_limit_reached' });
    const row = f.db.prepare("SELECT outcome, error_category, api_key_uid FROM api_usage_events ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual({ ...row }, { outcome: 'refused', error_category: 'insufficient_tokens', api_key_uid: KEY });
    // 49 earlier failures on the key; the 50th, a real failing call, crosses the rate and notifies.
    for (let i = 0; i < 48; i++) f.db.prepare(`INSERT INTO api_usage_events(execution_id,user_id,api_key_uid,surface,operation,outcome,duration_ms) VALUES(?,2,?,'mcp','broken_tool','error',1)`).run(`seed-${i}`, KEY);
    const quiet = console.error; console.error = () => {};
    try { await callTool(f.env, props, null, tool('broken_tool', async () => { throw new Error('boom'); }), {}, ['validate:read'], priced); }
    finally { console.error = quiet; }
    assert.deepEqual(notices(f.db).map((r: any) => r.type), ['api_key_failures']);
  } finally { f.db.close(); }
});
