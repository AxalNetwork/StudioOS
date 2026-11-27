// D1511 (#3762, deck v2 A18) — property tests for the editor's Grid geometry
// and its moves, over seeded random inputs (a failure names its seed):
//
//   1. op and inverse: the centre of any cell's box falls back in that cell
//      (`cellAtPoint`, `nearestCell`), at both aspects;
//   2. a move and its inverse: a block moved to a free cell and moved back is
//      where it was; a nudge and the opposite nudge cancel;
//   3. a move never leaves the grid or lands on another block.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_grid_properties_d1511.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASPECTS, GRID, boxOf, cellAtPoint, nearestCell } from '../src/pages/raise/pitch/gridModel.js';
import { moveTo, nudge } from '../src/pages/raise/pitch/gridSelection.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const RUNS = 300;
const overlaps = (x, y) => x.c1 <= y.c2 && y.c1 <= x.c2 && x.r1 <= y.r2 && y.r1 <= x.r2;

test('1. op and inverse: any point inside a cell\'s box is that cell; a point in a gutter is no cell', () => {
  for (const aspect of ASPECTS) {
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const r = rng(seed);
      const c = int(r, 1, GRID.cols), row = int(r, 1, GRID.rows);
      const b = boxOf({ c1: c, c2: c, r1: row, r2: row }, aspect);
      const px = b.x + 1 + r() * (b.w - 2), py = b.y + 1 + r() * (b.h - 2);
      assert.deepEqual(cellAtPoint(px, py, aspect), { c, r: row }, `${aspect} seed ${seed}`);
      if (c < GRID.cols) assert.equal(cellAtPoint(b.x + b.w + 12, py, aspect), null, `${aspect} seed ${seed}: the gutter after column ${c}`);
    }
  }
});

test('1. op and inverse: a cell\'s box centre falls back in that cell, at both aspects', () => {
  for (const aspect of ASPECTS) {
    for (let c = 1; c <= GRID.cols; c += 1) for (let r = 1; r <= GRID.rows; r += 1) {
      const b = boxOf({ c1: c, c2: c, r1: r, r2: r }, aspect);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      assert.deepEqual(cellAtPoint(cx, cy, aspect), { c, r }, `${aspect} ${c},${r}`);
      assert.deepEqual(nearestCell(cx, cy, aspect), { c, r }, `${aspect} ${c},${r}`);
    }
  }
});

/** A card of one small block and a few others that do not overlap it or each other. */
function randomCard(r) {
  const blocks = [];
  for (let i = 0; i < int(r, 1, 6); i += 1) {
    const c1 = int(r, 1, GRID.cols), r1 = int(r, 1, GRID.rows);
    const g = { c1, c2: Math.min(GRID.cols, c1 + int(r, 0, 2)), r1, r2: Math.min(GRID.rows, r1 + int(r, 0, 1)) };
    if (!blocks.some((b) => overlaps(b.grid, g))) blocks.push({ id: `b${i}`, kind: 'text', style: 'paragraph', text: 'x', grid: g });
  }
  return { layout: 'statement', blocks };
}

test('2. a move and its inverse: moved and moved back, or nudged and nudged back, the block is where it was', () => {
  let moved = 0;
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const r = rng(seed);
    const card = randomCard(r);
    const block = card.blocks[0];
    const at = { c: int(r, 1, GRID.cols), r: int(r, 1, GRID.rows) };
    const there = moveTo(card, block.id, at);
    if (!there.grid || there.same) continue;
    moved += 1;
    const after = { ...card, blocks: card.blocks.map((b) => (b.id === block.id ? { ...b, grid: there.grid } : b)) };
    const back = moveTo(after, block.id, { c: block.grid.c1, r: block.grid.r1 });
    assert.deepEqual(back.grid, block.grid, `seed ${seed}: the inverse move restores it`);
    const dc = there.grid.c1 - block.grid.c1, dr = there.grid.r1 - block.grid.r1;
    const nudged = nudge(card, block.id, dc, dr);
    assert.deepEqual(nudged.grid, there.grid, `seed ${seed}: a nudge by the same offset is the same move`);
    assert.deepEqual(nudge(after, block.id, -dc, -dr).grid, block.grid, `seed ${seed}: the opposite nudge cancels it`);
  }
  assert.ok(moved > RUNS / 4, `enough moves were tried (${moved})`);
});

test('3. a move never leaves the grid or lands on another block', () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const r = rng(seed * 31);
    const card = randomCard(r);
    const block = card.blocks[int(r, 0, card.blocks.length - 1)];
    const res = moveTo(card, block.id, { c: int(r, -1, GRID.cols + 1), r: int(r, -1, GRID.rows + 1) });
    if (!res.grid) { assert.match(res.error, /Pick a free range\.|no longer on this card/, `seed ${seed}`); continue; }
    const g = res.grid;
    assert.ok(g.c1 >= 1 && g.c2 <= GRID.cols && g.r1 >= 1 && g.r2 <= GRID.rows, `seed ${seed}: inside the grid`);
    for (const other of card.blocks) if (other.id !== block.id) assert.equal(overlaps(other.grid, g), false, `seed ${seed}: clear of ${other.id}`);
  }
});
