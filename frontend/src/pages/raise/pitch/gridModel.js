// D1499 (#3749, deck v2 A2) — The Grid's geometry on the page: the 17
// structures (geometry only: ids, names, uses and areas), the safe frame and
// the box of any grid range at 16:9 (1920 × 1080) or 4:3 (1440 × 1080).
//
// It mirrors the Worker's `cloudflare-worker/src/services/decks/structures.ts`
// and `designSystem.ts`, and `frontend/test/deck_grid_model_d1499.test.mjs`
// checks the two agree, structure by structure and box by box. The editor,
// Present and print place every area from `boxOf` on a fixed stage scaled
// to fit (`stageScale`), never from a CSS gap.

export const GRID = Object.freeze({ cols: 12, rows: 6 });
export const FRAME = Object.freeze({ marginX: 112, marginTop: 96, marginBottom: 88, gutter: 24 });
export const BASELINE = 8;
export const ASPECTS = Object.freeze(['16:9', '4:3']);
export const SLIDE_SIZES = Object.freeze({
  '16:9': Object.freeze({ width: 1920, height: 1080 }),
  '4:3': Object.freeze({ width: 1440, height: 1080 }),
});

export const aspectOf = (v) => (v === '4:3' ? '4:3' : '16:9');

/** One cell's size at an aspect, in slide pixels. */
export function cellAt(aspect = '16:9') {
  const s = SLIDE_SIZES[aspectOf(aspect)];
  return {
    width: (s.width - FRAME.marginX * 2 - FRAME.gutter * (GRID.cols - 1)) / GRID.cols,
    height: (s.height - FRAME.marginTop - FRAME.marginBottom - FRAME.gutter * (GRID.rows - 1)) / GRID.rows,
  };
}

/** A grid range's box in slide pixels: the Worker's `boxOfAt`, exactly. */
export function boxOf(g, aspect = '16:9') {
  const cell = cellAt(aspect);
  const x = FRAME.marginX + (g.c1 - 1) * (cell.width + FRAME.gutter);
  const y = FRAME.marginTop + (g.r1 - 1) * (cell.height + FRAME.gutter);
  const w = (g.c2 - g.c1 + 1) * cell.width + (g.c2 - g.c1) * FRAME.gutter;
  const h = (g.r2 - g.r1 + 1) * cell.height + (g.r2 - g.r1) * FRAME.gutter;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The cell (column, row) a point on the slide falls in, or null in a margin or gutter: the inverse of `boxOf`. */
export function cellAtPoint(px, py, aspect = '16:9') {
  const cell = cellAt(aspect);
  const fx = (px - FRAME.marginX) / (cell.width + FRAME.gutter);
  const fy = (py - FRAME.marginTop) / (cell.height + FRAME.gutter);
  const c = Math.floor(fx) + 1;
  const r = Math.floor(fy) + 1;
  if (c < 1 || c > GRID.cols || r < 1 || r > GRID.rows) return null;
  // Inside the gutter after a cell: no cell.
  if ((fx - Math.floor(fx)) * (cell.width + FRAME.gutter) > cell.width) return null;
  if ((fy - Math.floor(fy)) * (cell.height + FRAME.gutter) > cell.height) return null;
  return { c, r };
}

/** How much a fixed slide stage scales to fit a box of `width` × `height` CSS pixels. */
export function stageScale(width, height, aspect = '16:9') {
  const s = SLIDE_SIZES[aspectOf(aspect)];
  if (!(width > 0) || !(height > 0)) return 0;
  return Math.min(width / s.width, height / s.height);
}

const a = (id, c1, c2, r1, r2, order, role) => ({ id, c1, c2, r1, r2, order, ...(role ? { role } : {}) });

/** The 17 structures, geometry only, in the canvas's order (pd10). */
export const STRUCTURES = Object.freeze([
  { id: 'full', label: 'Full', use: 'Title, statement, full bleed', areas: [a('a1', 1, 12, 1, 6, 1)] },
  { id: 'title_body', label: 'Title band + body', use: 'Most content slides', areas: [a('title', 1, 12, 1, 1, 1, 'title'), a('body', 1, 12, 2, 6, 2)] },
  { id: 'halves', label: 'Halves', use: 'Problem and solution', areas: [a('left', 1, 6, 1, 6, 1), a('right', 7, 12, 1, 6, 2)] },
  { id: 'split_7_5', label: 'Split 7/5', use: 'Chart plus text', areas: [a('main', 1, 7, 1, 6, 1), a('side', 8, 12, 1, 6, 2)] },
  { id: 'split_5_7', label: 'Split 5/7', use: 'Text plus chart', areas: [a('side', 1, 5, 1, 6, 1), a('main', 6, 12, 1, 6, 2)] },
  { id: 'sidebar_4_8', label: 'Sidebar 4/8', use: 'Narrative plus visual', areas: [a('side', 1, 4, 1, 6, 1), a('main', 5, 12, 1, 6, 2)] },
  { id: 'sidebar_8_4', label: 'Sidebar 8/4', use: 'Visual plus narrative', areas: [a('main', 1, 8, 1, 6, 1), a('side', 9, 12, 1, 6, 2)] },
  { id: 'thirds', label: 'Thirds', use: 'Three pillars or metrics', areas: [a('a1', 1, 4, 1, 6, 1), a('a2', 5, 8, 1, 6, 2), a('a3', 9, 12, 1, 6, 3)] },
  { id: 'hero_3', label: 'Hero + 3', use: 'Product plus features', recommended: ['seed'], areas: [a('hero', 1, 12, 1, 3, 1), a('a1', 1, 4, 4, 6, 2), a('a2', 5, 8, 4, 6, 3), a('a3', 9, 12, 4, 6, 4)] },
  { id: 'quarters', label: 'Quarters', use: 'Metric row, logo row', areas: [a('a1', 1, 3, 1, 6, 1), a('a2', 4, 6, 1, 6, 2), a('a3', 7, 9, 1, 6, 3), a('a4', 10, 12, 1, 6, 4)] },
  { id: 'two_by_two', label: '2×2', use: 'Matrix, positioning', areas: [a('a1', 1, 6, 1, 3, 1), a('a2', 7, 12, 1, 3, 2), a('a3', 1, 6, 4, 6, 3), a('a4', 7, 12, 4, 6, 4)] },
  { id: 'big_number', label: 'Big number', use: 'One metric with context', recommended: ['seed'], areas: [a('number', 1, 8, 1, 4, 1, 'metric'), a('context', 9, 12, 1, 4, 2), a('footer', 1, 12, 5, 6, 3)] },
  {
    id: 'team', label: 'Team', use: 'Team grid',
    areas: [1, 2].flatMap((row) => [1, 2, 3, 4].map((col) => a(`p${(row - 1) * 4 + col}`, (col - 1) * 3 + 1, col * 3, (row - 1) * 3 + 1, row * 3, (row - 1) * 4 + col))),
  },
  { id: 'timeline_band', label: 'Timeline band', use: 'Roadmap', areas: [a('top', 1, 12, 1, 2, 1, 'title'), a('timeline', 1, 12, 3, 4, 2), a('bottom', 1, 12, 5, 6, 3)] },
  { id: 'z_pattern', label: 'Z-pattern', use: 'Story slides', areas: [a('a1', 1, 7, 1, 3, 1), a('a2', 8, 12, 1, 3, 2), a('a3', 1, 5, 4, 6, 3), a('a4', 6, 12, 4, 6, 4)] },
  { id: 'overlay', label: 'Overlay', use: 'Full-bleed photo', background: 'image', areas: [a('text', 1, 6, 4, 6, 1)] },
  { id: 'appendix_table', label: 'Appendix table', use: 'Tables', areas: [a('title', 1, 12, 1, 1, 1, 'title'), a('table', 1, 12, 2, 6, 2, 'table')] },
]);

export const structureOf = (id) => STRUCTURES.find((s) => s.id === id) ?? null;
export const recommendedFor = (stage) => STRUCTURES.filter((s) => (s.recommended || []).includes(stage)).map((s) => s.id);
