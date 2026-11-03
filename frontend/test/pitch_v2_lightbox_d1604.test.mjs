/**
 * D1604 (#3716, plan §4.2, §11 steps 7 and 8) — "Generate into N areas"
 * (`AreaLightbox.jsx`), its model (`areaLightboxModel.js`) and its proposals
 * (`AreaResults.jsx`).
 *
 *   · every element maps to a Worker route on main, a free placement, or the
 *     adapter method and issue that bring it; words for an empty area wait
 *     for #3764;
 *   · the model chip is read-only text from the AIRail's own read: no select,
 *     radio or "Use this model" in the lightbox;
 *   · one area shows its hold; several run one after another with their sum,
 *     and a refusal stops the rest; variants 2 and 3 are Coming later;
 *   · results say Accept and Accept all, never Insert; Accept places in the
 *     area and records the decision; a metric and an upload run no model,
 *     and a proposed figure names its source and grade;
 *   · a Title leads with the Worker's `headline`; Change tone and Translate
 *     are typed in the instruction box, not offered here; a chart needs the
 *     canvas's 4 × 3 cells;
 *   · the model chip still names its model when the options change while
 *     the rail is read; AI paused mid-dialog still places the free rows;
 *     "Add it here" puts a free element in the area itself; the element
 *     picker and the variant count work from the keyboard.
 *
 * Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOf } from '../src/pages/raise/pitch/gridModel.js';
// D1499: a block's place is `placeOf` (boxOf on the slide), so a range is read back from its box.
const cols = (st, c1, c2) => st?.left === placeOf({ c1, c2, r1: 1, r2: 1 }).left && st?.width === placeOf({ c1, c2, r1: 1, r2: 1 }).width;
const rows = (st, r1, r2) => st?.top === placeOf({ c1: 1, c2: 1, r1, r2 }).top && st?.height === placeOf({ c1: 1, c2: 1, r1, r2 }).height;
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';
import { FIGURE_LINE } from '../src/pages/raise/pitch/deckAssistModel.js';
import { SURFACES } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { ELEMENTS, ELEMENT_GROUPS, HOLD, elementOnMain } from '../src/pages/raise/pitch/deckV2Model.js';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import { areasOf } from '../src/pages/raise/pitch/gridSelection.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';
import {
  CHART_MIN_LINE, NOT_RUN, TEXT_CHANGES, TEXT_ELEMENTS, aspectFor, batchMode, chargedLine, defaultElement, holdLine, modelChip,
  placeResult, rowPlan, runSequence, validLine, variantWhy, VENTURE_ELEMENTS, VENTURE_LINE,
} from '../src/pages/raise/pitch/areaLightboxModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(resolve(root, 'frontend/src/pages/raise/pitch', f), 'utf8');
const AREAS = areasOf(CARD, MODEL);
const area = (id) => AREAS.find((a) => a.id === id);
const ITEMS = [{ source_key: 'revenue.mrr', label: 'MRR', value: 4200, as_of: '2026-10-01', grade: 'Measured', state: 'recorded', module: 'Grow › Revenue' }];
/** The whole Grid, empty: room for any element. */
const WHOLE = { id: 'free:whole', kind: 'free', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('every element maps to a route on main, a free placement, or its adapter issue', () => {
  // D1560 (#3807): Speaker notes is a transform run for the card's notes.
  const runs = new Set(['assist', 'image', 'metric', 'upload', 'dialog', 'notes']);
  for (const el of ELEMENTS) {
    const on = TEXT_ELEMENTS.includes(el.id) ? area('b2') : WHOLE;
    const plan = rowPlan({ area: on, element: el.id, card: CARD, cardIndex: 0, items: ITEMS });
    if (el.adapter) {
      assert.equal(plan.run, 'later', el.id);
      assert.equal(plan.adapter, el.adapter, el.id);
      assert.equal(plan.issue, SURFACES[el.adapter].issue, `${el.id}: keyed to the issue that brings it`);
    } else if (VENTURE_ELEMENTS.includes(el.id)) {
      // D1543 (#3781): a record-bound element is read from the records, never generated here.
      assert.deepEqual([plan.run, plan.why], ['refused', VENTURE_LINE], el.id);
    } else {
      assert.ok(runs.has(plan.run), `${el.id} runs on main (${plan.run})`);
    }
    if (plan.run === 'assist' || plan.run === 'image' || plan.run === 'notes') {
      assert.ok(FOUNDER_OPTIONS.some((o) => o.key === plan.option && o.page === 'Founder · Raise · Pitch deck'), `${el.id}: ${plan.option} is a deck rail option`);
    }
  }
  // D1512 (#3764): words for an empty area are the batch's, written from the card's own words.
  const empty = rowPlan({ area: area('free:8-4'), element: 'body', card: CARD, cardIndex: 0 });
  assert.deepEqual([empty.run, empty.option], ['area', 'deck:rewrite']);
  // A bound figure: only another recorded figure replaces it.
  assert.equal(rowPlan({ area: area('b3'), element: 'chart', card: CARD, cardIndex: 0, items: ITEMS }).why, FIGURE_LINE('Grow › Revenue'));
  assert.equal(rowPlan({ area: area('b3'), element: 'metric', card: CARD, cardIndex: 0, items: ITEMS }).run, 'metric');
  // A chart needs the canvas's 4 × 3 (pd12 inset 1); a table or a timeline the editor's 3 × 2.
  assert.equal(CHART_MIN_LINE, 'A chart needs at least 4 × 3 cells. Select a larger area.');
  assert.equal(rowPlan({ area: area('free:8-4'), element: 'chart', card: CARD, cardIndex: 0 }).why, CHART_MIN_LINE, '3 × 3 is too small for a chart');
  assert.equal(rowPlan({ area: { ...WHOLE, grid: { c1: 1, c2: 4, r1: 1, r2: 3 } }, element: 'chart', card: CARD, cardIndex: 0 }).run, 'assist', '4 × 3 holds one');
  assert.equal(rowPlan({ area: area('free:8-4'), element: 'table', card: CARD, cardIndex: 0 }).run, 'assist');
  assert.match(rowPlan({ area: area('free:11-2'), element: 'table', card: CARD, cardIndex: 0 }).why, /A table needs at least 3 × 2 cells/);
  // Change tone and Translate are typed in the instruction box (plan §0): not offered here.
  assert.deepEqual(TEXT_CHANGES.map((c) => c.action), ['rewrite', 'shorten', 'expand']);
  assert.equal(rowPlan({ area: area('b2'), element: 'body', card: CARD, cardIndex: 0, choice: { change: 'tone' } }).action, 'rewrite', 'no tone to pick');
  // A Title leads with the Worker's headline, written from the card's recorded figures, under deck:rewrite.
  const title = rowPlan({ area: area('b1'), element: 'title', card: CARD, cardIndex: 0, items: ITEMS });
  assert.deepEqual([title.action, title.option], ['headline', 'deck:rewrite']);
  assert.deepEqual(title.body, { action: 'headline', block: { id: 'b1', kind: 'text' }, text: 'Synthetic heading', source_keys: ['revenue.mrr'] });
  assert.equal(rowPlan({ area: area('b1'), element: 'title', card: CARD, cardIndex: 0, items: ITEMS, choice: { change: 'rewrite' } }).action, 'rewrite');
  assert.equal(rowPlan({ area: area('b1'), element: 'title', card: CARD, cardIndex: 0, items: [] }).action, 'rewrite', 'no recorded figure: no headline');
  assert.equal(rowPlan({ area: area('b2'), element: 'body', card: CARD, cardIndex: 0, items: ITEMS, choice: { change: 'headline' } }).action, 'rewrite', 'a headline is a Title\'s');
  // The bodies the routes take.
  assert.deepEqual(rowPlan({ area: area('b2'), element: 'body', card: CARD, cardIndex: 0, choice: { change: 'shorten' } }).body,
    { action: 'shorten', block: { id: 'b2', kind: 'text' }, text: 'Synthetic body words' });
  assert.deepEqual(rowPlan({ area: area('free:8-4'), element: 'table', card: CARD, cardIndex: 0 }).body, { action: 'table', heading: 'Synthetic traction' });
  assert.deepEqual(rowPlan({ area: WHOLE, element: 'chart', card: CARD, cardIndex: 0 }).body, { action: 'chart', heading: 'Synthetic traction' });
  const photo = rowPlan({ area: area('free:8-4'), element: 'photo', card: CARD, cardIndex: 2 });
  assert.deepEqual(photo.body, { use: 'content', description: 'Synthetic heading. Synthetic body words', style: 'scene', palette: 'brand', aspect: '1:1', count: 1, card: 2, points: [], colours: [] });
  assert.equal(aspectFor({ c1: 1, c2: 12, r1: 1, r2: 6 }), '16:9');
  assert.equal(aspectFor({ c1: 1, c2: 3, r1: 1, r2: 6 }), '3:4');
  assert.deepEqual([defaultElement(area('b1')), defaultElement(area('b2')), defaultElement(area('b3')), defaultElement(area('free:8-4'))], ['title', 'body', 'metric', 'chart']);
});

test('one area holds its quote; several hold their sum across N runs; a missing quote draws no sum', () => {
  assert.equal(holdLine([{ ai: true, hold_microusd: 1200 }]), HOLD('$0.0012'));
  assert.equal(holdLine([{ ai: true, hold_microusd: 1200 }, { ai: true, total_microusd: 1800 }]), 'Holds up to $0.0030 across 2 runs · you pay what each uses');
  assert.equal(holdLine([{ ai: true, hold_microusd: 1200 }, null]), null, 'no sum from a missing part');
  assert.equal(holdLine([{ ai: false, reason: 'assist_off' }]), null);
  assert.equal(holdLine([]), null, 'nothing charged: no "$0.00"');
  assert.equal(validLine([{ expires_at: new Date(Date.parse('2026-10-31T10:10:00Z')).toISOString() }], Date.parse('2026-10-31T10:00:00Z')), 'Valid for 10 min');
  assert.equal(validLine([{ ai: true }]), null, 'only where a quote carries an expiry');
});

test('the model chip is the AIRail\'s pick, read-only, and says where it is set', () => {
  const rail = { models: [{ id: 'a', name: 'Synthetic A', price: '$0.001' }, { id: 'b', name: 'Synthetic B', price: '$0.002' }], pick: 'b' };
  assert.equal(modelChip(rail), 'Synthetic B · $0.002 per variant · set in the AIRail');
  assert.equal(modelChip({ ...rail, pick: null }), 'Synthetic A · $0.001 per variant · set in the AIRail', 'the row\'s first when nothing is picked');
  assert.equal(modelChip(null), 'Model set in the AIRail', 'a failed read names no model');
  // D1511: `GET /api/ai/rail` answers each model's unit prices as an object; the chip prints them as the AIRail does.
  const real = { models: [{ id: 'c', name: 'Synthetic C', price: { cost: { tokens_in: 0.29, tokens_out: 2.25 }, billed: { tokens_in: 0.58, tokens_out: 4.5 } } }], pick: 'c', billing: 'billed' };
  assert.doesNotMatch(modelChip(real), /object Object/);
  assert.match(modelChip(real), /^Synthetic C · \$0\.58.* · set in the AIRail$/);
});

test('several areas run as one batch since #3764 (D1512): the adapter is asked first; variants 2 and 3 are on', () => {
  // Mutation checked: put `areasGenerate` back to off('areasGenerate') → the dialog is in sequence again and this fails.
  assert.equal(batchMode(), 'batch');
  assert.equal(batchMode(() => ({ available: false })), 'sequence', 'a seam that answers unavailable runs the areas one after another');
  assert.equal(batchMode((n) => (n === 'areasQuote' ? { available: true } : { available: false })), 'sequence', 'both routes, or none');
  assert.equal(variantWhy(1), null);
  assert.equal(variantWhy(2), null);
  assert.ok(variantWhy(2, 'sequence'), 'in sequence, variants 2 and 3 say why they are off');
  assert.equal(variantWhy(3, 'batch'), null);
});

test('a refusal stops the rest: later areas are not run and not charged', async () => {
  const ran = [];
  const out = await runSequence([{ key: 'a' }, { key: 'b' }, { key: 'c' }], async (row) => {
    ran.push(row.key);
    if (row.key === 'b') throw Object.assign(new Error('Synthetic refusal'), { status: 422 });
    return { kind: 'text', charges: true, charged: 500 };
  });
  assert.deepEqual(ran, ['a', 'b']);
  assert.deepEqual(out.results.map((r) => r.status), ['proposed', 'refused', 'not_run']);
  assert.equal(out.results[2].line, NOT_RUN);
  assert.equal(out.refusal.key, 'b');
  assert.equal(chargedLine(out.results), 'Charged $0.0005 for 1 run. What a run did not use was released.');
  assert.equal(chargedLine([{ status: 'proposed', charges: true, charged: null }]), 'Charged for 1 run; the amount is not recorded yet. What a run did not use was released.');
  assert.equal(chargedLine([{ status: 'proposed', local: true }]), null, 'a free element charged nothing, and says no $0.00');
});

test('Accept places in the area on the card as it stands, or says why not', () => {
  const text = placeResult(CARD, { kind: 'text', area: area('b2'), before: 'Synthetic body words', after: 'Synthetic new words' }, MODEL);
  assert.equal(text.card.blocks.find((b) => b.id === 'b2').text, 'Synthetic new words');
  const changed = { ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b2' ? { ...b, text: 'Edited since' } : b)) };
  assert.match(placeResult(changed, { kind: 'text', area: area('b2'), before: 'Synthetic body words', after: 'x' }, MODEL).error, /changed since Eadwyn proposed this/);
  const chart = placeResult(CARD, { kind: 'block', area: area('free:8-4'), block: { kind: 'chart', chart_type: 'columns', series: [] } }, MODEL);
  assert.deepEqual(chart.card.blocks.at(-1).grid, { c1: 8, c2: 10, r1: 4, r2: 6 }, 'in the area\'s own range');
  const swap = placeResult(CARD, { kind: 'block', area: area('b3'), block: { kind: 'metric', label: 'ARR' } }, MODEL);
  const there = swap.card.blocks.filter((b) => b.grid.c1 === 8 && b.grid.r1 === 2);
  assert.deepEqual(there.map((b) => b.label), ['ARR'], 'the block that held the area gives way to the new one');
  assert.deepEqual(there[0].grid, area('b3').grid);
  assert.equal(swap.card.blocks.length, CARD.blocks.length);
  const moved = { ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b3' ? { ...b, grid: { c1: 8, c2: 10, r1: 4, r2: 5 } } : b)) };
  assert.match(placeResult(moved, { kind: 'block', area: area('b3'), block: { kind: 'metric' } }, MODEL).error, /changed since/);
  assert.match(placeResult(moved, { kind: 'block', area: area('free:8-4'), block: { kind: 'chart' } }, MODEL).error, /overlaps .*Nothing was placed\./);
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the model is picked in the AIRail only: the lightbox has no model select, radio or "Use this model"', () => {
  const src = read('AreaLightbox.jsx');
  for (const gone of ['setPagePick', 'setModel(', 'Use this model', 'type="radio"']) assert.ok(!src.includes(gone), gone);
  for (const m of src.matchAll(/<select[^>]*aria-label="([^"]+)"/g)) assert.ok(['Figure'].includes(m[1]), `a select for ${m[1]}`);
  assert.equal([...src.matchAll(/<select/g)].length, 1, 'the figure is the only select: tone and language are typed in the instruction box');
  for (const gone of ['TONES', 'LANGUAGES', "'tone'", "'translate'", 'deck:tone', 'deck:translate']) assert.ok(!src.includes(gone), `the lightbox offers no ${gone}`);
  assert.ok(src.includes('railPrefsApi.page(RAIL_PAGE, option)'), 'the chip reads the AIRail\'s own row');
});

test('results say Accept and Accept all, never Insert', () => {
  for (const f of ['AreaLightbox.jsx', 'AreaResults.jsx', 'areaLightboxModel.js']) assert.ok(!/\bInsert\b/.test(read(f)), `${f} says Insert`);
  const results = read('AreaResults.jsx');
  assert.ok(results.includes('{ACCEPT}') && results.includes('{ACCEPT_ALL}') && results.includes('{DISCARD}'));
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const RAIL = async (_page, option) => ({ ok: true, models: [{ id: 'synthetic/m', name: `Synthetic ${option}`, price: '$0.0004' }], pick: 'synthetic/m' });
const QUOTE = async (_id, _card, body) => ({ ai: true, action: body.action, hold_microusd: { rewrite: 1200, chart: 800 }[body.action] ?? 1000 });
const node = (m, id) => { const n = m.by(id); assert.ok(n, `no ${id}`); return n; };

/** D1512 (#3764): the area routes, stubbed: one quote, a run that settles at the first read, and Accept by the area. */
const BATCH = '00000000-0000-4000-8000-000000000b01';
const AREA_ROUTES = (variants = 1, refuse = null) => ({
  'areas.quote': async (_id, body) => ({
    class: 'areas', quote_uid: `q1.${'a'.repeat(32)}`, expires_at: new Date(Date.now() + 600_000).toISOString(),
    hold_microusd: 1200 * body.variants,
    areas: body.areas.map((a) => ({ key: a.id, card_uid: 'c-0', area_id: a.id, element: a.element, refusal: refuse?.[a.id] ?? null, hold_microusd: 1200 * body.variants, lines: [{ label: `${body.variants} variant · Synthetic`, microusd: 1200 * body.variants }] })),
  }),
  'areas.start': async (_id, body) => ({
    batch_uid: BATCH, class: 'areas', hold_microusd: 1200 * body.variants, replayed: false, refused: [],
    proposals: body.areas.map((a) => ({ uid: `p-${a.id}`, card_uid: 'c-0', area_id: a.id, element: a.element, kind: 'text', state: 'running', variants: [] })),
  }),
  'areas.proposals': async () => ({
    batch: { uid: BATCH, state: 'done', held_microusd: 1200 * variants, charged_microusd: 700 * variants }, done: true,
    proposals: [{
      uid: 'p-b2', card_uid: 'c-0', area_id: 'b2', element: 'body', kind: 'text', state: 'ready',
      variants: Array.from({ length: variants }, (_, k) => (k === 1
        ? { n: 2, seed: 12, model_label: 'Synthetic M', cost_microusd: 0, seconds: null, state: 'failed', error: { code: 'model_failed', message: 'This variant failed. You were charged only for what ran.' }, payload: null, critique: null }
        : { n: k + 1, seed: 11 + k, model_label: 'Synthetic M', cost_microusd: 700, seconds: 1.2, state: 'ready', error: null, payload: { kind: 'text', before: 'Synthetic body words', after: `Synthetic b2 after ${k + 1}` }, critique: { fits: true, contrast_aa: true, density_ok: true } })),
    }],
  }),
  'areas.accept': async () => ({ proposal: { uid: 'p-b2', state: 'accepted' } }),
  'areas.discard': async () => ({ proposal: { uid: 'p-b2', state: 'discarded' } }),
});

test('several areas (D1512): the batch\'s areas share one quote and one run; a headline keeps its own route; Accept all places one variant per area', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: `u-${body.block.id}` }, before: body.text, after: `Synthetic ${body.block.id} after`, cost: { charged_microusd: 700 } }),
    'prefs.page': RAIL,
    'proposals.decide': async () => ({ ok: true }),
    ...AREA_ROUTES(3),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    assert.match(m.text(node(m, 'pitch-areas')), /Generate into 2 areas/);
    // One area with one variant keeps its own route: the batch takes variants 2 and 3.
    assert.equal(m.calls.filter((c) => c[0] === 'areas.quote').length, 0, 'one batchable area, one variant: no batch');
    assert.notEqual(m.pr(node(m, 'pitch-areas-variants-3'))['aria-disabled'], true, 'variants 2 and 3 are on');
    await m.press(node(m, 'pitch-areas-variants-3'));
    assert.equal(m.pr(node(m, 'pitch-areas-variants-3'))['aria-checked'], true);
    // The Title leads with its headline (its own route, quoted at 1000); the body's Rewrite is the batch's (3 × 1200).
    assert.equal(m.pr(node(m, 'pitch-areas-row-b1-change-headline'))['aria-checked'], true);
    assert.equal(m.text(node(m, 'pitch-areas-hold')), 'Holds up to $0.0046 across 2 runs · you pay what each uses · Valid for 10 min', 'pd4: the batch quote says how long it holds');
    assert.match(m.text(node(m, 'pitch-areas-row-b1-hold')), /Holds up to \$0\.0010/, 'the headline\'s own quote');
    assert.match(m.text(node(m, 'pitch-areas-row-b2-hold')), /Holds up to \$0\.0036/, 'the batch row\'s hold, from the one quote');
    const quoted = m.calls.filter((c) => c[0] === 'areas.quote').at(-1)[2];
    assert.deepEqual(quoted.areas, [{ id: 'b2', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, element: 'body', action: 'rewrite' }], 'the client names the element and the change, never a model');
    assert.ok(!m.by('pitch-areas-sequence'), 'the batch is one run, not one after another');
    assert.equal(m.calls.filter((c) => c[0] === 'areas.quote').at(-1)[2].variants, 3, 'the quote holds three variants');
    await m.press(node(m, 'pitch-areas-generate'));
    const runs = m.calls.filter((c) => c[0] === 'assist.run');
    assert.deepEqual(runs.map((c) => c[3].action), ['headline'], 'only the headline ran on its own route');
    const start = m.calls.filter((c) => c[0] === 'areas.start');
    assert.equal(start.length, 1, 'one run for the batch');
    assert.equal(start[0][2].variants, 3);
    assert.equal(start[0][2].quote_uid, `q1.${'a'.repeat(32)}`, 'the run is held to the quote the dialog drew');
    // A 3-variant batch: each variant labelled by its model and cost; the failed one says so, the others stay acceptable.
    assert.match(m.text(node(m, 'pitch-area-result-b2~1-pill')), /Synthetic M · variant 1 · 1\.2 s/);
    assert.match(m.text(node(m, 'pitch-area-result-b2~2-refused')), /You were charged only for what ran/);
    assert.match(m.text(node(m, 'pitch-area-result-b2~3-after')), /Synthetic b2 after 3/);
    await m.press(node(m, 'pitch-area-results-accept-all'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'proposals.decide').map((c) => c.slice(1)), [['u-b1', 'accept']]);
    // Mutation checked: drop Accept all's one-per-area skip → variant 3 is accepted too and this fails.
    assert.deepEqual(m.calls.filter((c) => c[0] === 'areas.accept').map((c) => c.slice(1)), [[31, 'c-0', 'b2', 'p-b2', 1]], 'Accept by the area, one variant');
    assert.match(m.text(node(m, 'pitch-area-result-b2~3-decided')), /Another variant was placed in this area/);
    assert.ok(!m.by('pitch-area-result-b2~3-error'), 'Accept all does not try the area\'s other variants, so it stops on nothing');
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Synthetic b1 after/);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic b2 after 1/, 'Accept all placed both areas');
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.close(); }
});

test('a refused area stops the rest; an empty area\'s words are the batch\'s (D1512); adapter elements cannot be picked', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async () => { throw Object.assign(new Error('Synthetic: Eadwyn cannot run this now.'), { status: 422, code: 'synthetic' }); },
    'prefs.page': RAIL,
    ...AREA_ROUTES(1),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    await m.press(node(m, 'pitch-areas-generate'));
    // One batchable area with one variant: no batch, so the areas run in sequence and a refusal stops the rest.
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 1, 'the refusal stopped the second run');
    assert.match(m.text(node(m, 'pitch-area-result-b1-refused')), /Eadwyn cannot run this now/);
    assert.equal(m.text(node(m, 'pitch-area-result-b2-not-run')), NOT_RUN);
    assert.ok(!m.by('pitch-area-results-charged'), 'nothing charged is claimed');
    assert.equal(m.calls.filter((c) => c[0] === 'areas.start').length, 0);
  } finally { await m.close(); }
  const n = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL, ...AREA_ROUTES(1) } });
  try {
    await n.press(n.by('pitch-editor-area-free:8-4'));
    await n.press(node(n, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-free:8-4';
    assert.match(n.text(node(n, `${row}-element`)), /Chart from records/, 'an empty area starts as a chart');
    assert.equal(n.text(node(n, `${row}-why`)), CHART_MIN_LINE, 'the canvas\'s limit: 3 × 3 holds no chart');
    assert.equal(n.calls.filter((c) => c[0] === 'assist.quote').length, 0, 'a refused chart is not even quoted');
    await n.press(node(n, `${row}-element`));
    await n.press(node(n, `${row}-pick-table`));
    // D1512: one area with one variant keeps its own route.
    assert.deepEqual(n.calls.filter((c) => c[0] === 'assist.quote').at(-1)[3], { action: 'table', heading: 'Synthetic traction' });
    await n.press(node(n, `${row}-element`));
    assert.equal(n.pr(node(n, `${row}-picker`)).role, 'listbox');
    assert.equal(n.pr(node(n, `${row}-pick-icons`))['aria-disabled'], true);
    assert.match(n.text(node(n, `${row}-pick-remove_bg`)), /\(pending owner\)/);
    await n.press(node(n, `${row}-pick-icons`));
    assert.match(n.text(node(n, `${row}-element`)), /Table from records/, 'a Coming later element is not picked');
    await n.press(node(n, `${row}-pick-body`));
    // D1512: words for an empty area are written by the batch, from the card's own words; no change to pick.
    assert.ok(!n.by(`${row}-later`), 'no longer Coming later');
    assert.deepEqual(n.calls.filter((c) => c[0] === 'areas.quote').at(-1)[2].areas, [{ id: 'free:8-4', grid: area('free:8-4').grid, element: 'body' }]);
    assert.equal(n.pr(node(n, 'pitch-areas-generate')).disabled, false, 'it runs');
  } finally { await n.close(); }
});

test('a metric and an upload run no model: free, placed in the area on Accept', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await m.press(m.by('pitch-editor-area-free:8-4'));
    await m.press(node(m, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-free:8-4';
    await m.press(node(m, `${row}-element`));
    await m.press(node(m, `${row}-pick-metric`));
    assert.equal(m.text(node(m, `${row}-model`)), 'No model · free');
    assert.equal(m.pr(node(m, 'pitch-areas-generate')).disabled, true, 'pick a figure first');
    await m.type(node(m, `${row}-figure`), 'revenue.mrr');
    assert.equal(m.text(node(m, 'pitch-areas-hold')), 'No model · free');
    await m.press(node(m, 'pitch-areas-generate'));
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 0);
    assert.match(m.text(node(m, `pitch-area-result-free:8-4-pill`)), /Proposed · No model · free/);
    // A live figure carries its source and grade on the proposal the founder accepts.
    const result = node(m, 'pitch-area-result-free:8-4');
    const chip = m.walk(result).find((x) => m.pr(x)['data-testid'] === 'source-chip-revenue.mrr');
    assert.ok(chip, 'the proposal names the figure\'s source');
    assert.match(m.text(chip), /Connector .*Measured/);
    await m.press(node(m, 'pitch-area-result-free:8-4-accept'));
    assert.equal(m.calls.filter((c) => c[0] === 'proposals.decide').length, 0, 'nothing to decide on the Worker');
    const tile = [...m.walk(m.container)].find((x) => /^pitch-editor-block-/.test(m.pr(x)['data-testid'] || '') && cols(m.pr(x).style, 8, 10) && rows(m.pr(x).style, 4, 6));
    assert.ok(tile, 'the tile sits in the area');
    assert.match(m.text(tile), /MRR/);
  } finally { await m.close(); }
  const file = { name: 'synthetic.png' };
  const up = await mountEditor({ answers: {
    'assist.quote': QUOTE, 'prefs.page': RAIL,
    'images.upload': async () => ({ image: { uid: 'img-up', url: 'https://synthetic.example/up.png', alt: '', source: 'upload', state: 'kept' } }),
    'images.keep': async (uid) => ({ image: { uid, state: 'kept' } }),
  } });
  try {
    await up.press(up.by('pitch-editor-area-free:8-4'));
    await up.press(node(up, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-free:8-4';
    await up.press(node(up, `${row}-element`));
    await up.press(node(up, `${row}-pick-upload`));
    assert.equal(up.pr(node(up, 'pitch-areas-generate')).disabled, true, 'choose a file first');
    await up.fire(node(up, `${row}-file`), 'onChange', { target: { files: [file] } });
    await up.press(node(up, 'pitch-areas-generate'));
    const call = up.calls.find((c) => c[0] === 'images.upload');
    assert.deepEqual([call[1], call[2], call[3]], [31, file, { use: 'content', card: 0, alt: '' }]);
    await up.press(node(up, 'pitch-area-result-free:8-4-accept'));
    assert.ok(!up.calls.some((c) => c[0] === 'images.keep'), 'an upload is already the venture\'s: no keep');
    assert.ok(up.walk(node(up, 'pitch-editor-blocks')).some((x) => up.pr(x).src === 'https://synthetic.example/up.png'), 'the image is on the card');
  } finally { await up.close(); }
});

test('Accept all stops at the first proposal it cannot place, and says why', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: `u-${body.block.id}` }, before: body.text, after: `Synthetic ${body.block.id} after`, cost: { charged_microusd: 700 } }),
    'prefs.page': RAIL,
    'proposals.decide': async (uid) => { if (uid === 'u-b1') throw Object.assign(new Error('Synthetic: that proposal is no longer open.'), { status: 409 }); return { ok: true }; },
    ...AREA_ROUTES(1),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    await m.press(node(m, 'pitch-areas-generate'));
    await m.press(node(m, 'pitch-area-results-accept-all'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'proposals.decide').map((c) => c[1]), ['u-b1'], 'the second waits');
    assert.match(m.text(node(m, 'pitch-area-result-b1-error')), /no longer open/);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic body words/, 'nothing placed past the stop');
    assert.ok(m.by('pitch-area-result-b2-accept'), 'still waiting for its own Accept');
    assert.equal(m.calls.filter((c) => c[0] === 'areas.accept').length, 0, 'the batch\'s area is not accepted past the stop');
  } finally { await m.close(); }
});

test('the model chip still names its model when the options change while the rail is read', async () => {
  let answer;
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'prefs.page': (page, option) => (option === 'deck:rewrite' ? new Promise((r) => { answer = () => r(RAIL(page, option)); }) : RAIL(page, option)),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    assert.equal(m.text(node(m, 'pitch-areas-row-b1-model')), 'Model set in the AIRail', 'the rail is still being read');
    // Row 2 turns to a chart while row 1's rail read is in flight.
    await m.press(node(m, 'pitch-areas-row-b2-element'));
    await m.press(node(m, 'pitch-areas-row-b2-pick-chart'));
    assert.equal(m.text(node(m, 'pitch-areas-row-b2-model')), 'Synthetic deck:chart · $0.0004 per variant · set in the AIRail');
    await act(async () => { answer(); });
    await m.settle();
    assert.equal(m.text(node(m, 'pitch-areas-row-b1-model')), 'Synthetic deck:rewrite · $0.0004 per variant · set in the AIRail', 'the answer still lands');
    assert.equal(m.calls.filter((c) => c[0] === 'prefs.page' && c[2] === 'deck:rewrite').length, 1, 'read once');
  } finally { await m.close(); }
});

test('AI paused while the dialog is open: the free rows still place, the charged ones wait', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.press(m.by('pitch-editor-area-free:8-4'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    const row = 'pitch-areas-row-free:8-4';
    await m.press(node(m, `${row}-element`));
    await m.press(node(m, `${row}-pick-metric`));
    await m.type(node(m, `${row}-figure`), 'revenue.mrr');
    await act(async () => { seedAssistModes({ raise: false }); });
    await m.settle();
    assert.equal(m.text(node(m, 'pitch-areas-hold')), 'AI assistance is off on this page. Free elements still place; the rest wait until it is back on.');
    assert.equal(m.pr(node(m, 'pitch-areas-generate')).disabled, false, 'the recorded figure can still be placed');
    await m.press(node(m, 'pitch-areas-generate'));
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 0, 'nothing charged runs');
    assert.ok(m.by('pitch-area-result-free:8-4-accept'), 'the figure is proposed');
    assert.ok(!m.by('pitch-area-result-b2'), 'the words wait');
  } finally { localStorage.removeItem('assist_mode:raise'); await m.close(); __resetAssistModeForTest(); }
});

test('"Add it here" on an area that holds a block: the area\'s own range, and the block gives way on Add', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.press(node(m, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-b2';
    await m.press(node(m, `${row}-element`));
    await m.press(node(m, `${row}-pick-link`));
    await m.press(node(m, `${row}-dialog`));
    assert.ok(node(m, 'pitch-editor-add-dialog'));
    const url = m.walk(node(m, 'pitch-editor-add-dialog')).find((x) => m.pr(x)['aria-label'] === 'Link');
    await m.type(url, 'https://synthetic.example/demo');
    assert.match(m.text(node(m, 'pitch-editor-add-says')), /Adds a 7 × 5 link button at column 1, row 2\./, 'in the area itself');
    await m.press(node(m, 'pitch-editor-add-run'));
    assert.ok(!m.by('pitch-editor-block-b2'), 'the block that held the area gave way');
    const placed = [...m.walk(node(m, 'pitch-editor-blocks'))].find((x) => /^pitch-editor-block-/.test(m.pr(x)['data-testid'] || '') && cols(m.pr(x).style, 1, 7) && rows(m.pr(x).style, 2, 6));
    assert.ok(placed, 'the link sits in the area');
  } finally { await m.close(); }
});

test('the element picker and the variant count work from the keyboard', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await m.press(m.by('pitch-editor-area-free:8-4'));
    await m.press(node(m, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-free:8-4';
    const id = (n) => m.pr(n)['data-testid'];
    const enabled = ELEMENT_GROUPS.flatMap((g) => g.items).filter(elementOnMain).map((e) => e.id);
    // ArrowDown on the closed trigger opens the list, focused on the selected element.
    await m.fire(node(m, `${row}-element`), 'onKeyDown', { key: 'ArrowDown' });
    const list = node(m, `${row}-picker`);
    assert.equal(id(document.activeElement), `${row}-pick-chart`);
    const tabbable = m.walk(list).filter((x) => m.pr(x).role === 'option' && m.pr(x).tabIndex === 0);
    assert.deepEqual(tabbable.map(id), [`${row}-pick-chart`], 'one tab stop: a roving tabindex');
    // The arrows skip what is Coming later.
    await m.fire(list, 'onKeyDown', { key: 'ArrowDown' });
    const next = enabled[enabled.indexOf('chart') + 1];
    assert.equal(id(document.activeElement), `${row}-pick-${next}`);
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'End' });
    assert.equal(id(document.activeElement), `${row}-pick-${enabled.at(-1)}`);
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'Home' });
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'ArrowUp' });
    assert.equal(id(document.activeElement), `${row}-pick-${enabled.at(-1)}`, 'it wraps');
    // Escape closes and gives focus back to the trigger; nothing was picked.
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'Escape' });
    assert.ok(!m.by(`${row}-picker`));
    assert.equal(id(document.activeElement), `${row}-element`);
    assert.match(m.text(node(m, `${row}-element`)), /Chart from records/);
    // Enter picks the active element.
    await m.fire(node(m, `${row}-element`), 'onKeyDown', { key: 'ArrowDown' });
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'ArrowDown' });
    await m.fire(node(m, `${row}-picker`), 'onKeyDown', { key: 'Enter' });
    assert.ok(!m.by(`${row}-picker`));
    assert.match(m.text(node(m, `${row}-element`)), new RegExp(ELEMENTS.find((e) => e.id === next).label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(id(document.activeElement), `${row}-element`, 'focus is back on the trigger');
  } finally { await m.close(); }
  const n = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await n.press(n.by('pitch-editor-block-b2'));
    await n.press(node(n, 'pitch-editor-ask-area'));
    const group = n.walk(node(n, 'pitch-areas')).find((x) => n.pr(x)['aria-label'] === 'How Eadwyn changes the words');
    assert.equal(n.pr(node(n, 'pitch-areas-row-b2-change-rewrite')).tabIndex, 0);
    assert.equal(n.pr(node(n, 'pitch-areas-row-b2-change-shorten')).tabIndex, -1, 'one tab stop');
    await n.fire(group, 'onKeyDown', { key: 'ArrowRight' });
    assert.equal(n.pr(node(n, 'pitch-areas-row-b2-change-shorten'))['aria-checked'], true);
    assert.equal(n.pr(document.activeElement)['data-testid'], 'pitch-areas-row-b2-change-shorten');
    const variants = n.walk(node(n, 'pitch-areas')).find((x) => n.pr(x)['aria-label'] === 'Variants per area');
    await n.fire(variants, 'onKeyDown', { key: 'ArrowRight' });
    // D1512 (#3764): variants 2 and 3 are on, so the arrows reach them.
    assert.equal(n.pr(node(n, 'pitch-areas-variants-2'))['aria-checked'], true, 'the arrows move to the next variant count');
  } finally { await n.close(); }
});
