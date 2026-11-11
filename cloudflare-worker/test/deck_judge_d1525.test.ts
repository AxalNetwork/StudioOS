/**
 * D1525 (#3783, deck v2 B7) — the judge: a Clef decision ranks an area's
 * variants blind, from another model family than every writer, and reports
 * whether it agrees with the panel.
 *
 *   1. The family rule: a judge from a generator's family is refused; so is a
 *      writer whose family cannot be read, and an answer from a writer's family.
 *   2. A Clef call is quoted on input tokens only: its hold does not move with
 *      the output allowance, while a text model's does.
 *   3. Blind labels: no variant number and no model name reach the judge.
 *   4. judge_json: ranks and probabilities mapped back, null when not sent, and
 *      agreement with the panel reported (agrees, disagrees, no pick).
 *   5. AUTO-5: the judge as a function stays inside the run's one quote.
 *   6. The routes end to end on D1: the quote, the ranking, its contract, 404
 *      for a stranger, 409 once decided, nothing accepted.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_judge_d1525.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  JUDGE_THRESHOLD, LABELS, REFUSALS, blindOrder, gridJudge, judgeArea, judgeCandidates, judgeJson, judgeModelFor, panelPick, rankedLine, variantWords,
} from '../src/services/decks/judge.ts';
import { CLEF, CLEF_FLASH } from '../src/services/ai/decide.ts';
import { estimateCostUsd, quoteRun, __resetForTest } from '../src/services/aiRouter.ts';
import { DECK_JUDGE, DECK_GENERATE } from '../src/middleware/rateLimit.ts';
import deckJudge from '../src/routes/deck_judge.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const CLAIRIC = '@cf/cloudflare/clairic';

const text = (n: number, words: string, critique: any = { fits: true, contrast_aa: true, density_ok: true }) =>
  ({ n, seed: n, model_label: 'llama-3.3-70b-instruct-fp8-fast', cost_microusd: 10, seconds: 1, state: 'ready', error: null, payload: { kind: 'text', before: 'old', after: words }, critique }) as any;
const VARIANTS = [text(1, 'Audits take weeks; Kestrel reads the ledger.'), text(2, 'Kestrel reads the ledger in an afternoon.'), text(3, 'Audit work, done by reading the ledger.')];
const answer = (choice: string, probabilities: Record<string, number>) => ({ choice, confidence: probabilities[choice], probabilities });

// ---- 1. the family rule ----------------------------------------------------------

test('1. the family rule: a judge from a generator\'s family is refused, and the first candidate of another family runs', async () => {
  // Mutations checked: the rule read against the first generator only (a mixed run let the judge share a family);
  // an unknown writer passed as "no family to avoid"; the answered model's family not checked.
  const candidates = judgeCandidates();
  assert.ok(candidates.length >= 1 && candidates.every((m) => m.startsWith('@cf/cloudflare/clef')), 'the decide kind\'s models, from #3721\'s table');
  assert.deepEqual(judgeModelFor(candidates, [LLAMA]), { model: candidates[0] });
  assert.deepEqual(judgeModelFor(candidates, [LLAMA, CLAIRIC]), { refusal: { code: 'same_family', message: REFUSALS.same_family } }, 'any writer of the judge\'s family refuses it');
  assert.deepEqual(judgeModelFor([CLEF, LLAMA], [CLAIRIC, MISTRAL]), { model: LLAMA }, 'the first candidate of a family no writer has');
  assert.equal((judgeModelFor(candidates, []) as any).refusal.code, 'generator_unknown');
  assert.equal((judgeModelFor(candidates, [LLAMA, 'not-a-model-id']) as any).refusal.code, 'generator_unknown', 'a writer that cannot be read never skips the rule');

  let calls = 0;
  const refused = await judgeArea({ decide: async () => { calls += 1; return { ok: true, answer: null, model: CLEF }; } }, { element: 'body', variants: VARIANTS, seed: 'p', generators: [CLAIRIC] });
  assert.deepEqual([refused.state, (refused as any).refusal.code, calls], ['refused', 'same_family', 0], 'nothing runs');

  // A fallback that answered from a writer's family is refused, and was charged.
  const fell = await judgeArea({ candidates: [CLEF], decide: async () => ({ ok: true, answer: answer('A', { A: 0.7, B: 0.2, C: 0.1 }), model: LLAMA, charged_microusd: 40 }) },
    { element: 'body', variants: VARIANTS, seed: 'p', generators: [LLAMA] });
  assert.deepEqual([fell.state, (fell as any).refusal.code, fell.charged_microusd], ['refused', 'answered_same_family', 40]);
});

// ---- 2. the input-only quote -------------------------------------------------------

test('2. a Clef call is quoted on input tokens only: the hold does not move with the output allowance', async () => {
  // Mutation checked: the decision's guard output slice held for `outputBound` tokens (the hold moved with maxTokens).
  assert.equal(estimateCostUsd(CLEF, 1000, 1_000_000), estimateCostUsd(CLEF, 1000, 0), 'the catalogue prices Clef on tokens_in only');
  assert.ok(estimateCostUsd(CLEF, 2000, 0) > estimateCostUsd(CLEF, 1000, 0), 'and on every input token');
  __resetForTest();
  const f = aiBudgetFixture();
  try {
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
    const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard({ run: async () => ({}) }) };
    const q = gridJudge({ element: 'body', variants: VARIANTS, seed: 'p' })!;
    const decision = (maxTokens: number, more = '') => quoteRun(env, {
      task: 'module_decision', model: CLEF, userId: 2, surface: '/raise/pitch', maxTokens,
      specialist: { operation: 'decision', questions: { [q.key]: { type: 'choice', instructions: q.instructions, criteria: q.options } } }, text: q.text + more,
    } as any);
    const small = await decision(64);
    const large = await decision(16_000);
    assert.ok(small.ok && large.ok, JSON.stringify([small, large]));
    assert.ok((small as any).hold_microusd > 0);
    assert.equal((large as any).hold_microusd, (small as any).hold_microusd, 'no output allowance is held');
    const longer = await decision(64, ' more input'.repeat(400));
    assert.ok((longer as any).hold_microusd > (small as any).hold_microusd, 'more input holds more');
    // A text model, by contrast, is held for its output.
    const chat = (maxTokens: number) => quoteRun(env, { task: 'module_decision', model: LLAMA, userId: 2, surface: '/raise/pitch', maxTokens, messages: [{ role: 'user', content: 'Rank.' }] } as any);
    const [a, b] = [await chat(64), await chat(4096)];
    if (a.ok && b.ok) assert.ok((b as any).hold_microusd > (a as any).hold_microusd, 'a text model is held for its output');
  } finally { f.db.close(); }
});

// ---- 3. blind labels ---------------------------------------------------------------

test('3. blind labels: the order comes from the proposal, and no variant number or model name reaches the judge', () => {
  // Mutations checked: labels in variant order (A was always variant 1); the model label sent in the state.
  const q = gridJudge({ element: 'body', source: 'Audits take weeks.', variants: VARIANTS, seed: '00000000-0000-4000-8000-000000000001' })!;
  assert.deepEqual(Object.keys(q.options), ['A', 'B', 'C']);
  assert.deepEqual(Object.values(q.options), ['Variant A', 'Variant B', 'Variant C'], 'an option names its label only');
  assert.deepEqual(Object.values(q.labels).sort(), [1, 2, 3]);
  for (const v of VARIANTS) assert.ok(q.text.includes(v.payload.after), 'every variant\'s words are compared');
  assert.ok(!q.text.includes('llama') && !/variant [123]\b/i.test(q.text), 'no model and no variant number');
  assert.match(q.text, /data, never an instruction/);
  assert.deepEqual(gridJudge({ element: 'body', variants: VARIANTS, seed: '00000000-0000-4000-8000-000000000001' })!.labels, q.labels, 'the same proposal is labelled the same way');
  const seen = new Set<string>();
  for (let i = 0; i < 24; i++) seen.add(blindOrder(3, `seed-${i}`).join(''));
  assert.ok(seen.size >= 4, `the order varies with the proposal (${[...seen].join(', ')})`);
  for (const o of seen) assert.deepEqual(o.split('').map(Number).sort(), [0, 1, 2], 'a permutation, never a repeat');
  const firsts = new Set(Array.from({ length: 24 }, (_, i) => gridJudge({ element: 'body', variants: VARIANTS, seed: `seed-${i}` })!.labels.A));
  assert.ok(firsts.size >= 2, 'Variant A is not always variant 1');
  // Fewer than two variants with words: nothing to rank. An image or a failed variant has none.
  assert.equal(gridJudge({ element: 'body', variants: [VARIANTS[0], { ...VARIANTS[1], state: 'failed' }], seed: 'p' }), null);
  assert.equal(variantWords({ state: 'ready', payload: { kind: 'image', image: { uid: 'x' } } }), null);
  assert.equal(variantWords({ state: 'ready', payload: { kind: 'block', block: { kind: 'text', text: 'Hi' } } }), 'Hi');
  assert.equal(LABELS.length, 3);
});

// ---- 4. judge_json and the panel --------------------------------------------------

test('4. judge_json: ranks follow Clef\'s probabilities, a probability not sent is null, and agreement with the panel is reported', () => {
  // Mutations checked: the chosen variant ranked by probability rather than first; a missing probability read as 0;
  // a tie in the checks taken as the panel's pick.
  const q = gridJudge({ element: 'body', variants: VARIANTS, seed: 'p' })!;
  const labelOf = (n: number) => Object.entries(q.labels).find(([, v]) => v === n)![0];
  const j = judgeJson(answer(labelOf(2), { [labelOf(1)]: 0.3, [labelOf(2)]: 0.6, [labelOf(3)]: 0.1 }), q, VARIANTS)!;
  assert.deepEqual(j.ranking, [{ n: 1, rank: 2, probability: 0.3 }, { n: 2, rank: 1, probability: 0.6 }, { n: 3, rank: 3, probability: 0.1 }]);
  assert.deepEqual([j.best, j.of, j.score, j.clears], [2, 3, 0.6, true]);
  assert.equal(rankedLine(1, 3), 'Ranked 1 of 3');
  assert.deepEqual(j.panel, { best: null, agrees: null, line: 'The checks did not separate these variants.' }, 'every variant passed every check: no pick');

  const checked = [text(1, 'a', { fits: true, contrast_aa: true, density_ok: true }), text(2, 'b', { fits: false, contrast_aa: true, density_ok: true }), text(3, 'c', { fits: true, contrast_aa: true, density_ok: false })];
  const agree = judgeJson(answer(labelOf(1), { [labelOf(1)]: 0.55, [labelOf(2)]: 0.25, [labelOf(3)]: 0.2 }), q, checked)!;
  assert.deepEqual(agree.panel, { best: 1, agrees: true, line: 'The checks agree with this ranking.' });
  const disagree = judgeJson(answer(labelOf(2), { [labelOf(2)]: 0.45 }), q, checked)!;
  assert.deepEqual(disagree.panel, { best: 1, agrees: false, line: 'The checks prefer variant 1.' });
  assert.deepEqual(disagree.ranking.map((r) => [r.n, r.rank, r.probability]), [[1, null, null], [2, 1, 0.45], [3, null, null]], 'never a guessed rank or probability');
  assert.equal(disagree.clears, 0.45 >= JUDGE_THRESHOLD);
  assert.equal(panelPick([text(1, 'a', null), text(2, 'b', null)], [1, 2]), null, 'no checks at all: no pick');
  assert.equal(panelPick([text(1, 'a', { fits: null, contrast_aa: null, density_ok: true }), text(2, 'b', { fits: null, contrast_aa: null, density_ok: false })], [1, 2]), 1, 'a check not recorded counts for no one');
  assert.equal(judgeJson({ choice: 'Z', confidence: 0.9, probabilities: {} }, q, VARIANTS), null, 'an option not asked is no ranking');
});

// ---- 5. AUTO-5: inside the run's one quote ----------------------------------------

test('5. AUTO-5: the judge runs only while its hold fits what is left of the quote, and its charge never passes its hold', async () => {
  // Mutations checked: the budget check removed (a judge ran past the quote); the charge taken uncapped.
  const area = { element: 'body', variants: VARIANTS, seed: 'p', generators: [LLAMA, MISTRAL] };
  let calls = 0;
  const decideOk = async (q: any) => { calls += 1; return { ok: true as const, answer: answer(Object.keys(q.options)[0], { A: 0.8, B: 0.15, C: 0.05 }), model: CLEF_FLASH, charged_microusd: 999 }; };
  const over = await judgeArea({ decide: decideOk, perJudgeMicrousd: 120, budgetMicrousd: 100 }, area);
  assert.deepEqual([over.state, (over as any).refusal.code, calls], ['refused', 'over_quote', 0], 'nothing ran past the quote');
  const ran = await judgeArea({ decide: decideOk, perJudgeMicrousd: 120, budgetMicrousd: 500 }, area);
  assert.equal(ran.state, 'ranked');
  assert.equal(ran.charged_microusd, 120, 'counted at most at its hold');
  if (ran.state === 'ranked') assert.deepEqual([ran.judgement.score, ran.judgement.clears, ran.model], [0.8, true, CLEF_FLASH], 'a score the loop holds against the threshold');
  const unknown = await judgeArea({ decide: async (q: any) => ({ ok: true as const, answer: answer(Object.keys(q.options)[0], { A: 0.8 }), model: CLEF }), perJudgeMicrousd: 70, budgetMicrousd: 500 }, area);
  assert.equal(unknown.charged_microusd, 70, 'an unknown charge counts as the whole hold');
  const failed = await judgeArea({ decide: async () => ({ ok: false as const, result: { ok: false, refusal: 'allowance_exhausted', error: 'No allowance left.' } as any }), perJudgeMicrousd: 70, budgetMicrousd: 500 }, area);
  assert.deepEqual([failed.state, (failed as any).refusal.code, (failed as any).refusal.message], ['refused', 'allowance_exhausted', 'No allowance left.']);
});

// ---- 6. the routes, end to end -----------------------------------------------------

const FOUNDER = 10, OTHER = 20, P = 1, DECK = 1;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const UID = '00000000-0000-4000-8000-00000000a001';
const BATCH = '00000000-0000-4000-8000-00000000b001';
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', '[]');
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  db.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, batch_uid, mode, element, payload_json, variants_json, state, created_by, expires_at)
    VALUES (?, ?, ?, 'card-one', 'b2', ?, 'variants', 'body', ?, ?, 'ready', ?, '2099-01-01 00:00:00')`)
    .run(UID, DECK, P, BATCH, JSON.stringify({ kind: 'text', source: 'Audits take weeks.' }), JSON.stringify(VARIANTS), FOUNDER);
  const step = db.prepare(`INSERT INTO deck_area_batch_steps (batch_uid, seq, card_uid, area_id, element, kind, task, model, state, model_used) VALUES (?, ?, 'card-one', 'b2', 'body', 'text', 'rail_write', ?, 'done', ?)`);
  for (const seq of [0, 1, 2]) step.run(BATCH, seq, LLAMA, seq === 2 ? MISTRAL : LLAMA);
  return db;
}
async function call(db: DatabaseSync, who: number, path: string, ai: (model: string, input: any) => any) {
  const app = new Hono<any>();
  app.route('/api/decks', deckJudge);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI: withGuard({ run: async (m: string, input: any) => ai(m, input) }) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const schema = JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS.judge.schema}`, 'utf8'));

test('6. routes: the quote runs nothing, the ranking is blind and of another family, matches its contract, and accepts nothing', async () => {
  __resetForTest();
  const db = world();
  const seen: { model: string; input: any }[] = [];
  const clef = (model: string, input: any) => {
    seen.push({ model, input });
    const labels = Object.keys(input.questions.best.criteria);
    const probabilities = Object.fromEntries(labels.map((l, i) => [l, [0.62, 0.28, 0.1][i]]));
    return { answers: { best: { type: 'choice', choice: labels[0], confidence: 0.62, probabilities } }, usage: { input_tokens: 180 } };
  };
  const q = await call(db, FOUNDER, `/api/decks/areas/${UID}/judge/quote`, clef);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.deepEqual([q.body.ai, q.body.family, q.body.writer_families, q.body.of], [true, 'cloudflare', ['meta', 'mistralai'], 3]);
  assert.ok(q.body.hold_microusd > 0);
  assert.deepEqual(contractErrors(schema, q.body), []);
  assert.equal(seen.length, 0, 'a quote runs nothing');

  const r = await call(db, FOUNDER, `/api/decks/areas/${UID}/judge`, clef);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(contractErrors(schema, r.body), []);
  assert.equal(r.body.ranked, true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].model.startsWith('@cf/cloudflare/clef'), 'the judge is of another family than llama and mistral');
  assert.ok(!JSON.stringify(seen[0].input).includes('llama'), 'no model name reaches the judge');
  assert.deepEqual(r.body.ranking.map((x: any) => x.rank).sort(), [1, 2, 3]);
  assert.equal(r.body.ranking.find((x: any) => x.n === r.body.best).line, 'Ranked 1 of 3');
  assert.deepEqual(Object.keys(r.body.panel).sort(), ['agrees', 'best', 'line'], 'agreement with the panel is reported');
  assert.ok(r.body.charged_microusd === null || r.body.charged_microusd >= 0, 'what it charged, or null: never a guessed 0');
  assert.notDeepEqual(contractErrors(schema, { ...r.body, model: CLEF }), [], 'a model id never rides on the reply');
  const row = db.prepare('SELECT state, accepted_variant FROM deck_area_proposals WHERE uid = ?').get(UID) as any;
  assert.deepEqual([row.state, row.accepted_variant], ['ready', null], 'ranking accepts nothing');

  // A stranger learns nothing from the uid; a decided proposal is not ranked.
  assert.equal((await call(db, OTHER, `/api/decks/areas/${UID}/judge`, clef)).status, 404);
  assert.equal((await call(db, FOUNDER, `/api/decks/areas/00000000-0000-4000-8000-00000000ffff/judge`, clef)).status, 404);
  db.prepare(`UPDATE deck_area_proposals SET state = 'accepted', accepted_variant = 1 WHERE uid = ?`).run(UID);
  const done = await call(db, FOUNDER, `/api/decks/areas/${UID}/judge`, clef);
  assert.deepEqual([done.status, done.body.error], [409, 'not_open']);
  assert.equal(seen.length, 1, 'nothing more ran');
});

test('6b. routes: a writer of the judge\'s family is refused before anything runs, and the rate limit covers the ranking only', async () => {
  __resetForTest();
  const db = world();
  db.prepare(`UPDATE deck_area_batch_steps SET model_used = ? WHERE seq = 1`).run(CLAIRIC);
  let ran = 0;
  const q = await call(db, FOUNDER, `/api/decks/areas/${UID}/judge/quote`, () => { ran += 1; return {}; });
  assert.deepEqual([q.body.ai, q.body.reason], [false, 'same_family']);
  const r = await call(db, FOUNDER, `/api/decks/areas/${UID}/judge`, () => { ran += 1; return {}; });
  assert.deepEqual([r.status, r.body.ranked, r.body.reason, r.body.charged_microusd], [200, false, 'same_family', null]);
  assert.deepEqual(contractErrors(schema, r.body), []);
  assert.equal(ran, 0, 'nothing ran');
  assert.ok(DECK_JUDGE.test(`/api/decks/areas/${UID}/judge`));
  assert.ok(!DECK_JUDGE.test(`/api/decks/areas/${UID}/judge/quote`), 'a quote runs nothing');
  assert.ok(!DECK_GENERATE.test(`/api/decks/areas/${UID}/judge`), 'ranking is not a generation run');
});
