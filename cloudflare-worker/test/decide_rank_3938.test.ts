/**
 * #3938 (task 4 of #3721's model use-case plan, part 1) — decisions, ranking
 * and sentiment on the models §2 names, through `run()`.
 *
 *   1. Clef's `choice` maps onto the options asked, with its probability; an
 *      option not offered, or a probability outside [0, 1], is no answer.
 *   2. The confidence line is "72% likely", and nothing when none is recorded.
 *   3. The reranker's ordering: best first, every unranked row kept in order.
 *   4. Sentiment: distilbert on English, clef-flash on every other language;
 *      an unreadable answer is no label, never a guessed "neutral".
 *   5. The routes the plan's §4.2 fixes 2, 3 and 4 name run those models.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/decide_rank_3938.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { ROUTE, __resetForTest } from '../src/services/aiRouter.ts';
import {
  CLEF_FLASH, DISTILBERT, RERANKER, confidenceLine, orderByRanking, readChoice, readDistilbert, sentiment, sentimentModelFor,
} from '../src/services/ai/decide.ts';

const OPTIONS = ['spinout_ready', 'continue', 'iterate'];
const out = (a: unknown) => JSON.stringify({ gate: a });

test('1. Clef\'s choice maps onto the options asked, with the chosen option\'s probability', () => {
  // Mutations checked: an unoffered choice accepted; the confidence taken from `confidence` over the chosen probability;
  // a probability above 1 accepted.
  assert.deepEqual(readChoice(out({ type: 'choice', choice: 'continue', confidence: 0.5, probabilities: { spinout_ready: 0.1, continue: 0.72, iterate: 0.18 } }), 'gate', OPTIONS),
    { choice: 'continue', confidence: 0.72, probabilities: { spinout_ready: 0.1, continue: 0.72, iterate: 0.18 } });
  assert.deepEqual(readChoice(out({ choice: 'iterate', confidence: 0.6 }), 'gate', OPTIONS), { choice: 'iterate', confidence: 0.6, probabilities: {} }, 'no probabilities: its confidence');
  assert.equal(readChoice(out({ choice: 'liquidate', confidence: 0.9 }), 'gate', OPTIONS), null, 'an option not offered is no answer');
  assert.equal(readChoice(out({ choice: 'continue', confidence: 1.4 }), 'gate', OPTIONS), null, 'a probability above 1 is no answer');
  assert.equal(readChoice(out({ choice: 'continue', probabilities: { continue: -0.1 } }), 'gate', OPTIONS), null);
  assert.equal(readChoice(out({ choice: 'continue' }), 'gate', OPTIONS), null, 'no probability at all is no answer');
  assert.equal(readChoice('not json', 'gate', OPTIONS), null);
  assert.equal(readChoice(JSON.stringify({ other: { choice: 'continue', confidence: 0.5 } }), 'gate', OPTIONS), null, 'another question\'s answer');
  // An unoffered option's probability is dropped, not reported.
  assert.deepEqual(readChoice(out({ choice: 'continue', probabilities: { continue: 0.7, liquidate: 0.3 } }), 'gate', OPTIONS)?.probabilities, { continue: 0.7 });
});

test('2. the confidence line is a rounded percentage, and nothing when none is recorded', () => {
  assert.equal(confidenceLine(0.72), '72% likely');
  assert.equal(confidenceLine(0.006), '1% likely');
  assert.equal(confidenceLine(1), '100% likely');
  for (const none of [null, undefined, NaN, -0.1, 1.2]) assert.equal(confidenceLine(none as any), null, `${none}: never a guessed figure`);
});

test('3. the reranker\'s ordering: best first, unranked rows kept in their order, nothing dropped', () => {
  // Mutations checked: the ranking applied ascending; unranked rows dropped.
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(orderByRanking(items, [{ index: 2, score: 0.1 }, { index: 3, score: 0.9 }]), ['d', 'c', 'a', 'b']);
  assert.deepEqual(orderByRanking(items, [{ index: 9, score: 1 }, { index: 1, score: 0.5 }, { index: 1, score: 0.4 }]), ['b', 'a', 'c', 'd'], 'an index out of range, or twice, is ignored');
  assert.deepEqual(orderByRanking(items, null), items);
  assert.deepEqual(orderByRanking(items, []), items);
});

test('4. sentiment: distilbert on English, clef-flash on every other language; an unreadable answer is no label', async () => {
  // Mutations checked: every language sent to distilbert; a missing answer read as "neutral".
  assert.equal(sentimentModelFor('en'), DISTILBERT);
  assert.equal(sentimentModelFor('en-GB'), DISTILBERT);
  assert.equal(sentimentModelFor(null), DISTILBERT, 'no language read: English, distilbert\'s default');
  for (const lang of ['es', 'fr', 'pt-BR', 'de']) assert.equal(sentimentModelFor(lang), CLEF_FLASH, lang);
  assert.deepEqual(readDistilbert(JSON.stringify([{ label: 'NEGATIVE', score: 0.2 }, { label: 'POSITIVE', score: 0.8 }])), { label: 'positive', score: 0.8 });
  assert.equal(readDistilbert('[]'), null);
  assert.equal(readDistilbert(JSON.stringify([{ label: 'POSITIVE', score: 3 }])), null);

  __resetForTest();
  const f = aiBudgetFixture();
  try {
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
    const models: string[] = [];
    let clefAnswer: unknown = { answers: { sentiment: { type: 'choice', choice: 'negative', confidence: 0.81, probabilities: { negative: 0.81, positive: 0.09, neutral: 0.1 } } }, usage: { input_tokens: 30 } };
    const env: any = { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard({ run: async (m: string) => {
      models.push(m);
      return m === DISTILBERT ? [{ label: 'POSITIVE', score: 0.93 }, { label: 'NEGATIVE', score: 0.07 }] : clefAnswer;
    } }) };
    const charge = { userId: 2, surface: '/onboarding' } as any;
    assert.deepEqual(await sentiment(env, charge, { text: 'This is great, thank you.', lang: 'en' }), { ok: true, label: 'positive', score: 0.93, model: DISTILBERT });
    assert.deepEqual(await sentiment(env, charge, { text: 'No me gustó nada.', lang: 'es' }), { ok: true, label: 'negative', score: 0.81, model: CLEF_FLASH });
    clefAnswer = { answers: { sentiment: { type: 'choice', choice: 'furious', confidence: 0.9 } }, usage: { input_tokens: 30 } };
    // The router itself refuses an answer naming an option not asked (moduleShapes): never a guessed label.
    const odd = await sentiment(env, charge, { text: 'Très déçu.', lang: 'fr' });
    assert.equal(odd.ok, false);
    assert.equal((odd as any).result.error, 'Unreadable specialist response');
    assert.deepEqual(models, [DISTILBERT, CLEF_FLASH, CLEF_FLASH]);
  } finally { f.db.close(); }
});

test('5. §4.2 fixes 2, 3 and 4: the advisor ranks on the reranker, detection and sentiment no longer run a Llama', () => {
  assert.equal(ROUTE.rerank.model, RERANKER, 'fix 2: no JSON picker on qwen-coder');
  assert.equal((ROUTE.rerank as any).fallbackChain, undefined, 'a reranker has no text fallback');
  assert.equal(ROUTE.detect_language.model, CLEF_FLASH, 'fix 3 (VA8)');
  assert.equal(ROUTE.sentiment.model, DISTILBERT, 'fix 4 (ON5)');
  assert.equal((ROUTE.sentiment as any).fallbackChain, undefined);
});
