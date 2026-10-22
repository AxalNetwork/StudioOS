/**
 * D844 (#2466) — metering on the one AI token ledger: idempotent holds,
 * settle and release, the refusals in plain words, and `callTool` through
 * `meteredCall` for a priced tool. On `_ai_budget_fixture.mjs` (migrations
 * 419, 486, 493) with 510 and 525.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/metering_d844.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { guardSafe } from './_guard_stub.mjs';
import { loadAiBudget, reserveAiBudget, settleAiReservation, usdToMicro } from '../src/services/aiBudget.ts';
import { run, __resetForTest, ROUTE, estimateCostUsd } from '../src/services/aiRouter.ts';
import {
  METERING_POLICY, MeteringRefused, REFUSAL_WORDS, holdKey, meteredCall, quoteFor, refusalFor, toolOperation,
} from '../src/services/metering.ts';
import { callTool, registeredTools } from '../src/mcp/server.ts';

const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-21T12:00:00Z');

function fixture(allowance = 1_000_000) {
  const f = aiBudgetFixture();
  f.db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql'));
  setFixtureAllowance(f.db, allowance);
  return { ...f, env: { DB: f.DB, ENVIRONMENT: 'development' } as any };
}
const holds = (db: any, user = 2) => db.prepare('SELECT uid, status, idempotency_key, included_microusd + topup_microusd AS held, COALESCE(actual_included_microusd,0) + COALESCE(actual_topup_microusd,0) AS charged FROM ai_budget_reservations WHERE user_id = ? ORDER BY rowid').all(user);
const spent = async (env: any) => { const b = await loadAiBudget(env, 2, NOW); return b.month_spend_microusd + b.month_reserved_microusd; };
const input = (over: Record<string, unknown> = {}) => ({ userId: 2, executionId: 'exec-1', operation: 'mcp.tool.paid', quoteMicrousd: 300_000, now: NOW, ...over });

test('the migration: a key per member, unique where present, and NULL for every caller that passes none', async () => {
  const f = fixture();
  try {
    const a = await reserveAiBudget(f.env, 2, 100_000, NOW);
    const b = await reserveAiBudget(f.env, 2, 100_000, NOW);
    assert.ok(a.ok && b.ok && a.reservation.uid !== b.reservation.uid, 'no key: two holds, as before');
    assert.deepEqual(holds(f.db).map((h: any) => h.idempotency_key), [null, null]);
    assert.ok(!('replayed' in a));
    // Two members may use the same key.
    const k1 = await reserveAiBudget(f.env, 2, 100_000, NOW, { idempotencyKey: 'exec:x:fee' });
    const k2 = await reserveAiBudget(f.env, 3, 100_000, NOW, { idempotencyKey: 'exec:x:fee' });
    assert.ok(k1.ok && k2.ok && k1.reservation.uid !== k2.reservation.uid);
    assert.throws(() => f.db.prepare("INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at,idempotency_key) VALUES('dup',2,'d','m',0,0,'2099-01-01','exec:x:fee')").run(), /UNIQUE/);
  } finally { f.db.close(); }
});

test('the same execution reserved twice holds once, and a replay returns that hold whatever its status', async () => {
  // Mutation checked: drop the `heldUnder` lookup before the insert → the paused replay is refused;
  // drop `ON CONFLICT DO NOTHING` → the race throws UNIQUE; drop the lookup after it → the race's loser is refused.
  const f = fixture();
  try {
    const key = holdKey('exec-1', 'fee');
    const first = await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: key });
    const again = await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: key });
    assert.ok(first.ok && again.ok);
    assert.equal(again.reservation.uid, first.reservation.uid);
    assert.equal((again as any).replayed, true);
    assert.equal((again as any).status, 'pending');
    assert.equal(holds(f.db).length, 1);
    assert.equal(await spent(f.env), 300_000, 'held once');
    // Concurrent: both race to the key; one hold, one charge's worth held.
    const g = fixture();
    try {
      const [x, y] = await Promise.all([1, 2].map(() => reserveAiBudget(g.env, 2, 300_000, NOW, { idempotencyKey: 'exec:race:fee' })));
      assert.ok(x.ok && y.ok && x.reservation.uid === y.reservation.uid);
      assert.equal(holds(g.db).length, 1);
      assert.equal(await spent(g.env), 300_000);
    } finally { g.db.close(); }
    // A replay answers from the hold it took, even once the member is paused: the run in flight keeps its hold.
    f.db.prepare("INSERT INTO member_ai_pauses(user_id, reason, paused_by) VALUES (2, 'paused mid-run for a test', 1)").run();
    const paused = await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: key });
    assert.ok(paused.ok && paused.reservation.uid === first.reservation.uid);
    assert.equal((await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: 'exec:new:fee' })).ok, false, 'a new key is refused');
    f.db.exec('DELETE FROM member_ai_pauses');
    await settleAiReservation(f.env, first.reservation, 300_000);
    const settled = await reserveAiBudget(f.env, 2, 300_000, NOW, { idempotencyKey: key });
    assert.equal((settled as any).status, 'settled', 'a replay after settle still returns the one hold');
    assert.equal(holds(f.db).length, 1);
    assert.throws(() => quoteFor('nope'), /no price/);
  } finally { f.db.close(); }
});

test('success: quote, hold, run, settle at the policy cost; settle replayed charges once', async () => {
  const f = fixture();
  try {
    let ran = 0;
    const out = await meteredCall(f.env, input(), async () => { ran += 1; return 'answer'; });
    assert.equal(out.value, 'answer');
    assert.equal(ran, 1);
    assert.deepEqual({ ...out.usage, reservation_uid: typeof out.usage.reservation_uid },
      { reservation_uid: 'string', reserved_microusd: 300_000, charged_microusd: 300_000, refunded_microusd: 0, pricing_version: 'd844-1', review: false });
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.idempotency_key, h.charged]), [['settled', 'exec:exec-1:mcp.tool.paid', 300_000]]);
    // Settle replayed: no second charge.
    await settleAiReservation(f.env, { uid: out.usage.reservation_uid!, userId: 2 }, 300_000);
    assert.equal(await spent(f.env), 300_000);
    // The same execution again never runs, and never charges.
    await assert.rejects(() => meteredCall(f.env, input(), async () => { ran += 1; return 'again'; }),
      (e: any) => e instanceof MeteringRefused && e.code === 'execution_closed');
    assert.equal(ran, 1);
    assert.equal(await spent(f.env), 300_000);
  } finally { f.db.close(); }
});

test('the provider\'s reported cost is what is charged; above the hold it goes to review, never capped', async () => {
  const f = fixture();
  try {
    const low = await meteredCall(f.env, input(), async (m) => { m.reportCost(120_000); return 1; });
    assert.equal(low.usage.charged_microusd, 120_000);
    assert.equal(low.usage.refunded_microusd, 180_000);
    assert.equal(await spent(f.env), 120_000, 'the difference is released');
    // A cost the provider reports must be an integer.
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'exec-3' }), async (m) => { m.reportCost(1.5); return 3; }), /Provider cost unreadable/);
    // Mutation checked: settle at `input.quoteMicrousd` instead of the reported cost → 300000 is charged.
    const high = await meteredCall(f.env, input({ executionId: 'exec-2' }), async (m) => { m.reportCost(450_000); return 2; });
    assert.equal(high.value, 2);
    assert.equal(high.usage.review, true);
    assert.equal(high.usage.charged_microusd, null, 'unknown until a Super Admin decides');
    const row = f.db.prepare("SELECT status, recorded_cost_microusd FROM ai_budget_reservations WHERE idempotency_key = 'exec:exec-2:mcp.tool.paid'").get() as any;
    assert.deepEqual([row.status, row.recorded_cost_microusd], ['review', 450_000]);
    // While it is in review the member's next metered call is refused, in words.
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'exec-4' }), async () => 4), (e: any) => e.code === 'budget_review');
  } finally { f.db.close(); }
});

test('a throw, a timeout and a cancel each release the hold (refunded), and nothing is charged', async () => {
  // Mutation checked: drop the release in meteredCall's catch → the hold stays pending and 300000 stays held.
  const f = fixture();
  try {
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'throw' }), async () => { throw new Error('provider down'); }), /provider down/);
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'slow', timeoutMs: 5 }), () => new Promise((r) => setTimeout(() => r('late'), 200))),
      (e: any) => e.reason === 'timeout' && e.meteringUsage.refunded_microusd === 300_000 && e.meteringUsage.charged_microusd === 0);
    const ac = new AbortController();
    const cancelled = meteredCall(f.env, input({ executionId: 'cancel', signal: ac.signal }), () => new Promise((r) => setTimeout(() => r('late'), 200)));
    setTimeout(() => ac.abort(), 5);
    await assert.rejects(() => cancelled, (e: any) => e.reason === 'cancelled');
    assert.deepEqual(holds(f.db).map((h: any) => [h.idempotency_key, h.status, h.charged]), [
      ['exec:throw:mcp.tool.paid', 'refunded', 0], ['exec:slow:mcp.tool.paid', 'refunded', 0], ['exec:cancel:mcp.tool.paid', 'refunded', 0],
    ]);
    assert.equal(await spent(f.env), 0);
    // A retry of a released execution does not run for free.
    let ran = 0;
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'throw' }), async () => { ran += 1; return 'free'; }),
      (e: any) => e.code === 'execution_closed');
    assert.equal(ran, 0);
  } finally { f.db.close(); }
});

test('insufficient tokens, the monthly limit and a pause refuse before the run, in plain words with no amounts', async () => {
  const f = fixture(200_000);
  try {
    let ran = 0;
    const tool = async () => { ran += 1; return 'x'; };
    await assert.rejects(() => meteredCall(f.env, input(), tool), (e: any) => e.code === 'insufficient_tokens' && e.sentence.startsWith('Not enough AI tokens'));
    setFixtureAllowance(f.db, 1_000_000);
    f.db.prepare('INSERT INTO member_ai_spend_limits(user_id, monthly_limit_microusd) VALUES (2, 100000)').run();
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'lim' }), tool), (e: any) => e.code === 'monthly_limit' && e.sentence.startsWith('Your monthly limit is reached'));
    f.db.exec('DELETE FROM member_ai_spend_limits');
    f.db.prepare("INSERT INTO member_ai_pauses(user_id, reason, paused_by) VALUES (2, 'paused for a test case', 1)").run();
    await assert.rejects(() => meteredCall(f.env, input({ executionId: 'paused' }), tool), (e: any) => e.code === 'ai_paused' && e.sentence.startsWith('AI is paused on this account'));
    assert.equal(ran, 0, 'no hold, no run');
    assert.equal(holds(f.db).length, 0);
    for (const w of Object.values(REFUSAL_WORDS)) assert.doesNotMatch(w.sentence, /\d|\$|credit/i, w.code);
    assert.equal(refusalFor('budget_review').code, 'budget_review');
    assert.equal(refusalFor('budget_user_day').code, 'insufficient_tokens');
  } finally { f.db.close(); }
});

test('two concurrent metered calls cannot pass the balance or the member\'s limit', async () => {
  const f = fixture(1_000_000);
  try {
    const results = await Promise.allSettled([1, 2, 3].map((i) => meteredCall(f.env, input({ executionId: `c${i}`, quoteMicrousd: 400_000 }), async () => i)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2, 'two fit the allowance of 1000000');
    assert.equal((results.find((r) => r.status === 'rejected') as any).reason.code, 'insufficient_tokens');
    assert.equal(await spent(f.env), 800_000);
    const g = fixture(1_000_000);
    try {
      g.db.prepare('INSERT INTO member_ai_spend_limits(user_id, monthly_limit_microusd) VALUES (2, 500000)').run();
      const r = await Promise.allSettled([1, 2].map((i) => meteredCall(g.env, input({ executionId: `l${i}`, quoteMicrousd: 300_000 }), async () => i)));
      assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
      assert.equal(await spent(g.env), 300_000);
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test('the composite rule: an AI run inside a priced tool is charged by its own hold; the fee is a second component, once each', async () => {
  __resetForTest();
  const f = fixture(2_000_000);
  try {
    f.env.AI = { run: guardSafe(async () => ({ response: 'drafted', usage: { prompt_tokens: 100, completion_tokens: 20 } })) };
    const out = await meteredCall(f.env, { userId: 2, executionId: 'combo', operation: 'mcp.tool.paid', component: 'fee', quoteMicrousd: 50_000 },
      async () => run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' }));
    assert.equal((out.value as any).ok, true);
    const rows = holds(f.db);
    assert.equal(rows.length, 2, 'the fee and the AI run, one hold each');
    const fee = rows.find((r: any) => r.idempotency_key === 'exec:combo:fee');
    const ai = rows.find((r: any) => r.idempotency_key === null);
    const aiCost = usdToMicro(estimateCostUsd(ROUTE.advisor_turn.model, 100, 20));
    assert.deepEqual([fee.status, fee.charged, ai.status, ai.charged], ['settled', 50_000, 'settled', aiCost]);
    assert.equal((await loadAiBudget(f.env, 2)).month_spend_microusd, 50_000 + aiCost, 'nothing counted twice');
  } finally { f.db.close(); }
});

test('the policy: v1 lists every registered tool at 0; quotes are server-side integers; an unlisted operation is refused', () => {
  // Mutation checked: delete a tool's line from METERING_POLICY → this fails naming it.
  const missing = registeredTools().map((t) => toolOperation(t.name)).filter((op) => !(op in METERING_POLICY.operations));
  assert.deepEqual(missing, [], 'every registered tool has a price');
  for (const [op, p] of Object.entries(METERING_POLICY.operations)) assert.equal(p.price_microusd, 0, op);
  assert.equal(METERING_POLICY.version, 'd844-1');
  assert.equal(quoteFor(toolOperation('list_companies')), 0);
  const priced = { version: 'test-1', operations: { 'mcp.tool.paid': { price_microusd: 25_000, unit: 'call' as const } } };
  assert.equal(quoteFor('mcp.tool.paid', 3, priced), 75_000);
  assert.throws(() => quoteFor('mcp.tool.paid', 0, priced), /units/);
  assert.throws(() => quoteFor('mcp.tool.paid', 1.5, priced), /units/);
  assert.throws(() => quoteFor('constructor', 1, priced), /no price/);
  assert.throws(() => quoteFor('mcp.tool.other', 1, priced), /no price/);
});

test('callTool: a free tool holds nothing; a priced tool runs through meteredCall; a refusal is an MCP error result', async () => {
  // Mutation checked: run the tool directly when `quote > 0` → no hold is taken and the balance never moves.
  const f = fixture(800_000);
  try {
    for (const col of ['founder_id INTEGER', 'spinout_lab_active INTEGER', 'jwt_min_iat INTEGER', 'deletion_requested_at TEXT']) f.db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    const props = { userId: 2, companies: [], clientId: 'c', clientName: 'Claude', redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000) };
    const tool = (name: string) => ({ name, requiredScope: 'validate:read' as const, source: 'axal' as const, version: '1.0.0', title: name, description: name, inputSchema: {}, company: false, run: async () => ({ ran: name }) });
    const priced = { version: 'test-1', operations: { [toolOperation('paid_tool')]: { price_microusd: 300_000, unit: 'call' as const }, [toolOperation('free_tool')]: { price_microusd: 0, unit: 'call' as const } } };
    const json = (r: any) => JSON.parse(r.content[0].text);
    const free = await callTool(f.env, props, null, tool('free_tool'), {}, ['validate:read'], priced);
    assert.deepEqual(json(free), { ran: 'free_tool' });
    assert.equal(holds(f.db).length, 0, 'a free tool takes no hold');
    const paid = await callTool(f.env, props, null, tool('paid_tool'), {}, ['validate:read'], priced);
    assert.deepEqual(json(paid), { ran: 'paid_tool' });
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged, /^exec:[0-9a-f-]{36}:mcp\.tool\.paid_tool$/.test(h.idempotency_key)]), [['settled', 300_000, true]]);
    // The tool's own arguments never set its price.
    await callTool(f.env, props, null, tool('paid_tool'), { price_microusd: 1, quoteMicrousd: 1 }, ['validate:read'], priced);
    assert.deepEqual(holds(f.db).map((h: any) => h.charged), [300_000, 300_000]);
    // 600000 of 800000 is spent; a third call does not fit, and says so.
    const refused = await callTool(f.env, props, null, tool('paid_tool'), {}, ['validate:read'], priced);
    assert.equal(refused.isError, true);
    assert.deepEqual(json(refused), { error: REFUSAL_WORDS.budget_user_month.sentence, code: 'insufficient_tokens' });
    // The server's own v1 policy: a registered tool name holds nothing.
    const before = holds(f.db).length;
    await callTool(f.env, props, null, tool('list_companies'), {}, ['validate:read']);
    assert.equal(holds(f.db).length, before);
  } finally { f.db.close(); }
});

test('D844 + D846: access is checked before a paid hold, and the checked connection reaches the metered handler', async () => {
  const f = fixture(800_000);
  try {
    for (const col of ['founder_id INTEGER', 'spinout_lab_active INTEGER', 'jwt_min_iat INTEGER', 'deletion_requested_at TEXT']) f.db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    f.db.exec(`
      ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
      UPDATE users SET founder_id = 42, subscription_tier = 'studio', subscription_status = 'active' WHERE id = 2;
      CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
      CREATE TABLE integrations(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, status TEXT);
      CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER);
      CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
      INSERT INTO projects VALUES(1, 'Synthetic venture', 42, 100, NULL);
      INSERT INTO user_company_links VALUES(2, 100);
      INSERT INTO integrations VALUES(1, 2, 'github', 'active');
      INSERT INTO integration_companies VALUES(1, 100, 1);
    `);
    const props = { userId: 2, companies: [1], clientId: 'test', clientName: 'Synthetic client', redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000) };
    const tool = {
      name: 'priced_connection', requiredScope: 'build:read' as const, source: 'connector' as const, version: '1.0.0',
      provider: 'github', entitlement: 'studio' as const, requiresConnection: true, company: true,
      title: 'Synthetic connector', description: 'Test connector', inputSchema: {},
      run: async ({ connected }: any) => ({ connected }),
    };
    const policy = { version: 'test-merge', operations: { [toolOperation(tool.name)]: { price_microusd: 100_000, unit: 'call' as const } } };
    const json = (r: any) => JSON.parse(r.content[0].text);
    const refused = async (scope: string[]) => {
      const result = await callTool(f.env, props, null, tool, { company: 1 }, scope, policy);
      assert.equal(result.isError, true, 'access denied before running');
      assert.equal(holds(f.db).length, 0, 'a refused call takes no hold');
    };
    await refused([]); // no scope; plan and connection otherwise allow the call
    f.db.exec("UPDATE users SET subscription_tier = 'free' WHERE id = 2");
    await refused(['build:read']); // no plan; connection otherwise allows the call
    f.db.exec("UPDATE users SET subscription_tier = 'studio', subscription_status = 'active' WHERE id = 2");
    f.db.exec('UPDATE integration_companies SET enabled = 0');
    await refused(['build:read']); // connection switched off
    f.db.exec('UPDATE integration_companies SET enabled = 1');
    const result = await callTool(f.env, props, null, tool, { company: 1 }, ['build:read'], policy);
    assert.deepEqual(json(result), { connected: [1] }, 'only checked company ids reach the metered handler');
    assert.deepEqual(holds(f.db).map((h: any) => [h.status, h.charged]), [['settled', 100_000]], 'allowed call charges once');
    assert.deepEqual(result._meta, { 'vc.axal/version': '1.0.0', 'vc.axal/source': 'connector' });
  } finally { f.db.close(); }
});
