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
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';
import { FIGURE_LINE } from '../src/pages/raise/pitch/deckAssistModel.js';
import { SURFACES } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { ELEMENTS, ELEMENT_GROUPS, HOLD, NOT_ON, elementOnMain } from '../src/pages/raise/pitch/deckV2Model.js';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import { areasOf } from '../src/pages/raise/pitch/gridSelection.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';
import {
  CHART_MIN_LINE, EMPTY_TEXT_WHAT, NOT_RUN, TEXT_CHANGES, TEXT_ELEMENTS, aspectFor, batchMode, chargedLine, defaultElement, holdLine, modelChip,
  placeResult, rowPlan, runSequence, validLine, variantWhy,
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
  const runs = new Set(['assist', 'image', 'metric', 'upload', 'dialog']);
  for (const el of ELEMENTS) {
    const on = TEXT_ELEMENTS.includes(el.id) ? area('b2') : WHOLE;
    const plan = rowPlan({ area: on, element: el.id, card: CARD, cardIndex: 0, items: ITEMS });
    if (el.adapter) {
      assert.equal(plan.run, 'later', el.id);
      assert.equal(plan.adapter, el.adapter, el.id);
      assert.equal(plan.issue, SURFACES[el.adapter].issue, `${el.id}: keyed to the issue that brings it`);
    } else {
      assert.ok(runs.has(plan.run), `${el.id} runs on main (${plan.run})`);
    }
    if (plan.run === 'assist' || plan.run === 'image') {
      assert.ok(FOUNDER_OPTIONS.some((o) => o.key === plan.option && o.page === 'Founder · Raise · Pitch deck'), `${el.id}: ${plan.option} is a deck rail option`);
    }
  }
  // Words for an empty area are #3764's: nothing on main writes them.
  const empty = rowPlan({ area: area('free:8-4'), element: 'body', card: CARD, cardIndex: 0 });
  assert.deepEqual([empty.run, empty.adapter, empty.issue, empty.what], ['later', 'areasGenerate', 3764, EMPTY_TEXT_WHAT]);
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
});

test('several areas run in sequence until #3764: the adapter is asked first; variants 2 and 3 are off', () => {
  assert.equal(batchMode(), 'sequence');
  assert.equal(batchMode(() => ({ available: true })), 'batch', 'the day the adapter answers, the batch');
  assert.equal(batchMode((n) => (n === 'areasQuote' ? { available: true } : { available: false })), 'sequence', 'both routes, or none');
  assert.equal(variantWhy(1), null);
  assert.equal(variantWhy(2), NOT_ON);
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

test('several areas: their sum across N runs, one after another under each area\'s option, then Accept all', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: `u-${body.block.id}` }, before: body.text, after: `Synthetic ${body.block.id} after`, cost: { charged_microusd: 700 } }),
    'prefs.page': RAIL,
    'proposals.decide': async () => ({ ok: true }),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    assert.match(m.text(node(m, 'pitch-areas')), /Generate into 2 areas/);
    // The Title leads with its headline (quoted at 1000), the body with Rewrite (1200).
    assert.equal(m.pr(node(m, 'pitch-areas-row-b1-change-headline'))['aria-checked'], true);
    assert.equal(m.text(node(m, 'pitch-areas-hold')), 'Holds up to $0.0022 across 2 runs · you pay what each uses');
    assert.match(m.text(node(m, 'pitch-areas-row-b1-hold')), /Holds up to \$0\.0010/, 'each area\'s own quote');
    assert.match(m.text(node(m, 'pitch-areas-sequence')), /one after another, and is charged on its own/);
    assert.equal(m.pr(node(m, 'pitch-areas-variants-2'))['aria-disabled'], true);
    assert.equal(m.pr(node(m, 'pitch-areas-variants-2')).title, NOT_ON);
    assert.equal(m.text(node(m, 'pitch-areas-row-b2-model')), 'Synthetic deck:rewrite · $0.0004 per variant · set in the AIRail');
    assert.ok(!m.walk(node(m, 'pitch-areas-row-b2-model')).some((n) => /^(BUTTON|SELECT|INPUT)$/.test(n.tagName || '')), 'the chip is text only');
    await m.press(node(m, 'pitch-areas-variants-3'));
    assert.equal(m.pr(node(m, 'pitch-areas-variants-1'))['aria-checked'], true, 'an off variant count is not picked');
    await m.press(node(m, 'pitch-areas-generate'));
    const runs = m.calls.filter((c) => c[0] === 'assist.run');
    assert.deepEqual(runs.map((c) => c[3].block.id), ['b1', 'b2'], 'in order, one run per area');
    assert.deepEqual(runs.map((c) => c[3].action), ['headline', 'rewrite']);
    assert.deepEqual(runs[0][3].source_keys, ['revenue.mrr'], 'the headline is written from the card\'s recorded figure');
    assert.ok(runs.every((c) => decodeURIComponent(c[4]['X-Rail-Option']) === 'deck:rewrite'));
    assert.match(m.text(node(m, 'pitch-area-results-charged')), /Charged \$0\.0014 for 2 runs/);
    assert.ok(!m.by('pitch-area-results-charged') || !/\$0\.00\b/.test(m.text(m.by('pitch-area-results-charged'))));
    await m.press(node(m, 'pitch-area-results-accept-all'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'proposals.decide').map((c) => c.slice(1)), [['u-b1', 'accept'], ['u-b2', 'accept']]);
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Synthetic b1 after/);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic b2 after/, 'Accept all placed both');
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.close(); }
});

test('a refused area stops the rest; an empty area\'s words come later; adapter elements cannot be picked', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async () => { throw Object.assign(new Error('Synthetic: Eadwyn cannot run this now.'), { status: 422, code: 'synthetic' }); },
    'prefs.page': RAIL,
  } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(node(m, 'pitch-editor-selbar-ask'));
    await m.press(node(m, 'pitch-areas-generate'));
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 1, 'the refusal stopped the second run');
    assert.match(m.text(node(m, 'pitch-area-result-b1-refused')), /Eadwyn cannot run this now/);
    assert.equal(m.text(node(m, 'pitch-area-result-b2-not-run')), NOT_RUN);
    assert.ok(!m.by('pitch-area-results-charged'), 'nothing charged is claimed');
  } finally { await m.close(); }
  const n = await mountEditor({ answers: { 'assist.quote': QUOTE, 'prefs.page': RAIL } });
  try {
    await n.press(n.by('pitch-editor-area-free:8-4'));
    await n.press(node(n, 'pitch-editor-ask-area'));
    const row = 'pitch-areas-row-free:8-4';
    assert.match(n.text(node(n, `${row}-element`)), /Chart from records/, 'an empty area starts as a chart');
    assert.equal(n.text(node(n, `${row}-why`)), CHART_MIN_LINE, 'the canvas\'s limit: 3 × 3 holds no chart');
    assert.equal(n.calls.filter((c) => c[0] === 'assist.quote').length, 0, 'a refused chart is not even quoted');
    await n.press(node(n, `${row}-element`));
    await n.press(node(n, `${row}-pick-table`));
    assert.deepEqual(n.calls.filter((c) => c[0] === 'assist.quote').at(-1)[3], { action: 'table', heading: 'Synthetic traction' });
    await n.press(node(n, `${row}-element`));
    assert.equal(n.pr(node(n, `${row}-picker`)).role, 'listbox');
    assert.equal(n.pr(node(n, `${row}-pick-icons`))['aria-disabled'], true);
    assert.match(n.text(node(n, `${row}-pick-stock_photo`)), /\(pending owner\)/);
    await n.press(node(n, `${row}-pick-icons`));
    assert.match(n.text(node(n, `${row}-element`)), /Table from records/, 'a Coming later element is not picked');
    await n.press(node(n, `${row}-pick-body`));
    assert.equal(n.text(node(n, `${row}-later`)), `Coming later: ${EMPTY_TEXT_WHAT}. Not switched on yet.`);
    assert.equal(n.pr(node(n, 'pitch-areas-generate')).disabled, true, 'nothing here runs on main');
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
    const tile = [...m.walk(m.container)].find((x) => /^pitch-editor-block-/.test(m.pr(x)['data-testid'] || '') && m.pr(x).style?.gridColumn === '8 / 11' && m.pr(x).style?.gridRow === '4 / 7');
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
    const placed = [...m.walk(node(m, 'pitch-editor-blocks'))].find((x) => /^pitch-editor-block-/.test(m.pr(x)['data-testid'] || '') && m.pr(x).style?.gridColumn === '1 / 8' && m.pr(x).style?.gridRow === '2 / 7');
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
    assert.equal(n.pr(node(n, 'pitch-areas-variants-1'))['aria-checked'], true, 'the arrows skip the variant counts still to come');
  } finally { await n.close(); }
});
