// Regression tests for the onboarding-chatbot Worker AI fix.
//
// Root cause: routes/profiling.ts classified the onboarding chat as
// 'advisor_turn', which forced every turn through the `advisor-ongoing` AI
// Gateway (an 8s timeout per turn when that gateway is broken) and burned the
// shared advisor budget. The fix adds a dedicated, un-gatewayed 'onboarding_chat'
// task class (8B primary / 70B fallback) and broadens output parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { run, ROUTE } from '../src/services/aiRouter.ts';

const SMALL = '@cf/meta/llama-3.1-8b-instruct';
const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Minimal env: no KV (so budget/cache are skipped) + a no-op DB so recordUsage
// never throws. AI.run is a spy whose behavior each test configures.
function makeEnv(aiRun: (model: string, payload: any, opt: any) => any) {
  const dbStmt = { bind: () => dbStmt, run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
  return {
    DB: { prepare: () => dbStmt },
    CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing',
    AI: { run: (model: string, payload: any, opt: any) => aiRun(model, payload, opt) },
  } as any;
}

test('onboarding_chat is registered: 8B primary, 70B fallback', () => {
  assert.ok(ROUTE.onboarding_chat, 'onboarding_chat route exists');
  assert.equal(ROUTE.onboarding_chat.model, SMALL);
  assert.deepEqual(ROUTE.onboarding_chat.fallbackChain, [MID]);
});

test('onboarding_chat is NOT gateway-routed even when a slug is configured', async () => {
  const calls: Array<{ model: string; opt: any }> = [];
  const env = makeEnv((model, _payload, opt) => {
    calls.push({ model, opt });
    return { response: 'hi there' };
  });
  const res = await run(env, { task: 'onboarding_chat', userId: 1, messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(res.ok, true);
  assert.equal(res.output, 'hi there');
  assert.equal(calls.length, 1, 'no gateway-bypass retry needed');
  assert.equal(calls[0].model, SMALL);
  assert.equal(calls[0].opt, undefined, 'gateway option must be undefined (un-gatewayed)');
});

test('advisor_turn still routes through the advisor gateway', async () => {
  const calls: Array<{ model: string; opt: any }> = [];
  const env = makeEnv((model, _payload, opt) => {
    calls.push({ model, opt });
    return { response: 'ok' };
  });
  await run(env, { task: 'advisor_turn', userId: 1, messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(calls[0].opt, { gateway: { id: 'advisor-ongoing' } });
});

test('output parsing unwraps a nested { result: { response } } shape', async () => {
  const env = makeEnv(() => ({ result: { response: 'nested reply' } }));
  const res = await run(env, { task: 'onboarding_chat', userId: 1, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(res.ok, true);
  assert.equal(res.output, 'nested reply');
});

test('a broken advisor gateway falls back to an un-gatewayed call (no dead-end)', async () => {
  const calls: Array<{ model: string; gatewayed: boolean }> = [];
  const env = makeEnv((model, _payload, opt) => {
    const gatewayed = !!opt;
    calls.push({ model, gatewayed });
    if (gatewayed) throw new Error('gateway 530: advisor-ongoing unavailable');
    return { response: 'recovered' };
  });
  const res = await run(env, { task: 'advisor_turn', userId: 1, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.ok, true);
  assert.equal(res.output, 'recovered');
  // First call gatewayed (throws), second call bypasses the gateway and succeeds.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].gatewayed, true);
  assert.equal(calls[1].gatewayed, false);
});
