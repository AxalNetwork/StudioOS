// D1513 (#3765, deck v2 A4) — the 17 structures on a card, the dividers
// between blocks, and the structure's reading order.
//
//   pd10  ⋯ › This card › Structure: 17 tiles (mini, name, use, "Recommended
//         for Seed"); pointing at one says what would move ("1 block moves to
//         the notes"); choosing one is one edit, and nothing is lost.
//   pd12  a divider between two blocks: arrows or a pointer, whole cells,
//         "7 | 5 → 6 | 6"; "A chart needs at least 4 × 3 cells."; "N words
//         over · Move overflow to notes", one edit.
//   §5    the reading order is the structure's (`area.order`).
//
// Every card, block and word is synthetic.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_structures_dividers_d1513.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRUCTURES, GRID } from '../src/pages/raise/pitch/gridModel.js';
import {
  MIN_CELLS, MOVED_HEADING, OVERFLOW_HEADING, applyStructure, minSizeProblem, movedLine, moveOverflow, overLine, overflowOf, readingOrder,
} from '../src/pages/raise/pitch/structureModel.js';
import { areasOf, dividerDelta, dividerReadout, dividersOf, moveDivider, nearest } from '../src/pages/raise/pitch/gridSelection.js';
import { dividerBox } from '../src/pages/raise/pitch/GridStage.jsx';
import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const overlaps = (a, b) => a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;
const inside = (g, a) => a.c1 <= g.c1 && g.c2 <= a.c2 && a.r1 <= g.r1 && g.r2 <= a.r2;

test('seventeen structures; each applied to a card keeps every block, on the slide or in the notes, with no overlap', () => {
  // Mutations checked: a moved block dropped from the notes, two blocks given one area, the reading order ignored — each red.
  assert.equal(STRUCTURES.length, 17);
  const card = {
    ...CARD,
    blocks: [...CARD.blocks, { id: 'b4', kind: 'chart', grid: { c1: 11, c2: 12, r1: 4, r2: 6 }, title: 'Synthetic chart' }],
  };
  for (const s of STRUCTURES) {
    const r = applyStructure(card, s.id);
    assert.ok(!r.error, `${s.id}: ${r.error}`);
    assert.equal(r.card.structure, s.id);
    assert.equal(r.card.blocks.length + r.count, card.blocks.length, `${s.id}: every block is placed or moved`);
    for (const b of r.card.blocks) {
      assert.ok(s.areas.some((a) => inside(b.grid, a)), `${s.id}: ${b.id} sits in an area`);
      assert.equal(minSizeProblem(b, b.grid), null, `${s.id}: ${b.id} keeps its minimum`);
      for (const o of r.card.blocks) if (o !== b) assert.ok(!overlaps(b.grid, o.grid), `${s.id}: ${b.id} overlaps ${o.id}`);
    }
    if (r.count) {
      assert.ok(r.card.notes.startsWith('Synthetic note'), `${s.id}: the notes the card had stay first`);
      assert.ok(r.card.notes.includes(MOVED_HEADING), s.id);
      for (const m of r.moved) assert.ok(r.card.notes.includes(m.text), `${s.id}: ${m.id} is in the notes`);
    }
    assert.equal(r.card.areas.length, s.areas.length, `${s.id}: the card keeps the structure's areas`);
  }
});

test('blocks take the areas in reading order; a chart passes over an area smaller than 4 × 3', () => {
  const hero = applyStructure(CARD, 'hero_3');
  assert.deepEqual(readingOrder(CARD.blocks).map((b) => b.id), ['b1', 'b2', 'b3'], 'top to bottom, then left to right');
  assert.deepEqual(hero.card.blocks.map((b) => [b.id, b.grid]), [
    ['b1', { c1: 1, c2: 12, r1: 1, r2: 3 }],
    ['b2', { c1: 1, c2: 4, r1: 4, r2: 6 }],
    ['b3', { c1: 5, c2: 8, r1: 4, r2: 6 }],
  ]);
  assert.equal(hero.count, 0);
  assert.equal(movedLine(0), 'Every block keeps a place.');

  const full = applyStructure(CARD, 'full');
  assert.equal(full.count, 2);
  assert.equal(movedLine(full.count), '2 blocks move to the notes');
  assert.equal(movedLine(1), '1 block moves to the notes');
  assert.match(full.card.notes, /Moved from the slide when its structure changed:\nSynthetic body words\nMRR: 4200$/);

  assert.deepEqual(MIN_CELLS.chart, { cols: 4, rows: 3 });
  const chart = { id: 'c1', kind: 'chart', grid: { c1: 1, c2: 12, r1: 1, r2: 6 }, title: 'Synthetic chart' };
  const q = applyStructure({ blocks: [chart] }, 'quarters');
  assert.equal(q.count, 1, 'every quarter is 3 columns wide');
  assert.equal(q.moved[0].why, 'A chart needs at least 4 × 3 cells.');
  const big = applyStructure({ blocks: [{ id: 't', kind: 'text', grid: { c1: 1, c2: 1, r1: 1, r2: 1 }, text: 'x' }, chart] }, 'big_number');
  assert.deepEqual(big.card.blocks.map((b) => b.id), ['t', 'c1'], 'the text takes the number area, the chart the 4 × 4 context');
  assert.deepEqual(big.card.blocks[1].grid, { c1: 9, c2: 12, r1: 1, r2: 4 });
  assert.equal(applyStructure(CARD, 'nope').error, 'That structure is not one of the seventeen.');
});

test('a structured card reads in the structure\'s order, for the tab order and for the arrows', () => {
  // Mutation checked: areas left in block-then-free order — red.
  const z = { blocks: [{ id: 'b1', kind: 'text', grid: { c1: 6, c2: 12, r1: 4, r2: 6 }, text: 'Synthetic' }], structure: 'z_pattern' };
  const areas = areasOf(z, MODEL);
  assert.deepEqual(areas.map((a) => [a.id, a.order]), [['free:1-1', 1], ['free:8-1', 2], ['free:1-4', 3], ['b1', 4]]);
  const two = { blocks: [], structure: 'two_by_two' };
  const quads = areasOf(two, MODEL);
  // The arrows still go by place: Up from the bottom-left quarter is the top-left one.
  assert.equal(nearest(quads, 'free:1-4', 'ArrowUp'), 'free:1-1');
});

test('dividers: where two blocks meet, one edit moves both, whole cells, with pd12\'s readout and refusals', () => {
  // Mutations checked: a divider moved for one block only, the chart minimum skipped, the overlap check skipped,
  // a side allowed to reach zero cells — each red.
  const ids = dividersOf(CARD).map((d) => d.id).sort();
  assert.deepEqual(ids, ['h:b1|b2', 'h:b1|b3', 'v:b2|b3']);
  const v = dividersOf(CARD).find((d) => d.id === 'v:b2|b3');
  assert.equal(v.at, 8);
  assert.equal(dividerReadout(CARD, v), '7 | 3');
  assert.equal(dividerReadout(CARD, v, -1), '7 | 3 → 6 | 4');
  assert.deepEqual(dividerBox(CARD, v), { c1: 7, c2: 8, r1: 2, r2: 3 }, 'the handle sits over the rows both blocks share');
  const r = moveDivider(CARD, v, 1, MODEL, minSizeProblem);
  assert.deepEqual(r.grids, { b2: { c1: 1, c2: 8, r1: 2, r2: 6 }, b3: { c1: 9, c2: 10, r1: 2, r2: 3 } });
  assert.equal(r.card.blocks.find((b) => b.id === 'b1'), CARD.blocks[0], 'the other blocks are untouched');
  assert.equal(moveDivider(CARD, v, 3, MODEL, minSizeProblem).error, 'Each side keeps at least one cell.');
  assert.ok(moveDivider(CARD, v, 0).same);
  // Moving the heading's lower edge down would run it into the metric.
  const h = dividersOf(CARD).find((d) => d.id === 'h:b1|b2');
  assert.match(moveDivider(CARD, h, 1, MODEL, minSizeProblem).error, /overlaps/);
  // A chart keeps 4 × 3.
  const charted = { blocks: [{ id: 'a', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 6 }, text: 'Synthetic' }, { id: 'c', kind: 'chart', grid: { c1: 7, c2: 10, r1: 1, r2: 6 } }] };
  const cd = dividersOf(charted)[0];
  assert.equal(moveDivider(charted, cd, 1, MODEL, minSizeProblem).error, 'A chart needs at least 4 × 3 cells.');
  assert.ok(moveDivider(charted, cd, -1, MODEL, minSizeProblem).card);
  assert.equal(dividerDelta(cd, 9), 2);
  assert.equal(dividerDelta(cd, undefined), 0);
});

test('a text block made smaller says how many words are over, and Move overflow to notes keeps every word', () => {
  // Mutations checked: overflow measured at the old size, the cut words dropped instead of moved — each red.
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const card = { notes: 'Synthetic note', blocks: [{ id: 't', kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 3, r1: 1, r2: 1 }, text: long }] };
  const o = overflowOf(card, 't');
  assert.ok(o && o.words > 0 && o.words < 60, JSON.stringify(o));
  assert.equal(overLine(1), '1 word over');
  assert.equal(overLine(18), '18 words over');
  const r = moveOverflow(card, 't');
  assert.equal(r.moved, o.words);
  const kept = r.card.blocks[0].text;
  assert.equal(overflowOf(r.card, 't'), null, 'what stays fits');
  assert.ok(r.card.notes.startsWith(`Synthetic note\n\n${OVERFLOW_HEADING}\n`));
  assert.equal(`${kept} ${r.card.notes.split(`${OVERFLOW_HEADING}\n`)[1]}`, long, 'no word is lost');
  assert.ok(moveOverflow(r.card, 't').same);
  assert.equal(overflowOf({ blocks: [{ id: 'm', kind: 'metric', grid: { c1: 1, c2: 1, r1: 1, r2: 1 } }] }, 'm'), null, 'only text overflows into words');
});

test('the editor: Structure offers 17 tiles with a preview, and applying one is one edit with a line for what moved', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-structure'));
    for (const s of STRUCTURES) assert.ok(m.by(`pitch-structure-${s.id}`), s.id);
    assert.match(m.text(m.by('pitch-structure-hero_3')), /Hero \+ 3 Product plus features Recommended for Seed/);
    assert.ok(m.by('pitch-editor-layout-title'), 'the presets stay');
    assert.match(m.text(m.by('pitch-structure-preview')), /Point at a structure/);
    await m.fire(m.by('pitch-structure-full'), 'onFocus');
    assert.equal(m.text(m.by('pitch-structure-preview')), 'Full: 2 blocks move to the notes (text, metric).');
    assert.ok(m.by('pitch-editor-block-b2'), 'a preview changes nothing');
    await m.press(m.by('pitch-structure-full'));
    assert.equal(m.by('pitch-sheet-structure'), undefined, 'the sheet closes');
    assert.equal(m.by('pitch-editor-block-b2'), undefined);
    assert.match(m.text(m.by('pitch-editor-structure-note')), /^2 blocks move to the notes\. The speaker notes keep each one\.$/);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    assert.match(m.pr(m.by('pitch-editor-block-b1'))['aria-label'], /c1–12 × r1–6/);
  } finally { await m.close(); }
});

test('the editor: a divider moves by arrow keys, says its readout, refuses with its sentence, and never moves the selection', async () => {
  const m = await mountEditor();
  try {
    const d = m.by('pitch-editor-divider-v:b2|b3');
    assert.ok(d, 'a divider between the body and the metric');
    const p = m.pr(d);
    assert.equal(p.role, 'separator');
    assert.equal(p['aria-orientation'], 'vertical');
    assert.equal(p.tabIndex, 0);
    assert.equal(p['aria-valuetext'], '7 | 3');
    let stopped = false;
    await m.fire(d, 'onKeyDown', { key: 'ArrowRight', stopPropagation() { stopped = true; } });
    assert.ok(stopped, 'the arrow does not also move the area focus');
    assert.match(m.pr(m.by('pitch-editor-block-b2'))['aria-label'], /c1–8 × r2–6/);
    assert.match(m.pr(m.by('pitch-editor-block-b3'))['aria-label'], /c9–10 × r2–3/);
    assert.equal(m.text(m.by('pitch-editor-divider-line')), '7 | 3 → 8 | 2');
    await m.fire(m.by('pitch-editor-divider-v:b2|b3'), 'onKeyDown', { key: 'ArrowRight' });
    await m.fire(m.by('pitch-editor-divider-v:b2|b3'), 'onKeyDown', { key: 'ArrowRight' });
    assert.equal(m.text(m.by('pitch-editor-divider-refused')), 'Each side keeps at least one cell.');
    assert.match(m.pr(m.by('pitch-editor-block-b3'))['aria-label'], /c10 × r2–3/, 'the refused move changed nothing');
    await m.fire(m.by('pitch-editor-divider-v:b2|b3'), 'onKeyDown', { key: 'ArrowUp' });
    assert.match(m.pr(m.by('pitch-editor-block-b3'))['aria-label'], /c10 × r2–3/, 'a vertical divider ignores Up');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.close(); }
});

test('the editor: a smaller text block offers Move overflow to notes, one edit', async () => {
  const long = Array.from({ length: 50 }, (_, i) => `syn${i}`).join(' ');
  const deck = {
    id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: null,
    slides: [{ title: 'Synthetic', notes: '', blocks: [
      { id: 'a', kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 6, r1: 1, r2: 2 }, text: long },
      { id: 'b', kind: 'text', style: 'paragraph', grid: { c1: 7, c2: 12, r1: 1, r2: 2 }, text: 'Synthetic' },
    ] }],
  };
  const m = await mountEditor({ answers: { deckGet: async () => deck } });
  try {
    for (let i = 0; i < 3; i += 1) await m.fire(m.by('pitch-editor-divider-v:a|b'), 'onKeyDown', { key: 'ArrowLeft' });
    const line = m.by('pitch-editor-overflow');
    assert.ok(line, 'the overflow line');
    assert.match(m.text(line), /^\d+ words over · Move overflow to notes One edit$/);
    await m.press(m.by('pitch-editor-overflow-move'));
    assert.equal(m.by('pitch-editor-overflow'), undefined);
    assert.doesNotMatch(m.text(m.by('pitch-editor-block-a')), /syn49/, 'the last words left the slide');
  } finally { await m.close(); }
});

test('the source: dividers are separators, keyboard first, and the drag snaps through moveDivider and placementProblem', () => {
  const stage = read('pages/raise/pitch/GridStage.jsx');
  assert.match(stage, /role="separator" tabIndex=\{0\} aria-orientation=/);
  assert.match(stage, /moveDivider\(card, div, delta, model, minSizeProblem\)/);
  assert.match(stage, /dividerDelta\(div, div\.axis === 'v' \? at\.c : at\.r\)/);
  assert.match(stage, /dividersOf\(card\) : \[\]/, 'no divider on a read-only card');
  const sel = read('pages/raise/pitch/gridSelection.js');
  assert.match(sel, /placementProblem\(next, ga, model, a\.id\) \|\| placementProblem\(next, gb, model, b\.id\)/);
  assert.ok(GRID.cols === 12 && GRID.rows === 6);
});
