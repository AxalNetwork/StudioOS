/**
 * Task #19 (WS0) — onboarding-chatbot resilience regressions for aiRouter.
 *
 * Focused unit tests for the two genuine gaps fixed in WS0 plus a guard on the
 * pre-existing gateway-bypass path:
 *   1. `onboarding_chat` is a DEDICATED non-gateway task class — even when the
 *      advisor gateway slug is configured, the onboarding turn runs
 *      un-gatewayed (so a broken `advisor-ongoing` gateway can't dead-end it).
 *   2. Nested AI response shapes (`{ result: { response } }`) are parsed
 *      instead of being dropped as an empty reply.
 *   3. Gateway-bypass retry still fires for the gateway-routed `advisor_turn`.
 *
 * Imports the real source via the strip-types loader (see package.json
 * test:drift), mirroring venture_risk.test.ts / axalFit.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, ROUTE, __resetForTest, bindAi, GATEWAY_TASKS, GATEWAY_METADATA_KEYS } from '../src/services/aiRouter.ts';
import type { Env } from '../src/types.ts';

// --- minimal in-memory stubs --------------------------------------------------
function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: 'text' | 'json') {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    async put(key: string, value: string) { store.set(key, String(value)); },
  };
}

function makeDB() {
  const rows: any[] = [];
  let nextId = 1;
  return {
    _rows: rows,
    exec: async () => undefined,
    prepare(sql: string) {
      const text = sql.replace(/\s+/g, ' ').trim();
      let bound: any[] = [];
      return {
        bind(...args: any[]) { bound = args; return this; },
        async run() {
          if (/^INSERT INTO ai_usage_logs /i.test(text)) {
            const [user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal] = bound;
            rows.push({ id: nextId++, user_id, task, model, latency_ms, prompt_tokens, completion_tokens, est_cost_usd, safety_score, fallback_used, cached, refusal });
          }
          return { meta: { last_row_id: nextId - 1 } };
        },
        async first() { return null; },
        async all() { return { results: [] }; },
      };
    },
  };
}

// Workers AI stub that records whether each call carried a gateway option and
// lets the test script the raw response shape per call. D261: it also keeps the
// options object as sent, so a test can read the gateway metadata itself.
type GatewayOpt = { gateway?: { id: string; metadata?: Record<string, unknown> } };
function makeAI(handler: (model: string, payload: unknown, gatewayed: boolean, n: number) => unknown) {
  const calls: Array<{ model: string; gatewayed: boolean; options: GatewayOpt | undefined }> = [];
  return {
    calls,
    async run(model: string, payload: unknown, options?: GatewayOpt) {
      const gatewayed = !!(options && options.gateway && options.gateway.id);
      calls.push({ model, gatewayed, options });
      return handler(model, payload, gatewayed, calls.length);
    },
  };
}

function envWith(ai: any, kv: any, db: any, extra: Record<string, unknown> = {}): Env {
  return { AI: ai, AI_SPEND: kv, DB: db, ...extra } as unknown as Env;
}

// -----------------------------------------------------------------------------
test('onboarding_chat is registered with the advisor model chain', () => {
  assert.ok(ROUTE.onboarding_chat, 'onboarding_chat route must exist');
  assert.equal(ROUTE.onboarding_chat.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  // `-fp8`, not the bare 8b: Cloudflare marked `@cf/meta/llama-3.1-8b-instruct`
  // Deprecated 5/30/2026, so the whole chain used to terminate on a model
  // scheduled for removal. Same family and size, wider context, cheaper both
  // ways — see `ai_router_prices.test.mjs`, which bans the deprecated id.
  assert.deepEqual(ROUTE.onboarding_chat.fallbackChain, ['@cf/meta/llama-3.1-8b-instruct-fp8']);
});

test('onboarding_chat NEVER routes through the advisor gateway, even when configured', async () => {
  __resetForTest();
  const ai = makeAI(() => ({ response: 'welcome to axal', usage: { prompt_tokens: 4, completion_tokens: 3 } }));
  const env = envWith(ai, makeKV(), makeDB(), { CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' });

  const r = await run(env, { task: 'onboarding_chat', userId: 1, messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(r.output, 'welcome to axal');
  // Exactly one call, and it must be un-gatewayed — no gateway dependency.
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].gatewayed, false);
});

test('onboarding_chat survives a totally broken gateway env (still single un-gatewayed call)', async () => {
  __resetForTest();
  // Even if the gateway-aware path were somehow hit, this stub would throw on
  // a gatewayed call. onboarding_chat must never make one.
  const ai = makeAI((_m, _p, gatewayed) => {
    if (gatewayed) throw new Error('1015 authenticated gateway token required');
    return { response: 'direct reply', usage: { prompt_tokens: 2, completion_tokens: 2 } };
  });
  const env = envWith(ai, makeKV(), makeDB(), { CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' });

  const r = await run(env, { task: 'onboarding_chat', userId: 2, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'direct reply');
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].gatewayed, false);
});

test('nested { result: { response } } AI shape is parsed, not dropped as empty', async () => {
  __resetForTest();
  const ai = makeAI(() => ({ result: { response: 'nested answer', usage: { prompt_tokens: 9, completion_tokens: 5 } } }));
  const env = envWith(ai, makeKV(), makeDB());

  const r = await run(env, { task: 'onboarding_chat', userId: 3, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'nested answer');
  // Nested usage is honored too.
  assert.equal(r.usage.prompt_tokens, 9);
  assert.equal(r.usage.completion_tokens, 5);
});

test('nested { result: { choices: [{ message: { content } }] } } AI shape is parsed', async () => {
  __resetForTest();
  const ai = makeAI(() => ({ result: { choices: [{ message: { content: 'nested choice content' } }] } }));
  const env = envWith(ai, makeKV(), makeDB());

  const r = await run(env, { task: 'onboarding_chat', userId: 4, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'nested choice content');
});

test('advisor_turn still bypasses a broken gateway by retrying un-gatewayed (same model)', async () => {
  __resetForTest();
  const ai = makeAI((_m, _p, gatewayed) => {
    if (gatewayed) throw new Error('1015 authenticated gateway token required');
    return { response: 'via direct workers-ai', usage: { prompt_tokens: 8, completion_tokens: 6 } };
  });
  const env = envWith(ai, makeKV(), makeDB(), { CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' });

  const r = await run(env, { task: 'advisor_turn', userId: 5, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'via direct workers-ai');
  assert.equal(r.usage.fallback_used, false); // same model, just gateway bypass
  assert.equal(ai.calls.length, 2);
  assert.equal(ai.calls[0].gatewayed, true);
  assert.equal(ai.calls[1].gatewayed, false);
  assert.equal(ai.calls[0].model, ai.calls[1].model);
});

// -----------------------------------------------------------------------------
// D261 — the gateway learns whose call it is.
// -----------------------------------------------------------------------------
const SLUG = { CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing' };
const FR = { ...SLUG, BRANCH_CODE: 'fr' };
const ok = () => ({ response: 'answer', usage: { prompt_tokens: 3, completion_tokens: 2 } });
const ask = [{ role: 'user' as const, content: 'hi' }];

/** Every metadata object a gatewayed call carried, for the shape checks. */
function metadataOf(ai: ReturnType<typeof makeAI>) {
  return ai.calls.filter((c) => c.gatewayed).map((c) => c.options!.gateway!.metadata);
}

test('D261: on a branch, a gatewayed call names the branch, the account as branch:user and the task', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  const r = await run(envWith(ai, makeKV(), makeDB(), FR), { task: 'advisor_explain', userId: 42, messages: ask });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].options?.gateway?.id, 'advisor-ongoing');
  assert.deepEqual(ai.calls[0].options?.gateway?.metadata, { branch: 'fr', account: 'fr:42', task: 'advisor_explain' });
});

test('D261: on HQ the branch is hq, and the account is scoped to it', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  await run(envWith(ai, makeKV(), makeDB(), SLUG), { task: 'advisor_turn', userId: 42, messages: ask });
  assert.deepEqual(ai.calls[0].options?.gateway?.metadata, { branch: 'hq', account: 'hq:42', task: 'advisor_turn' });
});

test('D261: a call with user id 0 (bindAi\'s default) carries no account key, never "hq:0"', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  await bindAi(envWith(ai, makeKV(), makeDB(), SLUG))('advisor_explain', { messages: ask });
  const md = ai.calls[0].options?.gateway?.metadata as Record<string, unknown>;
  assert.deepEqual(md, { branch: 'hq', task: 'advisor_explain' });
  assert.ok(!('account' in md), 'an account key was built from the default 0');
});

test('D261: the bypass retry after a gateway failure still carries no gateway option at all', async () => {
  __resetForTest();
  const ai = makeAI((_m, _p, gatewayed) => {
    if (gatewayed) throw new Error('1015 authenticated gateway token required');
    return ok();
  });
  const r = await run(envWith(ai, makeKV(), makeDB(), FR), { task: 'advisor_turn', userId: 7, messages: ask });
  assert.equal(r.ok, true);
  assert.equal(ai.calls.length, 2);
  assert.deepEqual(ai.calls[0].options?.gateway?.metadata, { branch: 'fr', account: 'fr:7', task: 'advisor_turn' });
  assert.equal(ai.calls[1].options, undefined, 'the un-gatewayed retry sent an options object');
});

test('D261: onboarding_chat is unchanged — no gateway option and so no metadata, on a branch with a slug set', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  await run(envWith(ai, makeKV(), makeDB(), FR), { task: 'onboarding_chat', userId: 42, messages: ask });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].options, undefined);
});

test('D261: with no slug set, a gatewayed task class sends no option, so no metadata', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  await run(envWith(ai, makeKV(), makeDB(), { BRANCH_CODE: 'fr' }), { task: 'advisor_explain', userId: 42, messages: ask });
  assert.equal(ai.calls[0].options, undefined);
});

test('D261: every gatewayed call carries at most five keys, none reserved (cf.*), in the exported order', async () => {
  __resetForTest();
  const ai = makeAI(ok);
  for (const task of GATEWAY_TASKS) {
    for (const [extra, userId] of [[FR, 42], [SLUG, 42], [SLUG, 0]] as const) {
      await run(envWith(ai, makeKV(), makeDB(), extra), { task, userId, messages: ask });
    }
  }
  const all = metadataOf(ai);
  assert.equal(all.length, GATEWAY_TASKS.length * 3, 'every gatewayed call was recorded');
  for (const md of all) {
    const keys = Object.keys(md ?? {});
    assert.ok(keys.length > 0 && keys.length <= 5, `metadata has ${keys.length} keys`);
    assert.ok(keys.every((k) => !k.startsWith('cf.')), `a reserved key was sent: ${keys}`);
    assert.deepEqual(keys, GATEWAY_METADATA_KEYS.filter((k) => keys.includes(k)), 'keys out of the exported order');
    assert.ok(keys.every((k) => (GATEWAY_METADATA_KEYS as readonly string[]).includes(k)), `an undeclared key was sent: ${keys}`);
    for (const v of Object.values(md ?? {})) assert.equal(typeof v, 'string');
  }
});
