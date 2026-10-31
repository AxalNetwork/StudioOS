/**
 * D1604 (#3716, pd11, pd3b) — selection on The Grid, pure. No React, no network.
 *
 *   areasOf        a card's areas: each block's range, then the free ranges the
 *                  blocks leave, read row by row (`{ id, kind, grid, block? }`)
 *   areaTitle      "Area 2 of 4 · c1–7 × r2–6 · Chart"
 *   selectable     whether an area can be selected, and why not (locked or
 *                  hidden areas never can; hovering says why)
 *   pick           a click (one area) or a shift-click (add or take away one)
 *   marquee        the areas a dragged rectangle touches
 *   keyStep        the keyboard: arrows move, Space selects, Shift + arrow
 *                  extends, Esc clears, Alt + arrow nudges a block one cell
 *   moveTo         a block dragged to a free range, or the drop refused with
 *                  the sentence that says why (never a silent no-op)
 *   cellAt         the cell under a point, on the blocks layer's own geometry
 *   liveFocus      the focus after the card changed under it
 *   askTarget      what the selection's Ask opens: the area lightbox
 *
 * Areas are the input, so when #3749 brings the 17 structures and divider drag
 * (`deckV2Adapter.grid`), only `areasOf` changes. Locks arrive with #3819;
 * until then a block is locked only when it says so (`locked: true`).
 */

import { areaLabel } from './deckV2Model.js';
import { KIND_LABELS, placementProblem } from './editorModel.js';
import { blockRefusal } from './deckAssistModel.js';

export const GRID = Object.freeze({ cols: 12, rows: 6 });

/** The hint the stage shows while nothing is selected (plan §2.3). */
export const STAGE_HINT = 'Select an area and press Ask to generate, change or check it.';
/** The keyboard line under the stage (pd11, card 4). */
export const KEYS_LINE = 'Arrows move · Space selects · Shift + arrow extends · Esc clears · Alt + arrow nudges a cell';
export const LOCKED_WHY = 'This area is locked in the brand kit.';
export const HIDDEN_WHY = 'This area is hidden.';

const dims = (model) => ({ cols: model?.grid?.cols ?? GRID.cols, rows: model?.grid?.rows ?? GRID.rows });
const validGrid = (g) => g && [g.c1, g.c2, g.r1, g.r2].every(Number.isInteger) && g.c2 >= g.c1 && g.r2 >= g.r1;

/** A free area's id: its top-left cell, stable while the blocks around it stay. */
export const freeId = (g) => `free:${g.c1}-${g.r1}`;

/**
 * The card's areas, blocks first (in their order), then the free ranges: each
 * uncovered cell, read row by row, starts a range as wide as the free run to
 * its right and as tall as that whole run stays free. Null for a card with no
 * blocks list (a card from before D898 draws its fields and has no Grid yet).
 */
export function areasOf(card, model = null) {
  if (!Array.isArray(card?.blocks)) return null;
  const { cols, rows } = dims(model);
  const taken = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(false));
  const areas = [];
  for (const b of card.blocks) {
    if (!validGrid(b?.grid)) continue;
    areas.push({ id: String(b.id), kind: 'block', grid: { ...b.grid }, block: b });
    for (let r = Math.max(1, b.grid.r1); r <= Math.min(rows, b.grid.r2); r += 1) {
      for (let c = Math.max(1, b.grid.c1); c <= Math.min(cols, b.grid.c2); c += 1) taken[r][c] = true;
    }
  }
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      if (taken[r][c]) continue;
      let c2 = c;
      while (c2 + 1 <= cols && !taken[r][c2 + 1]) c2 += 1;
      let r2 = r;
      const rowFree = (rr) => { for (let x = c; x <= c2; x += 1) if (taken[rr][x]) return false; return true; };
      while (r2 + 1 <= rows && rowFree(r2 + 1)) r2 += 1;
      for (let rr = r; rr <= r2; rr += 1) for (let x = c; x <= c2; x += 1) taken[rr][x] = true;
      const grid = { c1: c, c2, r1: r, r2 };
      areas.push({ id: freeId(grid), kind: 'free', grid });
    }
  }
  return areas;
}

/** What an area is, in a word: the block's kind, a text block's style, or Empty. */
export function areaKind(area) {
  if (!area) return '';
  if (area.kind === 'free') return 'Empty';
  const b = area.block || {};
  if (b.kind === 'text') return b.style === 'heading' ? 'Title' : b.style === 'list' ? 'Bullets' : 'Body';
  return KIND_LABELS[b.kind] || 'Block';
}

/** "Area 2 of 4 · c1–7 × r2–6 · Chart". */
export function areaTitle(area, index, count) {
  return [`Area ${index + 1} of ${count}`, areaLabel(area?.grid), areaKind(area)].filter(Boolean).join(' · ');
}

/** `{ ok: true }`, or `{ ok: false, why }` for a locked or hidden area. */
export function selectable(area) {
  if (!area) return { ok: false, why: null };
  if (area.block?.hidden === true) return { ok: false, why: HIDDEN_WHY };
  if (area.block?.locked === true) return { ok: false, why: LOCKED_WHY };
  return { ok: true };
}

const byId = (areas, id) => (areas || []).find((a) => a.id === id) || null;

/**
 * A click selects the one area; a shift-click adds it, or takes it away when
 * it was selected. A locked or hidden area changes nothing.
 */
export function pick(selection, areas, id, { shift = false } = {}) {
  const sel = Array.isArray(selection) ? selection : [];
  const area = byId(areas, id);
  if (!selectable(area).ok) return sel;
  if (!shift) return [id];
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
}

const touches = (a, b) => a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

/** The cell range two cells span, in either order. */
export function spanOf(from, to) {
  return { c1: Math.min(from.c, to.c), c2: Math.max(from.c, to.c), r1: Math.min(from.r, to.r), r2: Math.max(from.r, to.r) };
}

/**
 * The marquee's selection: every selectable block it touches; when it touches
 * no block, the free ranges it touches.
 */
export function marquee(areas, rect) {
  if (!validGrid(rect)) return [];
  const hit = (areas || []).filter((a) => selectable(a).ok && touches(a.grid, rect));
  const blocks = hit.filter((a) => a.kind === 'block');
  return (blocks.length ? blocks : hit).map((a) => a.id);
}

/**
 * The cell under a point. `box` is the blocks layer's own box (`{ left, top,
 * width, height }`), the one GridStage draws the blocks, the marquee, the
 * ghost and the "Show the Grid" overlay in: `p-[3%]` and `gap-2`. A CSS
 * percentage padding is taken from the box's width on all four sides, so the
 * top and bottom inset is `inset × width` too, never `inset × height`; `gap`
 * is the gutter between tracks, in px. A point in a gutter belongs to the
 * nearer track.
 */
export function cellAt(x, y, box, model = null, { inset = 0.03, gap = 0 } = {}) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  const { cols, rows } = dims(model);
  const pad = inset * box.width;
  const g = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const track = (at, size, n) => {
    const pitch = (size - 2 * pad - (n - 1) * g) / n + g;
    if (!(pitch > 0)) return 1;
    return Math.min(n, Math.max(1, Math.floor((at - pad + g / 2) / pitch) + 1));
  };
  return { c: track(x - box.left, box.width, cols), r: track(y - box.top, box.height, rows) };
}

/**
 * The focus as it stands on this card: the focused area when it is still
 * there; when a block now covers a free range that had the focus, that block
 * (or whichever area now holds that cell); otherwise null, so the stage falls
 * back to its first selectable area and keeps one tab stop.
 */
export function liveFocus(areas, focus) {
  const list = areas || [];
  if (focus == null) return null;
  if (list.some((a) => a.id === focus)) return focus;
  const m = /^free:(\d+)-(\d+)$/.exec(String(focus));
  if (!m) return null;
  const c = Number(m[1]); const r = Number(m[2]);
  const holder = list.find((a) => a.grid.c1 <= c && c <= a.grid.c2 && a.grid.r1 <= r && r <= a.grid.r2);
  return holder && selectable(holder).ok ? holder.id : null;
}

const centre = (g) => ({ x: (g.c1 + g.c2) / 2, y: (g.r1 + g.r2) / 2 });
const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** Lexicographic: the first place two ranks differ decides. */
const before = (a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

/**
 * The nearest selectable area from `fromId` in an arrow's direction, or null
 * at an edge. It must lie beyond the area's edge that way; the one that
 * shares rows (or columns, up and down) comes first, then the smallest gap,
 * then a block before a free range, then the closest centre across.
 */
export function nearest(areas, fromId, key) {
  const dir = DIRS[key];
  const from = byId(areas, fromId);
  if (!dir || !from) return null;
  const f = from.grid;
  const across = dir[0] !== 0;
  let best = null;
  for (const a of areas || []) {
    if (a.id === fromId || !selectable(a).ok) continue;
    const g = a.grid;
    const gap = dir[0] === 1 ? g.c1 - f.c2 : dir[0] === -1 ? f.c1 - g.c2 : dir[1] === 1 ? g.r1 - f.r2 : f.r1 - g.r2;
    if (gap < 1) continue;
    const shares = across ? g.r1 <= f.r2 && f.r1 <= g.r2 : g.c1 <= f.c2 && f.c1 <= g.c2;
    const off = across ? Math.abs(centre(g).y - centre(f).y) : Math.abs(centre(g).x - centre(f).x);
    const rank = [shares ? 0 : 1, gap, a.kind === 'block' ? 0 : 1, off];
    if (!best || before(rank, best.rank)) best = { id: a.id, rank };
  }
  return best ? best.id : null;
}

/**
 * One key on the stage. Answers `{ selection, focus, nudge? }`, or null when
 * the key is not the stage's (so the page keeps it):
 *   arrows        move the focus to the nearest area that way
 *   Shift + arrow move it and add that area to the selection
 *   Space, Enter  select the focused area alone (Shift: add or take it away)
 *   Escape        clear the selection
 *   Alt + arrow   `nudge: { id, dc, dr }` for the one selected block
 */
export function keyStep({ selection = [], focus = null }, areas, key, { shift = false, alt = false } = {}) {
  const list = areas || [];
  const first = list.find((a) => selectable(a).ok)?.id ?? null;
  if (key === 'Escape') return { selection: [], focus };
  if (DIRS[key] && alt) {
    if (selection.length !== 1) return { selection, focus };
    const one = byId(list, selection[0]);
    if (one?.kind !== 'block') return { selection, focus };
    return { selection, focus, nudge: { id: one.id, dc: DIRS[key][0], dr: DIRS[key][1] } };
  }
  if (DIRS[key]) {
    if (!focus || !byId(list, focus)) return { selection, focus: first };
    const to = nearest(list, focus, key) ?? focus;
    if (shift) return { selection: selection.includes(to) ? selection : [...selection, to], focus: to };
    return { selection, focus: to };
  }
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    const at = focus ?? first;
    if (!at) return { selection, focus };
    return { selection: pick(selection, list, at, { shift }), focus: at };
  }
  return null;
}

/**
 * Where a dragged block lands: its top-left on `at` (`{ c, r }`), its size
 * kept. `{ grid }`, or `{ error }` with the sentence the stage shows ("That
 * range overlaps the 3 × 2 metric tile. Pick a free range.").
 */
export function moveTo(card, blockId, at, model = null) {
  const block = (card?.blocks || []).find((b) => String(b.id) === String(blockId));
  if (!block?.grid || !at) return { error: 'That block is no longer on this card.' };
  const w = block.grid.c2 - block.grid.c1;
  const h = block.grid.r2 - block.grid.r1;
  const grid = { c1: at.c, c2: at.c + w, r1: at.r, r2: at.r + h };
  if (grid.c1 === block.grid.c1 && grid.r1 === block.grid.r1) return { grid, same: true };
  const problem = placementProblem(card, grid, model, block.id);
  if (!problem) return { grid };
  const overlap = /^It overlaps (.+)\.$/.exec(problem);
  return { error: overlap ? `That range overlaps ${overlap[1]}. Pick a free range.` : `${problem} Pick a free range.` };
}

/** A one-cell nudge, as a move. */
export function nudge(card, blockId, dc, dr, model = null) {
  const block = (card?.blocks || []).find((b) => String(b.id) === String(blockId));
  if (!block?.grid) return { error: 'That block is no longer on this card.' };
  return moveTo(card, blockId, { c: block.grid.c1 + dc, r: block.grid.r1 + dr }, model);
}

/**
 * What the selection's Ask opens (plan §4.2):
 *   `{ kind: 'areas', ids }`     "Generate into N areas" (`AreaLightbox.jsx`)
 *                                for one area or several; each row says what
 *                                runs on main and what waits for its issue
 *   `{ kind: 'refused', why }`   the one area is a figure bound to a record,
 *                                which only its record changes
 *   `{ kind: 'off' }`            AI is paused on the page
 */
export function askTarget(areas, selection, { aiOn = true, items = [] } = {}) {
  const chosen = (selection || []).map((id) => byId(areas, id)).filter(Boolean);
  if (!chosen.length) return null;
  if (!aiOn) return { kind: 'off' };
  if (chosen.length === 1 && chosen[0].kind === 'block') {
    const b = chosen[0].block;
    if (b.kind === 'metric' || b.binding?.source_key) return { kind: 'refused', why: blockRefusal(b, items) };
  }
  return { kind: 'areas', ids: chosen.map((a) => a.id) };
}
