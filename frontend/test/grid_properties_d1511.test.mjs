// D1511 (#3762, deck v2 A18) — property tests over The Grid's models, on a
// seeded PRNG (no dependency): every run draws the same cases, and a failure
// names its seed and case so it replays exactly.
//
//   no overlap · whole cells   areasProblem / sanitizeAreas against a
//                              brute-force cell oracle; the editor's areasOf
//                              (blocks plus free ranges) never overlaps and,
//                              without a structure, tiles every cell once
//   deriveAreas                sound, one area per first non-overlapping
//                              block, in reading order, and a round trip
//   reflow maps                every structure's areas keep their rows and
//                              heights at 4:3 and lose only width
//   reflow                     the result fits; no word is lost; a second
//                              reflow moves nothing; the editor's
//                              reflowCards is the Worker's reflowSlides
//   op and inverse             boxOf / cellAtPoint, nudge / un-nudge,
//                              shift-pick twice, spanOf either way, and
//                              withAspect / aspectOf
//
// Models: frontend/src/pages/raise/pitch/{gridModel,deckReflow,gridSelection}.js
// and cloudflare-worker/src/services/decks/{structures,reflow}.ts.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grid_properties_d1511.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as gm from '../src/pages/raise/pitch/gridModel.js';
import { fitsWrapped, reflowCards } from '../src/pages/raise/pitch/deckReflow.js';
import { fitText } from '../../cloudflare-worker/src/services/decks/designSystem.ts';
import { areasOf as editorAreas, marquee, nudge, pick, spanOf } from '../src/pages/raise/pitch/gridSelection.js';
import {
  MAX_AREAS, STRUCTURES, areasProblem, boxOfAt, deriveAreas, sanitizeAreas,
} from '../../cloudflare-worker/src/services/decks/structures.ts';
import { fitsAt, reflowMap, reflowSlides } from '../../cloudflare-worker/src/services/decks/reflow.ts';

const COLS = 12;
const ROWS = 6;
const RUNS = 400;
export const SEED = 0x1511;

/** mulberry32: a small, well-mixed 32-bit PRNG. Same seed, same draws. */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pickOne: (list) => list[int(0, list.length - 1)], bool: (p = 0.5) => next() < p };
}

/** Runs `prop(rand, i)` RUNS times, each case on its own derived seed, naming the seed of a failure. */
function forAll(name, prop, runs = RUNS) {
  for (let i = 0; i < runs; i += 1) {
    const seed = (SEED * 2654435761 + i) >>> 0;
    try { prop(prng(seed), i); } catch (e) { e.message = `${name}, case ${i} (seed ${seed}): ${e.message}`; throw e; }
  }
}

const range = (r) => {
  const c1 = r.int(1, COLS); const r1 = r.int(1, ROWS);
  return { c1, c2: r.int(c1, COLS), r1, r2: r.int(r1, ROWS) };
};
const key = (g) => `${g.c1}-${g.c2}-${g.r1}-${g.r2}`;
/** The oracle: each cell's count of covering ranges, by brute force. */
function coverage(ranges) {
  const n = Array.from({ length: ROWS + 1 }, () => new Array(COLS + 1).fill(0));
  for (const g of ranges) for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) n[r][c] += 1;
  return n;
}
const overlapsByOracle = (ranges) => coverage(ranges).some((row) => row.some((x) => x > 1));
const wholeOnGrid = (g) => [g.c1, g.c2, g.r1, g.r2].every(Number.isInteger) && g.c1 >= 1 && g.r1 >= 1 && g.c2 <= COLS && g.r2 <= ROWS && g.c1 <= g.c2 && g.r1 <= g.r2;
/** Non-overlapping ranges, drawn by rejection. */
function disjoint(r, max = 8) {
  const out = [];
  for (let t = 0; t < 40 && out.length < max; t += 1) {
    const g = range(r);
    if (!overlapsByOracle([...out, g])) out.push(g);
  }
  return out;
}

// ─────────────────────────────────────────────────────────── no overlap, whole cells

test('areasProblem agrees with a brute-force oracle: whole cells on the grid, no overlap, at most 12', () => {
  forAll('areasProblem', (r) => {
    const n = r.int(1, 14);
    const areas = Array.from({ length: n }, (_, i) => {
      const g = range(r);
      // Now and then a half cell or an off-grid edge.
      if (r.bool(0.05)) g.c2 += 0.5;
      if (r.bool(0.03)) g.r2 = ROWS + 1;
      return { id: `a${i}`, ...g };
    });
    const sound = areas.length <= MAX_AREAS && areas.every(wholeOnGrid) && !overlapsByOracle(areas);
    assert.equal(areasProblem(areas) === null, sound, JSON.stringify(areas));
    const kept = sanitizeAreas(areas);
    assert.equal(kept !== null, sound);
    if (kept) assert.deepEqual(kept.map(key), areas.map(key), 'a sound save keeps every range');
  });
});

test('every catalogue structure, and the editor\'s areas of any card on it, never overlap and stay on whole cells', () => {
  assert.equal(STRUCTURES.length, 17);
  forAll('editor areas on a structure', (r) => {
    const s = r.pickOne(STRUCTURES);
    assert.equal(areasProblem(s.areas), null, s.id);
    // Blocks sit exactly on some of the structure's areas; the rest are free.
    const used = s.areas.filter(() => r.bool(0.5));
    const card = { structure: s.id, blocks: used.map((a, i) => ({ id: `b${i}`, kind: 'text', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 } })) };
    const areas = editorAreas(card);
    assert.ok(areas.every((a) => wholeOnGrid(a.grid)), 'whole cells');
    assert.equal(overlapsByOracle(areas.map((a) => a.grid)), false, `${s.id}: ${JSON.stringify(areas.map((a) => a.id))}`);
    assert.equal(areas.length, s.areas.length, `${s.id}: every structure area is a block or free, once`);
    assert.equal(new Set(areas.map((a) => a.id)).size, areas.length, 'ids are unique');
  });
});

test('without a structure, the editor\'s blocks and free ranges tile every cell exactly once', () => {
  forAll('editor areas, free ranges', (r) => {
    const blocks = disjoint(r).map((g, i) => ({ id: `b${i}`, kind: 'text', grid: g }));
    const areas = editorAreas({ blocks });
    const n = coverage(areas.map((a) => a.grid));
    for (let row = 1; row <= ROWS; row += 1) for (let c = 1; c <= COLS; c += 1) assert.equal(n[row][c], 1, `cell ${c},${row}`);
    assert.deepEqual(areas.filter((a) => a.kind === 'block').map((a) => a.id), blocks.map((b) => b.id), 'blocks first, in order');
  });
});

// ─────────────────────────────────────────────────────────── deriveAreas

test('deriveAreas: sound, one area per first non-overlapping block, in reading order, and a round trip', () => {
  forAll('deriveAreas', (r) => {
    const blocks = Array.from({ length: r.int(0, 16) }, () => ({ grid: r.bool(0.05) ? { c1: 0, c2: 3, r1: 1, r2: 1 } : range(r) }));
    const areas = deriveAreas(blocks);
    assert.equal(areasProblem(areas), null);
    // The oracle: walk the blocks, keep each sound one that overlaps nothing kept, up to 12.
    const kept = [];
    for (const b of blocks) if (wholeOnGrid(b.grid) && !overlapsByOracle([...kept, b.grid]) && kept.length < MAX_AREAS) kept.push(b.grid);
    if (!kept.length) { assert.deepEqual(areas.map(key), ['1-12-1-6']); return; }
    assert.deepEqual(new Set(areas.map(key)), new Set(kept.map(key)));
    const sorted = [...areas].sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1);
    assert.deepEqual(areas.map(key), sorted.map(key), 'top to bottom, then left to right');
    assert.deepEqual(areas.map((a) => a.order), areas.map((_, i) => i + 1));
    assert.deepEqual(deriveAreas(areas.map((a) => ({ grid: a }))).map(key), areas.map(key), 'round trip');
  });
});

// ─────────────────────────────────────────────────────────── reflow maps

test('reflow maps: every structure area keeps its row, top and height at 4:3 and loses only width; the frontend boxes are the Worker\'s', () => {
  const map = reflowMap();
  assert.deepEqual(map.map((m) => m.id), STRUCTURES.map((s) => s.id));
  for (const m of map) {
    const s = STRUCTURES.find((x) => x.id === m.id);
    m.areas.forEach((a, i) => {
      const wide = a.boxes['16:9']; const narrow = a.boxes['4:3'];
      assert.deepEqual([narrow.y, narrow.h], [wide.y, wide.h], `${m.id}.${a.id}`);
      assert.ok(narrow.w < wide.w && narrow.x <= wide.x, `${m.id}.${a.id} narrows`);
      assert.equal(a.width_kept, Math.round((narrow.w / wide.w) * 1000) / 1000);
      assert.deepEqual(narrow, boxOfAt(s.areas[i], '4:3'));
      assert.ok(narrow.x + narrow.w <= 1440 && wide.x + wide.w <= 1920, 'inside the slide');
    });
  }
  forAll('box parity', (r) => {
    const g = range(r);
    for (const aspect of gm.ASPECTS) assert.deepEqual(gm.boxOf(g, aspect), boxOfAt(g, aspect), `${aspect} ${key(g)}`);
  });
});

// ─────────────────────────────────────────────────────────── reflow

const WORDS = ['ledger', 'close', 'finance', 'teams', 'month', 'review', 'entries', 'reconcile', 'cash', 'a', 'the', 'customers', 'pilot'];
function randomCard(r) {
  const blocks = disjoint(r, 6).map((g, i) => (r.bool(0.75)
    ? { id: `t${i}`, kind: 'text', style: r.pickOne(['heading', 'paragraph', 'list']), grid: g, text: Array.from({ length: r.int(1, 90) }, () => r.pickOne(WORDS)).join(' ') }
    : { id: `m${i}`, kind: 'metric', grid: g, label: 'Synthetic figure', value: '$'.concat(String(r.int(1, 10 ** r.int(1, 9)))) }));
  return { layout: r.bool(0.3) ? 'title' : null, blocks, ...(r.bool(0.3) ? { notes: 'Earlier notes.' } : {}) };
}
const squash = (s) => s.replace(/\s+/g, ' ').trim();

test('reflow to 4:3: the result fits, no word is lost, a second reflow moves nothing, and the editor\'s reflow is the Worker\'s', () => {
  let movedAny = 0;
  forAll('reflow', (r) => {
    const cards = Array.from({ length: r.int(1, 4) }, () => randomCard(r));
    const out = reflowSlides(cards, '4:3', '16:9');
    assert.equal(fitsAt(out.slides, '4:3'), true, 'nothing the aspect decides overflows');
    assert.equal(out.count, out.moved.length);
    movedAny += out.count;
    // No word is lost: each trimmed text block's kept words then its moved words are the original.
    for (const m of out.moved) {
      const before = cards[m.card - 1].blocks.find((b) => b.id === m.block);
      const after = out.slides[m.card - 1].blocks.find((b) => b.id === m.block);
      if (before.kind === 'text') assert.equal(squash(`${after ? after.text : ''} ${m.text}`), squash(before.text), `card ${m.card} ${m.block}`);
      else assert.equal(after, undefined, 'a figure that no longer fits leaves the slide whole');
      assert.ok(out.slides[m.card - 1].notes.includes(m.text.slice(0, 40)), 'its words are in the notes');
    }
    // The inverse direction moves nothing, and a second switch to 4:3 moves nothing.
    assert.equal(reflowSlides(out.slides, '4:3', '4:3').count, 0, 'idempotent');
    assert.equal(reflowSlides(out.slides, '16:9', '4:3').count, 0, 'going wider moves nothing');
    // Parity: the editor runs the same reflow on its draft.
    const front = reflowCards(cards, '4:3');
    assert.deepEqual(front.cards, out.slides);
    assert.deepEqual(front.moved, out.moved);
  }, 250);
  assert.ok(movedAny > 50, `the cases exercise the move (${movedAny} blocks moved)`);
});

test('the editor\'s wrapped fit is D1517\'s fitText, for any range, role, text and aspect', () => {
  // Found by the property above: after D1517 the reflow kept text that the count said fits but the
  // balanced wrap did not, at 4:3. Both sides now trim to the wrapped fit; this holds the mirror equal.
  forAll('fitsWrapped', (r) => {
    const g = range(r);
    const role = r.pickOne(['display', 'heading', 'subheading', 'paragraph', 'list', 'caption', 'kicker']);
    const text = Array.from({ length: r.int(1, 60) }, () => r.pickOne([...WORDS, 'reconciliation', 'multi-entity'])).join(' ');
    const aspect = r.pickOne(gm.ASPECTS);
    assert.equal(fitsWrapped(g, role, text, aspect), fitText(g, role, text, aspect).fits, `${role} ${aspect} ${key(g)} ${text.length}`);
  });
});

// ─────────────────────────────────────────────────────────── op and inverse

test('op and inverse: boxOf / cellAtPoint, nudge / un-nudge, shift-pick twice, spanOf either way, withAspect / aspectOf', () => {
  forAll('op/inverse', (r) => {
    const aspect = r.pickOne(gm.ASPECTS);
    // A point inside a cell's box reads back as that cell.
    const c = r.int(1, COLS); const row = r.int(1, ROWS);
    const b = gm.boxOf({ c1: c, c2: c, r1: row, r2: row }, aspect);
    const px = b.x + 1 + r.next() * (b.w - 2); const py = b.y + 1 + r.next() * (b.h - 2);
    assert.deepEqual(gm.cellAtPoint(px, py, aspect), { c, r: row }, `${aspect} ${px},${py}`);
    assert.deepEqual(gm.nearestCell(px, py, aspect), { c, r: row });

    // A nudge that lands, then the opposite nudge, puts the block back.
    const blocks = disjoint(r, 5).map((g, i) => ({ id: `b${i}`, kind: 'text', grid: g }));
    if (blocks.length) {
      const target = r.pickOne(blocks);
      const [dc, dr] = r.pickOne([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      const there = nudge({ blocks }, target.id, dc, dr);
      if (there.grid) {
        const moved = { blocks: blocks.map((x) => (x.id === target.id ? { ...x, grid: there.grid } : x)) };
        const back = nudge(moved, target.id, -dc, -dr);
        assert.deepEqual(back.grid, target.grid, 'the inverse nudge restores the range');
      } else {
        assert.match(there.error, /Pick a free range|no longer/, 'a refused nudge says why');
      }
    }

    // Shift-pick toggles: twice is no change; a plain pick is the one area.
    const areas = editorAreas({ blocks });
    const sel = areas.filter(() => r.bool(0.3)).map((a) => a.id);
    const id = r.pickOne(areas).id;
    assert.deepEqual(pick(pick(sel, areas, id, { shift: true }), areas, id, { shift: true }).sort(), [...sel].sort());
    assert.deepEqual(pick(sel, areas, id), [id]);

    // A marquee selects only what it touches; spanOf is the same span either way.
    const from = { c: r.int(1, COLS), r: r.int(1, ROWS) }; const to = { c: r.int(1, COLS), r: r.int(1, ROWS) };
    const span = spanOf(from, to);
    assert.deepEqual(spanOf(to, from), span);
    for (const hit of marquee(areas, span)) {
      const g = areas.find((a) => a.id === hit).grid;
      assert.ok(g.c1 <= span.c2 && span.c1 <= g.c2 && g.r1 <= span.r2 && span.r1 <= g.r2, `${hit} touches the marquee`);
    }

    // The slide size round-trips through a theme.
    const theme = r.pickOne([null, { kind: 'brand' }, { kind: 'neutral_dark' }, { kind: 'neutral_light', aspect: '4:3' }]);
    assert.equal(gm.aspectOf(gm.withAspect(theme, aspect)?.aspect), aspect);
  });
});
