/**
 * D1511 (#3762, deck v2 A18) — property tests for The Grid (D1499), over
 * seeded random inputs, so a failure names its seed and replays:
 *
 *   1. every structure, at both aspects: whole cells, no overlap, every box
 *      inside the safe frame, and no two boxes sharing a pixel;
 *   2. `deriveAreas`, for any blocks: sound areas (whole cells, no overlap, at
 *      most 12), in reading order, each one of the blocks' own ranges, and
 *      stable when derived again;
 *   3. `sanitizeAreas` is idempotent, and refuses exactly what `areasProblem`
 *      names.
 *   4. bounded generated layouts agree with an independent cell-occupancy
 *      model; failures shrink and include a seed and path for replay.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grid_properties_d1511.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { GRID_COLS, GRID_ROWS } from '../src/services/decks/slideModel.ts';
import { ASPECTS, FRAME, MAX_AREAS, SLIDE_SIZES, STRUCTURES, areasProblem, boxOfAt, deriveAreas, sanitizeAreas } from '../src/services/decks/structures.ts';

/** A seeded generator (mulberry32): the same seed, the same inputs. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const RUNS = 400;

function randomRange(r: () => number) {
  const c1 = int(r, 1, GRID_COLS), r1 = int(r, 1, GRID_ROWS);
  return { c1, c2: int(r, c1, GRID_COLS), r1, r2: int(r, r1, GRID_ROWS) };
}
/** Blocks as an old deck may hold them: some ranges overlap, some are not whole cells, some are missing. */
function randomBlocks(r: () => number) {
  return Array.from({ length: int(r, 0, 16) }, (_, i) => {
    const roll = r();
    if (roll < 0.08) return { id: `b${i}`, kind: 'text' };
    if (roll < 0.14) return { id: `b${i}`, kind: 'text', grid: { c1: 0, c2: 13, r1: 1.5, r2: 2 } };
    return { id: `b${i}`, kind: 'text', grid: randomRange(r) };
  });
}
const cellsOf = (g: { c1: number; c2: number; r1: number; r2: number }) => {
  const out: string[] = [];
  for (let c = g.c1; c <= g.c2; c += 1) for (let rr = g.r1; rr <= g.r2; rr += 1) out.push(`${c},${rr}`);
  return out;
};
const pixelsOverlap = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ── 1. The structures ────────────────────────────────────────────────────

test('1. every structure, at both aspects: whole cells, no overlap, boxes inside the frame and apart', () => {
  assert.equal(STRUCTURES.length, 17);
  for (const s of STRUCTURES) {
    assert.equal(areasProblem(s.areas), null, s.id);
    const cells = s.areas.flatMap(cellsOf);
    assert.equal(new Set(cells).size, cells.length, `${s.id}: no cell in two areas`);
    for (const aspect of ASPECTS) {
      const slide = SLIDE_SIZES[aspect];
      const boxes = s.areas.map((a) => boxOfAt(a, aspect));
      for (const b of boxes) {
        assert.ok(b.x >= FRAME.marginX - 1 && b.y >= FRAME.marginTop - 1, `${s.id} ${aspect}: inside the top-left margin`);
        assert.ok(b.x + b.w <= slide.width - FRAME.marginX + 1 && b.y + b.h <= slide.height - FRAME.marginBottom + 1, `${s.id} ${aspect}: inside the bottom-right margin`);
        assert.ok(b.w > 0 && b.h > 0);
      }
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        assert.equal(pixelsOverlap(boxes[i], boxes[j]), false, `${s.id} ${aspect}: ${s.areas[i].id} and ${s.areas[j].id} share no pixel`);
      }
    }
  }
});

// ── 2. deriveAreas ───────────────────────────────────────────────────────

test('2. deriveAreas, for any blocks: sound, in reading order, each a block\'s own range, and stable', () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const r = rng(seed);
    const blocks = randomBlocks(r);
    const areas = deriveAreas(blocks);
    const why = `seed ${seed}`;
    assert.equal(areasProblem(areas), null, why);
    assert.ok(areas.length >= 1 && areas.length <= MAX_AREAS, why);
    for (let i = 1; i < areas.length; i += 1) {
      const p = areas[i - 1], q = areas[i];
      assert.ok(p.r1 < q.r1 || (p.r1 === q.r1 && p.c1 < q.c1), `${why}: reading order`);
    }
    areas.forEach((a, i) => assert.equal(a.order, i + 1, why));
    const ranges = blocks.map((b: any) => b.grid).filter(Boolean).map((g: any) => `${g.c1}-${g.c2}-${g.r1}-${g.r2}`);
    const sound = ranges.length && areas.length && !(areas.length === 1 && areas[0].c1 === 1 && areas[0].c2 === GRID_COLS && areas[0].r1 === 1 && areas[0].r2 === GRID_ROWS && !ranges.includes(`1-${GRID_COLS}-1-${GRID_ROWS}`));
    if (sound) for (const a of areas) assert.ok(ranges.includes(`${a.c1}-${a.c2}-${a.r1}-${a.r2}`), `${why}: ${a.id} is a block's own range`);
    const again = deriveAreas(areas.map((a) => ({ grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 } })));
    assert.deepEqual(again, areas, `${why}: deriving again changes nothing`);
  }
});

test('2. no block reads as one Full area', () => {
  assert.deepEqual(deriveAreas([]).map((a) => [a.c1, a.c2, a.r1, a.r2]), [[1, GRID_COLS, 1, GRID_ROWS]]);
});

// ── 3. sanitizeAreas ─────────────────────────────────────────────────────

test('3. sanitizeAreas is idempotent and refuses exactly what areasProblem names', () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const r = rng(seed * 7919);
    const areas = Array.from({ length: int(r, 0, 14) }, (_, i) => ({ id: r() < 0.05 ? `a${i - 1}` : `a${i}`, ...randomRange(r), ...(r() < 0.1 ? { inset: int(r, 0, 6) } : {}), ...(r() < 0.5 ? { order: int(r, 1, 20) } : {}) }));
    const once = sanitizeAreas(areas);
    assert.equal(once === null, areasProblem(areas) !== null, `seed ${seed}`);
    if (!once) continue;
    assert.deepEqual(sanitizeAreas(once), once, `seed ${seed}: idempotent`);
    once.forEach((a, i) => assert.equal(a.order, (areas[i] as any).order ?? i + 1, `seed ${seed}: a saved reading order is kept`));
  }
});

// D8005: enumerate the documented 12 by 6 cells independently of the
// production range/overlap helpers. Generated inputs always have valid ids;
// this model checks geometry, repeated ids and the twelve-area limit.
type GeneratedRange = { c1: number; c2: number; r1: number; r2: number };
type GeneratedArea = GeneratedRange & { id: string };
const MODEL_CELLS = Array.from({ length: 72 }, (_, i) => ({ c: i % 12 + 1, r: Math.floor(i / 12) + 1 }));
const oneCell = (i: number): GeneratedRange => ({ c1: i % 12 + 1, c2: i % 12 + 1, r1: Math.floor(i / 12) + 1, r2: Math.floor(i / 12) + 1 });
const identified = (ranges: GeneratedRange[]): GeneratedArea[] => ranges.map((g, i) => ({ id: `a${i}`, ...g }));

function modelCells(g: GeneratedRange): number[] | null {
  const start = MODEL_CELLS.some(({ c, r }) => c === g.c1 && r === g.r1);
  const end = MODEL_CELLS.some(({ c, r }) => c === g.c2 && r === g.r2);
  if (!start || !end) return null;
  const cells = MODEL_CELLS.flatMap(({ c, r }, i) => c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2 ? [i] : []);
  return cells.length ? cells : null;
}

function modelAccepts(areas: GeneratedArea[]): boolean {
  if (areas.length > 12) return false;
  const ids = new Set<string>();
  const occupied = new Set<number>();
  for (const area of areas) {
    const cells = modelCells(area);
    if (!cells || ids.has(area.id)) return false;
    ids.add(area.id);
    for (const cell of cells) {
      if (occupied.has(cell)) return false;
      occupied.add(cell);
    }
  }
  return true;
}

const cellIndex = fc.integer({ min: 0, max: 71 });
const validCells = fc.uniqueArray(cellIndex, { maxLength: 12 }).map((cells) => identified(cells.map(oneCell)));
const tooManyCells = fc.uniqueArray(cellIndex, { minLength: 13, maxLength: 16 }).map((cells) => identified(cells.map(oneCell)));
const validRectangle = fc.tuple(
  fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }),
).map(([c1, c2, r1, r2]) => identified([{ c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) }]));
const rawAreas = fc.array(fc.record({
  id: fc.integer({ min: 0, max: 15 }).map((i) => `a${i}`),
  c1: fc.integer({ min: -2, max: 28 }).map((i) => i / 2),
  c2: fc.integer({ min: -2, max: 28 }).map((i) => i / 2),
  r1: fc.integer({ min: -2, max: 16 }).map((i) => i / 2),
  r2: fc.integer({ min: -2, max: 16 }).map((i) => i / 2),
}, { noNullPrototype: true }), { maxLength: 16 });
const overlapping = cellIndex.map((i) => identified([oneCell(i), oneCell(i)]));
const repeatedIds = fc.tuple(cellIndex, fc.integer({ min: 1, max: 71 })).map(([i, offset]) => [
  { id: 'same', ...oneCell(i) }, { id: 'same', ...oneCell((i + offset) % 72) },
]);
const fractional = fc.tuple(fc.integer({ min: 1, max: 11 }), fc.integer({ min: 1, max: 6 }))
  .map(([c, r]) => identified([{ c1: c + 0.5, c2: c + 1, r1: r, r2: r }]));
const offGrid = fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 6 }))
  .map(([c, r]) => identified([{ c1: 0, c2: c, r1: r, r2: r }]));
const areaLists = fc.oneof(validCells, validRectangle, rawAreas, overlapping, repeatedIds, tooManyCells, fractional, offGrid);
const rangeKey = (g: GeneratedRange) => [g.c1, g.c2, g.r1, g.r2].join(',');

test('4. generated areas agree with independent cell occupancy and sanitize without changing input', { timeout: 5000 }, () => {
  fc.assert(fc.property(areaLists, (areas) => {
    const before = structuredClone(areas);
    const accepted = modelAccepts(before);
    assert.equal(areasProblem(areas) === null, accepted, 'validation agrees with occupied cells');
    const clean = sanitizeAreas(areas);
    assert.equal(clean !== null, accepted, 'sanitization accepts exactly the modeled layouts');
    if (clean) {
      assert.deepEqual(clean.map((g) => [g.id, rangeKey(g)]), before.map((g) => [g.id, rangeKey(g)]), 'sanitization preserves ids and occupied ranges');
      assert.deepEqual(sanitizeAreas(clean), clean, 'canonical areas are idempotent');
    }
    assert.deepEqual(areas, before, 'validation and sanitization leave input unchanged');
  }), { seed: 8005, numRuns: RUNS, plugins: [fc.interruptAfterTimeLimit(2000, { failOnInterrupt: true })] });
});

test('5. generated blocks derive sound source ranges in reading order without changing input', { timeout: 5000 }, () => {
  fc.assert(fc.property(areaLists, (areas) => {
    const blocks = areas.map((g) => ({ grid: { c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 } }));
    const before = structuredClone(blocks);
    const derived = deriveAreas(blocks);
    assert.ok(derived.length > 0 && modelAccepts(derived), 'derived layout occupies valid disjoint cells');
    const usable = before.map((b) => b.grid).filter((g) => modelCells(g) !== null);
    const sourceRanges = new Set(usable.map(rangeKey));
    if (!usable.length) sourceRanges.add('1,12,1,6');
    assert.ok(derived.every((g) => sourceRanges.has(rangeKey(g))), 'each derived range comes from a usable source or the empty-input fallback');
    const positions = derived.map((g) => (g.r1 - 1) * 12 + g.c1);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'derived ranges follow reading order');
    assert.deepEqual(blocks, before, 'derivation leaves input unchanged');
  }), { seed: 8005, numRuns: RUNS, plugins: [fc.interruptAfterTimeLimit(2000, { failOnInterrupt: true })] });
});
