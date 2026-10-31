/**
 * D1604 (#3716, pd11, pd3, pd3b) — selection on The Grid.
 *
 *   · the pure `gridSelection.js`: a card's areas (blocks, then the free
 *     ranges they leave), "Area n of m · c1–7 × r2–6 · Body", click,
 *     shift-click, marquee, the keyboard (arrows, Space, Shift + arrow, Esc,
 *     Alt + arrow), locked and hidden areas skipped with the reason, a drag to
 *     a free range and a drop refused with the sentence, and what Ask opens;
 *   · the editor, mounted: no tools and the hint with nothing selected; block
 *     tools and the one Ask chip with one area; SELBAR with two or more and
 *     no block tools; the keyboard and a refused drop on the stage; the area's
 *     Ask opening Eadwyn's words for a text block and the adapter's answer for
 *     several areas.
 *
 * The owner's rules: the Grid is central, and the editor shows tools only
 * when a card or area is selected. Every card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { areaLabel, askAreaName } from '../src/pages/raise/pitch/deckV2Model.js';
import {
  HIDDEN_WHY, KEYS_LINE, LOCKED_WHY, STAGE_HINT,
  areaTitle, areasOf, askTarget, cellAt, keyStep, marquee, moveTo, nearest, nudge, pick, selectable,
} from '../src/pages/raise/pitch/gridSelection.js';
import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';

const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');
const ids = (areas) => areas.map((a) => a.id);

/* ------------------------------------------------------------------ *
 * The pure selection
 * ------------------------------------------------------------------ */

test('a card\'s areas: its blocks, then the free ranges they leave, read row by row', () => {
  const areas = areasOf(CARD, MODEL);
  assert.deepEqual(ids(areas), ['b1', 'b2', 'b3', 'free:11-2', 'free:8-4']);
  assert.deepEqual(areas.find((a) => a.id === 'free:11-2').grid, { c1: 11, c2: 12, r1: 2, r2: 6 }, 'as wide as the free run, as tall as it stays free');
  assert.deepEqual(areas.find((a) => a.id === 'free:8-4').grid, { c1: 8, c2: 10, r1: 4, r2: 6 });
  // Every cell is covered exactly once.
  const cells = new Set();
  for (const a of areas) for (let r = a.grid.r1; r <= a.grid.r2; r += 1) for (let c = a.grid.c1; c <= a.grid.c2; c += 1) {
    assert.ok(!cells.has(`${c},${r}`), `cell ${c},${r} twice`); cells.add(`${c},${r}`);
  }
  assert.equal(cells.size, 72);
  assert.equal(areasOf({ title: 'Fielded', fields: [] }, MODEL), null, 'a card from before the Grid has no areas yet');
  assert.deepEqual(ids(areasOf({ blocks: [] }, MODEL)), ['free:1-1'], 'an empty card is one free range');
});

test('labels: "c5–8 × r4–6" and "Area 2 of 5 · c1–7 × r2–6 · Body"', () => {
  assert.equal(areaLabel({ c1: 5, c2: 8, r1: 4, r2: 6 }), 'c5–8 × r4–6');
  assert.equal(areaLabel({ c1: 5, c2: 5, r1: 4, r2: 4 }), 'c5 × r4');
  const areas = areasOf(CARD, MODEL);
  assert.equal(areaTitle(areas[1], 1, areas.length), 'Area 2 of 5 · c1–7 × r2–6 · Body');
  assert.equal(areaTitle(areas[0], 0, areas.length), 'Area 1 of 5 · c1–12 × r1 · Title');
  assert.equal(areaTitle(areas[2], 2, areas.length), 'Area 3 of 5 · c8–10 × r2–3 · Metric tile');
  assert.equal(areaTitle(areas[4], 4, areas.length), 'Area 5 of 5 · c8–10 × r4–6 · Empty');
});

test('click selects one, shift-click adds or takes away, a locked or hidden area never', () => {
  const locked = { ...CARD, blocks: [...CARD.blocks.slice(0, 2), { ...CARD.blocks[2], locked: true }] };
  const areas = areasOf(locked, MODEL);
  assert.deepEqual(pick([], areas, 'b1'), ['b1']);
  assert.deepEqual(pick(['b1'], areas, 'b2'), ['b2'], 'a plain click replaces');
  assert.deepEqual(pick(['b1'], areas, 'b2', { shift: true }), ['b1', 'b2']);
  assert.deepEqual(pick(['b1', 'b2'], areas, 'b1', { shift: true }), ['b2'], 'shift on a selected area takes it away');
  assert.deepEqual(pick(['b1'], areas, 'b3', { shift: true }), ['b1'], 'locked: nothing changes');
  assert.deepEqual(selectable(areas[2]), { ok: false, why: LOCKED_WHY });
  const hidden = areasOf({ blocks: [{ ...CARD.blocks[0], hidden: true }] }, MODEL);
  assert.deepEqual(selectable(hidden[0]), { ok: false, why: HIDDEN_WHY });
  assert.deepEqual(pick([], areas, 'nope'), [], 'an id that is not on the card');
});

test('a marquee selects the blocks it touches, else the free ranges', () => {
  const areas = areasOf(CARD, MODEL);
  assert.deepEqual(marquee(areas, { c1: 6, c2: 9, r1: 2, r2: 2 }), ['b2', 'b3']);
  assert.deepEqual(marquee(areas, { c1: 1, c2: 12, r1: 1, r2: 6 }), ['b1', 'b2', 'b3']);
  assert.deepEqual(marquee(areas, { c1: 8, c2: 9, r1: 5, r2: 6 }), ['free:8-4'], 'no block: the free range');
  assert.deepEqual(marquee(areas, { c1: 9, c2: 12, r1: 5, r2: 6 }), ['free:11-2', 'free:8-4']);
  const locked = areasOf({ ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b3' ? { ...b, locked: true } : b)) }, MODEL);
  assert.deepEqual(marquee(locked, { c1: 6, c2: 9, r1: 2, r2: 2 }), ['b2'], 'a locked block is skipped');
  assert.deepEqual(marquee(areas, null), []);
});

test('the keyboard: arrows move, Shift + arrow extends, Space selects, Esc clears, Alt + arrow nudges', () => {
  const areas = areasOf(CARD, MODEL);
  assert.deepEqual(keyStep({ selection: [], focus: null }, areas, 'ArrowDown'), { selection: [], focus: 'b1' }, 'the first arrow lands on the first area');
  assert.equal(nearest(areas, 'b1', 'ArrowDown'), 'b2');
  assert.equal(nearest(areas, 'b2', 'ArrowRight'), 'b3');
  assert.equal(nearest(areas, 'b1', 'ArrowUp'), null, 'the top edge');
  assert.equal(nearest(areas, 'b3', 'ArrowLeft'), 'b2', 'the area sharing its rows, not the title above');
  assert.equal(nearest(areas, 'b3', 'ArrowRight'), 'free:11-2');
  assert.equal(nearest(areas, 'b3', 'ArrowDown'), 'free:8-4');
  // The range that shares the rows wins over a block as near above them.
  const row = areasOf({ blocks: [
    { id: 'up', kind: 'text', grid: { c1: 2, c2: 5, r1: 1, r2: 4 } },
    { id: 'here', kind: 'text', grid: { c1: 6, c2: 6, r1: 5, r2: 5 } },
  ] }, MODEL);
  assert.equal(nearest(row, 'here', 'ArrowLeft'), 'free:2-5');
  assert.deepEqual(keyStep({ selection: ['b2'], focus: 'b2' }, areas, 'ArrowRight', { shift: true }), { selection: ['b2', 'b3'], focus: 'b3' });
  assert.deepEqual(keyStep({ selection: [], focus: 'b2' }, areas, ' '), { selection: ['b2'], focus: 'b2' });
  assert.deepEqual(keyStep({ selection: ['b1'], focus: 'b2' }, areas, ' ', { shift: true }), { selection: ['b1', 'b2'], focus: 'b2' });
  assert.deepEqual(keyStep({ selection: ['b1', 'b2'], focus: 'b2' }, areas, 'Escape'), { selection: [], focus: 'b2' });
  assert.deepEqual(keyStep({ selection: ['b3'], focus: 'b3' }, areas, 'ArrowDown', { alt: true }).nudge, { id: 'b3', dc: 0, dr: 1 });
  assert.equal(keyStep({ selection: ['b1', 'b2'], focus: 'b2' }, areas, 'ArrowDown', { alt: true }).nudge, undefined, 'one block nudges, not two');
  assert.equal(keyStep({ selection: [], focus: 'b1' }, areas, 'a'), null, 'not the stage\'s key');
  const locked = areasOf({ ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b3' ? { ...b, locked: true } : b)) }, MODEL);
  assert.equal(nearest(locked, 'b2', 'ArrowRight'), 'free:8-4', 'a locked area is skipped');
});

test('a drag to a free range moves the block; a drop on a taken range is refused with the sentence', () => {
  assert.deepEqual(moveTo(CARD, 'b3', { c: 8, r: 4 }, MODEL), { grid: { c1: 8, c2: 10, r1: 4, r2: 5 } });
  assert.equal(moveTo(CARD, 'b3', { c: 6, r: 2 }, MODEL).error, 'That range overlaps the 7 × 5 text. Pick a free range.');
  assert.match(moveTo(CARD, 'b3', { c: 11, r: 4 }, MODEL).error, /must sit on the 12 × 6 grid\. Pick a free range\./);
  assert.equal(moveTo(CARD, 'b3', { c: 8, r: 2 }, MODEL).same, true, 'dropped where it was: no change');
  assert.deepEqual(nudge(CARD, 'b3', 1, 0, MODEL), { grid: { c1: 9, c2: 11, r1: 2, r2: 3 } });
  assert.match(nudge(CARD, 'b3', -1, 0, MODEL).error, /overlaps the 7 × 5 text/);
  assert.deepEqual(cellAt(150, 50, { left: 0, top: 0, width: 1000, height: 562.5 }, MODEL), { c: 2, r: 1 });
  assert.equal(cellAt(1, 1, null, MODEL), null, 'no box, no cell');
});

test('what the selection\'s Ask opens on this base', () => {
  const areas = areasOf(CARD, MODEL);
  assert.equal(askTarget(areas, ['b2']).kind, 'text');
  assert.equal(askTarget(areas, ['b3']).kind, 'refused', 'a bound figure takes no tool');
  assert.match(askTarget(areas, ['b3'], { items: [{ source_key: 'revenue.mrr', module: 'Grow › Revenue' }] }).why, /Figures come from your records\. Update Grow › Revenue/);
  assert.deepEqual(askTarget(areas, ['b1', 'b2']), { kind: 'later', adapter: 'areasGenerate', issue: 3764 }, 'several areas wait for #3764');
  assert.equal(askTarget(areas, ['free:8-4']).issue, 3764, 'an empty range too');
  assert.deepEqual(askTarget(areas, ['b2'], { aiOn: false }), { kind: 'off' });
  assert.equal(askTarget(areas, []), null);
  assert.equal(askAreaName(1), 'Ask Eadwyn about this area');
  assert.equal(askAreaName(3), 'Ask Eadwyn about these 3 areas');
});

/* ------------------------------------------------------------------ *
 * The editor, mounted
 * ------------------------------------------------------------------ */

const asks = (m) => m.walk(m.container).filter((n) => /^Ask Eadwyn about/.test(String(m.pr(n)['aria-label'] || '')));

test('nothing selected: the hint, and no block tools, no Ask chip, no SELBAR', async () => {
  const m = await mountEditor();
  try {
    assert.equal(m.text(m.by('pitch-editor-hint')), STAGE_HINT);
    assert.ok(!m.by('pitch-block-tools') && !m.by('pitch-area-tools'), 'no tools');
    assert.ok(!m.by('pitch-editor-add-block') && !m.by('pitch-editor-chart-library'), 'no Add block, no Chart library');
    assert.ok(!m.by('pitch-editor-selbar'));
    assert.equal(asks(m).length, 0);
    assert.ok(m.text().includes(KEYS_LINE));
    assert.equal(m.pr(m.by('pitch-editor-block-b2'))['aria-label'], 'Area 2 of 5 · c1–7 × r2–6 · Body');
  } finally { await m.close(); }
});

test('one area: block tools and one Ask chip; two: SELBAR and no block tools; Clear and Esc clear', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    assert.equal(m.pr(m.by('pitch-editor-block-b2'))['aria-pressed'], true);
    assert.equal(m.text(m.by('pitch-block-tools-title')), 'BODY · C1–7 × R2–6');
    assert.deepEqual(asks(m).map((n) => m.pr(n)['aria-label']), ['Ask Eadwyn about this area']);
    assert.ok(!m.by('pitch-editor-selbar'));
    await m.press(m.by('pitch-editor-block-b3'), { shiftKey: true });
    assert.match(m.text(m.by('pitch-editor-selbar')), /^2 areas selected Ask Clear$/);
    assert.deepEqual(asks(m).map((n) => m.pr(n)['aria-label']), ['Ask Eadwyn about these 2 areas'], 'one Ask, named for the selection');
    assert.ok(!m.by('pitch-block-tools'), 'several areas: no block tools');
    await m.press(m.by('pitch-editor-selbar-clear'));
    assert.ok(!m.by('pitch-editor-selbar'));
    assert.ok(m.by('pitch-editor-hint'));
    await m.press(m.by('pitch-editor-block-b1'));
    await m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: 'Escape' });
    assert.ok(!m.by('pitch-block-tools'), 'Esc clears');
    // An empty range: its own tools.
    await m.press(m.by('pitch-editor-area-free:8-4'));
    assert.match(m.text(m.by('pitch-area-tools')), /EMPTY · C8–10 × R4–6 Add a block here Chart library/);
  } finally { await m.close(); }
});

test('the keyboard on the stage: arrows move the focus, Space selects, Shift + arrow extends', async () => {
  const m = await mountEditor();
  try {
    const key = (k, over = {}) => m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: k, ...over });
    await key('ArrowDown');
    assert.equal(m.pr(m.by('pitch-editor-block-b1')).tabIndex, 0, 'the focus is on the first area');
    await key('ArrowDown');
    assert.equal(m.pr(m.by('pitch-editor-block-b2')).tabIndex, 0);
    assert.equal(m.pr(m.by('pitch-editor-block-b1')).tabIndex, -1, 'one stop in the tab order');
    await key(' ');
    assert.ok(m.by('pitch-block-tools'));
    await key('ArrowRight', { shiftKey: true });
    assert.match(m.text(m.by('pitch-editor-selbar')), /2 areas selected/);
  } finally { await m.close(); }
});

test('a drop on a taken range is refused and changes nothing; on a free range it moves the block, held until Save', async () => {
  const m = await mountEditor();
  try {
    await m.fire(m.by('pitch-editor-block-b3'), 'onDragStart', { dataTransfer: { setData() {} } });
    await m.fire(m.by('pitch-editor-block-b2'), 'onDrop');
    assert.equal(m.text(m.by('pitch-editor-drop-refused')), 'That range overlaps the 7 × 5 text. Pick a free range.');
    assert.ok(!m.by('pitch-editor-save'), 'nothing changed');
    await m.fire(m.by('pitch-editor-block-b3'), 'onDragStart', { dataTransfer: { setData() {} } });
    await m.fire(m.by('pitch-editor-area-free:8-4'), 'onDrop');
    assert.ok(!m.by('pitch-editor-drop-refused'));
    assert.equal(m.pr(m.by('pitch-editor-block-b3')).style.gridRow, '4 / 6', 'the block moved to row 4, its size kept');
    assert.ok(m.by('pitch-editor-save'), 'held until Save');
    // Alt + arrow nudges the one selected block a cell.
    await m.press(m.by('pitch-editor-block-b3'));
    await m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: 'ArrowRight', altKey: true });
    assert.equal(m.pr(m.by('pitch-editor-block-b3')).style.gridColumn, '9 / 12');
  } finally { await m.close(); }
});

test('block tools edit the block in place: words, style, and a span that overlaps says so', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.type(m.by('pitch-tools-text'), 'Synthetic new words');
    assert.match(m.text(m.by('pitch-editor-block-b2')), /Synthetic new words/);
    await m.press(m.by('pitch-tools-style-list'));
    assert.equal(m.pr(m.by('pitch-tools-style-list'))['aria-pressed'], true);
    await m.type(m.by('pitch-tools-cols'), '9');
    assert.match(m.text(m.by('pitch-tools-span-problem')), /overlaps the 3 × 2 metric tile\. Nothing changed\./);
    assert.equal(m.pr(m.by('pitch-editor-block-b2')).style.gridColumn, '1 / 8', 'the block kept its range');
    await m.type(m.by('pitch-tools-rows'), '4');
    await m.type(m.by('pitch-tools-cols'), '6');
    assert.ok(!m.by('pitch-tools-span-problem'));
    assert.equal(m.pr(m.by('pitch-editor-block-b2')).style.gridColumn, '1 / 7');
  } finally { await m.close(); }
});

test('Ask on one text area opens Eadwyn\'s words; on several areas it says Coming later, from the adapter', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    assert.ok(!m.by('pitch-assist-bar'), 'Eadwyn\'s bar waits for Ask');
    await m.press(m.by('pitch-editor-ask-area'));
    assert.ok(m.by('pitch-assist-bar'));
    await m.press(m.by('pitch-editor-block-b3'));
    await m.press(m.by('pitch-editor-ask-area'));
    assert.match(m.text(m.by('pitch-editor-ask-line')), /^Figures come from your records/);
    await m.press(m.by('pitch-editor-block-b1'), { shiftKey: true });
    await m.press(m.by('pitch-editor-selbar-ask'));
    assert.equal(m.text(m.by('pitch-editor-ask-line')), 'Coming later: Generate into several areas, with variants. Not switched on yet.');
  } finally { await m.close(); }
});

test('the source: the stage draws through BlockView; the old rail, centre card and its buttons are gone', () => {
  const stage = read('GridStage.jsx');
  assert.match(stage, /import \{ BlockView \} from '\.\/BlockGrid';/);
  assert.match(stage, /<BlockView block=\{a\.block\}/);
  const editor = read('PitchEditor.jsx');
  for (const gone of ['function Rail(', 'function CenterCard(', 'function RightPanel(', 'function DesignTab(', 'pitch-editor-callouts']) assert.ok(!editor.includes(gone), gone);
  assert.match(editor, /<CardsStrip /);
  assert.match(editor, /<GridStage /);
  assert.match(editor, /<BlockTools /);
});
