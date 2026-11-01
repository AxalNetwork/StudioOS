/**
 * D1518 (#3770, deck v2 A7) — one harness: rubric, editing tasks, benchmark
 * and element eval.
 *
 *  · `ELEMENT_ROUTES` jobs equal the plan's jobs (ELEMENT_EVAL.md), both ways;
 *  · the golden briefs come from the sample ventures' records, never a prompt;
 *  · the zero-edit acceptance arm (#3768's gate): its verdict, and the
 *    baseline DECK_BENCHMARK.md records equal to what the arm measures now;
 *  · the investor rubric is recorded, never gated; editing tasks are untimed
 *    until a person times them; a competitor arm runs only as F allows;
 *  · a live run is refused without the owner's cap (N), and never production.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_eval_d1518.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ELEMENTS, ELEMENT_ROUTES } from '../src/services/decks/elementModels.ts';
import { RUBRIC_GATE } from '../src/services/decks/rubric.ts';
import * as fixtures from './fixtures/pitchStoryFixtures.ts';
import {
  BRIEF_KEYS, COMPETITOR_ARMS, EDITING_TASKS_V0, GOLDEN_BRIEFS, INVESTOR_RUBRIC_V0, OWNER_F_PENDING, VENTURES, ZERO_EDIT_COMPARED,
  baselineFrom, baselineTable, liveRefusal, planJobsFrom, zeroEditVerdict,
} from '../../scripts/lib/deckEval.mjs';
import { plan, withBaseline, zeroEditArm } from '../../scripts/eval-elements.mjs';

const doc = (name: string) => readFileSync(resolve(process.cwd(), 'documentation/product', name), 'utf8');

test('ELEMENT_ROUTES jobs equal the plan\'s jobs in ELEMENT_EVAL.md, both ways', () => {
  // Mutation checked: a row's job changed in the doc → fails; a routed element's row removed → fails.
  const planned = planJobsFrom(doc('ELEMENT_EVAL.md'));
  const routed = Object.fromEntries(Object.entries(ELEMENT_ROUTES).map(([id, r]) => [id, r.job]));
  assert.ok(Object.keys(routed).length >= 30, 'every routed element is read');
  assert.deepEqual(planned, routed);
  assert.deepEqual(planJobsFrom('| title | text | DK9 |'), {}, 'only the rows between the markers count');
  assert.doesNotMatch(doc('ELEMENT_EVAL.md'), /@cf\//, 'no second model list: the catalogue is the only one');
});

test('the golden briefs: about twenty, each a routed element with its job, read from a sample venture\'s records, none a prompt', async () => {
  // Mutation checked: a brief given a `prompt` → the key check fails; a record key the venture lacks → fails.
  assert.ok(GOLDEN_BRIEFS.length >= 18 && GOLDEN_BRIEFS.length <= 24, `${GOLDEN_BRIEFS.length} briefs`);
  assert.equal(new Set(GOLDEN_BRIEFS.map((b) => b.id)).size, GOLDEN_BRIEFS.length, 'ids are distinct');
  const cards = new Set(Object.keys(fixtures.CARD_WORDS));
  for (const b of GOLDEN_BRIEFS) {
    assert.deepEqual(Object.keys(b).sort(), [...BRIEF_KEYS].sort(), `${b.id}: a brief carries records, never a prompt`);
    assert.equal(ELEMENT_ROUTES[b.element]?.job, b.job, `${b.id}: ${b.element} is routed on ${b.job}`);
    assert.ok(b.venture in VENTURES, b.id);
    assert.ok(cards.has(b.card), `${b.id}: ${b.card} is a card of the outline`);
    const keys = new Set((fixtures as any)[(VENTURES as any)[b.venture]]().items.map((i: any) => i.source_key));
    for (const k of b.records) assert.ok(keys.has(k), `${b.id}: ${k} is one of ${b.venture}'s records`);
    if (b.venture === 'sparse' && b.expect.includes('records_only')) assert.ok(b.expect.includes('honest_gaps'), `${b.id}: a sparse brief keeps its gaps honest`);
  }
  for (const v of Object.keys(VENTURES)) assert.ok(GOLDEN_BRIEFS.some((b) => b.venture === v), `${v} has a brief`);
  const groupOf = (id: string) => ELEMENTS.find((e) => e.id === id)?.group;
  for (const g of ['text', 'images', 'data', 'diagrams', 'venture']) assert.ok(GOLDEN_BRIEFS.some((b) => groupOf(b.element) === g), `${g} has a brief`);
  const rows = await plan();
  assert.equal(rows.length, GOLDEN_BRIEFS.length);
  for (const r of rows) assert.ok(r.models.length >= 1 && r.models.length <= 3, `${r.brief}: the rail's suggested models`);
});

test('the zero-edit arm: pass only at the gate with no placeholder and no overflow', () => {
  // Mutation checked: `score >= gate` as `score > gate` → the at-gate case fails; placeholders ignored → the second case passes.
  assert.deepEqual(zeroEditVerdict({ score: RUBRIC_GATE, placeholders: 0, overflow: 0 }, RUBRIC_GATE), { pass: true, reasons: [] });
  assert.deepEqual(zeroEditVerdict({ score: 100, placeholders: 2, overflow: 0 }, RUBRIC_GATE).reasons, ['2 "Not recorded" placeholder(s)']);
  assert.deepEqual(zeroEditVerdict({ score: 100, placeholders: 0, overflow: 1 }, RUBRIC_GATE).reasons, ['1 block(s) overflow']);
  assert.equal(zeroEditVerdict({ score: RUBRIC_GATE - 1, placeholders: 0, overflow: 0 }, RUBRIC_GATE).pass, false);
  assert.equal(zeroEditVerdict({ score: NaN, placeholders: 0, overflow: 0 }, RUBRIC_GATE).pass, false, 'an unscored deck never passes');
});

test('DECK_BENCHMARK.md records the zero-edit baseline the arm measures today, for the three sample ventures', async () => {
  // A change to what one click builds changes this table: refresh it with `scripts/eval-elements.mjs --benchmark --write`.
  const rows = await zeroEditArm();
  assert.deepEqual(Object.keys(rows), Object.keys(VENTURES));
  const recorded = baselineFrom(doc('DECK_BENCHMARK.md'));
  for (const [v, r] of Object.entries(rows) as any) {
    assert.deepEqual(recorded[v], { score: r.score, placeholders: r.placeholders, overflow: r.overflow, pass: r.pass }, `${v}: the benchmark is stale`);
  }
  assert.equal(rows.full.pass, true, 'a venture that recorded everything passes with zero edits');
  assert.equal(rows.conflicting.pass, true);
  // The write path keeps everything outside the markers.
  const md = 'a\n<!-- zero-edit:start -->\nold\n<!-- zero-edit:end -->\nb';
  assert.equal(withBaseline(md, rows), `a\n<!-- zero-edit:start -->\n${baselineTable(rows)}\n<!-- zero-edit:end -->\nb`);
  for (const t of ZERO_EDIT_COMPARED) assert.match(baselineTable(rows), new RegExp(`\\| ${t} \\|`), `${t} has its column, not run until F`);
});

test('the investor rubric is recorded, not gated; editing tasks wait for a person; competitor arms wait for F', () => {
  assert.equal(INVESTOR_RUBRIC_V0.gated, false);
  assert.ok(INVESTOR_RUBRIC_V0.criteria.length >= 5);
  assert.ok(EDITING_TASKS_V0.length >= 8);
  assert.equal(new Set(EDITING_TASKS_V0.map((t) => t.id)).size, EDITING_TASKS_V0.length);
  for (const t of EDITING_TASKS_V0) {
    assert.equal(t.measured, null, `${t.id}: no time is invented`);
    assert.ok(['7.4', '7.4b'].includes(t.section), t.id);
  }
  assert.deepEqual([...COMPETITOR_ARMS], ['Gamma', 'Canva', 'Pitch', 'Genspark', 'Dokie'], 'the five bars');
  const bench = doc('DECK_BENCHMARK.md');
  for (const tool of COMPETITOR_ARMS) assert.ok(bench.includes(`| ${tool} | ${OWNER_F_PENDING} |`), tool);
});

test('a live run is refused without the owner\'s cap and a staging URL, and never against production', () => {
  // Mutation checked: the production check removed → the axal.vc case returns null.
  assert.match(liveRefusal({})!, /EVAL_SPEND_CAP_USD.*decision N/);
  assert.match(liveRefusal({ EVAL_SPEND_CAP_USD: '0' })!, /decision N/);
  assert.match(liveRefusal({ EVAL_SPEND_CAP_USD: '25' })!, /EVAL_BASE_URL/);
  assert.match(liveRefusal({ EVAL_SPEND_CAP_USD: '25', EVAL_BASE_URL: 'http://staging.example.test' })!, /EVAL_BASE_URL/);
  assert.match(liveRefusal({ EVAL_SPEND_CAP_USD: '25', EVAL_BASE_URL: 'https://axal.vc' })!, /never targets production/);
  assert.match(liveRefusal({ EVAL_SPEND_CAP_USD: '25', EVAL_BASE_URL: 'https://app.axal.vc/api' })!, /never targets production/);
  assert.equal(liveRefusal({ EVAL_SPEND_CAP_USD: '25', EVAL_BASE_URL: 'https://studioos-staging.example.test' }), null);
});
