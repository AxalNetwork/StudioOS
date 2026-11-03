/**
 * D1551 (#3798, deck v2 C3) — text ensembles: draft-refine and best-of-n with
 * the judge, priced inside the one quote, run under the one hold, with the
 * first draft announced before the refine or the judge. Synthetic data, stub
 * model calls.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_ensembles_d1551.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  BEST_OF_STEP, REFINE_INSTRUCTION, bestOfOptions, ensembleCalls, ensembleN, quoteEnsemble, refineOptions, runEnsemble,
  type RunOptions, type RunResult,
} from '../src/services/aiRouter.ts';
import { BEST_OF_ELEMENTS, ensembleFor, ensembleLabel, judgeFor, quoteAreaEnsemble } from '../src/services/decks/ensembles.ts';
import { blindOrder, judgeCandidates } from '../src/services/decks/judge.ts';
import { planAreas } from '../src/services/decks/areas.ts';
import { familyOf } from '../src/services/decks/critic.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { modelLabel, stepRecordRef, type StepRow } from '../src/services/decks/genRuntime.ts';
import { Governor } from '../src/services/decks/aiGovernor.ts';
import { DeckGenRoom } from '../src/durable-objects/deck-gen-room.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const WRITER = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const ASK: RunOptions = { task: 'rail_write', userId: 10, model: '@cf/synthetic/writer', systemPrompt: 'sys', messages: [{ role: 'user', content: 'Write the title.' }], maxTokens: 60, temperature: 0.4 } as RunOptions;
const ok = (output: string, model = '@cf/synthetic/writer', id = 1): RunResult => ({ ok: true, output, usage: { model } as any, usageLogId: id });
const no = (refusal = 'all_models_failed'): RunResult => ({ ok: false, refusal: refusal as any, usage: {} as any });

// ─────────────────────────────────────────────────────────── the modes

test('draft-refine: one draft, the draft heard first, then one refine of it that adds nothing; a failed refine keeps the draft', async () => {
  const seen: Array<{ messages: any[]; temperature: number | undefined; model: string | undefined }> = [];
  const heard: string[] = [];
  const out = await runEnsemble(null as any, ASK, { mode: 'draft-refine' }, {
    run: async (_e, o) => { seen.push({ messages: o.messages!, temperature: o.temperature, model: o.model }); heard.push(`call ${seen.length}`); return seen.length === 1 ? ok('First draft words.') : ok('Tighter words.', '@cf/synthetic/writer', 2); },
    onDraft: (t) => { heard.push(`draft: ${t}`); },
  });
  assert.equal(seen.length, 2, 'two calls');
  assert.deepEqual(heard, ['call 1', 'draft: First draft words.', 'call 2'], 'the draft is heard before the refine runs');
  assert.deepEqual(seen[1].messages.slice(-2), [{ role: 'assistant', content: 'First draft words.' }, { role: 'user', content: REFINE_INSTRUCTION }]);
  assert.match(REFINE_INSTRUCTION, /Do not add a number, a name or a claim/);
  assert.equal(seen[1].temperature, 0.3, 'the refine runs cooler');
  assert.equal(seen[1].model, '@cf/synthetic/writer', 'the routed model refines its own draft');
  assert.deepEqual([out.ok, out.output, out.refined, out.usageLogId], [true, 'Tighter words.', true, 2]);
  assert.deepEqual(out.calls.map((c) => [c.role, c.ok]), [['draft', true], ['refine', true]]);

  let n = 0;
  const kept = await runEnsemble(null as any, ASK, { mode: 'draft-refine' }, { run: async () => (++n === 1 ? ok('Only the draft.') : no()) });
  assert.deepEqual([kept.ok, kept.output, kept.refined], [true, 'Only the draft.', false], 'an ensemble never loses an answer it had');
  const blank = await runEnsemble(null as any, ASK, { mode: 'draft-refine' }, { run: async () => ok('   ') });
  assert.equal(blank.ok, false, 'an empty draft is no draft');
  const failed = await runEnsemble(null as any, ASK, { mode: 'draft-refine' }, { run: async () => no('guard_blocked') });
  assert.deepEqual([failed.ok, failed.failed?.refusal, failed.calls.length], [false, 'guard_blocked', 1], 'no refine after no draft');
});

test('best-of-n: n drafts at rising temperatures, the judge picks one; no judge, a refusing judge or one answer keeps the first answered', async () => {
  assert.deepEqual(bestOfOptions(ASK, 3).map((o) => o.temperature), [0.4, 0.6, 0.8]);
  assert.equal(BEST_OF_STEP, 0.2);
  assert.deepEqual([ensembleN({ mode: 'best-of-n' }), ensembleN({ mode: 'best-of-n', n: 9 }), ensembleN({ mode: 'best-of-n', n: 1 })], [3, 3, 2]);
  assert.deepEqual([ensembleCalls({ mode: 'single' }), ensembleCalls({ mode: 'draft-refine' }), ensembleCalls({ mode: 'best-of-n', n: 2 })], [1, 2, 2]);
  const texts = ['Alpha line', 'Beta line', 'Gamma line'];
  let k = 0;
  const run = async (_e: any, o: RunOptions) => ok(texts[Math.round(((o.temperature ?? 0.4) - 0.4) / 0.2)], '@cf/synthetic/writer', 100 + k++);
  const asked: any[] = [];
  const judged = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, {
    run, judge: async (answers) => { asked.push(answers); return { index: 2, probability: 0.7, model: '@cf/synthetic/judge' }; },
  });
  assert.deepEqual(asked[0].map((a: any) => a.text), texts, 'the judge reads every answered draft');
  assert.deepEqual([judged.output, judged.pick, judged.judged, judged.probability, judged.judge_model], ['Gamma line', 2, true, 0.7, '@cf/synthetic/judge']);
  assert.deepEqual(judged.calls.map((c) => c.role), ['candidate', 'candidate', 'candidate']);
  const unjudged = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, { run });
  assert.deepEqual([unjudged.output, unjudged.judged], ['Alpha line', false]);
  const refusing = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, { run, judge: async () => null });
  assert.deepEqual([refusing.output, refusing.judged], ['Alpha line', false]);
  const outOfRange = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, { run, judge: async () => ({ index: 7, probability: 0.9, model: 'x' }) });
  assert.deepEqual([outOfRange.output, outOfRange.judged], ['Alpha line', false], 'a pick that names no answer is no pick');
  let c = 0;
  let asked1 = 0;
  const one = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, {
    run: async () => (c++ === 1 ? ok('Only Beta') : no()), judge: async () => { asked1++; return { index: 1, probability: 0.9, model: 'j' }; },
  });
  assert.deepEqual([one.ok, one.output, one.pick, one.judged], [true, 'Only Beta', 1, false]);
  assert.equal(asked1, 0, 'a judge of one answer is never asked');
  // The first draft is told once, however many drafts answer.
  const toldB: string[] = [];
  await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, { run, onDraft: (t) => { toldB.push(t); } });
  assert.equal(toldB.length, 1, 'the first answered draft, once');
  const none = await runEnsemble(null as any, ASK, { mode: 'best-of-n', n: 2 }, { run: async () => no() });
  assert.equal(none.ok, false);
});

test('the quote is every call: draft-refine counts the refine with the longest draft in its input; best-of-n counts each draft', async () => {
  const inputs: number[] = [];
  const quote = async (_e: any, o: RunOptions) => { const chars = (o.messages ?? []).reduce((s, m) => s + m.content.length, 0); inputs.push(chars); return { ok: true as const, hold_microusd: 100 + Math.ceil(chars / 100), model: o.model ?? 'm' }; };
  const dr = await quoteEnsemble(null as any, { ...ASK, maxTokens: 400 } as RunOptions, { mode: 'draft-refine' }, quote);
  assert.equal(dr.ok && dr.calls, 2);
  assert.ok(inputs[1] >= 400 * 4, 'the refine is priced with the draft\'s longest answer in its input');
  assert.equal(dr.ok && dr.hold_microusd, (100 + Math.ceil(inputs[0] / 100)) + (100 + Math.ceil(inputs[1] / 100)));
  const bo = await quoteEnsemble(null as any, ASK, { mode: 'best-of-n', n: 3 }, async () => ({ ok: true as const, hold_microusd: 100, model: 'm' }));
  assert.deepEqual(bo.ok && [bo.hold_microusd, bo.calls], [300, 3]);
  const refused = await quoteEnsemble(null as any, ASK, { mode: 'draft-refine' }, async () => ({ ok: false as const, refusal: 'assist_off' as any, error: 'off' }));
  assert.equal(refused.ok, false);
  assert.deepEqual(refineOptions(ASK, 'd', null).messages!.length, 3);
});

// ─────────────────────────────────────────────────────────── which element, and its line

test('a whole-deck run writes a title, a kicker and a callout best of three, judged; other words draft-and-refine; a lightbox run stays single', async () => {
  assert.deepEqual([...BEST_OF_ELEMENTS].sort(), ['callout', 'kicker', 'title']);
  assert.deepEqual(ensembleFor('title', 'deck_build', 1), { mode: 'best-of-n', n: 3 });
  assert.deepEqual(ensembleFor('body', 'deck_build', 1), { mode: 'draft-refine' });
  assert.deepEqual(ensembleFor('title', 'areas', 1), { mode: 'single' }, 'the lightbox asked for variants to choose from');
  assert.deepEqual(ensembleFor('title', 'deck_build', 3), { mode: 'single' });
  // The judge keeps the family rule: never the writer's own family.
  const [lead] = judgeCandidates();
  const judge = judgeFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.ok(judge && familyOf(judge) !== familyOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
  assert.equal(judgeFor(lead), judgeCandidates().find((m) => familyOf(m) !== familyOf(lead)) ?? null);
  assert.equal(judgeFor(null), null, 'a writer that cannot be read is never judged');

  const priced: RunOptions[] = [];
  const quote = async (o: RunOptions) => { priced.push(o); return { ok: true as const, hold_microusd: o.task === 'module_decision' ? 40 : 100, model: o.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }; };
  const writer = { ...ASK, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } as RunOptions;
  const bo = await quoteAreaEnsemble(quote, writer, { mode: 'best-of-n', n: 3 }, 'title', 80);
  assert.ok(bo.ok);
  assert.deepEqual(bo.ok && [bo.hold_microusd, bo.calls, bo.judge_microusd], [340, 3, 40], 'three drafts and the judge, in one line');
  assert.equal(priced.filter((o) => o.task === 'module_decision').length, 1);
  assert.equal(bo.ok && bo.judge_model, judgeFor(writer.model));
  const dr = await quoteAreaEnsemble(quote, writer, { mode: 'draft-refine' }, 'body', 400);
  assert.deepEqual(dr.ok && [dr.hold_microusd, dr.calls, dr.judge_model], [200, 2, null]);
  assert.equal(ensembleLabel({ mode: 'draft-refine' }, 2, 'Llama', null), 'Draft and refine · Llama');
  assert.match(ensembleLabel({ mode: 'best-of-n', n: 3 }, 3, 'Llama', null), /^Best of 3, the first answer kept \(no judge of another model family\)/);
});

// ─────────────────────────────────────────────────────────── the step

const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db); return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string); })();
function db0() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* replayed */ } }
  return db;
}
const UID = '00000000-0000-4000-8000-0000000000aa';
const stepOf = (over: Partial<StepRow>): StepRow => ({
  batch_uid: UID, seq: 3, card_uid: 'c1', area_id: 'a1', element: 'body', kind: 'text', task: 'rail_write', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  state: 'running', quote_microusd: 500, charged_microusd: 0, model_used: null, fallback_used: 0, usage_log_id: null, error_code: null, started_at: null, ended_at: null,
  input: JSON.stringify({ messages: [{ role: 'user', content: 'Write the body.' }], maxTokens: 120, temperature: 0.4, ensemble: { mode: 'draft-refine' } }), result: null, ...over,
});

test('an ensemble step: every call under the run\'s one hold and the step\'s record, its charge their sum, the first draft told first', async () => {
  const db = db0();
  try {
    const env: any = { DB: d1Over(db) };
    const g = new Governor();
    const governor = { acquire: async (i: any) => g.acquire(i), release: async (id: string) => { g.release(id); } };
    const ref = stepRecordRef(UID, 3);
    const calls: RunOptions[] = [];
    const run = async (_e: any, o: RunOptions) => {
      calls.push(o);
      db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, 'rail_write', ?, ?, ?, ?)").run(10, o.model ?? 'm', 120, o.parentHold?.uid ?? null, o.rail?.record ?? null);
      return ok(calls.length === 1 ? 'The body, drafted.' : 'The body, refined.', o.model, calls.length);
    };
    const drafts: string[] = [];
    const x = stepExecutor(env, { run: run as any, governor, sleep: async () => {}, onDraft: (_s, t) => { drafts.push(t); } });
    const ctx: any = { batch: { created_by: 10, uid: UID, project_id: 1, deck_id: 1 }, parentHold: { uid: 'hold-1', userId: 10 } };
    const r = await x(stepOf({}), ctx);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((o) => o.parentHold?.uid === 'hold-1' && o.rail?.record === ref), 'one hold, one record');
    assert.equal(new Set(calls.map((o) => o.idempotencyKey)).size, 2, 'each call its own key, so a retry never runs the other twice');
    assert.equal(r.charged_microusd, 240, 'the step charges the sum of its calls');
    assert.deepEqual(drafts, ['The body, drafted.']);
    assert.deepEqual((r.variant as any).text, 'The body, refined.');
    assert.deepEqual((r.variant as any).ensemble.calls.map((c: any) => c.role), ['draft', 'refine']);
    assert.equal((r.variant as any).ensemble.refined, true);
    assert.deepEqual(g.held(10), { runs: 0, image: 0, text: 0, vision: 0 }, 'the lease is released');

    // Best of three, with the judge under the same hold and record (the judge's decide is a run too).
    calls.length = 0;
    // The line's own judge (not the first candidate), and a label that maps to a draft other than the first.
    const judgeModel = '@cf/cloudflare/clef';
    assert.notEqual(judgeFor(WRITER), judgeModel);
    const order = blindOrder(3, ref);
    const at = order.findIndex((v) => v !== 0);
    const letter = 'ABC'[at];
    const runB = async (_e: any, o: any) => {
      calls.push(o);
      if (o.task === 'module_decision') return { ok: true, output: JSON.stringify({ best: { choice: letter, confidence: 0.8, probabilities: { [letter]: 0.8 } } }), usage: { model: o.model }, usageLogId: 99 };
      return ok(`Title ${calls.length}`, o.model, calls.length);
    };
    const xb = stepExecutor(env, { run: runB as any, governor, sleep: async () => {} });
    const rb = await xb(stepOf({ element: 'title', input: JSON.stringify({ messages: [{ role: 'user', content: 'Write the title.' }], maxTokens: 40, temperature: 0.4, ensemble: { mode: 'best-of-n', n: 3, judge_model: judgeModel, judge_microusd: 50 } }) }), ctx);
    assert.equal(rb.ok, true);
    const writes = calls.filter((o) => o.task === 'rail_write');
    assert.equal(writes.length, 3, 'three drafts');
    assert.ok(calls.every((o) => o.rail?.record === ref), 'the judge runs under the step\'s record too');
    const e = (rb.variant as any).ensemble;
    assert.equal(e.mode, 'best-of-n');
    assert.equal(e.judged, true, 'the judge of another family ranked the three');
    assert.equal(e.probability, 0.8);
    assert.equal(e.pick, order[at], 'the judge\'s label maps back through the blind order');
    assert.notEqual(e.pick, 0);
    assert.deepEqual(calls.filter((o) => o.task === 'module_decision').map((o) => o.model), [judgeModel], 'the line\'s own judge is asked, once');
    assert.equal((rb.variant as any).text, `Title ${e.pick + 1}`, 'the step\'s words are the judged pick');
    assert.equal(e.judge_model_label, modelLabel(judgeModel));
    assert.equal(e.calls.length, 3);
    // A line with no judge (none of another family offered): the drafts run, no judge runs, the first draft stands.
    calls.length = 0;
    const rn = await xb(stepOf({ element: 'title', input: JSON.stringify({ messages: [{ role: 'user', content: 'Write the title.' }], maxTokens: 40, temperature: 0.4, ensemble: { mode: 'best-of-n', n: 3, judge_model: null, judge_microusd: 0 } }) }), ctx);
    assert.equal(calls.filter((o) => o.task === 'module_decision').length, 0);
    assert.deepEqual([(rn.variant as any).ensemble.judged, (rn.variant as any).ensemble.pick], [false, 0]);
  } finally { db.close(); }
});

test('the room tells a first draft as variant_ready with the step still running, its money filled from the run', async () => {
  const db = db0();
  try {
    const store = new Map<string, unknown>();
    const state: any = { storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, setAlarm: async () => {} } };
    const room = new DeckGenRoom(state, { DB: d1Over(db) } as any);
    const seen: any[] = [];
    room.onEvent((e) => seen.push(e));
    await room.drafted({ batch_uid: UID, seq: 2, card_uid: 'c1', area_id: 'a1', element: 'body' }, 'Early words.', '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].type, seen[0].state, seen[0].variant], ['variant_ready', 'running', { text: 'Early words.', draft: true }]);
    assert.ok(seen[0].charged_microusd >= 0 && seen[0].held_microusd >= 0, 'never the -1 placeholders');
    assert.equal(typeof seen[0].model_label, 'string');
  } finally { db.close(); }
});

test('the plan: a whole-deck run prices each text area as its ensemble in one line, the judge in it; a lightbox run keeps a line per variant', async () => {
  const cards = [{ uid: 'c1', title: 'Kestrel closes the month in a day', blocks: [] }];
  const priced: RunOptions[] = [];
  const ctx: any = {
    userId: 10, projectId: 1, deckId: 1, cards, aspect: '16:9', voice: null,
    quote: async (o: RunOptions) => { priced.push(o); return { ok: true, hold_microusd: o.task === 'module_decision' ? 40 : 100, model: o.model ?? WRITER }; },
    modelFor: async () => ({ model: WRITER, source: 'default' }),
    venture: async () => ({ available: false }), sources: async () => [], art: async () => ({ art: null }),
  };
  const areas = [
    { id: 'a-title', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, element: 'title', card: 'c1', action: 'rewrite' },
    { id: 'a-body', grid: { c1: 1, c2: 12, r1: 2, r2: 5 }, element: 'body', card: 'c1', action: 'rewrite' },
  ] as any;
  const build = await planAreas(ctx, { card: null, areas, variants: 1, cls: 'deck_build' });
  const [title, body] = build.areas;
  assert.equal(title.refusal, null, JSON.stringify(title.refusal));
  assert.deepEqual([title.lines.length, (title.lines[0].input as any).ensemble.mode, title.hold_microusd], [1, 'best-of-n', 340], 'three drafts and the judge in one line');
  assert.equal((title.lines[0].input as any).ensemble.judge_model, judgeFor(WRITER));
  assert.equal(title.lines[0].quote_microusd, 340);
  assert.match(title.quote_lines[0].label, /^Best of 3, judged by /);
  assert.deepEqual([body.lines.length, (body.lines[0].input as any).ensemble.mode, body.hold_microusd], [1, 'draft-refine', 200]);
  assert.equal(build.hold_microusd, 540, 'the run\'s one quote is every ensemble\'s calls');
  const lightbox = await planAreas(ctx, { card: null, areas: [areas[0]], variants: 3, cls: 'areas' });
  assert.deepEqual([lightbox.areas[0].lines.length, (lightbox.areas[0].lines[0].input as any).ensemble], [3, undefined], 'one call per variant, no ensemble');
});
