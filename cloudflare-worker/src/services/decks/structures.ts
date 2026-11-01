/**
 * D1499 (#3749, deck v2 A2) — The Grid's structures and geometry.
 *
 * A card sits on the 12 × 6 grid (`slideModel.ts`) inside the safe frame of
 * `designSystem.ts` (112 / 96 / 88 at 1920, a 24 px gutter). A **structure**
 * divides the grid into **areas** of whole cells. An area is a grid range with
 * an id, a reading order, an inset in 8 px baseline steps and an alignment.
 * Areas never overlap, never leave the grid, and a card holds at most 12.
 *
 * `card.structure` names one of the 17 structures below, or `custom` once the
 * founder has moved a divider (A4). `card.areas` is the card's own list. A
 * card saved before v2 has neither: `areasOf(card)` derives them from its
 * blocks (`deriveAreas`), so an old deck opens unchanged and nothing is
 * backfilled.
 *
 * `aspect` is the deck's: 16:9 on a 1920 × 1080 slide, or 4:3 on 1440 × 1080.
 * Both use the same grid and margins; 4:3 has narrower cells. `boxOfAt` is
 * the one geometry the editor, Present and print place every area from.
 *
 * Pure: no binding. The frontend mirrors the catalogue, geometry only, in
 * `frontend/src/pages/raise/pitch/gridModel.js`, with a parity test.
 */
import { GRID_COLS, GRID_ROWS, type Grid } from './slideModel';

/**
 * The safe frame and the 16:9 slide, as `designSystem.ts` defines them
 * (`FRAME`, `SLIDE`). Written here because `slideModel` keeps a card's areas
 * through this file, and `designSystem` reads `slideModel` at load: importing
 * it here would be a cycle. `deck_grid_d1499.test.ts` checks both equal
 * `designSystem`'s, and that `boxOfAt` at 16:9 is `boxOf` for every range.
 */
export const FRAME = Object.freeze({ marginX: 112, marginTop: 96, marginBottom: 88, gutter: 24 });
const SLIDE = Object.freeze({ width: 1920, height: 1080 });

export const ASPECTS = ['16:9', '4:3'] as const;
export type Aspect = typeof ASPECTS[number];
export const SLIDE_SIZES: Record<Aspect, { width: number; height: number }> = Object.freeze({
  '16:9': Object.freeze({ width: SLIDE.width, height: SLIDE.height }),
  '4:3': Object.freeze({ width: 1440, height: 1080 }),
});
/** The baseline every inset and decor offset snaps to, in slide pixels. */
export const BASELINE = 8;
export const MAX_AREAS = 12;
export const INSET_MAX = 4;
export const ALIGNS = ['start', 'center', 'end'] as const;

export const aspectOf = (v: unknown): Aspect => (v === '4:3' ? '4:3' : '16:9');

/** One cell's size at an aspect, in slide pixels. */
export function cellAt(aspect: Aspect) {
  const s = SLIDE_SIZES[aspect];
  return {
    width: (s.width - FRAME.marginX * 2 - FRAME.gutter * (GRID_COLS - 1)) / GRID_COLS,
    height: (s.height - FRAME.marginTop - FRAME.marginBottom - FRAME.gutter * (GRID_ROWS - 1)) / GRID_ROWS,
  };
}

/** A grid range's box at an aspect, in slide pixels. At 16:9 it is `designSystem.boxOf`, exactly. */
export function boxOfAt(g: Grid, aspect: Aspect = '16:9'): { x: number; y: number; w: number; h: number } {
  const cell = cellAt(aspect);
  const x = FRAME.marginX + (g.c1 - 1) * (cell.width + FRAME.gutter);
  const y = FRAME.marginTop + (g.r1 - 1) * (cell.height + FRAME.gutter);
  const w = (g.c2 - g.c1 + 1) * cell.width + (g.c2 - g.c1) * FRAME.gutter;
  const h = (g.r2 - g.r1 + 1) * cell.height + (g.r2 - g.r1) * FRAME.gutter;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export type Area = Grid & { id: string; order: number; inset: number; align: typeof ALIGNS[number]; role?: string };
export type Structure = { id: string; label: string; use: string; areas: Area[]; background?: 'image'; recommended?: string[] };

const a = (id: string, c1: number, c2: number, r1: number, r2: number, order: number, role?: string): Area =>
  ({ id, c1, c2, r1, r2, order, inset: 0, align: 'start', ...(role ? { role } : {}) });

/**
 * The 17 structures of the final canvas (pd10), in its order. "Recommended
 * for Seed" sits on Hero + 3 and Big number. Overlay's image is the card's
 * background, not an area, so its one text area overlaps nothing.
 */
export const STRUCTURES: readonly Structure[] = Object.freeze([
  { id: 'full', label: 'Full', use: 'Title, statement, full bleed', areas: [a('a1', 1, 12, 1, 6, 1)] },
  { id: 'title_body', label: 'Title band + body', use: 'Most content slides', areas: [a('title', 1, 12, 1, 1, 1, 'title'), a('body', 1, 12, 2, 6, 2)] },
  { id: 'halves', label: 'Halves', use: 'Problem and solution', areas: [a('left', 1, 6, 1, 6, 1), a('right', 7, 12, 1, 6, 2)] },
  { id: 'split_7_5', label: 'Split 7/5', use: 'Chart plus text', areas: [a('main', 1, 7, 1, 6, 1), a('side', 8, 12, 1, 6, 2)] },
  { id: 'split_5_7', label: 'Split 5/7', use: 'Text plus chart', areas: [a('side', 1, 5, 1, 6, 1), a('main', 6, 12, 1, 6, 2)] },
  { id: 'sidebar_4_8', label: 'Sidebar 4/8', use: 'Narrative plus visual', areas: [a('side', 1, 4, 1, 6, 1), a('main', 5, 12, 1, 6, 2)] },
  { id: 'sidebar_8_4', label: 'Sidebar 8/4', use: 'Visual plus narrative', areas: [a('main', 1, 8, 1, 6, 1), a('side', 9, 12, 1, 6, 2)] },
  { id: 'thirds', label: 'Thirds', use: 'Three pillars or metrics', areas: [a('a1', 1, 4, 1, 6, 1), a('a2', 5, 8, 1, 6, 2), a('a3', 9, 12, 1, 6, 3)] },
  {
    id: 'hero_3', label: 'Hero + 3', use: 'Product plus features', recommended: ['seed'],
    areas: [a('hero', 1, 12, 1, 3, 1), a('a1', 1, 4, 4, 6, 2), a('a2', 5, 8, 4, 6, 3), a('a3', 9, 12, 4, 6, 4)],
  },
  { id: 'quarters', label: 'Quarters', use: 'Metric row, logo row', areas: [a('a1', 1, 3, 1, 6, 1), a('a2', 4, 6, 1, 6, 2), a('a3', 7, 9, 1, 6, 3), a('a4', 10, 12, 1, 6, 4)] },
  { id: 'two_by_two', label: '2×2', use: 'Matrix, positioning', areas: [a('a1', 1, 6, 1, 3, 1), a('a2', 7, 12, 1, 3, 2), a('a3', 1, 6, 4, 6, 3), a('a4', 7, 12, 4, 6, 4)] },
  {
    id: 'big_number', label: 'Big number', use: 'One metric with context', recommended: ['seed'],
    areas: [a('number', 1, 8, 1, 4, 1, 'metric'), a('context', 9, 12, 1, 4, 2), a('footer', 1, 12, 5, 6, 3)],
  },
  {
    id: 'team', label: 'Team', use: 'Team grid',
    areas: [1, 2, 3, 4].flatMap((col) => [1, 2].map((row) => a(`p${(row - 1) * 4 + col}`, (col - 1) * 3 + 1, col * 3, (row - 1) * 3 + 1, row * 3, (row - 1) * 4 + col)))
      .sort((x, y) => x.order - y.order),
  },
  { id: 'timeline_band', label: 'Timeline band', use: 'Roadmap', areas: [a('top', 1, 12, 1, 2, 1, 'title'), a('timeline', 1, 12, 3, 4, 2), a('bottom', 1, 12, 5, 6, 3)] },
  { id: 'z_pattern', label: 'Z-pattern', use: 'Story slides', areas: [a('a1', 1, 7, 1, 3, 1), a('a2', 8, 12, 1, 3, 2), a('a3', 1, 5, 4, 6, 3), a('a4', 6, 12, 4, 6, 4)] },
  { id: 'overlay', label: 'Overlay', use: 'Full-bleed photo', background: 'image', areas: [a('text', 1, 6, 4, 6, 1)] },
  { id: 'appendix_table', label: 'Appendix table', use: 'Tables', areas: [a('title', 1, 12, 1, 1, 1, 'title'), a('table', 1, 12, 2, 6, 2, 'table')] },
]);
export const STRUCTURE_IDS: readonly string[] = STRUCTURES.map((s) => s.id);
export const CUSTOM = 'custom';
export const structureOf = (id: unknown): Structure | null => STRUCTURES.find((s) => s.id === id) ?? null;

const whole = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const overlap = (x: Grid, y: Grid) => x.c1 <= y.c2 && y.c1 <= x.c2 && x.r1 <= y.r2 && y.r1 <= x.r2;
const AREA_ID = /^[A-Za-z0-9_-]{1,24}$/;

/** What is wrong with a card's areas, as one sentence, or null when they are sound. */
export function areasProblem(areas: unknown): string | null {
  if (!Array.isArray(areas)) return 'areas must be a list.';
  if (areas.length > MAX_AREAS) return `a card holds at most ${MAX_AREAS} areas.`;
  const seen = new Set<string>();
  const placed: Grid[] = [];
  for (const [i, v] of areas.entries()) {
    const n = `area ${i + 1}`;
    if (!v || typeof v !== 'object') return `${n} is not an area.`;
    const g = v as Record<string, unknown>;
    if (!(whole(g.c1, 1, GRID_COLS) && whole(g.c2, 1, GRID_COLS) && whole(g.r1, 1, GRID_ROWS) && whole(g.r2, 1, GRID_ROWS))
      || (g.c1 as number) > (g.c2 as number) || (g.r1 as number) > (g.r2 as number)) {
      return `${n} must cover whole cells of the ${GRID_COLS} × ${GRID_ROWS} grid.`;
    }
    if (typeof g.id !== 'string' || !AREA_ID.test(g.id)) return `${n} needs an id.`;
    if (seen.has(g.id)) return `${n} repeats the id ${g.id}.`;
    seen.add(g.id);
    if (g.inset != null && !whole(g.inset, 0, INSET_MAX)) return `${n}'s inset is 0 to ${INSET_MAX} baseline steps.`;
    if (g.align != null && !(ALIGNS as readonly unknown[]).includes(g.align)) return `${n}'s alignment is start, center or end.`;
    const grid = { c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 } as Grid;
    if (placed.some((p) => overlap(p, grid))) return `${n} overlaps another area.`;
    placed.push(grid);
  }
  return null;
}

/** A card's areas, kept as saved when sound, with their defaults filled in; null when they are not sound. */
export function sanitizeAreas(areas: unknown): Area[] | null {
  if (areasProblem(areas)) return null;
  return (areas as any[]).map((v, i) => ({
    id: v.id, c1: v.c1, c2: v.c2, r1: v.r1, r2: v.r2,
    order: Number.isInteger(v.order) ? v.order : i + 1,
    inset: Number.isInteger(v.inset) ? v.inset : 0,
    align: (ALIGNS as readonly unknown[]).includes(v.align) ? v.align : 'start',
    ...(typeof v.role === 'string' && /^[a-z_]{1,24}$/.test(v.role) ? { role: v.role } : {}),
  }));
}

/**
 * The areas of a card saved before v2: one per block, in reading order (top
 * to bottom, then left to right). A block that overlaps an earlier one, or
 * past the twelfth, gets no area. No block reads as one Full area.
 */
export function deriveAreas(blocks: unknown): Area[] {
  const ranges: Grid[] = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const g = b?.grid;
    if (!g || !(whole(g.c1, 1, GRID_COLS) && whole(g.c2, 1, GRID_COLS) && whole(g.r1, 1, GRID_ROWS) && whole(g.r2, 1, GRID_ROWS)) || g.c1 > g.c2 || g.r1 > g.r2) continue;
    const grid = { c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 };
    if (ranges.some((r) => overlap(r, grid)) || ranges.length >= MAX_AREAS) continue;
    ranges.push(grid);
  }
  if (!ranges.length) return [a('a1', 1, GRID_COLS, 1, GRID_ROWS, 1)];
  return ranges.slice().sort((x, y) => x.r1 - y.r1 || x.c1 - y.c1).map((g, i) => a(`a${i + 1}`, g.c1, g.c2, g.r1, g.r2, i + 1));
}

/** The card's structure and areas as every reader uses them: its own when sound, else derived. */
export function areasOf(card: any): { structure: string; areas: Area[]; derived: boolean } {
  const own = card?.areas != null ? sanitizeAreas(card.areas) : null;
  if (own && own.length) {
    const known = structureOf(card.structure) ? card.structure : CUSTOM;
    return { structure: known, areas: own, derived: false };
  }
  return { structure: CUSTOM, areas: deriveAreas(card?.blocks), derived: true };
}
