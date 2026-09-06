/**
 * Task #1 (AX) — Multi-model AI router tests.
 *
 * Three acceptance scenarios per spec:
 *   1. primary 5xx triggers smaller-model fallback
 *   2. budget exhaustion returns refusal
 *   3. embedding cache hit on second identical input
 *
 * Loads `cloudflare-worker/src/services/aiRouter.ts` through `_transpile-ts.mjs`
 * (same pattern as projects.test.mjs) so we exercise the exact source bytes
 * shipped to Cloudflare. Provides in-memory mocks for `env.AI` (Workers AI),
 * `env.AI_SPEND` (KV), and `env.DB` (D1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transpileTs } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadRouter() {
  const srcPath = resolve(__dirname, '../src/services/aiRouter.ts');
  const src = await readFile(srcPath, 'utf8');
  // Strip the lone `import type { Env } from '../types';` — tests don't
  // need the type and tsc's `module: None` won't resolve it. Also strip
  // every `export ` keyword so transpilation doesn't emit CommonJS
  // `exports.foo = foo` writes (no `exports` global in `new Function`).
  const stripped = src
    .replace(/^import type[^;]+;\s*$/m, '')
    .replace(/^export\s+(const|let|function|async\s+function|class|interface|type|enum)\b/gm, '$1')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
  const outputText = transpileTs(stripped);
  // Re-export the public surface via an IIFE wrapper.
  const wrapped = `${outputText}\nreturn { run, ROUTE, estimateCostUsd, loadAiUsageReport, __resetForTest };`;
  return new Function(wrapped)();
}

// --------------------------------------------------------------------------
// In-memory KV stub
// --------------------------------------------------------------------------
function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    },
    async put(key, value /* opts */) {
      store.set(key, String(value));
    },
  };
}

// --------------------------------------------------------------------------
// In-memory D1 stub — only handles the statements aiRouter.ts emits.
// --------------------------------------------------------------------------
function makeDB() {
  const rows = [];
  let nextId = 1;
  const exec = async () => undefined;
  const prepare = (sql) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    let bound = [];
    return {
      bind(...args) { bound = args; return this; },
      async run() {
        if (/^INSERT INTO ai_usage_logs /i.test(text)) {
          const [user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal] = bound;
          rows.push({ id: nextId++, user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal, created_at: new Date().toISOString() });
        }
        return { meta: { last_row_id: nextId - 1 } };
      },
      async first() { return null; },
      async all() { return { results: [] }; },
    };
  };
  return { exec, prepare, _rows: rows };
}

// --------------------------------------------------------------------------
// Workers AI stub. `responses` is an array of { fn(model, payload) → result }.
// Each call shifts the next response off the front; if more calls are made
// than responses queued the last response repeats.
// --------------------------------------------------------------------------
function makeAI(responses) {
  const calls = [];
  return {
    calls,
    async run(model, payload) {
      calls.push({ model, payload });
      const handler = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (typeof handler === 'function') return handler(model, payload);
      if (handler && handler.throw) throw new Error(handler.throw);
      return handler;
    },
  };
}

function baseEnv({ ai, kv, db, budgets = {} }) {
  return {
    AI: ai,
    AI_SPEND: kv,
    DB: db,
    WORKERS_AI_BUDGET_USD_DAY: budgets.day,
    WORKERS_AI_BUDGET_USD_MONTH: budgets.month,
    WORKERS_AI_BUDGET_USD_ORG_MONTH: budgets.orgMonth,
  };
}

// --------------------------------------------------------------------------
// Scenario 1 — primary 5xx triggers smaller-model fallback.
// `tool_call` primary = qwen2.5-coder; fallback = llama-3.3-70b.
// We make the qwen call throw and assert llama-3.3-70b is invoked next.
// --------------------------------------------------------------------------
test('primary 5xx triggers smaller-model fallback (one hop)', async () => {
  const { run, ROUTE, __resetForTest } = await loadRouter();
  __resetForTest();
  assert.equal(ROUTE.tool_call.model, '@cf/qwen/qwen2.5-coder-32b-instruct');
  // The small sibling is `-fp8`, not the bare 8b: Cloudflare marked
  // `@cf/meta/llama-3.1-8b-instruct` Deprecated 5/30/2026, and it terminated
  // every chain in this table. `ai_router_prices.test.mjs` bans the deprecated
  // id outright; this one pins the two hops and their order.
  assert.deepEqual(ROUTE.tool_call.fallbackChain, [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct-fp8',
  ]);

  const ai = makeAI([
    () => { throw new Error('500 internal error'); },              // primary fails
    () => ({ response: 'fallback answer', usage: { prompt_tokens: 12, completion_tokens: 7 } }),
  ]);
  const kv = makeKV();
  const db = makeDB();
  const env = baseEnv({ ai, kv, db });

  const result = await run(env, {
    task: 'tool_call',
    userId: 42,
    text: 'pick a tool',
  });

  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.equal(result.usage.fallback_used, true);
  assert.equal(result.usage.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(ai.calls.length, 2);
  assert.equal(ai.calls[0].model, '@cf/qwen/qwen2.5-coder-32b-instruct');
  assert.equal(ai.calls[1].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(result.output, 'fallback answer');
  assert.equal(db._rows.length, 1);
  assert.equal(db._rows[0].fallback_used, 1);
  assert.equal(db._rows[0].refusal, null);
});

// Spec step 3: multi-hop fallback "tool_call → advisor_turn → role_detect"
// (qwen32b → llama-70b → llama-8b). Verifies the second hop is reached
// when both the primary and the first sibling fail.
test('multi-hop fallback chain reaches second sibling on cascading failure', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => { throw new Error('qwen 502'); },
    () => { throw new Error('llama-70b 503'); },
    () => ({ response: 'small-llama saved the day', usage: { prompt_tokens: 5, completion_tokens: 4 } }),
  ]);
  const kv = makeKV();
  const db = makeDB();
  const env = baseEnv({ ai, kv, db });

  const r = await run(env, { task: 'tool_call', userId: 11, text: 'do thing' });
  assert.equal(r.ok, true);
  assert.equal(r.usage.fallback_used, true);
  assert.equal(r.usage.model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(ai.calls.length, 3);
  assert.equal(ai.calls[2].model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(r.output, 'small-llama saved the day');
});

// --------------------------------------------------------------------------
// Task #50 — gateway-resilient advisor calls.
// When the advisor AI Gateway is configured but failing, a gateway-routed
// task (`advisor_turn`) must retry the SAME model un-gatewayed before
// declaring the model dead, so a single shared-gateway outage can no longer
// dead-end the onboarding chat.
// --------------------------------------------------------------------------
// Workers AI stub that distinguishes gatewayed vs un-gatewayed calls via the
// third `options.gateway` arg that callWorkersAI passes through.
function makeGatewayAwareAI({ gatewayedFails }) {
  const calls = [];
  return {
    calls,
    async run(model, payload, options) {
      const gatewayed = !!(options && options.gateway && options.gateway.id);
      calls.push({ model, payload, gatewayed });
      if (gatewayed && gatewayedFails) throw new Error('1015 authenticated gateway token required');
      return { response: gatewayed ? 'via gateway' : 'via direct workers-ai', usage: { prompt_tokens: 8, completion_tokens: 6 } };
    },
  };
}

test('advisor_turn retries un-gatewayed when the advisor gateway is broken', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeGatewayAwareAI({ gatewayedFails: true });
  const kv = makeKV();
  const db = makeDB();
  const env = { ...baseEnv({ ai, kv, db }), CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' };

  const result = await run(env, { task: 'advisor_turn', userId: 5, messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.equal(result.output, 'via direct workers-ai');
  // Same primary model, no chain fallback — just the gateway bypass.
  assert.equal(result.usage.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(result.usage.fallback_used, false);
  // Two calls on the SAME model: first gatewayed (fails), then un-gatewayed.
  assert.equal(ai.calls.length, 2);
  assert.equal(ai.calls[0].gatewayed, true);
  assert.equal(ai.calls[1].gatewayed, false);
  assert.equal(ai.calls[0].model, ai.calls[1].model);
  assert.equal(db._rows.length, 1);
  assert.equal(db._rows[0].refusal, null);
});

test('advisor_turn uses the gateway and does NOT double-call when it is healthy', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeGatewayAwareAI({ gatewayedFails: false });
  const kv = makeKV();
  const db = makeDB();
  const env = { ...baseEnv({ ai, kv, db }), CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' };

  const result = await run(env, { task: 'advisor_turn', userId: 6, messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(result.ok, true);
  assert.equal(result.output, 'via gateway');
  // Healthy gateway → exactly one call, gatewayed, no un-gatewayed retry.
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].gatewayed, true);
});

// --------------------------------------------------------------------------
// Scenario 2 — budget exhaustion returns refusal.
// Pre-seed the user's daily KV bucket above the configured cap and assert
// run() refuses without invoking the model.
// --------------------------------------------------------------------------
test('budget exhaustion returns refusal without calling model', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([() => ({ response: 'should not be called', usage: { prompt_tokens: 1, completion_tokens: 1 } })]);
  const kv = makeKV();
  const db = makeDB();

  const env = baseEnv({ ai, kv, db, budgets: { day: '0.01' } });
  const today = new Date().toISOString().slice(0, 10);
  // Seed daily spend over the cap.
  kv.store.set(`ai_spend:user:7:${today}`, '999');

  const result = await run(env, { task: 'advisor_turn', userId: 7, text: 'hi' });
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'budget_user_day');
  assert.equal(ai.calls.length, 0, 'model must not be invoked when over budget');
  // refusal is logged
  assert.equal(db._rows.length, 1);
  assert.equal(db._rows[0].refusal, 'budget_user_day');
});

// --------------------------------------------------------------------------
// Scenario 3 — embedding cache hit on second identical input.
// First call invokes the model and writes the cache; second identical call
// returns a cached result without invoking the model.
// --------------------------------------------------------------------------
test('embedding cache hit on second identical input', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const fakeVec = new Array(8).fill(0).map((_, i) => i / 10);
  const ai = makeAI([() => ({ data: [fakeVec], shape: [1, 8] })]);
  const kv = makeKV();
  const db = makeDB();
  const env = baseEnv({ ai, kv, db });

  const first = await run(env, { task: 'embed', userId: 9, text: 'hello world' });
  assert.equal(first.ok, true);
  assert.equal(first.usage.cached, false);
  assert.deepEqual(first.embedding, fakeVec);
  assert.equal(ai.calls.length, 1);

  const second = await run(env, { task: 'embed', userId: 9, text: 'hello world' });
  assert.equal(second.ok, true);
  assert.equal(second.usage.cached, true);
  assert.deepEqual(second.embedding, fakeVec);
  // Critically: no second call to the model.
  assert.equal(ai.calls.length, 1, 'embed must not re-call the model on cache hit');

  // Two log rows: one fresh, one cached.
  assert.equal(db._rows.length, 2);
  assert.equal(db._rows[0].cached, 0);
  assert.equal(db._rows[1].cached, 1);
});

// --------------------------------------------------------------------------
// The caller-chosen model. Everything below is about ONE property: a model the
// task does not offer never becomes an argument to `env.AI.run`.
//
// The source-level guard (`ai_router_prices.test.mjs`) holds the LISTS shut —
// `safety` and `embed` declare none, every alternate is priced. These hold the
// BEHAVIOUR shut, which is the half a source test cannot see: it can prove the
// list is empty and still not prove that an empty list refuses.
// --------------------------------------------------------------------------

test('a model on the task\'s list is the one that runs', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([() => ({ response: 'ok', usage: { prompt_tokens: 9, completion_tokens: 3 } })]);
  const db = makeDB();
  const env = baseEnv({ ai, kv: makeKV(), db });

  const r = await run(env, {
    task: 'workspace_explain',
    userId: 5,
    model: '@cf/meta/llama-3.2-3b-instruct',
    messages: [{ role: 'user', content: 'read this page back' }],
  });

  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, '@cf/meta/llama-3.2-3b-instruct');
  assert.equal(r.usage.model, '@cf/meta/llama-3.2-3b-instruct');
  assert.equal(r.usage.fallback_used, false, 'a chosen model is not a fallback');
  // And it is BILLED at its own rate, not the primary's. 9 in + 3 out at
  // 0.051 / 0.335 per M is a different number from the 70b's 0.293 / 2.253;
  // an implementation that ran the 3b and priced it as the primary would pass
  // every assertion above and this one catches it.
  const expected = (9 / 1e6) * 0.051 + (3 / 1e6) * 0.335;
  assert.ok(Math.abs(r.usage.est_cost_usd - expected) < 1e-12,
    `cost ${r.usage.est_cost_usd} is not the 3b's rate (${expected})`);
  assert.equal(db._rows[0].model, '@cf/meta/llama-3.2-3b-instruct');
});

test('a model NOT on the list never reaches env.AI.run', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([() => ({ response: 'should never happen', usage: {} })]);
  const db = makeDB();
  const env = baseEnv({ ai, kv: makeKV(), db });

  const r = await run(env, {
    task: 'workspace_explain',
    userId: 5,
    model: '@cf/deepseek-ai/deepseek-v4-pro-0813',   // real model, not offered here
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(r.ok, false);
  assert.equal(r.refusal, 'model_not_offered');
  assert.equal(ai.calls.length, 0, 'the model was called anyway — this is the whole property');
  // Refused, NOT silently run on the primary. A router that quietly substituted
  // would return ok:true here, and a founder would read the 3b's rate beside a
  // 70b's answer.
  assert.ok(!r.output, 'a refusal must carry no output');
  assert.equal(db._rows.length, 1, 'a refusal is still a recorded event');
  assert.equal(db._rows[0].refusal, 'model_not_offered');
  assert.equal(db._rows[0].est_cost_usd, 0);
});

test('safety cannot be routed off the guard model, by any request', async () => {
  const { run, ROUTE, __resetForTest } = await loadRouter();
  __resetForTest();
  assert.equal(ROUTE.safety.model, '@cf/meta/llama-guard-3-8b');
  assert.deepEqual(ROUTE.safety.alternates ?? [], []);

  for (const attempt of [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',   // a model the router does route to
    '@cf/meta/llama-guard-3-8b',                  // even the guard model itself
  ]) {
    __resetForTest();
    const ai = makeAI([() => ({ response: 'safe', usage: {} })]);
    const env = baseEnv({ ai, kv: makeKV(), db: makeDB() });
    const r = await run(env, { task: 'safety', userId: 1, model: attempt, text: 'check me' });
    assert.equal(r.refusal, 'model_not_offered', `${attempt} was accepted for task=safety`);
    assert.equal(ai.calls.length, 0);
  }

  // …and with no `model` at all it still runs, on the guard model. The rule is
  // "no override", not "no safety calls".
  __resetForTest();
  const ai = makeAI([() => ({ response: 'safe', usage: { prompt_tokens: 4, completion_tokens: 1 } })]);
  const env = baseEnv({ ai, kv: makeKV(), db: makeDB() });
  const ok = await run(env, { task: 'safety', userId: 1, text: 'check me' });
  assert.equal(ok.ok, true);
  assert.equal(ai.calls[0].model, '@cf/meta/llama-guard-3-8b');
});

test('a fallback\'s answer is not cached under the primary\'s name', async () => {
  // `explain` is the cached task (7 days). When the 70b fails and the 8b
  // answers, the text in hand is the 8b's. Caching it under the 70b's key
  // would hand the next caller a smaller model's answer labelled with the
  // 70b's name and rate — for a week.
  //
  // This is also the only reachable half of the cache-key change: no task
  // today has BOTH a cacheTtlSec and alternates, so a chosen model cannot yet
  // collide with a cached one. `ai_router_prices.test.mjs` holds that half at
  // the source, because the day a task grows both, the bug would be silent.
  const { run, ROUTE, __resetForTest } = await loadRouter();
  __resetForTest();
  assert.ok(ROUTE.explain.cacheTtlSec > 0, 'explain is no longer a cached task');
  assert.deepEqual(ROUTE.explain.fallbackChain, ['@cf/meta/llama-3.1-8b-instruct-fp8']);

  const kv = makeKV();
  const ai = makeAI([
    () => { throw new Error('70b 503'); },
    () => ({ response: 'from the 8b', usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    () => ({ response: 'from the 70b', usage: { prompt_tokens: 10, completion_tokens: 5 } }),
  ]);
  const env = baseEnv({ ai, kv, db: makeDB() });
  const ask = () => run(env, { task: 'explain', userId: 3, topic: 'runway', text: 'what is runway' });

  const first = await ask();
  assert.equal(first.ok, true, `expected ok, got ${JSON.stringify(first)}`);
  assert.equal(first.output, 'from the 8b');
  assert.equal(first.usage.fallback_used, true);
  assert.equal(ai.calls.length, 2);

  // The primary has recovered. The next ask must MISS — the stored row belongs
  // to the 8b — and reach the 70b.
  const second = await ask();
  assert.equal(second.usage.cached, false,
    'the 8b\'s answer was served back as the 70b\'s');
  assert.equal(second.output, 'from the 70b');
  assert.equal(second.usage.fallback_used, false);
  assert.equal(ai.calls.length, 3);
  assert.equal(ai.calls[2].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

  // …and a third, with the primary still healthy, is a hit. The cache still
  // works; it just stopped lying about whose answer it holds.
  const third = await ask();
  assert.equal(third.usage.cached, true, 'the primary never cached its own answer');
  assert.equal(third.output, 'from the 70b');
  assert.equal(ai.calls.length, 3);
});
