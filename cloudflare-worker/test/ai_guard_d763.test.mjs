/**
 * D763 (#2020) — Llama Guard 3 8B checks every run's input and output in full.
 *
 * Part 1: the guard's rules as plain code (services/ai/guard.ts): slicing, the
 * verdict parser, the category policy and the refusal copy.
 * Part 2: the hooks in `run()` on a stubbed `env.AI` and the real budget
 * tables: the input and output checks, the streamed release one checked slice
 * at a time, failing closed, one hold, `guard_for`, the routes, the counters.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_guard_d763.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUARD_CATALOGUE, GUARD_CATEGORIES, GUARD_COPY, GUARD_SLICE_CHARS, WELLBEING_PATH, combine, decide, parseVerdict, refusalFor, sliceForGuard,
} from '../src/services/ai/guard.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { usdToMicro } from '../src/services/aiBudget.ts';
import { run, __resetForTest, estimateCostUsd, guardQuoteMicro, loadGuardrailCounters } from '../src/services/aiRouter.ts';
import { classifyInput } from '../src/services/advisor/guardrails.ts';

const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------

test('a text at or under the limit is one slice; an empty text has none', () => {
  assert.deepEqual(sliceForGuard(''), []);
  assert.deepEqual(sliceForGuard('hello'), ['hello']);
  const exact = 'x'.repeat(GUARD_SLICE_CHARS);
  assert.deepEqual(sliceForGuard(exact), [exact]);
  assert.equal(GUARD_SLICE_CHARS, 2000);
});

test('no slice is over 2,000 characters, and the slices join back to the text exactly', () => {
  const texts = [
    'y'.repeat(5000),
    words(1500),
    `${words(300)}.\n\n${words(300)}! ${words(300)}?\n\n\n${words(500)}`,
    Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${words(20)}.`).join('\n\n'),
    `${'é'.repeat(2500)}\n\n${'漢'.repeat(2500)}`,
  ];
  for (const t of texts) {
    const slices = sliceForGuard(t);
    assert.equal(slices.join(''), t);
    for (const s of slices) {
      assert.ok(s.length > 0, 'no empty slice');
      assert.ok(s.length <= GUARD_SLICE_CHARS, `a slice of ${s.length}`);
    }
  }
  assert.equal(sliceForGuard('y'.repeat(5000)).length, 3, 'a 5,000-character text is three slices');
});

test('a slice ends at the last paragraph break inside it, before any sentence end', () => {
  const first = `${'a'.repeat(1200)}. More here.\n\n`;
  const text = `${first}${'b'.repeat(500)}. ${'c'.repeat(900)}`;
  const slices = sliceForGuard(text);
  assert.equal(slices[0], first, 'cut after the blank line');
  assert.equal(slices.join(''), text);
});

test('with no paragraph break, a slice ends after the last sentence end inside it', () => {
  const head = `${'a'.repeat(900)}. ${'b'.repeat(700)}? `;
  const text = `${head}${'c'.repeat(1500)}`;
  const slices = sliceForGuard(text);
  assert.equal(slices[0], head);
  assert.equal(slices[1], 'c'.repeat(1500));
});

test('with neither, a slice is cut at the limit', () => {
  const slices = sliceForGuard('z'.repeat(4100));
  assert.deepEqual(slices.map((s) => s.length), [2000, 2000, 100]);
});

test('a decimal point or a full stop with no space after it is not a sentence end', () => {
  const text = `${'a'.repeat(1000)} 3.14 e.g.x ${'b'.repeat(1500)}`;
  assert.deepEqual(sliceForGuard(text).map((s) => s.length), [2000, text.length - 2000]);
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

test('safe and unsafe are read, with the codes in order and once each', () => {
  assert.deepEqual(parseVerdict('safe'), { verdict: 'safe' });
  assert.deepEqual(parseVerdict('  Safe \n'), { verdict: 'safe' });
  assert.deepEqual(parseVerdict('unsafe\nS1'), { verdict: 'unsafe', codes: ['S1'] });
  assert.deepEqual(parseVerdict('unsafe\nS10,S2, s10'), { verdict: 'unsafe', codes: ['S10', 'S2'] });
  assert.deepEqual(parseVerdict('UNSAFE\r\nS6'), { verdict: 'unsafe', codes: ['S6'] });
  assert.deepEqual(parseVerdict('unsafe'), { verdict: 'unsafe', codes: [] });
  assert.deepEqual(parseVerdict('unsafe\nS99'), { verdict: 'unsafe', codes: [] }, 'an unknown code is dropped');
});

test('anything else is unreadable, and unreadable is never safe', () => {
  for (const out of [undefined, null, 42, {}, '', '   ', 'yes', 'safe enough', 'The content is safe.', 'safe\nS1', 'S1', 'unsafe\nS1\nmore', 'unsafe S1']) {
    const v = parseVerdict(out);
    assert.deepEqual(v, { verdict: 'unreadable' }, JSON.stringify(out));
    assert.deepEqual(decide(v), { action: 'fail' });
  }
});

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

test('S6 and S7 log; every other code blocks', () => {
  const codes = Object.keys(GUARD_CATEGORIES);
  assert.deepEqual(codes, Array.from({ length: 14 }, (_, i) => `S${i + 1}`));
  for (const c of codes) {
    const d = decide({ verdict: 'unsafe', codes: [c] });
    assert.equal(d.action, c === 'S6' || c === 'S7' ? 'log' : 'block', c);
    assert.deepEqual(d.codes, [c]);
  }
  assert.deepEqual(decide({ verdict: 'unsafe', codes: ['S6', 'S7'] }), { action: 'log', codes: ['S6', 'S7'] });
  assert.deepEqual(decide({ verdict: 'unsafe', codes: ['S6', 'S1'] }), { action: 'block', codes: ['S6', 'S1'] });
  assert.deepEqual(decide({ verdict: 'unsafe', codes: [] }), { action: 'block', codes: [] }, 'unsafe with no code we know blocks');
  assert.deepEqual(decide({ verdict: 'safe' }), { action: 'pass' });
});

test('slices combine: a failure fails, else a block blocks, else a log logs', () => {
  const pass = { action: 'pass' }, fail = { action: 'fail' };
  const log = (c) => ({ action: 'log', codes: [c] }), block = (c) => ({ action: 'block', codes: [c] });
  assert.deepEqual(combine([]), pass);
  assert.deepEqual(combine([pass, pass]), pass);
  assert.deepEqual(combine([pass, log('S6'), log('S7'), log('S6')]), { action: 'log', codes: ['S6', 'S7'] });
  assert.deepEqual(combine([log('S6'), block('S1'), block('S10'), block('S1')]), { action: 'block', codes: ['S1', 'S10'] });
  assert.deepEqual(combine([block('S1'), fail, pass]), fail);
});

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

test("each refusal has Eadwyn's words and names no category", () => {
  assert.deepEqual(refusalFor('input', ['S1'], 'founder'), { message: GUARD_COPY.input, link: null });
  assert.deepEqual(refusalFor('output', ['S10'], 'admin'), { message: GUARD_COPY.output, link: null });
  assert.deepEqual(refusalFor('unavailable', [], 'founder'), { message: GUARD_COPY.unavailable, link: null });
  for (const message of Object.values(GUARD_COPY)) {
    assert.doesNotMatch(message, /\bS\d{1,2}\b/, 'no code in the copy');
    for (const { name } of Object.values(GUARD_CATEGORIES)) assert.equal(message.toLowerCase().includes(name.toLowerCase()), false, name);
  }
});

test('S11 has its own words; the Wellbeing link is drawn for a founder and an admin only', () => {
  for (const role of ['founder', 'admin', 'Founder']) {
    assert.deepEqual(refusalFor('input', ['S11'], role), { message: GUARD_COPY.selfHarm, link: { href: WELLBEING_PATH, label: 'Open Wellbeing' } }, role);
  }
  assert.equal(WELLBEING_PATH, '/wellbeing');
  for (const role of ['investor', 'partner', 'advisor', '', null, undefined]) {
    assert.deepEqual(refusalFor('output', ['S1', 'S11'], role), { message: GUARD_COPY.selfHarm, link: null }, String(role));
  }
  assert.deepEqual(refusalFor('unavailable', ['S11'], 'founder'), { message: GUARD_COPY.unavailable, link: null },
    'a guard that could not answer says so, whatever an earlier slice said');
});

// ===========================================================================
// Part 2: the guard inside `run()`
// ===========================================================================

const GUARD = '@cf/meta/llama-guard-3-8b';
const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GUARD_USAGE = { prompt_tokens: 50, completion_tokens: 2 };
const MODEL_USAGE = { prompt_tokens: 100, completion_tokens: 20 };
const guardMicro = (calls) => calls * usdToMicro(estimateCostUsd(GUARD, GUARD_USAGE.prompt_tokens, GUARD_USAGE.completion_tokens));
const modelMicro = usdToMicro(estimateCostUsd(MID, MODEL_USAGE.prompt_tokens, MODEL_USAGE.completion_tokens));

/**
 * A member (user 2) with an allowance of 0 and a funded top-up balance, and a
 * Workers AI stub that answers the guard with `verdict(content, role)` and the
 * model with `answer(model, input)`. `verdict` may throw.
 */
function world({ verdict = () => 'safe', answer = () => ({ response: 'An answer.', usage: MODEL_USAGE }), funded = true } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  setFixtureAllowance(f.db, 0); // D783: no plan, and no tokens
  if (funded) f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000) ON CONFLICT(user_id) DO UPDATE SET balance_microusd=excluded.balance_microusd').run();
  const calls = { guard: [], model: [] };
  const AI = {
    async run(model, input) {
      if (model === GUARD) {
        const last = input.messages.at(-1);
        calls.guard.push({ role: last.role, content: last.content });
        return { response: verdict(last.content, last.role), usage: GUARD_USAGE };
      }
      calls.model.push({ model, input });
      return answer(model, input);
    },
  };
  return { ...f, calls, env: { DB: f.DB, ENVIRONMENT: 'development', AI } };
}
const rows = (db) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all().map((r) => ({ ...r }));
const holds = (db) => db.prepare('SELECT * FROM ai_budget_reservations ORDER BY created_at, uid').all().map((r) => ({ ...r }));
const settledAt = (h) => h.actual_included_microusd + h.actual_topup_microusd;
const unsafeIf = (word, code = 'S1') => (content) => (content.includes(word) ? `unsafe\n${code}` : 'safe');

test('every member run is checked on its input and its output, in full: 5,000 characters are three guard calls each', async () => {
  const input = 'x'.repeat(5000);
  const output = 'y'.repeat(5000);
  const f = world({ answer: () => ({ response: output, usage: MODEL_USAGE }) });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, messages: [{ role: 'user', content: input }] });
    assert.equal(r.ok, true);
    assert.equal(r.output, output);
    assert.deepEqual(f.calls.guard.map((c) => c.role), ['user', 'user', 'user', 'assistant', 'assistant', 'assistant']);
    assert.equal(f.calls.guard.slice(0, 3).map((c) => c.content).join(''), input, 'the input was not checked in full');
    assert.equal(f.calls.guard.slice(3).map((c) => c.content).join(''), output, 'the output was not checked in full');
    assert.ok(f.calls.guard.every((c) => c.content.length <= GUARD_SLICE_CHARS));
    assert.deepEqual(r.guard, { input: 'pass', output: 'pass', codes: [], calls: 6 });
  } finally { f.db.close(); }
});

test('the caller names the member\'s own text; the system prompt and gathered rows are not checked again', async () => {
  const f = world();
  try {
    await run(f.env, {
      task: 'advisor_turn', userId: 2, systemPrompt: 'Connector rows: Acme MRR 40k',
      messages: [{ role: 'user', content: 'earlier turn' }, { role: 'user', content: 'What is MRR?' }], guardText: 'What is MRR?',
    });
    assert.deepEqual(f.calls.guard.filter((c) => c.role === 'user').map((c) => c.content), ['What is MRR?']);
    f.calls.guard.length = 0;
    await run(f.env, { task: 'advisor_turn', userId: 2, systemPrompt: 'Ours.', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
    assert.deepEqual(f.calls.guard.filter((c) => c.role === 'user').map((c) => c.content), ['a\n\nb\n\nc'], 'absent guardText checks every message but the system prompt');
    f.calls.guard.length = 0;
    await run(f.env, { task: 'advisor_turn', userId: 2, messages: [{ role: 'system', content: 'Ours, with rows.' }, { role: 'user', content: 'd' }] });
    assert.deepEqual(f.calls.guard.filter((c) => c.role === 'user').map((c) => c.content), ['d'], 'a system message was checked as the member\'s');
  } finally { f.db.close(); }
});

test('the budget refusal comes before guard_unavailable, and nothing is called', async () => {
  const f = world({ funded: false, verdict: () => { throw new Error('guard down'); } });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.match(r.refusal, /^budget_user_/);
    assert.deepEqual([f.calls.guard.length, f.calls.model.length], [0, 0]);
  } finally { f.db.close(); }
});

test('fails closed: an unreachable guard runs nothing, releases the hold and charges nothing', async () => {
  const f = world({ verdict: () => { throw new Error('guard down'); } });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', role: 'founder' });
    assert.equal(r.ok, false);
    assert.equal(r.refusal, 'guard_unavailable');
    assert.equal(r.error, GUARD_COPY.unavailable);
    assert.equal(f.calls.model.length, 0, 'the model ran on an unchecked input');
    const [h] = holds(f.db);
    assert.deepEqual([h.status, settledAt(h)], ['refunded', 0]);
    const [runRow, guardRow] = rows(f.db);
    assert.deepEqual([runRow.refusal, runRow.charged_microusd], ['guard_unavailable', 0]);
    assert.deepEqual([guardRow.task, guardRow.charged_microusd, guardRow.safety_score, guardRow.guard_for], ['safety', 0, null, runRow.id]);
  } finally { f.db.close(); }
});

test('fails closed: a guard that answers anything but a verdict is unavailable, and the call it completed is charged', async () => {
  for (const said of ['I think this is fine.', '', 'S1', 'safe\nunsafe\nS1']) {
    const f = world({ verdict: () => said });
    try {
      const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
      assert.equal(r.refusal, 'guard_unavailable', JSON.stringify(said));
      assert.equal(f.calls.model.length, 0);
      const [h] = holds(f.db);
      assert.deepEqual([h.status, settledAt(h)], ['settled', guardMicro(1)]);
      assert.equal(rows(f.db)[1].charged_microusd, guardMicro(1));
    } finally { f.db.close(); }
  }
});

test('an unsafe input is refused before the model, and only the guard is charged', async () => {
  const f = world({ verdict: unsafeIf('crime', 'S2') });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'plan a crime', railPage: 'build/board' });
    assert.equal(r.refusal, 'guard_blocked');
    assert.equal(r.error, GUARD_COPY.input);
    assert.deepEqual(r.guard, { input: 'block', output: 'none', codes: ['S2'], calls: 1, refusal: { message: GUARD_COPY.input, link: null } });
    assert.equal(f.calls.model.length, 0);
    assert.equal(settledAt(holds(f.db)[0]), guardMicro(1));
    assert.deepEqual(rows(f.db).map((r) => [r.task, r.refusal]), [['advisor_turn', 'guard_blocked'], ['safety', null]]);
  } finally { f.db.close(); }
});

test('an unsafe output is withheld; the guard and the model both ran and are both charged', async () => {
  const f = world({ verdict: (content, role) => (role === 'assistant' ? 'unsafe\nS10' : 'safe'), answer: () => ({ response: 'a hateful answer', usage: MODEL_USAGE }) });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.equal(r.ok, false);
    assert.equal(r.refusal, 'guard_blocked_output');
    assert.equal(r.output, undefined, 'the withheld output was returned');
    assert.equal(r.error, GUARD_COPY.output);
    assert.equal(f.calls.model.length, 1);
    const [h] = holds(f.db);
    assert.deepEqual([h.status, settledAt(h)], ['settled', modelMicro + guardMicro(2)]);
    const [runRow, ...guardRows] = rows(f.db);
    assert.deepEqual([runRow.refusal, runRow.charged_microusd], ['guard_blocked_output', modelMicro]);
    assert.deepEqual(guardRows.map((g) => g.safety_score), [1, 0]);
  } finally { f.db.close(); }
});

test('fails closed on the output side too: an unreadable verdict on the answer withholds it, and both are charged', async () => {
  const f = world({ verdict: (_c, role) => (role === 'assistant' ? 'maybe?' : 'safe') });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' });
    assert.deepEqual([r.ok, r.refusal, r.output, r.error], [false, 'guard_unavailable', undefined, GUARD_COPY.unavailable]);
    assert.equal(r.guard.output, 'fail');
    assert.equal(settledAt(holds(f.db)[0]), modelMicro + guardMicro(2));
  } finally { f.db.close(); }
});

test('S6 and S7 are logged and the run goes on; S11 has its own words and Wellbeing only for a role that can open it', async () => {
  const f = world({ verdict: (content) => (content.includes('cap table') ? 'unsafe\nS6,S7' : content.includes('hurt') ? 'unsafe\nS11' : 'safe') });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'draft my cap table' });
    assert.equal(r.ok, true);
    assert.deepEqual([r.guard.input, r.guard.codes], ['log', ['S6', 'S7']]);
    const founder = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'I want to hurt myself', role: 'founder' });
    assert.deepEqual([founder.refusal, founder.error, founder.guard.refusal.link], ['guard_blocked', GUARD_COPY.selfHarm, { href: '/wellbeing', label: 'Open Wellbeing' }]);
    const investor = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'I want to hurt myself', role: 'investor' });
    assert.deepEqual([investor.error, investor.guard.refusal.link], [GUARD_COPY.selfHarm, null]);
  } finally { f.db.close(); }
});

test('the guard takes no hold of its own: one hold per run, quoted for the guard too, settled at the model and every guard call', async () => {
  const input = 'z'.repeat(4500);
  const f = world();
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: input, maxTokens: 300 });
    assert.equal(r.ok, true);
    const all = holds(f.db);
    assert.equal(all.length, 1, 'the guard took a hold of its own');
    const [h] = all;
    assert.equal(settledAt(h), modelMicro + guardMicro(r.guard.calls));
    const held = h.included_microusd + h.topup_microusd;
    assert.ok(held >= settledAt(h));
    // The quote is D762's for the model (the dearer of the chain, on a bounded
    // prompt and the run's maximum output) plus the guard on every input slice
    // and the most output slices that output allows.
    const promptBound = input.length + 4096 + 64;
    const modelQuote = Math.max(estimateCostUsd(MID, promptBound, 300), estimateCostUsd('@cf/meta/llama-3.1-8b-instruct-fp8', promptBound, 300));
    const guardShare = guardQuoteMicro(input, 300 * 8);
    assert.ok(guardShare > 0);
    assert.equal(held, usdToMicro(modelQuote) + guardShare, 'the hold was not quoted for the guard');
    assert.ok(guardQuoteMicro(input, 0) >= usdToMicro(estimateCostUsd(GUARD, input.length + 3 * 1024, 3 * 64)), 'three input slices at their bound');
    assert.equal(guardQuoteMicro('', 0), 0);
    const rowsNow = rows(f.db);
    assert.deepEqual(new Set(rowsNow.map((x) => x.reservation_uid)), new Set([h.uid]), 'a guard row named another hold');
  } finally { f.db.close(); }
});

test('each guard row names its run in guard_for, on the same page and option', async () => {
  const f = world();
  try {
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', railPage: 'validate/customer-research', railOption: 'draft', surface: '/validate' });
    const [runRow, ...guardRows] = rows(f.db);
    assert.equal(runRow.guard_for, null);
    assert.equal(guardRows.length, 2);
    for (const g of guardRows) {
      assert.deepEqual([g.task, g.model, g.guard_for, g.rail_page, g.rail_option, g.surface, g.user_id],
        ['safety', GUARD, runRow.id, 'validate/customer-research', 'draft', '/validate', 2]);
    }
  } finally { f.db.close(); }
});

// ---- streaming ------------------------------------------------------------

const enc = new TextEncoder();
const sse = (chunks) => {
  let i = 0;
  return new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); } });
};
const deltas = (text, size = 300) => {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(`data: ${JSON.stringify({ response: text.slice(i, i + size) })}\n\n`);
  return out;
};
const events = (raw) => raw.split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, '')).map((d) => (d === '[DONE]' ? d : JSON.parse(d)));

test('no unchecked text is streamed: a stream whose second slice is unsafe releases the first slice only', async () => {
  const first = 'A safe sentence. '.repeat(117);
  const second = 'Then BAD things follow. '.repeat(40);
  const f = world({
    verdict: unsafeIf('BAD', 'S1'),
    answer: (_m, input) => (input.stream ? sse([...deltas(first + second), 'data: [DONE]\n\n']) : { response: 'x' }),
  });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'tell me', stream: true });
    assert.equal(r.ok, true);
    const reader = r.stream.getReader();
    const firstRead = await reader.read();
    const firstEvent = events(new TextDecoder().decode(firstRead.value))[0];
    // The slice was checked before it was released.
    assert.ok(f.calls.guard.some((c) => c.role === 'assistant' && c.content === firstEvent.response), 'a slice was released before its verdict');
    let rest = '';
    for (;;) { const n = await reader.read(); if (n.done) break; rest += new TextDecoder().decode(n.value); }
    const all = [firstEvent, ...events(rest)];
    const released = all.filter((e) => typeof e === 'object' && 'response' in e).map((e) => e.response).join('');
    assert.equal(released.includes('BAD'), false, 'unchecked or unsafe text reached the reader');
    assert.ok(first.startsWith(released) && released.length > 0);
    assert.deepEqual(all.slice(-2), [{ refusal: 'guard_blocked_output', message: GUARD_COPY.output, link: null }, '[DONE]']);
    const runRows = rows(f.db).filter((x) => x.guard_for === null);
    assert.deepEqual(runRows.map((x) => x.refusal), ['guard_blocked_output'], 'settled once, as withheld');
    const [h] = holds(f.db);
    assert.equal(h.status, 'settled');
    assert.ok(rows(f.db).filter((x) => x.guard_for === runRows[0].id).length >= 2);
  } finally { f.db.close(); }
});

test('a safe stream is released in full, slice by slice, then [DONE]', async () => {
  const text = 'One clean sentence here. '.repeat(200);
  const f = world({ answer: (_m, input) => (input.stream ? sse([...deltas(text), 'data: [DONE]\n\n']) : { response: 'x' }) });
  try {
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'tell me', stream: true });
    const all = events(await new Response(r.stream).text());
    assert.equal(all.at(-1), '[DONE]');
    const released = all.slice(0, -1).map((e) => e.response);
    assert.equal(released.join(''), text);
    assert.ok(released.length >= 3 && released.every((s) => s.length <= GUARD_SLICE_CHARS));
    assert.deepEqual(rows(f.db).filter((x) => x.guard_for === null).map((x) => x.refusal), [null]);
  } finally { f.db.close(); }
});

// ---- what the guard skips, and what it marks --------------------------------

test('skipped: the guard\'s own run and a system embedding; a member embedding is checked on its input', async () => {
  const f = world({ answer: (m) => (m.includes('bge') ? { data: [[0.1, 0.2]], usage: { prompt_tokens: 3 } } : { response: 'safe' }) });
  try {
    await run(f.env, { task: 'safety', userId: 2, text: 'check me' });
    assert.equal(f.calls.guard.length, 1, 'the guard\'s own run was checked by the guard');
    f.calls.guard.length = 0;
    await run(f.env, { task: 'embed', userId: 0, text: 'system text' });
    assert.equal(f.calls.guard.length, 0);
    const member = await run(f.env, { task: 'embed', userId: 2, text: 'my text' });
    assert.equal(member.ok, true);
    assert.deepEqual(f.calls.guard.map((c) => [c.role, c.content]), [['user', 'my text']], 'an embedding has no text output to check');
  } finally { f.db.close(); }
});

test('the member\'s own material is marked, logged and kept: a transcript the guard calls unsafe is still returned', async () => {
  const f = world({ verdict: (_c, role) => (role === 'assistant' ? 'unsafe\nS1' : 'safe'), answer: (m) => (m.includes('whisper') ? { text: 'what the founder said', transcription_info: { language: 'en' } } : { response: 'extracted text', usage: MODEL_USAGE }) });
  try {
    const r = await run(f.env, { task: 'transcribe', userId: 2, audio: new Uint8Array([1, 2, 3]), audioMinutes: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.output, 'what the founder said');
    assert.deepEqual([r.guard.input, r.guard.output, r.guard.codes], ['none', 'marked', ['S1']]);
    assert.equal(rows(f.db).find((x) => x.guard_for !== null).safety_score, 0, 'the verdict was not logged');
    const text = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'extracted', guardOutput: 'mark' });
    assert.deepEqual([text.ok, text.guard.output], [true, 'marked']);
  } finally { f.db.close(); }
});

test('a cached answer is still checked on its input first', async () => {
  const kv = new Map();
  const f = world({ verdict: unsafeIf('BAD') });
  f.env.AI_SPEND = { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, String(v)); } };
  try {
    const first = await run(f.env, { task: 'explain', userId: 2, text: 'what is churn', topic: 'churn' });
    assert.equal(first.ok, true);
    const again = await run(f.env, { task: 'explain', userId: 2, text: 'what is churn', topic: 'churn' });
    assert.deepEqual([again.ok, again.usage.cached, f.calls.model.length], [true, true, 1]);
    assert.equal(f.calls.guard.filter((c) => c.role === 'user').length, 2, 'the cached run skipped its input check');
    const bad = await run(f.env, { task: 'explain', userId: 2, text: 'BAD words', topic: 'churn' });
    assert.equal(bad.refusal, 'guard_blocked', 'a cached topic answered an unsafe input');
  } finally { f.db.close(); }
});

// ---- the counters and the catalogue ------------------------------------------

test('loadGuardrailCounters counts guard verdicts per page, and today\'s totals', async () => {
  const f = world({ verdict: unsafeIf('BAD') });
  try {
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'fine', railPage: 'build/board' });
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'BAD', railPage: 'build/board' });
    await run(f.env, { task: 'advisor_turn', userId: 2, text: 'fine', railPage: 'raise/pitch' });
    const c = await loadGuardrailCounters(f.env, 7);
    assert.equal(c.guard.available, true);
    const page = (p) => c.guard.by_page.find((x) => x.page === p);
    assert.deepEqual(page('build/board'), { page: 'build/board', checks: 3, safe: 2, unsafe: 1, unreadable: 0, blocked_input: 1, withheld_output: 0, unavailable: 0 });
    assert.deepEqual(page('raise/pitch'), { page: 'raise/pitch', checks: 2, safe: 2, unsafe: 0, unreadable: 0, blocked_input: 0, withheld_output: 0, unavailable: 0 });
    assert.deepEqual(c.guard.today, { checks: 5, safe: 4, unsafe: 1, unreadable: 0, blocked_input: 1, withheld_output: 0, unavailable: 0 });
    assert.equal(c.verdicts.available && c.verdicts.evaluated, 5, 'the guard rows are the verdicts HQ already counts');
  } finally { f.db.close(); }
});

test('the catalogue constant says the guard checks every run', () => {
  assert.deepEqual(GUARD_CATALOGUE, { every_run: true });
});

// ---- the four routes ----------------------------------------------------------

test('classifyInput, for the one route no model run follows, checks in full and fails closed', async () => {
  const f = world({ verdict: unsafeIf('BAD', 'S1') });
  try {
    assert.deepEqual(await classifyInput(f.env, 2, 'q'.repeat(5000), '/studio'), { blocked: false, unavailable: false, score: 1, category: 'safe' });
    assert.equal(f.calls.guard.length, 3, 'a 5,000-character answer is three checks');
    assert.deepEqual(await classifyInput(f.env, 2, `${'q'.repeat(4500)} BAD`, '/studio'), { blocked: true, unavailable: false, score: 0, category: 's1' });
  } finally { f.db.close(); }
  for (const verdict of [() => { throw new Error('down'); }, () => 'no idea']) {
    const g = world({ verdict });
    try {
      const r = await classifyInput(g.env, 2, 'hello', '/studio');
      assert.deepEqual([r.blocked, r.unavailable], [true, true], 'the guard failed open');
    } finally { g.db.close(); }
  }
  const spent = world({ funded: false });
  try {
    const r = await classifyInput(spent.env, 2, 'hello', '/studio');
    assert.deepEqual([r.blocked, r.unavailable], [true, true], 'a check that could not run let the text through');
    assert.match(r.category, /^budget_user_/, 'a spent budget is named, so /answer says so');
  } finally { spent.db.close(); }
  const h = world({ verdict: () => 'unsafe\nS6' });
  try {
    assert.deepEqual(await classifyInput(h.env, 2, 'my cap table', '/studio'), { blocked: false, unavailable: false, score: 0, category: 's6' });
  } finally { h.db.close(); }
});

test('the four routes call the guard once: three through run(), /answer through classifyInput', () => {
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const advisor = src('routes/advisor.ts');
  assert.equal((advisor.match(/classifyInput\(c\.env/g) || []).length, 1, 'advisor calls classifyInput more than once');
  const answer = advisor.slice(advisor.indexOf("advisor.post('/answer'"), advisor.indexOf("advisor.post('/skip'"));
  assert.match(answer, /classifyInput\(c\.env, user\.id, valueStr/);
  assert.match(answer, /if \(safety\.unavailable\)[\s\S]{0,1100}reason: 'guard_unavailable' \}, 503\)/, '/answer fails open');
  assert.match(answer, /budgetRefusalMessage\(safety\.category\)[\s\S]{0,80}\}, 429\)/, 'a spent budget is blamed on the guard');
  const explain = advisor.slice(advisor.indexOf("advisor.post('/explain'"), advisor.indexOf("advisor.get('/tools'"));
  assert.doesNotMatch(explain, /classifyInput/);
  assert.match(explain, /guardText: topic,/);
  assert.match(explain, /if \(ai\.refusal === 'guard_blocked'\)[\s\S]{0,700}error: REFUSAL\.jailbreak,[\s\S]{0,120}reason: 'safety_block',[\s\S]{0,80}\}, 422\)/);
  for (const [file, text] of [['routes/ai.ts', 'guardText: facts,'], ['routes/eadwyn.ts', 'guardText: fileText ?']]) {
    const s = src(file);
    assert.doesNotMatch(s, /classifyInput/, file);
    assert.ok(s.includes(text), file);
    assert.match(s, /if \(r\.refusal === 'guard_blocked'\)[\s\S]{0,200}error: 'safety_block'[\s\S]{0,200}\}, 422\)/, file);
  }
});
