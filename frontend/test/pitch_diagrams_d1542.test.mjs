/**
 * D1542 (#3780, deck v2 B4) — Diagrams on the client: the adapter's
 * `diagrams` swapped to its client, Flow, Cycle and Matrix keyed to the areas
 * route while the rest of the family stays "Coming later", a generated diagram
 * arriving as a proposal that changes nothing until Accept, its nodes editable
 * on the canvas, and the check's line, which is never "fits" when unread.
 *
 * Every venture, card and label is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { deckDiagramsApi } from '../src/lib/api/deckDiagrams.js';
import { deckAreasApi } from '../src/lib/api/deckAreas.js';
import { ELEMENTS } from '../src/pages/raise/pitch/deckV2Model.js';
import { DIAGRAM_ELEMENTS, batchArea, diagramMinLine, placeResult, rowPlan } from '../src/pages/raise/pitch/areaLightboxModel.js';
import { areaRunResults } from '../src/pages/raise/pitch/areaRunResults.js';
import {
  EMPTY_LABEL, FITS_LINE, UNCHECKED_LINE, checkLine, diagramOf, editableNodes, setNodeLabel,
} from '../src/pages/raise/pitch/diagramEditModel.js';
import { DiagramCheck, DiagramNodes } from '../src/pages/raise/pitch/DiagramNodes.jsx';
import AreaResults from '../src/pages/raise/pitch/AreaResults.jsx';

const WHOLE = { id: 'free:whole', kind: 'free', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } };
const CARD = { uid: 'card-one', title: 'How Kestrel closes the books', blocks: [{ id: 'b1', kind: 'text', style: 'heading', text: 'How Kestrel closes the books', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } }] };
const FLOW = { v: 1, type: 'flow', items: [{ label: 'Connect ledger' }, { label: 'ARR' }, { label: 'Close' }] };
const MATRIX = { v: 1, type: 'matrix', axes: { x: 'Price', y: 'Depth' }, items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }] };

test('diagrams is swapped: it answers through deckDiagramsApi.check; a 404 is still off and a failure is unreadable, never "fits"', async () => {
  // Mutation checked: leave `diagrams = off('diagrams')` → the available answer fails.
  const real = deckDiagramsApi.check;
  try {
    let asked = null;
    deckDiagramsApi.check = async (id, body) => { asked = [id, body]; return { diagram: FLOW, type: 'flow', fits: true, problems: [], figures: [], steps: { min: 2, max: 6 } }; };
    const a = await adapter.diagrams(7, { diagram: FLOW, grid: WHOLE.grid, card: 0 });
    assert.equal(a.available, true);
    assert.deepEqual(asked, [7, { diagram: FLOW, grid: WHOLE.grid, card: 0 }]);
    assert.deepEqual(checkLine(a), { ok: true, text: FITS_LINE });
    deckDiagramsApi.check = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
    assert.equal((await adapter.diagrams(7, {})).available, false);
    deckDiagramsApi.check = async () => { throw Object.assign(new Error('The check could not be read.'), { status: 500 }); };
    const bad = await adapter.diagrams(7, {});
    assert.equal(bad.unreadable, true);
    assert.deepEqual(checkLine(bad), { ok: false, text: UNCHECKED_LINE }, 'an unread check is never drawn as fits');
  } finally { deckDiagramsApi.check = real; }
  assert.ok(adapter.SWAPPED.includes('diagrams'));
  assert.equal(adapter.availability('diagrams'), null);
});

test('the picker: Flow, Cycle and Matrix generate through the areas route; Funnel, Hierarchy, Hub and spoke and 2×2 stay later', () => {
  // Mutation checked: key flow back to A('diagrams', 3780) → its route is gone and this fails.
  const by = (id) => ELEMENTS.find((e) => e.id === id);
  for (const id of ['flow', 'cycle', 'matrix']) {
    assert.equal(by(id).route, 'POST /api/decks/:id/areas', id);
    assert.equal(by(id).adapter, undefined, id);
  }
  for (const id of ['funnel', 'hierarchy', 'hub', 'positioning']) assert.deepEqual([by(id).adapter, by(id).issue], ['diagrams', 3780], id);
  assert.deepEqual(Object.keys(DIAGRAM_ELEMENTS), ['flow', 'cycle', 'matrix']);
});

test('the row: a diagram runs in the batch with no model named by the client; an area too narrow for its steps is refused, uncharged', () => {
  // Mutation checked: drop the size check → the matrix in six columns plans a run and this fails.
  const plan = rowPlan({ area: WHOLE, element: 'flow', card: CARD, cardIndex: 0 });
  assert.deepEqual(plan, { run: 'area', option: null, cardKey: 'card-one' });
  assert.deepEqual(batchArea({ key: 'free:whole', area: WHOLE, element: 'flow', plan }), { id: 'free:whole', grid: WHOLE.grid, element: 'flow' });
  const narrow = { id: 'free:n', kind: 'free', grid: { c1: 1, c2: 6, r1: 2, r2: 6 } };
  assert.deepEqual(rowPlan({ area: narrow, element: 'matrix', card: CARD, cardIndex: 0 }), { run: 'refused', why: diagramMinLine('matrix') });
  assert.equal(rowPlan({ area: narrow, element: 'cycle', card: CARD, cardIndex: 0 }).run, 'area');
  assert.equal(rowPlan({ area: WHOLE, element: 'funnel', card: CARD, cardIndex: 0 }).run, 'later');
});

test('a proposal: the diagram is drawn in the results, nothing is on the card before Accept, Accept places it and Discard leaves the card as it was', async () => {
  // Mutation checked: render the graphic proposal as a chart line (drop the AreaResults graphic branch) → no diagram is drawn and this fails.
  const block = { kind: 'graphic', graphic: 'Flow', diagram: FLOW, grid: WHOLE.grid };
  const run = { proposals: [{ uid: 'p1', card_uid: 'card-one', area_id: 'free:whole', kind: 'diagram', state: 'ready', variants: [
    { n: 1, seed: 3, model_label: 'Llama', cost_microusd: 700, seconds: 2, state: 'ready', error: null, payload: { kind: 'block', block, title: 'Flow', stripped: 1 }, critique: null },
  ] }], refused: [] };
  const { results } = areaRunResults(9, run);
  assert.deepEqual([results[0].status, results[0].kind, results[0].block.kind], ['proposed', 'block', 'graphic']);
  const before = JSON.stringify(CARD);
  const html = renderToStaticMarkup(React.createElement(AreaResults, { results: [{ ...results[0], area: WHOLE }], card: CARD, model: null, onPlace: () => {} }));
  assert.match(html, /data-diagram="flow"/);
  assert.match(html, /Checked: every number removed/);
  assert.match(html, /Accept/);
  assert.equal(JSON.stringify(CARD), before, 'nothing on the card before Accept');
  const below = { id: 'free:below', kind: 'free', grid: { c1: 1, c2: 12, r1: 2, r2: 6 } };
  const placed = placeResult(CARD, { ...results[0], area: below });
  assert.equal(placed.error, undefined, placed.error);
  assert.equal(placed.card.blocks.at(-1).kind, 'graphic');
  assert.deepEqual(placed.card.blocks.at(-1).diagram, FLOW);
  const real = deckAreasApi.discard;
  try {
    let discarded = null;
    deckAreasApi.discard = async (deckId, uid) => { discarded = [deckId, uid]; return {}; };
    await results[0].decide('discard');
    assert.deepEqual(discarded, [9, 'p1']);
  } finally { deckAreasApi.discard = real; }
  assert.equal(JSON.stringify(CARD), before, 'Discard leaves the card unchanged');
});

test('nodes edited on the canvas: one field per node, an empty label refused, a matrix axis editable, one edit through onCard', () => {
  // Mutation checked: let setNodeLabel accept an empty label → the EMPTY_LABEL refusal fails.
  const card = { ...CARD, blocks: [...CARD.blocks, { id: 'd1', kind: 'graphic', graphic: 'Matrix', diagram: MATRIX, grid: { c1: 1, c2: 8, r1: 2, r2: 6 } }] };
  const area = { id: 'd1', kind: 'block', block: card.blocks[1], grid: card.blocks[1].grid };
  assert.equal(diagramOf(area)?.id, 'd1');
  assert.equal(diagramOf({ kind: 'block', block: CARD.blocks[0] }), null);
  assert.deepEqual(editableNodes(MATRIX).map((n) => n.key), ['item-0', 'item-1', 'item-2', 'item-3', 'axis-x', 'axis-y']);
  const r = setNodeLabel(card, 'd1', { item: 1 }, '  Pricier   and broader ');
  assert.equal(r.card.blocks[1].diagram.items[1].label, 'Pricier and broader');
  assert.equal(card.blocks[1].diagram.items[1].label, 'B', 'the card is never changed in place');
  assert.equal(setNodeLabel(card, 'd1', { axis: 'y' }, 'Depth of product').card.blocks[1].diagram.axes.y, 'Depth of product');
  assert.deepEqual(setNodeLabel(card, 'd1', { item: 0 }, '   '), { error: EMPTY_LABEL });
  assert.deepEqual(setNodeLabel(card, 'd1', { item: 0 }, 'A'), { same: true });
  const html = renderToStaticMarkup(React.createElement(DiagramNodes, { block: card.blocks[1], card, aspect: '16:9', onCard: () => {} }));
  assert.equal((html.match(/<input /g) || []).length, 6);
  assert.match(html, /aria-label="Diagram step 1"/);
  assert.match(html, /aria-label="Diagram axis up"/);
  assert.match(html, /dark:bg-gray-900/);
});

test('the check line: a fit problem first, then a figure the founder typed, and an edit refusal over both', () => {
  // Mutation checked: read fits before problems in checkLine → the overflow line is lost and this fails.
  const ans = (v) => ({ available: true, value: v });
  assert.equal(checkLine(ans({ fits: false, problems: [{ kind: 'overflow', message: 'Card 1: "Long" is longer than its box in the diagram holds.' }], figures: ['$'] })).text, 'Card 1: "Long" is longer than its box in the diagram holds.');
  assert.match(checkLine(ans({ fits: true, problems: [], figures: ['$'] })).text, /labels are words: "\$" is a figure/);
  assert.equal(checkLine(null), null);
  assert.equal(checkLine({ available: false, reason: 'Not switched on yet.' }).text, null, 'a check still off says nothing');
  const html = renderToStaticMarkup(React.createElement(DiagramCheck, { block: { id: 'd1', diagram: FLOW, grid: WHOLE.grid }, check: null, error: EMPTY_LABEL }));
  assert.match(html, /A step needs words/);
  assert.match(html, /role="status"/);
});
