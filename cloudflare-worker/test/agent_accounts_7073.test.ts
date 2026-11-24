/**
 * #7073 part 2 (D7073-p2): an engine-started run's model accounts through the `agents` AI Gateway. Fixtures only:
 * the gateway is a fake `fetch` that answers per stored-key alias; the holds, settlements and usage rows are the
 * real ones on the migrated schema. No live inference.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_accounts_7073.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { lifecycleWorld, modelCalls } from './_agent_lifecycle_fixture.ts';
import {
  accountSlots, buildRequest, classify, runAccounts, type AccountsDeps, type AccountsInput,
} from '../src/services/agents/agentAccounts.ts';
import { agentRun } from '../src/services/agents/agentRun.ts';
import { runTaskLoop } from '../src/agents/loop.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';

test.after(() => removeMigratedDatabases());

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cfut_test_gateway_run_token_value';
const ALIASES = { AGENT_CLAUDE_ALIAS_1: 'claude-primary', AGENT_CLAUDE_ALIAS_2: 'claude-2', AGENT_CLAUDE_ALIAS_3: 'claude-3', AGENT_OPENAI_ALIAS: 'openai-codex' };
const CONFIG = {
  AGENT_AI_GATEWAY: 'agents', AGENT_AI_GATEWAY_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  AGENT_CLAUDE_MODEL: 'anthropic/claude-sonnet-5-5', OPENAI_MODEL: 'gpt-5-mini', ...ALIASES,
};
const PROMPT = 'Draft the runway section for the board pack.';
const SECRET_IN_PROMPT = 'board pack';

/** A world whose sponsor can pay, with the account configuration on its env. */
function accountsWorld(over: Record<string, string | undefined> = {}) {
  __resetForTest();
  const w = world();
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE id = ?").run(SPONSOR);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(SPONSOR);
  Object.assign(w.env, CONFIG, over);
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete w.env[k];
  w.agent(AGENT);
  return w;
}

type Reply = { status: number; body: unknown };
const claudeOk = (text = 'Runway: 18 months.'): Reply => ({ status: 200, body: { content: [{ type: 'text', text }], usage: { input_tokens: 120, output_tokens: 40 } } });
const openaiOk = (text = 'Runway: 18 months (OpenAI).'): Reply => ({ status: 200, body: { model: 'gpt-5-mini-2026-08-07', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 40 } } });
const noCredit: Reply = { status: 402, body: { type: 'error', error: { type: 'billing_error', message: 'Payment required' } } };
const lowBalance: Reply = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } };
const accountCap: Reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Spend limit', details: { error_code: 'enforced_spend_limit_reached' } } } };
const openaiQuota: Reply = { status: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota.' } } };
const gatewayCap: Reply = { status: 429, body: { success: false, errors: [{ code: 2017, message: 'Spend limit exceeded' }] } };
const ambiguous429: Reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } } };
const noStoredKey: Reply = { status: 400, body: { success: false, errors: [{ code: 2044, message: 'Customer-provided provider credentials are required for this request' }] } };

/** The gateway: a fetch that answers by alias, and records every request it saw (headers, URL and body). */
function gateway(script: Record<string, Reply>) {
  const seen: Array<{ url: string; alias: string; headers: Record<string, string>; body: any }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const alias = headers['cf-aig-byok-alias'];
    seen.push({ url, alias, headers, body: JSON.parse(String(init.body)) });
    const r = script[alias];
    if (!r) throw new Error(`no reply scripted for ${alias}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen, aliases: () => seen.map((s) => s.alias) };
}
const passGuard: AccountsDeps['guard'] = async () => ({ decision: { action: 'pass' } as any, calls: 0, micro: 0, usd: 0, record: async () => {} });

const inputFor = (runUid = 'run-7073-0001'): AccountsInput => ({
  who: { userId: SPONSOR, agentId: AGENT, surface: '/raise/use-of-funds' }, task: 'rail_numbers' as any, executionId: runUid,
  request: { system: 'You are the CFO agent.', messages: [{ role: 'user', content: PROMPT }], maxTokens: 512 },
  guardText: PROMPT,
});
const holds = (w: World) => w.db.prepare("SELECT uid, status, actual_included_microusd + actual_topup_microusd AS charged FROM ai_budget_reservations ORDER BY created_at, uid").all() as any[];
const rows = (w: World) => w.db.prepare('SELECT model, refusal, agent_id, units_json, charged_microusd FROM ai_usage_logs ORDER BY id').all() as any[];

test('the slots: in order, unconfigured or refused ones skipped, never the `default` alias, never an unpriced model', () => {
  assert.deepEqual(accountSlots(CONFIG).slots.map((s) => [s.slot, s.alias, s.model]), [
    [1, 'claude-primary', 'anthropic/claude-sonnet-5-5'], [2, 'claude-2', 'anthropic/claude-sonnet-5-5'],
    [3, 'claude-3', 'anthropic/claude-sonnet-5-5'], [4, 'openai-codex', 'openai/gpt-5-mini'],
  ]);
  const some = accountSlots({ ...CONFIG, AGENT_CLAUDE_ALIAS_2: '', AGENT_CLAUDE_ALIAS_3: 'default', OPENAI_MODEL: 'gpt-codex-unpriced' });
  assert.deepEqual(some.slots.map((s) => s.slot), [1]);
  assert.deepEqual(some.skipped, [{ slot: 2, reason: 'not configured' }, { slot: 3, reason: 'alias refused' }, { slot: 4, reason: 'no priced model' }]);
  assert.deepEqual(accountSlots(CONFIG, (m) => m !== 'openai/gpt-5-mini').slots.map((s) => s.slot), [1, 2, 3], 'a model HQ or the scope refuses skips its slot');
});

test('an OpenAI model the catalogue does not price is called only with the owner\'s rates', () => {
  const codex = { ...CONFIG, OPENAI_MODEL: 'gpt-5.3-codex' };
  assert.deepEqual(accountSlots(codex).skipped, [{ slot: 4, reason: 'no priced model' }]);
  const rates = JSON.stringify({ tokens_in: '1.25', tokens_cached: '0.125', tokens_out: '10' });
  const priced = accountSlots({ ...codex, AGENT_OPENAI_RATES: rates }).slots.find((s) => s.slot === 4)!;
  assert.deepEqual([priced.model, priced.apiModel, priced.rates.tokens_out], ['openai/gpt-5.3-codex', 'gpt-5.3-codex', '10']);
  for (const bad of ['{"tokens_in":"1"}', '{"tokens_in":"0","tokens_cached":"0","tokens_out":"0"}', '{"tokens_in":"1","tokens_cached":"1","tokens_out":"1","x":"1"}', 'not json', '{"tokens_in":1,"tokens_cached":1,"tokens_out":1}']) {
    assert.deepEqual(accountSlots({ ...codex, AGENT_OPENAI_RATES: bad }).skipped, [{ slot: 4, reason: 'no priced model' }], bad);
  }
});

test('the request: provider-native, through the `agents` gateway, the alias and the gateway token, and no provider key', () => {
  const [claude, , , openai] = accountSlots(CONFIG).slots;
  const c = buildRequest(CONFIG, claude, { system: 's', messages: [{ role: 'user', content: 'p' }], maxTokens: 10 }, { surface: 'agents' })!;
  assert.equal(c.url, `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/agents/anthropic/v1/messages`);
  const h = c.init.headers as Record<string, string>;
  assert.equal(h['cf-aig-authorization'], `Bearer ${TOKEN}`);
  assert.equal(h['cf-aig-byok-alias'], 'claude-primary');
  assert.equal(h['cf-aig-collect-log-payload'], 'false');
  assert.ok(!('x-api-key' in h) && !('authorization' in h) && !('Authorization' in h), 'the gateway supplies the stored key');
  assert.equal(JSON.parse(String(c.init.body)).model, 'claude-sonnet-5-5');
  const o = buildRequest(CONFIG, openai, { messages: [{ role: 'user', content: 'p' }], maxTokens: 10 }, {})!;
  assert.equal(o.url, `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/agents/openai/chat/completions`);
  assert.equal((o.init.headers as Record<string, string>)['cf-aig-byok-alias'], 'openai-codex');
  assert.deepEqual(JSON.parse(String(o.init.body)), { model: 'gpt-5-mini', messages: [{ role: 'user', content: 'p' }], max_completion_tokens: 10 });
  assert.equal(buildRequest({ ...CONFIG, AGENT_AI_GATEWAY_TOKEN: '' }, claude, { messages: [], maxTokens: 1 }, {}), null, 'no token, no request');
});

test('what moves the loop: a confirmed credit or key refusal advances; the gateway cap stops everything; an unclear 429 stops the run', () => {
  const v = (p: 'anthropic' | 'openai', r: Reply) => classify(p, r.status, r.body).verdict;
  assert.deepEqual([noCredit, lowBalance, accountCap, noStoredKey, { status: 401, body: {} }].map((r) => v('anthropic', r)), ['advance', 'advance', 'advance', 'advance', 'advance']);
  assert.equal(v('openai', openaiQuota), 'advance');
  assert.equal(v('anthropic', gatewayCap), 'stop_all');
  assert.equal(v('anthropic', { status: 402, body: { errors: [{ code: 2052 }] } }), 'stop_all', 'a sign of Unified Billing stops everything');
  assert.equal(v('anthropic', ambiguous429), 'stop_run');
  assert.equal(v('openai', { status: 429, body: { error: { code: 'rate_limit_exceeded' } } }), 'stop_run');
  assert.equal(v('anthropic', { status: 429, body: null }), 'stop_run', 'a 429 with no readable source');
  assert.equal(v('anthropic', { status: 429, body: { errors: [{ code: 2003 }] } }), 'stop_run', 'the gateway\'s rate limit is not its spend limit');
  assert.deepEqual(classify('anthropic', 500, null), { verdict: 'stop_run', reason: 'failed (500)', billed: 'maybe' });
  assert.deepEqual(classify('anthropic', 0, null), { verdict: 'stop_run', reason: 'no answer', billed: 'maybe' });
});

test('the primary Claude account answers: one call, one hold settled at the reported usage, one row naming the account', async () => {
  const w = accountsWorld();
  try {
    const gw = gateway({ 'claude-primary': claudeOk() });
    const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual([r.slot, r.alias, r.model, r.output], [1, 'claude-primary', 'anthropic/claude-sonnet-5-5', 'Runway: 18 months.']);
    assert.deepEqual(gw.aliases(), ['claude-primary']);
    const h = holds(w);
    assert.equal(h.length, 1);
    assert.equal(h[0].status, 'settled');
    assert.ok(h[0].charged > 0);
    const [row] = rows(w);
    assert.deepEqual([row.model, row.refusal, row.agent_id], ['anthropic/claude-sonnet-5-5', null, AGENT]);
    const units = JSON.parse(row.units_json);
    assert.deepEqual([units.slot, units.alias, units.via, units.billing], [1, 'claude-primary', 'ai_gateway', 'byok']);
    // Nothing recorded carries the key, the gateway token or the prompt.
    const recorded = JSON.stringify(w.db.prepare('SELECT * FROM ai_usage_logs').all()) + JSON.stringify(w.db.prepare('SELECT * FROM ai_budget_reservations').all());
    assert.ok(!recorded.includes(TOKEN) && !recorded.includes(SECRET_IN_PROMPT));
  } finally { w.close(); }
});

test('fallback: Claude 2 after the primary runs out of credit, then Claude 3, then OpenAI; each refusal billed nothing', async () => {
  const cases: Array<[Record<string, Reply>, number, string[]]> = [
    [{ 'claude-primary': noCredit, 'claude-2': claudeOk() }, 2, ['claude-primary', 'claude-2']],
    [{ 'claude-primary': lowBalance, 'claude-2': accountCap, 'claude-3': claudeOk() }, 3, ['claude-primary', 'claude-2', 'claude-3']],
    [{ 'claude-primary': noCredit, 'claude-2': noCredit, 'claude-3': noStoredKey, 'openai-codex': openaiOk() }, 4, ['claude-primary', 'claude-2', 'claude-3', 'openai-codex']],
  ];
  for (const [script, slot, order] of cases) {
    const w = accountsWorld();
    try {
      const gw = gateway(script);
      const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
      assert.ok(r.ok, JSON.stringify(r));
      assert.equal(r.slot, slot);
      assert.deepEqual(gw.aliases(), order);
      assert.deepEqual(r.attempts.map((a) => a.billed), [...order.slice(0, -1).map(() => 'no'), 'yes']);
      const h = holds(w);
      assert.equal(h.length, order.length, 'one hold per attempt');
      // Holds share a creation second, so they are compared as a set: the refused accounts at 0, the answer above it.
      assert.equal(h.filter((x) => x.charged === 0).length, order.length - 1, 'a refused account is charged nothing');
      assert.equal(h.filter((x) => x.charged > 0).length, 1);
      assert.equal(rows(w).length, order.length, 'one usage row per attempt');
    } finally { w.close(); }
  }
});

test('an unconfigured slot is skipped without a call; every account out of credit is exhausted, with nothing charged', async () => {
  const w = accountsWorld({ AGENT_CLAUDE_ALIAS_2: undefined });
  try {
    const gw = gateway({ 'claude-primary': noCredit, 'claude-3': lowBalance, 'openai-codex': openaiQuota });
    const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
    assert.equal(!r.ok && r.code, 'accounts_exhausted');
    assert.deepEqual(gw.aliases(), ['claude-primary', 'claude-3', 'openai-codex']);
    assert.ok(holds(w).every((h) => h.charged === 0));
  } finally { w.close(); }
});

test('the gateway cap stops the loop at once: no other account is called', async () => {
  const w = accountsWorld();
  try {
    const gw = gateway({ 'claude-primary': gatewayCap, 'claude-2': claudeOk(), 'claude-3': claudeOk(), 'openai-codex': openaiOk() });
    const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
    assert.equal(!r.ok && r.code, 'gateway_limit');
    assert.deepEqual(gw.aliases(), ['claude-primary']);
  } finally { w.close(); }
});

test('the gateway cap, through the task loop, writes the breaker: every later run is refused before any call', async () => {
  const w = accountsWorld();
  try {
    w.task(200, AGENT); w.task(201, AGENT);
    const a = await w.runtime.admit({ kind: 'project', id: 7 } as any, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok, JSON.stringify(a));
    const h = harness();
    h.opts.decision = { status: 'accepted' };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, fakeAgentRun(w, { refuse: { status: 503, code: 'gateway_limit' } }).fn));
    assert.deepEqual(out, { go: false, status: 'failed', refusal: 'gateway_limit' });
    assert.equal(await w.kv.get('agents:paused'), 'gateway_limit');
    const later = await w.runtime.admit({ kind: 'project', id: 7 } as any, { agentId: AGENT, taskId: 201, by: SPONSOR, source: 'person' });
    assert.equal(!later.ok && later.code, 'engine_paused');
  } finally { w.close(); }
});

test('an ambiguous 429, or a failure that may have been billed, ends the run on that account and is counted', async () => {
  const w = accountsWorld();
  try {
    const gw = gateway({ 'claude-primary': ambiguous429, 'claude-2': claudeOk() });
    const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
    assert.equal(!r.ok && r.code, 'account_failed');
    assert.deepEqual(gw.aliases(), ['claude-primary']);
  } finally { w.close(); }
  const x = accountsWorld();
  try {
    const gw = gateway({ 'claude-primary': { status: 500, body: null }, 'claude-2': claudeOk() });
    const r = await runAccounts(x.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
    assert.equal(!r.ok && r.code, 'account_failed');
    assert.deepEqual(gw.aliases(), ['claude-primary']);
    assert.equal(r.attempts[0].billed, 'maybe');
    assert.ok(holds(x)[0].charged > 0, 'an attempt that may have been billed is charged at its quote');
  } finally { x.close(); }
});

test('no token, no account id or no alias: refused before any call, nothing held', async () => {
  for (const over of [{ AGENT_AI_GATEWAY_TOKEN: undefined }, { CLOUDFLARE_ACCOUNT_ID: undefined }, { ...Object.fromEntries(Object.keys(ALIASES).map((k) => [k, undefined])) }]) {
    const w = accountsWorld(over);
    try {
      const gw = gateway({ 'claude-primary': claudeOk() });
      const r = await runAccounts(w.env, inputFor(), { fetch: gw.fetchImpl, guard: passGuard });
      assert.equal(!r.ok && r.code, 'accounts_unconfigured', JSON.stringify(over));
      assert.deepEqual([gw.seen.length, holds(w).length], [0, 0]);
    } finally { w.close(); }
  }
});

test('a retried step replays the same holds: the run is still one, and nothing is charged twice', async () => {
  const w = accountsWorld();
  try {
    const gw = gateway({ 'claude-primary': noCredit, 'claude-2': claudeOk() });
    const first = await runAccounts(w.env, inputFor('run-7073-retry'), { fetch: gw.fetchImpl, guard: passGuard });
    assert.ok(first.ok);
    const again = await runAccounts(w.env, inputFor('run-7073-retry'), { fetch: gw.fetchImpl, guard: passGuard });
    assert.equal(!again.ok && again.code, 'step_lost');
    assert.equal(gw.seen.length, 2, 'the retry called no account');
    assert.equal(holds(w).length, 2);
  } finally { w.close(); }
});

/** The real agentRun, engine-started, with global fetch as the gateway. */
async function withFetch<T>(f: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('agentRun: an engine run uses the accounts, proposes once, and its event names the account without the prompt or a key', async () => {
  const w = lifecycleWorld();
  try {
    Object.assign(w.env, CONFIG);
    w.agent(AGENT); w.task(200, AGENT);
    const agentRow = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
    const gw = gateway({ 'claude-primary': noCredit, 'claude-2': claudeOk('Runway: 18 months, from account 2.') });
    const step = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', prompt: PROMPT, taskId: 200, runUid: 'run-7073-engine-01', engine: true };
    const t = w.db.prepare('SELECT module, option FROM scope_tasks WHERE id = 200').get() as any;
    const r = await withFetch(gw.fetchImpl, () => agentRun(w.env, { agent: agentRow, ...step, module: t.module, option: t.option }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(gw.aliases(), ['claude-primary', 'claude-2']);
    assert.equal(modelCalls(w), 0, 'the router\'s Workers AI model path was not used');
    const ev = w.db.prepare("SELECT detail_json FROM team_agent_events WHERE kind = 'run'").get() as any;
    const detail = JSON.parse(ev.detail_json);
    assert.deepEqual(detail.account, { slot: 2, alias: 'claude-2', model: 'anthropic/claude-sonnet-5-5' });
    assert.ok(!ev.detail_json.includes(SECRET_IN_PROMPT) && !ev.detail_json.includes(TOKEN));
    // The same run key again answers the same proposal and calls nothing.
    const again = await withFetch(gw.fetchImpl, () => agentRun(w.env, { agent: agentRow, ...step, module: t.module, option: t.option }));
    assert.ok(again.ok && again.replayed && again.proposal.uid === r.proposal.uid);
    assert.equal(gw.seen.length, 2);
  } finally { w.close(); }
});

test('Stage A: with the deterministic stub, an engine run reaches no account and no live inference', async () => {
  const w = lifecycleWorld();
  try {
    Object.assign(w.env, CONFIG, { ENVIRONMENT: 'preview', AGENT_INFERENCE_STUB: 'deterministic' });
    w.agent(AGENT); w.task(200, AGENT);
    const agentRow = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
    const t = w.db.prepare('SELECT module, option FROM scope_tasks WHERE id = 200').get() as any;
    const gw = gateway({});
    const r = await withFetch(gw.fetchImpl, () => agentRun(w.env, { agent: agentRow, module: t.module, option: t.option, prompt: PROMPT, taskId: 200, runUid: 'run-7073-stagea-1', engine: true }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(gw.seen.length, 0, 'no account was called');
    assert.equal(w.ai.calls, 0, 'the fixture binding was not called either: the stub answered');
    assert.match(JSON.stringify(w.db.prepare('SELECT payload_json FROM ai_rail_proposals').all()), /synthetic inference stub/);
  } finally { w.close(); }
});
