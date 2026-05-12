/**
 * Task #1 (AX) — Multi-model AI router tests.
 *
 * Three acceptance scenarios per spec:
 *   1. primary 5xx triggers smaller-model fallback
 *   2. budget exhaustion returns refusal
 *   3. embedding cache hit on second identical input
 *
 * Loads `cloudflare-worker/src/services/aiRouter.ts` via tsc.transpileModule
 * (same pattern as projects.test.mjs) so we exercise the exact source bytes
 * shipped to Cloudflare. Provides in-memory mocks for `env.AI` (Workers AI),
 * `env.AI_SPEND` (KV), and `env.DB` (D1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
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
  assert.deepEqual(ROUTE.tool_call.fallbackChain, [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct',
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
  assert.equal(r.usage.model, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(ai.calls.length, 3);
  assert.equal(ai.calls[2].model, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(r.output, 'small-llama saved the day');
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
