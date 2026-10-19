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
 * PR 2 — vision, rerank, embeddings and translation:
 *   - each shape's request, its parsed answer and its units;
 *   - a model that cannot serve the run is skipped uncalled; a malformed input is refused before any call;
 *   - images, a rerank and a translation are part of the cache key; a rerank's texts reach the guard;
 *   - only BGE Base EN v1.5's 768-dimension vectors may be written to `axal-search`.
 *
 * PR 3 — speech and voice:
 *   - Aura's and MeloTTS's requests, their audio, and their units (characters; minutes from the bytes);
 *   - a partner voice is skipped uncalled until D760 offers it; a voice the model lacks moves down the chain;
 *   - a voice is held and charged on those units, and never cached;
 *   - a live stream's units are WebSocket minutes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_router_shapes_d761.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { upsertEntity } from '../src/services/vectorize.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { run, ROUTE, estimateCostUsd, __resetForTest } from '../src/services/aiRouter.ts';
import * as shapes from '../src/services/ai/shapes.ts';
import { withGuard } from './_guard_stub.mjs';

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
// D763: the guard answers free, so `ai.calls` stays the router's own attempts.
const envWith = (ai, extra = {}) => ({ AI: withGuard(ai), AI_SPEND: makeKV(), DB: aiBudgetFixture().DB, ...extra });
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
  const talks = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"hi"}\n\n')); c.close(); } });
  const ai = makeAI((model) => (model === MID ? silent() : talks()));
  const pending = run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask, stream: true });
  await flush(); t.mock.timers.tick(8_000); await flush();
  const r = await pending;
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls.map((c) => c.model), [MID, SMALL]);
  assert.equal(r.attempts[0].status, 504);
  assert.equal(cancelled, true, 'the silent stream was cancelled');
  const text = await new Response(r.stream).text();
  // D763: the text is released once the guard has checked it, as Workers AI's own event shape.
  assert.equal(text, 'data: {"response":"hi"}\n\ndata: [DONE]\n\n', 'the first chunk is replayed, then the rest');
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

// ─────────────────────────────────────────────────────────── PR 2: vision

const PNG = `data:image/png;base64,${Buffer.from('a tiny png').toString('base64')}`;
const JPEG = `data:image/jpeg;base64,${Buffer.from('a tiny jpeg').toString('base64')}`;
const visionFacts = (m) => (m === MID ? { kind: 'text', context_window: null, paid_only: false, vision: true } : null);

test('vision: the images ride on the last user message as content parts, and the attempt counts them', async () => {
  // Mutation checked: images put on the first message; images_in dropped.
  shapes.setModelFactsSource(visionFacts);
  const ai = makeAI(() => ok('A whiteboard with three columns.', { prompt_tokens: 600, completion_tokens: 8 }));
  const msgs = [{ role: 'user', content: 'Earlier.' }, { role: 'assistant', content: 'Yes.' }, { role: 'user', content: 'What is on this board?' }];
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: msgs, images: [PNG, JPEG] });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'A whiteboard with three columns.');
  assert.deepEqual(ai.calls[0].payload.messages, [
    { role: 'user', content: 'Earlier.' }, { role: 'assistant', content: 'Yes.' },
    { role: 'user', content: [{ type: 'text', text: 'What is on this board?' }, { type: 'image_url', image_url: { url: PNG } }, { type: 'image_url', image_url: { url: JPEG } }] },
  ]);
  assert.deepEqual(r.units, { tokens_in: 600, tokens_out: 8, images_in: 2 });
  assert.deepEqual(shapes.withImages([{ role: 'system', content: 'S' }], [PNG]), [{ role: 'system', content: 'S' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: PNG } }] }]);
});

test('vision: a text-only model is skipped without a call, so no model answers as if there were no image', async () => {
  // Mutation checked: the canServe skip removed (the 70b is called and answers blind).
  const ai = makeAI(() => ok('I see nothing.'));
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask, images: [PNG] });
  assert.equal(r.ok, false);
  assert.equal(r.refusal, 'all_models_failed');
  assert.equal(ai.calls.length, 0, 'no model was called');
  assert.deepEqual(r.attempts.map((a) => [a.model, a.called, a.status]), [[MID, false, 422], [SMALL, false, 422]]);
  // The interim table: the four the catalogue named on 2026-10-17, Kimi K2.6 a reasoning model that also sees.
  for (const m of ['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.2-11b-vision-instruct', '@cf/moonshotai/kimi-k2.6']) {
    assert.equal(shapes.canServe(shapes.factsFor(m), 'vision'), true, m);
  }
  assert.equal(shapes.factsFor('@cf/moonshotai/kimi-k2.6').kind, 'reasoning');
  assert.equal(shapes.canServe(shapes.factsFor(MID), 'vision'), false);
  assert.equal(shapes.canServe(shapes.factsFor(MID), 'chat'), true);
});

test('vision: only data URIs of the four image types, at most 4, each at most 4 MB; refused before any call', async () => {
  // Mutations checked: an https URL accepted; the count cap dropped; the size cap dropped.
  shapes.setModelFactsSource(visionFacts);
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil((shapes.MAX_IMAGE_BYTES + 3) / 3) * 4)}`;
  for (const [images, why] of [
    [['https://example.test/a.png'], /data URI/], [['data:image/svg+xml;base64,PHN2Zz4='], /data URI/],
    [[PNG, PNG, PNG, PNG, PNG], /at most 4 images/], [[big], /at most 4 MB/],
  ]) {
    const ai = makeAI(() => ok());
    const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, messages: ask, images });
    assert.equal(r.refusal, 'invalid_input', String(images[0]).slice(0, 30));
    assert.match(r.error, why);
    assert.equal(ai.calls.length, 0);
  }
  assert.equal(shapes.imageBytes(PNG), Buffer.from('a tiny png').length);
  assert.equal(shapes.imagesRefusal([PNG, PNG, PNG, PNG]), null);
});

// ─────────────────────────────────────────────────────────── PR 2: rerank

const RERANK = '@cf/baai/bge-reranker-base';
const rerankFacts = (m) => (m === MID ? { kind: 'rerank', context_window: null, paid_only: false } : null);

test('rerank: query and contexts in, the stub\'s scores out, best first by each context\'s index', async () => {
  // Mutations checked: contexts sent as bare strings; the sort dropped; an out-of-range id kept.
  shapes.setModelFactsSource(rerankFacts);
  const ai = makeAI(() => ({ response: [{ id: 0, score: 0.2 }, { id: 2, score: 0.9 }, { id: 1, score: 0.5 }, { id: 7, score: 1 }] }));
  const rr = { query: 'Who pays today?', contexts: ['Interns', 'The ops lead', 'The CFO'], topK: 3 };
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, rerank: rr });
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls[0].payload, { query: 'Who pays today?', contexts: [{ text: 'Interns' }, { text: 'The ops lead' }, { text: 'The CFO' }], top_k: 3 });
  assert.deepEqual(r.ranking, [{ index: 2, score: 0.9 }, { index: 1, score: 0.5 }, { index: 0, score: 0.2 }]);
  const perPair = (c) => Math.ceil('Who pays today?'.length / 4) + Math.ceil(c.length / 4);
  assert.deepEqual(r.units, { tokens_in: perPair('Interns') + perPair('The ops lead') + perPair('The CFO') }, 'input only: a reranker writes nothing');
  assert.equal(shapes.canServe(shapes.factsFor(MID), 'rerank'), true);
  shapes.setModelFactsSource(null);
  assert.equal(shapes.factsFor(RERANK).kind, 'rerank', 'the interim table, until D760');
});

test('rerank: a chat model is skipped uncalled; an empty query or context is refused before any call', async () => {
  // Mutation checked: rerankRefusal accepting an empty context.
  const ai = makeAI(() => ok());
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, rerank: { query: 'q', contexts: ['a'] } });
  assert.equal(r.refusal, 'all_models_failed');
  assert.equal(ai.calls.length, 0);
  for (const bad of [{ query: ' ', contexts: ['a'] }, { query: 'q', contexts: [] }, { query: 'q', contexts: ['a', ''] }, { query: 'q', contexts: ['a'], topK: 0 }]) {
    const r2 = await run(envWith(makeAI(() => ok())), { task: 'paraphrase', userId: 0, rerank: bad });
    assert.equal(r2.refusal, 'invalid_input', JSON.stringify(bad));
  }
  const both = await run(envWith(makeAI(() => ok())), { task: 'paraphrase', userId: 0, rerank: { query: 'q', contexts: ['a'] }, images: [PNG] });
  assert.equal(both.refusal, 'invalid_input', 'one ask per run');
});

test('rerank: the query and every context reach the guard as the run\'s input', async () => {
  // Mutation checked: guardInputFor ignoring the rerank.
  const src = readFileSync('cloudflare-worker/src/services/aiRouter.ts', 'utf8');
  const body = src.slice(src.indexOf('function guardInputFor('), src.indexOf('/** One guard call'));
  assert.match(body, /if \(opts\.rerank\) return \[opts\.rerank\.query, \.\.\.\(opts\.rerank\.contexts \?\? \[\]\)\]\.join/);
});

// ─────────────────────────────────────────────────────────── PR 2: translation

const M2M = '@cf/meta/m2m100-1.2b';
const translationFacts = (m) => (m === MID ? { kind: 'translation', context_window: null, paid_only: false } : null);

test('translation: m2m100\'s shape, codes only, and its units both ways', async () => {
  // Mutations checked: source_lang sent when absent; a language name accepted.
  shapes.setModelFactsSource(translationFacts);
  const ai = makeAI(() => ({ translated_text: 'Qui paie aujourd\'hui ?' }));
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, text: 'Who pays today?', translate: { targetLang: 'fr' } });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'Qui paie aujourd\'hui ?');
  assert.deepEqual(ai.calls[0].payload, { text: 'Who pays today?', target_lang: 'fr' });
  assert.deepEqual(r.units, { tokens_in: Math.ceil(15 / 4), tokens_out: Math.ceil('Qui paie aujourd\'hui ?'.length / 4) });
  assert.deepEqual(shapes.translateRequest('x', { sourceLang: 'en', targetLang: 'pt-BR' }), { text: 'x', source_lang: 'en', target_lang: 'pt-BR' });
  for (const t of [{ targetLang: 'french' }, { targetLang: 'fr', sourceLang: 'english' }, {}]) {
    const bad = await run(envWith(makeAI(() => ok())), { task: 'paraphrase', userId: 0, text: 'x', translate: t });
    assert.equal(bad.refusal, 'invalid_input', JSON.stringify(t));
  }
  shapes.setModelFactsSource(null);
  assert.equal(shapes.factsFor(M2M).kind, 'translation', 'the interim table, until D760');
});

// ─────────────────────────────────────────────────────────── PR 2: the cache key

test('images, a rerank and a translation are part of the cache key', async () => {
  // Mutation checked: the extra seed dropped (the second image is answered from the first one's cache).
  shapes.setModelFactsSource(visionFacts);
  const env = envWith(makeAI((m, p, n) => ok(`answer ${n}`)));
  const a = await run(env, { task: 'sentiment', userId: 0, messages: ask, images: [PNG] });
  const b = await run(env, { task: 'sentiment', userId: 0, messages: ask, images: [JPEG] });
  const again = await run(env, { task: 'sentiment', userId: 0, messages: ask, images: [PNG] });
  assert.equal(a.output, 'answer 1');
  assert.equal(b.output, 'answer 2', 'another image is another question');
  assert.equal(again.usage.cached, true, 'the same image is a cache hit');
  assert.equal(again.output, 'answer 1');
});

// ─────────────────────────────────────────────────────────── PR 2: rail embeddings and axal-search

test('rail embeddings: every catalogue embedding model takes { text } and returns data[0]; none is ever written to axal-search', async () => {
  // Mutations checked: searchIndexAccepts ignoring the model; upsertEntity skipping the check.
  for (const m of ['@cf/baai/bge-m3', '@cf/qwen/qwen3-embedding-0.6b', '@cf/google/embeddinggemma-300m', '@cf/pfnet/plamo-embedding-1b', '@cf/baai/bge-large-en-v1.5']) {
    assert.equal(shapes.factsFor(m).kind, 'embedding', m);
    assert.equal(shapes.searchIndexAccepts(m, new Array(768).fill(0.1)), false, `${m} never writes the index, even at 768 dimensions`);
  }
  assert.equal(shapes.searchIndexAccepts(shapes.SEARCH_INDEX_MODEL, new Array(768).fill(0.1)), true);
  assert.equal(shapes.searchIndexAccepts(shapes.SEARCH_INDEX_MODEL, new Array(1024).fill(0.1)), false);
  assert.equal(ROUTE.embed.model, shapes.SEARCH_INDEX_MODEL, 'the system embed task is the index\'s model');

  // The one writer of axal-search embeds with that model and nothing else.
  const upserts = [];
  const seen = [];
  const env = {
    AI: { async run(model, payload) { seen.push(model); return { data: [new Array(768).fill(0.2)] }; } },
    VECTORIZE: { async upsert(v) { upserts.push(v); } },
  };
  assert.equal(await upsertEntity(env, { type: 'project', id: 1, text: 'A venture.', title: 'V', url: '/v' }), true);
  assert.deepEqual(seen, [shapes.SEARCH_INDEX_MODEL]);
  assert.equal(upserts.length, 1);
  const wrongDims = { ...env, AI: { async run() { return { data: [new Array(1024).fill(0.2)] }; } } };
  assert.equal(await upsertEntity(wrongDims, { type: 'project', id: 2, text: 'B', title: 'B', url: '/b' }), false);
  assert.equal(upserts.length, 1, 'nothing else was written');
  const writers = readFileSync('cloudflare-worker/src/services/vectorize.ts', 'utf8');
  assert.match(writers, /if \(!vector \|\| !searchIndexAccepts\(EMBED_MODEL, vector\)\) return false;/);
  assert.match(writers, /const EMBED_MODEL = SEARCH_INDEX_MODEL;/);
});

// ─────────────────────────────────────────────────────────── PR 3: speech and voice

const MELO = '@cf/myshell-ai/melotts';
const AURA1 = '@cf/deepgram/aura-1';
const AURA2 = '@cf/deepgram/aura-2-en';
const MP3 = new Uint8Array(9_000).fill(7); MP3.set([0x49, 0x44, 0x33]);
// 500,000 bytes is three minutes at the assumed 32 kbps (`audioMinutesFromBytes`).
const MELO_MP3 = new Uint8Array(500_000).fill(7); MELO_MP3.set([0x49, 0x44, 0x33]);
const melo = () => ({ audio: Buffer.from(MELO_MP3).toString('base64') });
const byteStream = (bytes, chunk = 4_096) => new ReadableStream({
  start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); },
});
/** D760's catalogue, as it will answer once it offers the partner voices. */
const offered = (m) => (shapes.PARTNER_MODELS.has(m) ? { kind: 'voice', context_window: null, paid_only: false, partner: true, offered: true }
  : m === MELO ? { kind: 'voice', context_window: null, paid_only: false } : null);
/** Route `paraphrase` to voices for one test. */
function voiceRoute(t, model, fallbackChain, extra = {}) {
  const saved = ROUTE.paraphrase;
  ROUTE.paraphrase = { ...saved, model, fallbackChain, ...extra };
  t.after(() => { ROUTE.paraphrase = saved; });
}

test('voice: MeloTTS takes { prompt, lang } and returns base64 audio, counted in minutes from its bytes', async (t) => {
  // Mutations checked: MeloTTS sent Aura's shape; its minutes taken from the text; the audio dropped from the result.
  voiceRoute(t, MELO, []);
  const ai = makeAI(() => melo());
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, text: 'Bonjour à tous.', speak: { lang: 'fr' } });
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls[0].payload, { prompt: 'Bonjour à tous.', lang: 'fr' });
  assert.equal(r.audio.mime, 'audio/mpeg');
  assert.ok(Buffer.from(r.audio.bytes).equals(Buffer.from(MELO_MP3)));
  assert.deepEqual(r.units, { audio_minutes: 3 }, 'from the 500,000 bytes, not the 15 characters');
  assert.equal(r.output, '');
  assert.equal(shapes.factsFor(MELO).kind, 'voice', 'the interim table, until D760');
  assert.equal(shapes.factsFor(MELO).partner, undefined, 'MeloTTS is not a partner model');
});

test('voice: an offered Aura takes { text, encoding, speaker } and streams audio, counted in characters', async (t) => {
  // Mutations checked: the speaker dropped; Aura's units in minutes; the stream read as empty.
  shapes.setModelFactsSource(offered);
  voiceRoute(t, AURA2, []);
  const ai = makeAI(() => byteStream(MP3));
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, text: 'Who pays today?', speak: { voice: 'luna' } });
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls[0].payload, { text: 'Who pays today?', encoding: 'mp3', speaker: 'luna' });
  assert.equal(r.audio.bytes.byteLength, MP3.byteLength);
  assert.deepEqual(r.units, { characters: 15 });
  assert.deepEqual(shapes.speakRequest(AURA1, 'x', {}), { text: 'x', encoding: 'mp3' }, 'no speaker: the model\'s default');
});

test('voice: a partner model is skipped uncalled until offered; a voice a model lacks moves down the chain', async (t) => {
  // Mutations checked: canServe ignoring `offered`; a missing speaker sent anyway; MeloTTS speaking a named voice.
  voiceRoute(t, AURA2, [MELO]);
  const ai = makeAI(() => melo());
  const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, text: 'Hello.', speak: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(ai.calls.map((c) => c.model), [MELO]);
  assert.deepEqual(r.attempts.map((a) => [a.model, a.called, a.status]), [[AURA2, false, 422], [MELO, true, undefined]]);
  assert.equal(shapes.factsFor(AURA2).offered, false, 'nothing offers a partner model before D760');

  shapes.setModelFactsSource(offered);
  const lacks = makeAI(() => byteStream(MP3));
  const r2 = await run(envWith(lacks), { task: 'paraphrase', userId: 0, text: 'Hello.', speak: { voice: 'sirio' } });
  assert.equal(r2.refusal, 'all_models_failed', 'aura-2-en has no "sirio", and MeloTTS names no speaker');
  assert.equal(lacks.calls.length, 0);
  assert.deepEqual(r2.attempts.map((a) => a.status), [400, 400]);
  assert.equal(shapes.speakRequest('@cf/deepgram/aura-2-es', 'Hola', { voice: 'sirio' }).speaker, 'sirio');
});

test('voice: malformed options are refused before any call; a voice run is one ask, never streamed, never a transcription', async () => {
  // Mutations checked: the length cap dropped; a voice with a translation accepted; a streamed voice accepted.
  const cases = [
    { text: '', speak: {} },
    { text: 'x'.repeat(shapes.MAX_SPEAK_CHARS + 1), speak: {} },
    { text: 'Hi', speak: { voice: 'Luna!' } },
    { text: 'Hi', speak: { lang: 'french' } },
    { text: 'Hi', speak: {}, translate: { targetLang: 'fr' } },
    { text: 'Hi', speak: {}, stream: true },
  ];
  for (const c of cases) {
    const ai = makeAI(() => melo());
    const r = await run(envWith(ai), { task: 'paraphrase', userId: 0, ...c });
    assert.equal(r.refusal, 'invalid_input', JSON.stringify({ ...c, text: c.text.length }));
    assert.equal(ai.calls.length, 0);
  }
  const stt = await run(envWith(makeAI(() => melo())), { task: 'transcribe', userId: 0, text: 'Hi', speak: {} });
  assert.equal(stt.refusal, 'invalid_input');
  assert.equal(shapes.speakRefusal({}, 'x'.repeat(shapes.MAX_SPEAK_CHARS)), null, 'the cap itself is allowed');
});

test('voice: priced per 1k characters (Aura) or per minute returned (MeloTTS); a member is held and charged on those units', async (t) => {
  // Mutations checked: the character price ignored; the quote without the voice's units; the charge from the token table.
  assert.equal(estimateCostUsd(AURA1, 0, 0, 0, 1_000), 0.015);
  assert.equal(estimateCostUsd(AURA2, 0, 0, 0, 2_000), 0.06);
  assert.equal(estimateCostUsd(MELO, 0, 0, 2), 0.0004);

  shapes.setModelFactsSource(offered);
  voiceRoute(t, AURA2, []);
  const env = envWith(makeAI(() => byteStream(MP3)));
  const text = 'a'.repeat(1_000);
  const r = await run(env, { task: 'paraphrase', userId: 42, text, speak: {} });
  assert.equal(r.ok, true);
  const row = env.DB._rows.find((x) => x.guard_for == null);
  assert.equal(row.model, AURA2);
  assert.equal(row.charged_microusd, 30_000, '1,000 characters at $0.030 per 1k');
  assert.deepEqual(JSON.parse(row.units_json), { characters: 1_000, tokens_in: 0, tokens_out: 0 });

  voiceRoute(t, MELO, []);
  const { DB, db } = aiBudgetFixture();
  const env2 = { ...envWith(makeAI(() => melo())), DB };
  const r2 = await run(env2, { task: 'paraphrase', userId: 42, text: 'Hello.', speak: {} });
  assert.equal(r2.ok, true);
  assert.equal(DB._rows.find((x) => x.guard_for == null).charged_microusd, 600, 'three minutes at $0.0002');
  const held = db.prepare('SELECT included_microusd + topup_microusd AS held FROM ai_budget_reservations WHERE user_id = 42').get().held;
  assert.ok(held >= 44 * 200, `held ${held}: the most audio readSpeech accepts, 44 minutes, before the guard's share`);
});

test('voice: the audio is never cached; a live stream reports WebSocket minutes', async (t) => {
  // Mutations checked: cacheKeyFor keying a voice run; settleStream returning no units.
  voiceRoute(t, MELO, [], { cacheTtlSec: 3_600 });
  const ai = makeAI(() => melo());
  const env = envWith(ai);
  const a = await run(env, { task: 'paraphrase', userId: 0, text: 'Same words.', speak: {} });
  const b = await run(env, { task: 'paraphrase', userId: 0, text: 'Same words.', speak: {} });
  assert.equal(ai.calls.length, 2);
  assert.equal(b.usage.cached, false);
  assert.ok(a.audio && b.audio);
  assert.deepEqual(shapes.websocketUnits(2.5), { audio_minutes_websocket: 2.5 });
  assert.deepEqual(shapes.websocketUnits(Number.NaN), { audio_minutes_websocket: 0 });
  const live = readFileSync('cloudflare-worker/src/services/liveTranscription.ts', 'utf8');
  assert.match(live, /return \{ minutes, cost_microusd: charged, units: websocketUnits\(minutes\) \};/);
});

test('readSpeech: base64 flat or under result, bytes, a buffer or a stream; WAV is told apart; too large is none', async () => {
  // Mutations checked: the size cap dropped from the stream; `result.audio` not read; WAV labelled MP3.
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
  assert.equal((await shapes.readSpeech({ result: { audio: Buffer.from(wav).toString('base64') } })).mime, 'audio/wav');
  assert.equal((await shapes.readSpeech(wav.buffer)).bytes.byteLength, 7);
  assert.equal((await shapes.readSpeech(MP3)).mime, 'audio/mpeg');
  let cancelled = false;
  const huge = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  assert.equal(await shapes.readSpeech(huge), null);
  assert.equal(cancelled, true, 'the stream is cancelled at the cap');
  for (const none of [null, {}, { audio: '' }, new Uint8Array(0), 'text']) assert.equal(await shapes.readSpeech(none), null);
});
