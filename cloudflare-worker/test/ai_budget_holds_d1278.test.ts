/**
 * D1278 (#3304, #2482's contract gaps 1 and 2) — `GET /api/ai-budget/prices`
 * from the metering policy, migration 632's hold context written with the
 * hold, and `GET /api/ai-budget/holds`, the caller's own. On
 * `_ai_budget_fixture.mjs` with migrations 510, 525 and 632.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/ai_budget_holds_d1278.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import { HOLD_TTL_MS, memberHolds, reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { METERING_POLICY, OPERATION_INFO, meteredCall, priceList, toolOperation } from '../src/services/metering.ts';
import { registeredTools } from '../src/mcp/server.ts';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, run } from '../src/services/aiRouter.ts';

const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const ME = 2, OTHER = 3;
const SECRET = 'd1278-fixture-only-secret';

function world(allowance = 5_000_000) {
  const f = aiBudgetFixture();
  f.db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql') + migration('632_ai_hold_context.sql'));
  setFixtureAllowance(f.db, allowance);
  return { f, env: { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  return a;
}

async function get(w: any, path: string, user: number | null = ME) {
  const headers: Record<string, string> = {};
  if (user != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  }
  const r = await app().request(`/api/ai-budget${path}`, { headers }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

/* ------------------------------------------------------------------ *
 * Prices
 * ------------------------------------------------------------------ */

test('the price list is the policy itself, in its order, with every free operation a known 0', async () => {
  const w = world();
  try {
    const res = await get(w, '/prices');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, METERING_POLICY.version);
    assert.deepEqual(res.body.operations.map((o: any) => o.operation), Object.keys(METERING_POLICY.operations));
    for (const o of res.body.operations) {
      assert.equal(o.price_microusd, METERING_POLICY.operations[o.operation].price_microusd, `${o.operation} is the policy's price`);
      assert.equal(o.unit, 'call');
      assert.ok(['axal', 'connector', 'remote_mcp'].includes(o.source));
      assert.equal(typeof o.ai, 'boolean');
    }
    const free = res.body.operations.find((o: any) => o.operation === toolOperation('list_companies'));
    assert.equal(free.price_microusd, 0, 'free is a known 0, never left out or null');
    assert.equal(res.body.operations.find((o: any) => o.operation === toolOperation('summarize_meeting')).ai, true, 'charged at the AI run\'s cost');
    assert.equal(res.body.operations.find((o: any) => o.operation === toolOperation('list_connections')).source, 'connector');
    assert.equal((await get(w, '/prices', null)).status, 401, 'members only');
  } finally { w.f.db.close(); }
});

test('every priced operation has its label and source, and every registered tool is priced', () => {
  assert.deepEqual(Object.keys(OPERATION_INFO).sort(), Object.keys(METERING_POLICY.operations).sort());
  // D1315: a renamed tool is priced and labelled under its stored name.
  for (const t of registeredTools()) assert.ok(OPERATION_INFO[toolOperation(t.storedAs ?? t.name)], `${t.name} has a label`);
  const paid = priceList({ version: 'v-test', operations: { 'mcp.tool.paid': { price_microusd: 1500, unit: 'call' } } });
  assert.deepEqual(paid.operations[0], { operation: 'mcp.tool.paid', label: 'mcp.tool.paid', source: 'axal', price_microusd: 1500, unit: 'call', ai: false });
  assert.equal(priceList({ version: 'v', operations: { x: { price_microusd: -1 as any, unit: 'call' } } }).operations[0].price_microusd, null, 'an unreadable price is null, never a 0');
});

/* ------------------------------------------------------------------ *
 * The hold's context (migration 632)
 * ------------------------------------------------------------------ */

test('a metered call writes what took the hold before its run; a hold with no context keeps NULL', async () => {
  const w = world();
  try {
    const now = new Date();
    let seen: any = null;
    await meteredCall(w.env, { userId: ME, executionId: 'exec-9', operation: 'mcp.tool.paid', quoteMicrousd: 200_000, surface: 'mcp', now }, async () => {
      seen = w.f.db.prepare('SELECT operation, surface, api_key_uid, execution_id FROM ai_budget_reservations WHERE user_id = ?').get(ME);
      return 'ok';
    });
    assert.deepEqual({ ...seen }, { operation: 'mcp.tool.paid', surface: 'mcp', api_key_uid: null, execution_id: 'exec-9' }, 'written with the hold, before the run');
    const plain = await reserveAiBudget(w.env, ME, 100_000, now);
    assert.ok(plain.ok);
    const row = w.f.db.prepare('SELECT operation, surface, api_key_uid, execution_id FROM ai_budget_reservations WHERE uid = ?').get(plain.reservation.uid) as any;
    assert.deepEqual({ ...row }, { operation: null, surface: null, api_key_uid: null, execution_id: null });
    // Never a prompt: a value that is not a short id is not written.
    const odd = await reserveAiBudget(w.env, ME, 100_000, now, { context: { operation: 'Tell me everything about this founder', surface: 'ai' } });
    assert.ok(odd.ok);
    assert.deepEqual({ ...(w.f.db.prepare('SELECT operation, surface FROM ai_budget_reservations WHERE uid = ?').get(odd.reservation.uid) as any) }, { operation: null, surface: 'ai' });
    assert.throws(() => w.f.db.prepare("UPDATE ai_budget_reservations SET surface = 'web' WHERE uid = ?").run(odd.reservation.uid), /CHECK/);
  } finally { w.f.db.close(); }
});

test('a refused hold writes no context row', async () => {
  const w = world(0);
  try {
    const refused = await reserveAiBudget(w.env, ME, 100_000, new Date(), { context: { operation: 'mcp.tool.paid', surface: 'mcp' } });
    assert.equal(refused.ok, false);
    assert.equal((w.f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n, 0);
  } finally { w.f.db.close(); }
});

/* ------------------------------------------------------------------ *
 * Holds
 * ------------------------------------------------------------------ */

test('the holds read: the caller\'s own pending and review holds, with the Worker\'s expires_at, never another member\'s', async () => {
  const w = world();
  try {
    const now = new Date();
    const mine = await reserveAiBudget(w.env, ME, 300_000, now, { idempotencyKey: 'exec:e1:fee', context: { operation: 'mcp.tool.paid', surface: 'mcp', apiKeyUid: 'key_abc', executionId: 'e1' } });
    const theirs = await reserveAiBudget(w.env, OTHER, 400_000, now, { context: { operation: 'mcp.tool.secret', surface: 'mcp', executionId: 'e-other' } });
    const done = await reserveAiBudget(w.env, ME, 100_000, now);
    assert.ok(mine.ok && theirs.ok && done.ok);
    await settleAiReservation(w.env, done.reservation, 100_000);
    const res = await get(w, '/holds');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.holds.map((h: any) => h.uid), [mine.reservation.uid], 'only the caller\'s open holds');
    const h = res.body.holds[0];
    const stored = w.f.db.prepare('SELECT expires_at, created_at, included_microusd, topup_microusd FROM ai_budget_reservations WHERE uid = ?').get(mine.reservation.uid) as any;
    assert.equal(h.expires_at, stored.expires_at, 'the stored expiry, not one computed for the page');
    assert.equal(h.status, 'pending');
    assert.equal(h.included_microusd + h.topup_microusd, 300_000);
    assert.equal(h.included_microusd, stored.included_microusd);
    assert.deepEqual([h.surface, h.operation, h.api_key_uid, h.execution_id], ['mcp', 'mcp.tool.paid', 'key_abc', 'e1']);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|e-other/, 'nothing of another member\'s');
    assert.equal((await get(w, '/holds', null)).status, 401);
    // The other member sees theirs, and not this one.
    assert.deepEqual((await get(w, '/holds', OTHER)).body.holds.map((x: any) => x.uid), [theirs.reservation.uid]);
  } finally { w.f.db.close(); }
});

test('the five-minute rule is the Worker\'s: an expired pending hold is released, not listed; a hold in review stays', async () => {
  const w = world();
  try {
    const then = new Date(Date.now() - HOLD_TTL_MS - 60_000);
    const stale = await reserveAiBudget(w.env, ME, 200_000, then);
    const review = await reserveAiBudget(w.env, ME, 200_000, then);
    assert.ok(stale.ok && review.ok);
    w.f.db.prepare("UPDATE ai_budget_reservations SET status = 'review', recorded_cost_microusd = 250000 WHERE uid = ?").run(review.reservation.uid);
    const expiresAt = (w.f.db.prepare('SELECT expires_at FROM ai_budget_reservations WHERE uid = ?').get(stale.reservation.uid) as any).expires_at;
    const lived = Date.parse(expiresAt.replace(' ', 'T') + (expiresAt.includes('Z') ? '' : 'Z')) - then.getTime();
    assert.ok(lived > HOLD_TTL_MS - 1000 && lived <= HOLD_TTL_MS, `five minutes after the hold, to the stored second (${lived})`);
    const list = await memberHolds(w.env, ME);
    assert.deepEqual(list.map((h) => [h.uid, h.status]), [[review.reservation.uid, 'review']]);
    assert.equal((w.f.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid = ?').get(stale.reservation.uid) as any).status, 'refunded', 'released, never charged');
    assert.deepEqual(list[0].surface, null, 'a hold with no context reads null, for "Not recorded"');
  } finally { w.f.db.close(); }
});

test('the callers name their surface, and the AI run names its task, never its prompt', () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(src('mcp/server.ts'), /apiKeyUid, signal, surface: 'mcp' \}/);
  assert.match(src('services/flows.ts'), /STEP_TIMEOUT_MS, now, surface: 'flow',/);
  // D1496 part 2 (#3842): the run's hold is named by `holdOperation`: `ai.<task>`, or `agent.<role>` for a team agent.
  assert.match(src('services/aiRouter.ts'), /\{ context: \{ operation: holdOperation\(opts\), surface: 'ai' \} \}/);
  assert.match(src('services/aiRouter.ts'), /\? `agent\.\$\{o\.agentRole\}` : `ai\.\$\{String\(o\.task\)\}`/);
  assert.match(src('services/metering.ts'), /context: \{ operation: input\.operation, surface: input\.surface \?\? null, apiKeyUid: keyUid, executionId: input\.executionId \}/);
  const sql = migration('632_ai_hold_context.sql');
  assert.doesNotMatch(sql.split('\n').filter((l) => !l.startsWith('--')).join('\n'), /BEGIN|COMMIT|PRAGMA/);
  for (const col of ['operation', 'surface', 'api_key_uid', 'execution_id']) assert.match(sql, new RegExp(`ADD COLUMN ${col} TEXT`));
});

test('D1496 part 2 (#3842): an agent\'s run holds on the ai surface as agent.<role>, a member\'s as ai.<task>; neither names the prompt', async () => {
  // Mutation checked: the hold named `ai.${opts.task}` for every run → the agent row reads ai.rail_numbers and fails.
  __resetForTest();
  const w = world();
  try {
    w.f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(ME);
    w.env.AI = withGuard({ run: async () => ({ response: 'ok', usage: { prompt_tokens: 5, completion_tokens: 5 } }) });
    const ask = { task: 'rail_numbers' as const, userId: ME, text: 'secret runway figure', rail: { page: 'Founder · Raise · Use of funds', option: 'draft:raise/use-of-funds-runway' } };
    assert.equal((await run(w.env, { ...ask, agentId: 9, agentRole: 'cfo' })).ok, true);
    assert.equal((await run(w.env, ask)).ok, true);
    const rows = w.f.db.prepare('SELECT operation, surface FROM ai_budget_reservations ORDER BY rowid').all().map((r: any) => ({ ...r }));
    assert.deepEqual(rows, [{ operation: 'agent.cfo', surface: 'ai' }, { operation: 'ai.rail_numbers', surface: 'ai' }]);
    assert.ok(!JSON.stringify(rows).includes('secret'));
  } finally { w.f.db.close(); }
});
