// D1145 (#3031, part 4 of #2433) — Fundraising readiness draws the stored
// Product-market fit score (D1144's `parts.pmf`) beside the raise kit:
//
//   1. below the floor no number shows ("Not enough recorded"), and a missing
//      input is "—" with its reason, never 0; a recorded 0 is 0;
//   2. an input that could not be read is drawn without, the score at its
//      lower confidence, and the tile says which (RD16 B);
//   3. a refused or failed read is Unreadable with Try again, never "no
//      score" (RD16 A), and a failed history is never an empty one;
//   4. the inputs in their four groups, an input's lightbox (a bottom sheet on
//      a phone), the gaps from both scores with their filter, the raise kit
//      from the module's own card, and the history with the pivot marked.
//
// Every venture and figure is made up.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pmf_page_d1145.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  NOT_ENOUGH, UNREADABLE, gainWords, gapRows, historyView, inputGroups, inputRow, kitView, moduleHref, pmfView, verdictLine,
} from '../src/pages/cycles/pmfModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const row = (key, label, group, weight, o = {}) => ({
  key, label, group, weight, state: 'recorded', value: 50, grade: 'sourced', grade_factor: 0.7, stale: false, contribution: 5,
  words: `${label} words`, reason: null, source: { table: 'discovery_interviews', rows: 4 }, as_of: '2026-10-20', before_pivot: 0,
  module: 'customer-research', ...o,
});
const INPUTS = () => [
  row('icp_interviews', 'ICP interviews held', 'who', 10, { value: 70, contribution: 7.4, grade: 'reviewed', words: '14 of 17 held interviews with people who fit, 9 from recorded sessions', before_pivot: 6 }),
  row('icp_coverage', 'ICP coverage', 'who', 5, { value: 88, contribution: 4.6 }),
  row('pain_frequency', 'Pain frequency', 'problem', 10, { value: 0, contribution: 0, words: '0 of 14 ICP interviews name the top pain', module: 'problem-discovery' }),
  row('pain_severity', 'Pain severity', 'problem', 10, { value: 83, contribution: 8.7, stale: true, module: 'problem-discovery' }),
  row('claims_supported', 'Claims supported', 'claims', 20, { value: 30, contribution: 6.3, module: 'experiments' }),
  row('paying_demand', 'Paying demand', 'demand', 15, { value: 70, contribution: 11, grade: 'measured', module: 'demand-signals' }),
  row('would_pay', 'Would pay', 'demand', 10, { value: 54, contribution: 5.7, module: 'demand-signals' }),
  row('waitlist', 'Waitlist against your bar', 'demand', 5, { state: 'not_recorded', value: null, contribution: null, grade: 'not_recorded', words: 'Not recorded: no bar set (86 sign-ups)', reason: 'No bar set', module: 'demand-signals' }),
  row('experiment_outcomes', 'Experiment outcomes', 'claims', 5, { value: 50, contribution: 2.6, grade: 'stated', module: 'experiments' }),
  row('product_pull', 'Product pull', 'demand', 10, { state: 'not_expected', value: null, contribution: null, grade: 'not_recorded', words: 'Not expected yet', reason: 'It counts once a release is out or PostHog tracks a metric', module: 'product-roadmap' }),
];
const STEPS = [
  { input: 'would_pay', text: 'Ask the next ICP interviews whether they would pay', module: 'demand-signals', gain: { value: 7, confidence: null, coverage: null }, confidence_delta: 0 },
  { input: 'waitlist', text: 'Set the bar for waitlist sign-ups', module: 'demand-signals', gain: { value: null, confidence: { from: 'Medium', to: 'High' }, coverage: { from: 8, to: 9, of: 9 } }, confidence_delta: 0.04 },
];
const SCORED = () => ({
  model: '1.0', state: 'scored', value: 64, band: 'Fair', confidence: 0.6, confidence_word: 'Medium', coverage: { present: 8, applies: 9 },
  inputs: INPUTS(), steps: STEPS, id: 12, inputs_hash: 'h', computed_at: '2026-10-21T09:40:00Z', computed_by: 1, trigger: 'module_read', changed: false,
  pivot_at: '2026-06-03', verdict: { decision: 'proceed', state: 'given', decided_at: '2026-09-12', evidence_count: 7 },
});
const NOT_ENOUGH_PART = () => ({
  ...SCORED(), state: 'not_enough', value: null, band: null, confidence: 0.19, confidence_word: null, coverage: { present: 0, applies: 9 }, steps: [],
  inputs: INPUTS().map((i) => (i.state === 'not_expected' ? i : { ...i, state: 'not_recorded', value: null, contribution: null, grade: 'not_recorded', reason: 'No interview held yet' })),
  verdict: null, pivot_at: null,
});
const PARTIAL = () => {
  const p = SCORED();
  p.partial = true; p.inputs_hash = null; p.value = 63; p.confidence_word = 'Low'; p.confidence = 0.41; p.coverage = { present: 7, applies: 9 };
  p.inputs = p.inputs.map((i) => (i.key === 'paying_demand' ? { ...i, state: 'unreadable', value: null, contribution: null, grade: 'not_recorded', words: 'Could not be read', reason: 'Could not be read' } : i));
  p.steps = STEPS.filter((s) => s.input !== 'paying_demand');
  return p;
};
const CARD = { state: 'ok', series: [
  { kind: 'hbar', items: [{ label: 'Investor narrative', value: 10 }, { label: 'Pitch deck', value: 0 }, { label: 'Data room', value: 7 }, { label: 'Cap table', value: 10 },
    { label: 'Use of funds', value: 5 }, { label: 'Traction proof', value: 10 }, { label: 'Team', value: null }, { label: 'Product-market fit', value: 6.4 }] },
  { kind: 'line', values: [30, 34, 41, 46, 52, 58], target: 100 },
] };
const RECORDS = { cols: [], rows: [
  { id: 'deck', cells: { item: 'Pitch deck', score: 0, evidence: null, missing: 'Build the pitch deck.', updated: '2026-10-21' } },
  { id: 'pmf', cells: { item: 'Product-market fit', score: 6.4, evidence: 'pattern', missing: 'See the gaps above.', updated: '2026-10-21' } },
  { id: 'narrative', cells: { item: 'Investor narrative', score: 10, evidence: 'pattern', missing: '', updated: '2026-10-18' } },
], total: 3, page: 1, page_size: 25 };
const HISTORY = { items: [
  { id: 3, value: 38, band: 'Weak', confidence: 0.3, confidence_word: 'Low', coverage: { present: 6, applies: 9 }, model: '1.0', trigger: 'module_read', computed_at: '2026-05-10T10:00:00Z' },
  { id: 5, value: null, band: null, confidence: 0.2, confidence_word: null, coverage: { present: 3, applies: 9 }, model: '1.0', trigger: 'module_read', computed_at: '2026-06-10T10:00:00Z' },
  { id: 9, value: 58, band: 'Fair', confidence: 0.55, confidence_word: 'Medium', coverage: { present: 7, applies: 9 }, model: '1.0', trigger: 'rescore', computed_at: '2026-09-10T10:00:00Z' },
  { id: 12, value: 64, band: 'Fair', confidence: 0.6, confidence_word: 'Medium', coverage: { present: 8, applies: 9 }, model: '1.0', trigger: 'module_read', computed_at: '2026-10-21T09:40:00Z' },
], has_more: false, next_cursor: null };

const MODULE = (pmf) => ({ module: { slug: 'fundraising-readiness', name: 'Fundraising readiness', records_title: 'Readiness items' }, card: CARD, records: RECORDS, ...(pmf === undefined ? {} : { parts: { pmf } }) });

async function mounted(pmf, { history = () => response(HISTORY), phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const url = String(u); requests.push(url);
    if (url.includes('/cycles/raise/pmf/history')) return history(url);
    if (url.includes('/cycles/raise/modules/fundraising-readiness')) return response(MODULE(pmf));
    return response({});
  };
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/fundraising-readiness?project_id=3'] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  ))));
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const one = (id) => all(id)[0];
  return {
    requests, props, all, one,
    textOf: (id) => text(one(id)),
    count: (id) => all(id).length,
    async click(node) { await act(async () => props(node).onClick?.({ preventDefault() {}, stopPropagation() {} })); await settle(); },
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('1. below the floor no number shows, a missing input is "—" with its reason, and a recorded 0 is 0', () => {
  // Mutation checked: not_enough drawn with a value → kind 'scored'; a Not recorded input as 0 → '0'; a recorded 0 as '—'.
  const v = pmfView(NOT_ENOUGH_PART());
  assert.equal(v.kind, 'not_enough');
  assert.equal(v.line, NOT_ENOUGH);
  assert.equal(v.value, undefined);
  assert.equal(v.band, undefined);
  assert.equal(v.empty, true);
  // A part that says scored but carries no number is never drawn as one.
  assert.equal(pmfView({ ...SCORED(), value: null }).kind, 'not_enough');
  const missing = inputRow(INPUTS().find((i) => i.key === 'waitlist'));
  assert.equal(missing.value, '—');
  assert.equal(missing.bar, null);
  assert.equal(missing.status, 'Not recorded');
  assert.match(missing.why, /^No bar set · lowers confidence, not the score$/);
  const zero = inputRow(INPUTS().find((i) => i.key === 'pain_frequency'));
  assert.equal(zero.value, '0', 'a recorded zero is a real 0');
  assert.equal(zero.bar, 0);
  const pull = inputRow(INPUTS().find((i) => i.key === 'product_pull'));
  assert.equal(pull.status, 'Not expected yet');
  assert.equal(pull.why, 'Out of the coverage count');
  assert.equal(pull.href, '/build/product-roadmap');
});

test('2. a failed input is drawn without, the confidence is the lower one, and the tile names it', () => {
  // Mutation checked: unreadable read as recorded → status the grade; the partial line dropped → null.
  const v = pmfView(PARTIAL());
  assert.equal(v.kind, 'scored');
  assert.equal(v.value, 63);
  assert.equal(v.partial, true);
  assert.equal(v.confidence, '●○○ Low confidence');
  assert.equal(v.coverage, '7 of 9 inputs that apply');
  assert.equal(v.unreadLine, 'Paying demand could not be read, so the score leaves it out until it reads.');
  assert.match(v.foot, /not stored: an input could not be read/);
  const r = inputRow(PARTIAL().inputs.find((i) => i.key === 'paying_demand'));
  assert.equal(r.status, 'Could not be read');
  assert.equal(r.value, '—');
  assert.equal(r.weight, null);
  assert.match(r.why, /Left out until it reads · lowers confidence/);
  // A complete read names nothing.
  assert.equal(pmfView(SCORED()).unreadLine, null);
});

test('3. a refused, failed or missing read is Unreadable, never "no score"', () => {
  // Mutation checked: unreadable read as not_enough → kind 'not_enough'; a missing part read as empty → kind 'not_enough'.
  for (const p of [{ state: 'unreadable', reason: 'Product-market fit could not be read' }, undefined, null, { state: 'scored' }]) {
    const v = pmfView(p);
    assert.equal(v.kind, 'unreadable', JSON.stringify(p));
    assert.equal(v.line, UNREADABLE);
    assert.ok(!/no score|not enough/i.test(v.line));
  }
  assert.deepEqual(gapRows(null, RECORDS).map((g) => g.scope), ['kit'], 'the raise kit\'s gaps still show');
});

test('4. the scored tile, the groups, the gaps, the raise kit and the history, in words', () => {
  // Mutation checked: Team counted as 0 in the kit → 69 becomes 61; the pmf row's "Missing" listed as a kit gap → 3 kit gaps; the pivot unmarked.
  const v = pmfView(SCORED());
  assert.deepEqual([v.kind, v.value, v.band, v.confidence, v.coverage], ['scored', 64, 'Fair', '●●○ Medium confidence', '8 of 9 inputs that apply']);
  assert.equal(v.verdict, 'Verdict: Proceed · 7 pieces · 12 Sep 2026');
  assert.equal(verdictLine(null), 'Verdict: No verdict yet');
  assert.equal(verdictLine({ decision: 'pivot', state: 'withheld', decided_at: null, evidence_count: 1 }), 'Verdict: Pivot · withheld · 1 piece');
  assert.equal(v.foot, 'From Validate · Model v1.0 · 21 Oct 2026 · when this page was read');
  assert.deepEqual(inputGroups(SCORED()).map((g) => [g.title, g.rows.length]), [['Who you heard from', 2], ['The problem', 2], ['Claims and experiments', 2], ['Demand and pull', 4]]);
  const first = inputGroups(SCORED(), '?project_id=3')[0].rows[0];
  assert.equal(first.status, 'Reviewed');
  assert.equal(first.weight, 'Weight 10 · 7.4 points');
  assert.equal(first.beforePivot, '6 records before the pivot, not counted');
  assert.equal(first.href, '/validate/customer-research?project_id=3');
  assert.equal(first.source, 'Validate › Customer research · 4 records');
  assert.ok(inputGroups(SCORED())[1].rows[1].stale);
  assert.deepEqual(gainWords(STEPS[1].gain), ['Confidence Medium → High', 'Coverage 8 → 9 of 9']);
  const gaps = gapRows(SCORED(), RECORDS, '?project_id=3');
  assert.deepEqual(gaps.map((g) => [g.scope, g.text]), [
    ['pmf', 'Ask the next ICP interviews whether they would pay'], ['pmf', 'Set the bar for waitlist sign-ups'], ['kit', 'Build the pitch deck.'],
  ]);
  assert.equal(gaps[0].href, '/validate/demand-signals?project_id=3');
  assert.deepEqual(gaps[0].gains, ['Up to +7']);
  const kit = kitView(CARD);
  assert.deepEqual([kit.kind, kit.value, kit.note], ['scored', 69, '7 of 8 items scored'], 'Team, unscored, is left out, never 0: 48.4 ÷ 7 × 10');
  assert.equal(kitView({ state: 'ok', series: [{ kind: 'hbar', items: [{ label: 'Team', value: null }] }] }).kind, 'empty');
  assert.equal(kitView({ state: 'unreadable' }).kind, 'unreadable');
  const hist = historyView(HISTORY.items, '2026-06-03');
  assert.deepEqual(hist.map((p) => [p.label, p.pivot]), [['38', false], [NOT_ENOUGH, true], ['58', false], ['64', false]]);
  assert.equal(hist[1].value, null, 'a point below the floor has no number');
  assert.equal(historyView([{ ...HISTORY.items[0] }, { ...HISTORY.items[2], model: '1.1' }])[1].modelChange, 'Model v1.1');
  assert.equal(moduleHref('record', '?project=0'), '/validate/record');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('5. the page: the tiles, the ten inputs, an input lightbox, the gaps filter and the history', async () => {
  // Mutation checked: the history unread → no chart; the lightbox not opened on Open ›; the gaps filter ignored.
  const t = await mounted(SCORED());
  try {
    assert.equal(t.textOf('pmf-value'), '64');
    assert.match(t.textOf('pmf-band'), /Fair/);
    assert.match(t.textOf('pmf-confidence'), /Medium confidence · 8 of 9 inputs that apply/);
    assert.match(t.textOf('pmf-verdict'), /Verdict: Proceed · 7 pieces · 12 Sep 2026/);
    assert.equal(t.textOf('kit-value'), '69');
    assert.equal(t.count('pmf-input-row'), 10);
    assert.match(t.textOf('pmf-pivot'), /After the pivot on 3 Jun 2026/);
    assert.ok(t.requests.some((u) => /\/cycles\/raise\/pmf\/history\?project=3&limit=200$/.test(u)), 'the history is read for this venture');
    assert.equal(t.count('pmf-history-chart'), 1);
    assert.equal(t.count('pmf-gap'), 3);
    await t.click(t.one('pmf-gaps-kit'));
    assert.deepEqual(t.all('pmf-gap').map((n) => t.props(n)['data-scope']), ['kit']);
    await t.click(t.one('pmf-gaps-pmf'));
    assert.equal(t.count('pmf-gap'), 2);
    assert.equal(t.count('pmf-input-lightbox'), 0);
    const claims = t.all('pmf-input-row').find((n) => t.props(n)['data-key'] === 'claims_supported');
    await t.click(t.all('pmf-input-open')[t.all('pmf-input-row').indexOf(claims)]);
    assert.equal(t.count('pmf-input-lightbox'), 1);
    assert.match(t.textOf('pmf-input-lightbox'), /30 of 100/);
    assert.match(t.textOf('pmf-input-lightbox'), /6\.3 points/);
    assert.ok(t.hrefs().includes('/validate/experiments?project_id=3'));
  } finally { await t.close(); }
});

test('6. below the floor: no number, every input dashed, and the Validate start', async () => {
  // Mutation checked: the value drawn when not_enough → a pmf-value node.
  const t = await mounted(NOT_ENOUGH_PART());
  try {
    assert.equal(t.count('pmf-value'), 0);
    assert.match(t.textOf('pmf-not-enough'), /Not enough recorded/);
    assert.equal(t.count('pmf-empty'), 1);
    assert.ok(t.all('pmf-input-value').every((n) => t.props(n).children === '—'), 'no 0 for a missing input');
  } finally { await t.close(); }
});

test('7. one input unread: the partial tile names it and its row says Could not be read', async () => {
  const t = await mounted(PARTIAL());
  try {
    assert.equal(t.textOf('pmf-value'), '63');
    assert.match(t.textOf('pmf-partial'), /Paying demand could not be read/);
    const r = t.all('pmf-input-row').find((n) => t.props(n)['data-key'] === 'paying_demand');
    assert.equal(t.props(r)['data-state'], 'unreadable');
  } finally { await t.close(); }
});

test('8. a failed read is Unreadable with Try again, and a failed history says so, never an empty one', async () => {
  // Mutation checked: the history error drawn as empty → pmf-history-empty.
  const t = await mounted({ state: 'unreadable', reason: 'Product-market fit could not be read' }, { history: () => response({ detail: 'Product-market fit history could not be read' }, 503) });
  try {
    assert.match(t.textOf('pmf-unreadable'), /could not be read/);
    assert.equal(t.count('pmf-retry'), 1);
    assert.equal(t.count('pmf-not-enough'), 0);
    assert.equal(t.count('pmf-value'), 0);
    assert.equal(t.count('pmf-input-row'), 0);
    assert.equal(t.count('pmf-history-empty'), 0);
    assert.match(t.textOf('pmf-history-error'), /not the same as no history/);
    assert.equal(t.textOf('kit-value'), '69', 'the raise kit is current');
  } finally { await t.close(); }
});

test('9. the wiring: an input is a bottom sheet on a phone, dark colours, phone targets, and Eadwyn writes nothing here', () => {
  const src = readFileSync('frontend/src/pages/cycles/PmfPart.jsx', 'utf8');
  assert.match(src, /<Lightbox [^>]*phone="sheet"/, 'RD18 B: an input as a bottom sheet');
  assert.ok((src.match(/dark:/g) || []).length > 40, 'RD19: dark colours throughout');
  assert.match(src, /max-sm:min-h-\[44px\]/, 'phone tap targets');
  assert.ok(!/window\.(alert|confirm|prompt)/.test(src), 'no browser pop-up');
  assert.ok(!/Eadwyn/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'Eadwyn\'s reading is part 6');
});
