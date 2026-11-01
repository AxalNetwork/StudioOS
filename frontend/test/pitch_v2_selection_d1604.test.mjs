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
import { placeOf } from '../src/pages/raise/pitch/gridModel.js';
// D1499: a block's place is `placeOf` (boxOf on the slide), so a range is read back from its box.
const cols = (st, c1, c2) => st?.left === placeOf({ c1, c2, r1: 1, r2: 1 }).left && st?.width === placeOf({ c1, c2, r1: 1, r2: 1 }).width;
const rows = (st, r1, r2) => st?.top === placeOf({ c1: 1, c2: 1, r1, r2 }).top && st?.height === placeOf({ c1: 1, c2: 1, r1, r2 }).height;
import { readFileSync } from 'node:fs';

import { areaLabel, askAreaName } from '../src/pages/raise/pitch/deckV2Model.js';
import {
  HIDDEN_WHY, KEYS_LINE, LOCKED_WHY, STAGE_HINT,
  areaTitle, areasOf, askTarget, cellAt, keyStep, liveFocus, marquee, moveTo, nearest, nudge, pick, selectable,
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

test('one geometry (D1499): the pointer is read back onto the slide, the inverse of boxOf, at 16:9 and 4:3', () => {
  // A 16:9 face 1600 × 900 is the 1920 × 1080 slide at 5/6. Rows: the top
  // margin is 96 × 5/6 = 80, each row (1080 − 96 − 88 − 5 × 24) / 6 = 129.3 slide
  // px, so 107.8 here, with a 20 px gutter: row 1 is 80–187.8, row 2 starts 207.8.
  const box = { left: 0, top: 0, width: 1600, height: 900 };
  const at = (x, y) => cellAt(x, y, box, MODEL);
  assert.equal(at(800, 209).r, 2, 'just below the top edge of row 2');
  assert.equal(at(800, 186).r, 1, 'just above the bottom edge of row 1');
  assert.equal(at(800, 196).r, 1, 'the upper half of a gutter belongs to the row above');
  assert.equal(at(800, 200).r, 2, 'the lower half to the row below');
  // Columns: the side margin is 112 × 5/6 = 93.3, each column 119.3 slide px (99.4 here): column 2 starts 212.8.
  assert.equal(at(214, 300).c, 2);
  assert.equal(at(201, 300).c, 1, 'just right of column 1, in its half of the gutter');
  assert.deepEqual(at(0, 0), { c: 1, r: 1 }, 'the margin clamps to the edge cell');
  assert.deepEqual(at(1600, 900), { c: 12, r: 6 });
  // 4:3: the same face height, 1200 wide, is the 1440 × 1080 slide at 5/6;
  // the columns narrow to 79.3 slide px (66.1 here): column 2 starts 179.4.
  const four = (x, y) => cellAt(x, y, { left: 0, top: 0, width: 1200, height: 900 }, MODEL, { aspect: '4:3' });
  assert.equal(four(181, 300).c, 2);
  assert.equal(four(168, 300).c, 1);
  assert.equal(at(181, 300).c, 1, 'the same point at 16:9 is still column 1: the aspect is read, not assumed');
  // Every cell's centre, placed with placeOf on a face of any size, reads back as that cell.
  for (const [aspect, w, h] of [['16:9', 1600, 900], ['16:9', 733, 412.3125], ['4:3', 1200, 900], ['4:3', 517, 387.75]]) {
    for (let r = 1; r <= 6; r += 1) {
      for (let c = 1; c <= 12; c += 1) {
        const p = placeOf({ c1: c, c2: c, r1: r, r2: r }, aspect);
        const x = ((parseFloat(p.left) + parseFloat(p.width) / 2) / 100) * w;
        const y = ((parseFloat(p.top) + parseFloat(p.height) / 2) / 100) * h;
        assert.deepEqual(cellAt(x, y, { left: 0, top: 0, width: w, height: h }, MODEL, { aspect }), { c, r }, `${aspect} ${w}: c${c} r${r}`);
      }
    }
  }
  // The stage places every area from placeOf and reads the pointer with the deck's aspect: no CSS gap or padding.
  const stage = read('GridStage.jsx');
  for (const css of [/p-\[3%\]/, /inset-\[3%\]/, /inset-0 grid/, /gridTemplateColumns/, /gridColumn/, /gutterOf/]) assert.doesNotMatch(stage, css, String(css));
  assert.match(stage, /const at = placeOf\(a\.grid, aspect\)/, 'the blocks and the free areas');
  assert.match(stage, /style=\{placeOf\(box, aspect\)\}/, 'the marquee');
  assert.match(stage, /cellAt\(e\?\.clientX, e\?\.clientY, rect\(\), model, \{ aspect \}\)/);
  assert.match(stage, /aspectRatio: ratioOf\(aspect\)/, 'the face is the deck\'s slide');
});

test('the focus follows the card: a free range a block now covers hands the focus to that block', () => {
  const areas = areasOf(CARD, MODEL);
  assert.equal(liveFocus(areas, 'b2'), 'b2');
  assert.equal(liveFocus(areas, null), null);
  const moved = areasOf({ ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b3' ? { ...b, grid: { c1: 8, c2: 10, r1: 4, r2: 5 } } : b)) }, MODEL);
  assert.ok(!moved.some((a) => a.id === 'free:8-4'), 'the free range is gone');
  assert.equal(liveFocus(moved, 'free:8-4'), 'b3', 'the block that now covers its cell');
  assert.equal(liveFocus(moved, 'gone'), null, 'a removed block: no focus, the stage falls back to its first area');
  const locked = areasOf({ ...CARD, blocks: CARD.blocks.map((b) => (b.id === 'b3' ? { ...b, locked: true, grid: { c1: 8, c2: 10, r1: 4, r2: 5 } } : b)) }, MODEL);
  assert.equal(liveFocus(locked, 'free:8-4'), null, 'never onto a locked block');
});

test('what the selection\'s Ask opens: the area lightbox, or why not', () => {
  const areas = areasOf(CARD, MODEL);
  assert.deepEqual(askTarget(areas, ['b2']), { kind: 'areas', ids: ['b2'] }, 'one text area: "Generate into 1 area"');
  assert.equal(askTarget(areas, ['b3']).kind, 'refused', 'a bound figure takes no tool');
  assert.match(askTarget(areas, ['b3'], { items: [{ source_key: 'revenue.mrr', module: 'Grow › Revenue' }] }).why, /Figures come from your records\. Update Grow › Revenue/);
  assert.deepEqual(askTarget(areas, ['b1', 'b2']), { kind: 'areas', ids: ['b1', 'b2'] }, 'several areas open the one lightbox');
  assert.deepEqual(askTarget(areas, ['b3', 'b2']), { kind: 'areas', ids: ['b3', 'b2'] }, 'a bound figure among several is a row that says why');
  assert.deepEqual(askTarget(areas, ['free:8-4']), { kind: 'areas', ids: ['free:8-4'] }, 'an empty range too');
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
    // D1511 (#3762): the name is the area's position, then what it draws, so its visible words are in its name (WCAG 2.5.3).
    const b2 = m.by('pitch-editor-block-b2');
    const [nameId, faceId] = String(m.pr(b2)['aria-labelledby']).split(' ');
    const byDomId = (id) => m.walk(b2).find((n) => n.id === id || m.pr(n).id === id);
    assert.equal(m.text(byDomId(nameId)), 'Area 2 of 5 · c1–7 × r2–6 · Body');
    assert.match(m.text(byDomId(faceId)), /Synthetic body words/);
    assert.equal(m.pr(b2)['aria-label'], undefined);
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

test('a free range with the focus, then a block dropped on it: exactly one area keeps the tab stop', async () => {
  const m = await mountEditor();
  try {
    const stops = () => m.walk(m.by('pitch-editor-blocks')).filter((n) => n.tagName === 'BUTTON' && m.pr(n).tabIndex === 0).map((n) => m.pr(n)['data-testid']);
    await m.press(m.by('pitch-editor-area-free:8-4'));
    assert.deepEqual(stops(), ['pitch-editor-area-free:8-4']);
    await m.fire(m.by('pitch-editor-block-b3'), 'onDragStart', { dataTransfer: { setData() {} } });
    await m.fire(m.by('pitch-editor-area-free:8-4'), 'onDrop');
    assert.ok(!m.by('pitch-editor-area-free:8-4'), 'the block covers it now');
    assert.deepEqual(stops(), ['pitch-editor-block-b3'], 'the tab stop moved to the block that covers it');
    await m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: 'ArrowLeft' });
    assert.deepEqual(stops(), ['pitch-editor-block-b2'], 'and the keyboard goes on from there');
  } finally { await m.close(); }
});

test('after Enter on the stage, the next real click still selects', async () => {
  const m = await mountEditor();
  try {
    const key = (k) => m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: k });
    await key('ArrowDown'); await key('ArrowDown');
    await key('Enter');
    assert.equal(m.pr(m.by('pitch-editor-block-b2'))['aria-pressed'], true, 'Enter selects the focused area');
    await m.fire(m.by('pitch-editor-card'), 'onKeyUp', { key: 'Enter' });
    await m.press(m.by('pitch-editor-block-b1'));
    assert.equal(m.pr(m.by('pitch-editor-block-b1'))['aria-pressed'], true, 'no click follows Enter, so this one is the user\'s');
    await key(' ');
    await m.fire(m.by('pitch-editor-block-b3'), 'onPointerDown', { button: 0 });
    await m.press(m.by('pitch-editor-block-b3'));
    assert.equal(m.pr(m.by('pitch-editor-block-b3'))['aria-pressed'], true, 'a press that starts with a pointerdown is never swallowed');
  } finally { await m.close(); }
});

test('speaker notes show with one area, never with none or several', async () => {
  const m = await mountEditor();
  try {
    assert.ok(!m.by('pitch-editor-notes'), 'nothing selected: no notes');
    await m.press(m.by('pitch-editor-block-b2'));
    assert.equal(m.pr(m.by('pitch-editor-notes')).value, 'Synthetic note');
    await m.press(m.by('pitch-editor-block-b3'), { shiftKey: true });
    assert.ok(!m.by('pitch-editor-notes'), 'several areas: no notes');
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
    assert.ok(rows(m.pr(m.by('pitch-editor-block-b3')).style, 4, 5), 'the block moved to row 4, its size kept');
    assert.ok(m.by('pitch-editor-save'), 'held until Save');
    // Alt + arrow nudges the one selected block a cell.
    await m.press(m.by('pitch-editor-block-b3'));
    await m.fire(m.by('pitch-editor-card'), 'onKeyDown', { key: 'ArrowRight', altKey: true });
    assert.ok(cols(m.pr(m.by('pitch-editor-block-b3')).style, 9, 11));
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
    assert.ok(cols(m.pr(m.by('pitch-editor-block-b2')).style, 1, 7), 'the block kept its range');
    await m.type(m.by('pitch-tools-rows'), '4');
    await m.type(m.by('pitch-tools-cols'), '6');
    assert.ok(!m.by('pitch-tools-span-problem'));
    assert.ok(cols(m.pr(m.by('pitch-editor-block-b2')).style, 1, 6));
  } finally { await m.close(); }
});

test('Ask on one area or several opens "Generate into N areas"; a bound figure says why', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    assert.ok(!m.by('pitch-areas'), 'the lightbox waits for Ask');
    await m.press(m.by('pitch-editor-ask-area'));
    assert.ok(m.by('pitch-areas'));
    assert.ok(m.by('pitch-areas-row-b2'), 'one row, for the selected area');
    assert.match(m.text(m.by('pitch-areas')), /Generate into 1 area/);
  } finally { await m.close(); }
  const n = await mountEditor();
  try {
    await n.press(n.by('pitch-editor-block-b3'));
    await n.press(n.by('pitch-editor-ask-area'));
    assert.match(n.text(n.by('pitch-editor-ask-line')), /^Figures come from your records/);
    assert.ok(!n.by('pitch-areas'), 'nothing opens on a bound figure alone');
    await n.press(n.by('pitch-editor-block-b2'));
    await n.press(n.by('pitch-editor-block-b1'), { shiftKey: true });
    await n.press(n.by('pitch-editor-selbar-ask'));
    assert.match(n.text(n.by('pitch-areas')), /Generate into 2 areas/);
    assert.ok(n.by('pitch-areas-row-b1') && n.by('pitch-areas-row-b2'));
  } finally { await n.close(); }
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
