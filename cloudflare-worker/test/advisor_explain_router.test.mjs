/**
 * Task #16 — Personal Advisor /explain provider routing tests.
 *
 * Covers the three operational modes added by Task #16 plus the
 * unsafe-completion retry path:
 *   1. default route uses Workers AI (MID_LLAMA) with no Anthropic call
 *   2. ADVISOR_EXPLAIN_PROVIDER='anthropic' routes to Anthropic when key
 *      is present, and silently falls back to Workers AI when no key
 *   3. Workers AI failure cascade → anthropicFallback (claude-sonnet-4-6)
 *      is invoked when ANTHROPIC_API_KEY is configured
 *   4. forceProvider='anthropic' explicitly targets the Anthropic API
 *      (the path used by the route handler's unsafe-completion retry)
 *
 * Loads cloudflare-worker/src/services/aiRouter.ts via the same
 * tsc.transpileModule trick aiRouter.test.mjs uses, with stubs for
 * env.AI, env.AI_SPEND (KV), env.DB (D1), and globalThis.fetch
 * (Anthropic upstream).
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
  const stripped = src
    .replace(/^import type[^;]+;\s*$/m, '')
    .replace(/^export\s+(const|let|function|async\s+function|class|interface|type|enum)\b/gm, '$1')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  const wrapped = `${outputText}\nreturn { run, ROUTE, __resetForTest };`;
  return new Function(wrapped)();
}

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    async put(key, value) { store.set(key, String(value)); },
  };
}

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
          rows.push({ id: nextId++, user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal });
        }
        return { meta: {} };
      },
      async first() { return null; },
      async all() { return { results: [] }; },
    };
  };
  return { exec, prepare, _rows: rows };
}

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

// Replace globalThis.fetch with a recorder so we can assert whether the
// Anthropic API was hit (and reply with a canned message). Returns a
// teardown that restores the original fetch.
function stubAnthropicFetch(reply = { content: [{ type: 'text', text: 'claude said hi' }], usage: { input_tokens: 10, output_tokens: 5 } }) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return {
    calls,
    restore() { globalThis.fetch = orig; },
  };
}

function baseEnv({ ai, kv, db, anthropicKey, explainProvider }) {
  return {
    AI: ai,
    AI_SPEND: kv,
    DB: db,
    ANTHROPIC_API_KEY: anthropicKey,
    ADVISOR_EXPLAIN_PROVIDER: explainProvider,
  };
}

// --------------------------------------------------------------------------
// 1. Default route — Workers AI primary, no Anthropic call.
// --------------------------------------------------------------------------
test('advisor_explain default route uses Workers AI without touching Anthropic', async () => {
  const { run, ROUTE, __resetForTest } = await loadRouter();
  __resetForTest();
  // Spec sanity: the route entry exists and points at Workers AI.
  assert.equal(ROUTE.advisor_explain.provider, 'workers-ai');
  assert.equal(ROUTE.advisor_explain.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(ROUTE.advisor_explain.anthropicFallback, 'claude-sonnet-4-6');

  const ai = makeAI([
    () => ({ response: 'workers ai answer', usage: { prompt_tokens: 8, completion_tokens: 4 } }),
  ]);
  const stub = stubAnthropicFetch();
  try {
    const r = await run(baseEnv({ ai, kv: makeKV(), db: makeDB() }), {
      task: 'advisor_explain',
      userId: 1,
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'what is a SAFE?' }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.usage.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(r.usage.fallback_used, false);
    assert.equal(r.output, 'workers ai answer');
    assert.equal(ai.calls.length, 1);
    assert.equal(stub.calls.length, 0, 'Anthropic API must not be called on default route');
    // Regression guard (Task #16 review-2): when the caller passes
    // both systemPrompt and messages, callWorkersAI must inject the
    // systemPrompt as a leading system message. Previously dropped
    // silently on the WAI path while preserved on Anthropic.
    const sentMessages = ai.calls[0].payload.messages;
    assert.ok(Array.isArray(sentMessages));
    assert.equal(sentMessages[0]?.role, 'system');
    assert.equal(sentMessages[0]?.content, 'sys');
    assert.equal(sentMessages[1]?.role, 'user');
  } finally {
    stub.restore();
  }
});

// Regression guard for the dual case: when the caller already supplied
// a system message inline, we must NOT prepend a duplicate.
test('advisor_explain Workers AI does not duplicate system message when caller already supplied one', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => ({ response: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  ]);
  const stub = stubAnthropicFetch();
  try {
    await run(baseEnv({ ai, kv: makeKV(), db: makeDB() }), {
      task: 'advisor_explain',
      userId: 99,
      systemPrompt: 'OUTER-SYSTEM',
      messages: [
        { role: 'system', content: 'INLINE-SYSTEM' },
        { role: 'user', content: 'hi' },
      ],
    });
    const sent = ai.calls[0].payload.messages;
    assert.equal(sent.length, 2, 'must not duplicate system message');
    assert.equal(sent[0].content, 'INLINE-SYSTEM');
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------------------
// 2a. ADVISOR_EXPLAIN_PROVIDER=anthropic with key → Anthropic primary.
// --------------------------------------------------------------------------
test('advisor_explain with ADVISOR_EXPLAIN_PROVIDER=anthropic routes to Anthropic when key is set', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => { throw new Error('AI binding must not be invoked for anthropic primary'); },
  ]);
  const stub = stubAnthropicFetch();
  try {
    const r = await run(baseEnv({
      ai, kv: makeKV(), db: makeDB(),
      anthropicKey: 'test-key', explainProvider: 'anthropic',
    }), {
      task: 'advisor_explain',
      userId: 2,
      messages: [{ role: 'user', content: 'explain ARR' }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.usage.model, 'claude-sonnet-4-6');
    assert.equal(r.output, 'claude said hi');
    assert.equal(ai.calls.length, 0);
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0].url, /api\.anthropic\.com/);
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------------------
// 2b. ADVISOR_EXPLAIN_PROVIDER=anthropic without key → silent fallback to WAI.
// --------------------------------------------------------------------------
test('advisor_explain anthropic override is silently ignored when ANTHROPIC_API_KEY is unset', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => ({ response: 'wai still answered', usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  ]);
  const stub = stubAnthropicFetch();
  try {
    const r = await run(baseEnv({
      ai, kv: makeKV(), db: makeDB(),
      anthropicKey: undefined, explainProvider: 'anthropic',
    }), {
      task: 'advisor_explain',
      userId: 3,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.usage.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(stub.calls.length, 0, 'Anthropic must not be called without an API key');
    assert.equal(ai.calls.length, 1);
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------------------
// 3. Workers AI failure cascade → anthropicFallback.
// --------------------------------------------------------------------------
test('advisor_explain falls back to Anthropic claude-sonnet-4-6 when every Workers AI hop fails', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => { throw new Error('llama-70b 503'); },
    () => { throw new Error('llama-8b 503'); },
  ]);
  const stub = stubAnthropicFetch({
    content: [{ type: 'text', text: 'claude rescued the call' }],
    usage: { input_tokens: 7, output_tokens: 6 },
  });
  try {
    const r = await run(baseEnv({
      ai, kv: makeKV(), db: makeDB(), anthropicKey: 'k',
    }), {
      task: 'advisor_explain',
      userId: 4,
      messages: [{ role: 'user', content: 'why convert?' }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.usage.model, 'claude-sonnet-4-6');
    assert.equal(r.usage.fallback_used, true);
    assert.equal(r.output, 'claude rescued the call');
    assert.equal(ai.calls.length, 2);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------------------
// 4. forceProvider='anthropic' (the route handler's unsafe-completion
//    retry path) explicitly targets Anthropic regardless of ROUTE.
// --------------------------------------------------------------------------
test('advisor_explain forceProvider=anthropic explicitly targets the Anthropic API', async () => {
  const { run, __resetForTest } = await loadRouter();
  __resetForTest();
  const ai = makeAI([
    () => { throw new Error('AI must not be invoked when forceProvider=anthropic'); },
  ]);
  const stub = stubAnthropicFetch();
  try {
    const r = await run(baseEnv({
      ai, kv: makeKV(), db: makeDB(), anthropicKey: 'k',
    }), {
      task: 'advisor_explain',
      userId: 5,
      forceProvider: 'anthropic',
      messages: [{ role: 'user', content: 'retry on leak' }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.usage.model, 'claude-sonnet-4-6');
    assert.equal(stub.calls.length, 1);
    assert.equal(ai.calls.length, 0);
  } finally {
    stub.restore();
  }
});
