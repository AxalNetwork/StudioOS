/**
 * D761 (#2018) PR 1 — the router's text and reasoning shapes, its timeouts per
 * class, and its fallbacks, on a stubbed `env.AI`. Nothing calls Workers AI.
 *
 *   - each shape's request as the stub receives it, and the units it reports;
 *   - `reasoning_content` is never the answer;
 *   - each class times out at its limit and falls back, a stream on its first chunk;
 *   - a 429, and a 403 with 5035, from a paid-only model move down the chain;
 *   - a context overflow skips a model without calling it;
 *   - `x-session-affinity` holds the user id and page key, never an email or name.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_router_shapes_d761.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { run, ROUTE, __resetForTest } from '../src/services/aiRouter.ts';
import * as shapes from '../src/services/ai/shapes.ts';

const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SMALL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const DEEPSEEK = '@cf/deepseek-ai/deepseek-v4-flash-0731';
const ask = [{ role: 'user', content: 'What changed this week?' }];

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, String(v)); },
  };
}
function makeAI(handler) {
  const calls = [];
  return {
    calls,
    async run(model, payload, options) { calls.push({ model, payload, options }); return handler(model, payload, calls.length); },
  };
}
const envWith = (ai, extra = {}) => ({ AI: ai, AI_SPEND: makeKV(), DB: aiBudgetFixture().DB, ...extra });
const ok = (text = 'An answer.', usage = { prompt_tokens: 11, completion_tokens: 5 }) => ({ response: text, usage });
const failWith = (message, status) => { const e = new Error(message); if (status) e.status = status; throw e; };
/** Let pending promise work run between mocked-timer ticks. */
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

test.afterEach(() => { shapes.setModelFactsSource(null); __resetForTest(); });

// ─────────────────────────────────────────────────────────── shapes and units

test('text: the chat request the stub receives, and the units the attempt reports, cached input included', async () => {
  const ai = makeAI(() => ok('Plain answer.', { prompt_tokens: 40, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 32 } }));
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'Plain answer.');
  assert.deepEqual(ai.calls[0].payload, { messages: ask, max_tokens: 512 });
  assert.deepEqual(r.units, { tokens_in: 40, tokens_out: 6, tokens_cached: 32 });
  assert.deepEqual(r.attempts, [{ model: MID, ok: true, called: true, timeout_ms: 8_000, units: { tokens_in: 40, tokens_out: 6, tokens_cached: 32 } }]);
  assert.equal(r.usage.prompt_tokens, 40);
  assert.equal(r.usage.completion_tokens, 6);
});

test('text: a provider that reports no usage is counted from the text the Worker holds, and no cached count is invented', async () => {
  const ai = makeAI(() => ({ response: 'Twelve chars' }));
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask });
  assert.deepEqual(r.units, { tokens_in: Math.ceil('What changed this week?'.length / 4), tokens_out: 3 });
  assert.ok(!('tokens_cached' in r.units));
});

test('reasoning: the task\'s output budget replaces 512, and a control is sent only when it names a value', async () => {
  const ai = makeAI(() => ({ choices: [{ message: { content: 'Structured.' } }], usage: { prompt_tokens: 9, completion_tokens: 900 } }));
  const r = await run(envWith(ai), { task: 'structure_interview', userId: 0, messages: ask, model: DEEPSEEK });
  assert.equal(r.ok, true);
  assert.equal(ai.calls[0].payload.max_tokens, shapes.REASONING_MAX_TOKENS);
  assert.ok(!('reasoning_effort' in ai.calls[0].payload) && !('chat_template_kwargs' in ai.calls[0].payload));
  assert.equal(r.attempts[0].timeout_ms, 30_000);
  const larger = await run(envWith(makeAI(() => ok())), { task: 'structure_interview', userId: 0, messages: ask, model: DEEPSEEK, maxTokens: 8_000 });
  assert.equal(larger.ok, true);
  assert.equal(shapes.maxTokensFor(shapes.factsFor(DEEPSEEK), 8_000), 8_000, 'a larger ask is kept');
  assert.equal(shapes.maxTokensFor(shapes.factsFor(MID), undefined), 512, 'a text model keeps 512');
  assert.equal(shapes.maxTokensFor(shapes.factsFor(DEEPSEEK), 300, 2_000), 2_000, 'a task\'s own reasoning budget');

  const effort = shapes.chatRequest({ kind: 'reasoning', context_window: null, paid_only: false, reasoning: { via: 'reasoning_effort', effort: 'low' } }, ask, { maxTokens: 4096 });
  assert.equal(effort.reasoning_effort, 'low');
  const nemotron = shapes.chatRequest({ kind: 'reasoning', context_window: null, paid_only: false, reasoning: { via: 'chat_template_kwargs', kwargs: { enable_thinking: true, low_effort: true } } }, ask, { maxTokens: 4096 });
  assert.deepEqual(nemotron.chat_template_kwargs, { enable_thinking: true, low_effort: true });
  assert.ok(!('reasoning_effort' in nemotron));
  assert.deepEqual(shapes.REASONING_CONTROLS['@cf/nvidia/nemotron-3-120b-a12b'], { via: 'chat_template_kwargs' });
  const text = shapes.chatRequest({ kind: 'text', context_window: null, paid_only: false, reasoning: { via: 'reasoning_effort', effort: 'high' } }, ask, { maxTokens: 512 });
  assert.ok(!('reasoning_effort' in text), 'a text model is never sent a reasoning control');
});

test('reasoning_content is never the answer, and inline thinking is stripped from a reasoning model', async () => {
  const onlyReasoning = makeAI(() => ({ choices: [{ message: { content: '', reasoning_content: 'private chain of thought' } }] }));
  const r1 = await run(envWith(onlyReasoning), { task: 'structure_interview', userId: 0, messages: ask, model: DEEPSEEK });
  assert.equal(r1.output, '');
  assert.doesNotMatch(JSON.stringify(r1), /private chain of thought/);
  const both = makeAI(() => ({ choices: [{ message: { content: 'The answer.', reasoning_content: 'thinking' } }] }));
  assert.equal((await run(envWith(both), { task: 'structure_interview', userId: 0, messages: ask, model: DEEPSEEK })).output, 'The answer.');
  const reasoning = shapes.factsFor(DEEPSEEK);
  assert.equal(shapes.parseChat({ response: '<think>weigh it</think>\nThe answer.' }, reasoning, ask).text, 'The answer.');
  assert.equal(shapes.parseChat({ response: 'weigh it</think>The answer.' }, reasoning, ask).text, 'The answer.', 'a closing tag with no opening one');
  assert.equal(shapes.parseChat({ response: '<think>kept</think> text' }, shapes.factsFor(MID), ask).text, '<think>kept</think> text', 'a text model\'s answer is left alone');
});

// ─────────────────────────────────────────────────────────── timeouts

test('the classes: chat 8 s, reasoning and long context 30 s, images 60 s', () => {
  const f = (kind) => ({ kind, context_window: null, paid_only: false });
  assert.equal(shapes.timeoutMs(f('text'), 10), 8_000);
  assert.equal(shapes.timeoutMs(f('text'), shapes.LONG_CONTEXT_TOKENS - 1), 8_000);
  assert.equal(shapes.timeoutMs(f('text'), shapes.LONG_CONTEXT_TOKENS), 30_000);
  assert.equal(shapes.timeoutMs(f('reasoning'), 10), 30_000);
  assert.equal(shapes.timeoutMs(f('image'), 10), 60_000);
  assert.deepEqual({ ...shapes.TIMEOUT_MS }, { chat: 8_000, reasoning: 30_000, long_context: 30_000, image: 60_000 });
});

async function timedRun(t, opts, hangOn, advance) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ai = makeAI((model) => (model === hangOn ? new Promise(() => {}) : ok('from the fallback')));
  const pending = run(envWith(ai), opts);
  for (const ms of advance) { await flush(); t.mock.timers.tick(ms); }
  await flush();
  const r = await pending;
  return { r, ai };
}

test('a chat attempt times out at 8 s and falls back; 7.9 s is not yet a timeout', async (t) => {
  const { r, ai } = await timedRun(t, { task: 'paraphrase', userId: 0, messages: ask }, MID, [7_999, 1]);
  assert.equal(r.ok, true);
  assert.equal(r.output, 'from the fallback');
  assert.deepEqual(ai.calls.map((c) => c.model), [MID, SMALL]);
  assert.equal(r.attempts[0].status, 504);
  assert.equal(r.attempts[0].timeout_ms, 8_000);
});

test('a reasoning attempt is not cut at 8 s; it times out at 30 s and falls back', async (t) => {
  shapes.setModelFactsSource((m) => (m === MID ? { kind: 'reasoning', context_window: null, paid_only: false } : null));
  const early = await (async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ai = makeAI((model) => (model === MID ? new Promise(() => {}) : ok('fallback')));
    const pending = run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask });
    await flush(); t.mock.timers.tick(8_000); await flush();
    const calledAt8 = ai.calls.length;
    t.mock.timers.tick(22_000); await flush();
    return { calledAt8, r: await pending, ai };
  })();
  assert.equal(early.calledAt8, 1, 'still waiting on the reasoning model at 8 s');
  assert.equal(early.r.ok, true);
  assert.deepEqual(early.ai.calls.map((c) => c.model), [MID, SMALL]);
  assert.equal(early.r.attempts[0].timeout_ms, 30_000);
});

test('a streamed run gets the same limit for its first chunk, and falls back when none comes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const silent = () => new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
  const talks = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: hi\n\n')); c.close(); } });
  const ai = makeAI((model) => (model === MID ? silent() : talks()));
  const pending = run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask, stream: true });
  await flush(); t.mock.timers.tick(8_000); await flush();
  const r = await pending;
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls.map((c) => c.model), [MID, SMALL]);
  assert.equal(r.attempts[0].status, 504);
  assert.equal(cancelled, true, 'the silent stream was cancelled');
  const text = await new Response(r.stream).text();
  assert.equal(text, 'data: hi\n\n', 'the first chunk is replayed, then the rest');
});

// ─────────────────────────────────────────────────────────── fallbacks

test('a paid-only model\'s 429 and its 403 with code 5035 move down the chain, recorded on the attempt', async () => {
  shapes.setModelFactsSource((m) => (m === MID ? { kind: 'text', context_window: null, paid_only: true } : null));
  for (const [message, status, code] of [['429 Too Many Requests', 429, null], ['5035: This model requires a paid plan', 403, 5035]]) {
    const ai = makeAI((model) => (model === MID ? failWith(message, status) : ok('from the 8b')));
    const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask });
    assert.equal(r.ok, true, message);
    assert.equal(r.output, 'from the 8b');
    assert.deepEqual(ai.calls.map((c) => c.model), [MID, SMALL]);
    assert.equal(r.attempts[0].status, status);
    assert.equal(r.attempts[0].code, code);
    assert.equal(r.usage.fallback_used, true);
  }
  assert.equal(shapes.isPaidOnlyRefusal({ kind: 'text', context_window: null, paid_only: true }, { status: 403, code: 5035 }), true);
  assert.equal(shapes.isPaidOnlyRefusal({ kind: 'text', context_window: null, paid_only: true }, { status: 403, code: 5000 }), false);
  assert.equal(shapes.isPaidOnlyRefusal({ kind: 'text', context_window: null, paid_only: false }, { status: 429, code: null }), false);
  assert.deepEqual(shapes.failureOf(Object.assign(new Error('5035: paid plan'), { status: 403 })), { status: 403, code: 5035 });
  assert.deepEqual(shapes.failureOf(new Error('Too many requests')), { status: 429, code: null });
});

test('a context overflow skips the model without calling it; an unknown window always fits', async () => {
  shapes.setModelFactsSource((m) => (m === MID ? { kind: 'text', context_window: 100, paid_only: false } : null));
  const ai = makeAI(() => ok('from the 8b'));
  const long = [{ role: 'user', content: 'x'.repeat(4 * 200) }];
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: long });
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls.map((c) => c.model), [SMALL], 'the 70b was never called');
  assert.deepEqual(r.attempts[0], { model: MID, ok: false, called: false, status: 413, code: null });
  assert.equal(shapes.fitsContext({ kind: 'text', context_window: null, paid_only: false }, 10 ** 9, 512), true);
  assert.equal(shapes.fitsContext({ kind: 'text', context_window: 1000, paid_only: false }, 488, 512), true);
  assert.equal(shapes.fitsContext({ kind: 'text', context_window: 1000, paid_only: false }, 489, 512), false);
  const short = await run(envWith(makeAI(() => ok())), { task: 'paraphrase', userId: 0, messages: ask });
  assert.equal(short.attempts[0].model, MID, 'a short input still runs on the 70b');
});

// ─────────────────────────────────────────────────────────── cache affinity

test('x-session-affinity is the user id and the page key, never an email or a name', async () => {
  const ai = makeAI(() => ok());
  await run(envWith(ai), { task: 'paraphrase', userId: 42, messages: ask, surface: '/validate/customer-research/' });
  assert.deepEqual(ai.calls[0].options, { extraHeaders: { 'x-session-affinity': 'u42:/validate/customer-research' } });
  const noPage = makeAI(() => ok());
  await run(envWith(noPage), { task: 'paraphrase', userId: 42, messages: ask });
  assert.deepEqual(noPage.calls[0].options, { extraHeaders: { 'x-session-affinity': 'u42:paraphrase' } }, 'the task is the page key when none is given');
  const system = makeAI(() => ok());
  await run(envWith(system), { task: 'paraphrase', userId: 0, messages: ask });
  assert.equal(system.calls[0].options, undefined, 'no member, no affinity');
  assert.equal(shapes.sessionAffinity(42, 'founder@example.test'), null, 'an email is never a page key');
  assert.equal(shapes.sessionAffinity(42, 'Ada Lovelace'), null, 'a name is never a page key');
  assert.equal(shapes.sessionAffinity(-1, '/x'), null);
  const src = readFileSync('cloudflare-worker/src/services/aiRouter.ts', 'utf8');
  assert.match(src, /shapes\.sessionAffinity\(opts\.userId, normaliseSurface\(opts\.surface\) \?\? opts\.task\)/);
});

test('the system embed task keeps BGE Base EN v1.5 for the 768-dimension index, and reports its tokens', async () => {
  assert.equal(ROUTE.embed.model, '@cf/baai/bge-base-en-v1.5');
  assert.equal(ROUTE.embed.isEmbed, true);
  const ai = makeAI(() => ({ data: [new Array(768).fill(0.1)], usage: { prompt_tokens: 7 } }));
  const r = await run(envWith(ai), { task: 'embed', userId: 0, text: 'index me' });
  assert.equal(r.embedding.length, 768);
  assert.deepEqual(ai.calls[0].payload, { text: 'index me' });
  assert.deepEqual(r.units, { tokens_in: 7 });
});
