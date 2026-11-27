/**
 * D1533 (#3777, deck v2 B1, pd26, pd3b) — direct manipulation on The Grid,
 * pure. No React, no network. What it changes is the card document, saved
 * with every other edit (the editor's `onCard`), so no route stands behind it.
 *
 *   two layers     areas (blocks) sit on whole cells and never overlap; decor
 *                  (D1500's `card.decor`, whose kinds are #3779's elements
 *                  library) sits under them, on the 8 px baseline, in a layer
 *                  order. Every operation below keeps each layer on its own
 *                  grid: an area edge on a cell, a decor edge on 8 px.
 *   arrange        align left, centre, right, top, middle and bottom;
 *                  distribute horizontally and vertically; Group; Lock (the
 *                  card's `pinned`, never #3819's brand-kit `locked`); Bring
 *                  forward and Send back (decor only: areas have no layers);
 *                  Copy style (`arrange`, `arrangeState`).
 *   nudge          the selected decor by 8 px ("Moved 8 px"), and a pointer
 *                  drag snapped to 8 px with its guides and spacing markers
 *                  (`moveDecor`, `guidesFor`, `spacingOf`).
 *   exports        `decorPlan`, the Worker's `arrange.decorPlan`: what the
 *                  print page (the PDF) and the editable PowerPoint draw, in
 *                  layer order. `EXPORT_GEOMETRY` and `TONE_COLOURS` mirror
 *                  the Worker's; `cloudflare-worker/test/deck_arrange_d1533.test.ts`
 *                  holds them equal.
 *
 * A selected decor item is `decor:<id>` in the Grid's selection, beside the
 * areas' ids. Decor and areas are arranged apart: a group, an alignment or a
 * copied style never mixes the two.
 */

import { BASELINE, SLIDE_SIZES, aspectOf, boxOf } from './gridModel.js';
import { placementProblem } from './editorModel.js';

export const NUDGE_LINE = 'Arrow keys nudge by 8 px.';
export const movedPx = (px) => `Moved ${px} px`;
export const LAYERS_TITLE = 'LAYERS · DECOR ONLY';
export const DECOR_RULE = 'Decor never holds a figure or body text.';
export const TOOLS_NOTE = 'Tools appear only when a card or area is selected.';
export const MIXED = 'Arrange decor with decor, or areas with areas.';
export const PINNED = 'Locked items keep their place. Unlock to move them.';
export const NO_LAYERS = 'Areas never overlap, so only decor has layers.';

export const TONE_COLOURS = Object.freeze({ ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b', surface: '#fbfaf7' });
export const EXPORT_GEOMETRY = Object.freeze({ 'shape:circle': 'ellipse', 'shape:rect': 'rect', 'shape:rounded': 'roundRect', 'divider:line': 'line' });

/** The Arrange set, in pd26's order. */
export const ARRANGE_OPS = Object.freeze([
  { id: 'align-left', label: 'Align left' },
  { id: 'align-centre', label: 'Align centre' },
  { id: 'align-right', label: 'Align right' },
  { id: 'align-top', label: 'Align top' },
  { id: 'align-middle', label: 'Align middle' },
  { id: 'align-bottom', label: 'Align bottom' },
  { id: 'distribute-h', label: 'Distribute horizontally' },
  { id: 'distribute-v', label: 'Distribute vertically' },
  { id: 'group', label: 'Group' },
  { id: 'lock', label: 'Lock' },
  { id: 'forward', label: 'Bring forward' },
  { id: 'back', label: 'Send back' },
  { id: 'copy-style', label: 'Copy style' },
]);

const DECOR = 'decor:';
export const decorSel = (id) => `${DECOR}${id}`;
export const isDecorSel = (sel) => typeof sel === 'string' && sel.startsWith(DECOR);
const decorIdOf = (sel) => sel.slice(DECOR.length);
const decorList = (card) => (Array.isArray(card?.decor) ? card.decor : []);
/** Whether `sel` names a decor item on this card. */
export const isDecorOn = (card, sel) => isDecorSel(sel) && decorList(card).some((d) => String(d?.id) === decorIdOf(sel));

/** A value on the 8 px baseline. */
export const snap = (v) => Math.round(v / BASELINE) * BASELINE;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** A box on the 8 px baseline inside the 1920 × 1080 slide, or null: the Worker's `atOf`. */
export function atOf(v) {
  if (!v || typeof v !== 'object') return null;
  const n = [v.x, v.y, v.w, v.h];
  if (!n.every((x) => Number.isInteger(x) && x % BASELINE === 0)) return null;
  const [x, y, w, h] = n;
  if (x < 0 || y < 0 || w < BASELINE || h < BASELINE || x + w > 1920 || y + h > 1080) return null;
  return { x, y, w, h };
}

const groupId = (v) => (typeof v === 'string' && ID.test(v) ? v : null);

/** Items in layer order, each group's members gathered where its lowest stood: the Worker's `gathered`. */
export function gathered(items) {
  const sorted = items
    .map((d, i) => ({ d, k: Number.isInteger(d?.layer) ? d.layer : i + 1, i }))
    .sort((a, z) => a.k - z.k || a.i - z.i)
    .map((x) => x.d);
  const out = [];
  const seen = new Set();
  for (const d of sorted) {
    const g = groupId(d?.group);
    if (!g) { out.push(d); continue; }
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(...sorted.filter((x) => groupId(x?.group) === g));
  }
  return out;
}

/** The decor in layer order, bottom first, each with what an export draws: the Worker's `decorPlan`. */
export function decorPlan(card) {
  return gathered(decorList(card))
    .map((d, i) => {
      const ref = typeof d?.ref === 'string' ? d.ref : null;
      const tone = typeof d?.tone === 'string' && Object.hasOwn(TONE_COLOURS, d.tone) ? d.tone : 'ink';
      return {
        id: String(d?.id ?? `d${i + 1}`), kind: String(d?.kind ?? ''), ref, tone, colour: TONE_COLOURS[tone],
        geometry: ref ? EXPORT_GEOMETRY[`${d.kind}:${ref}`] ?? null : null,
        at: atOf(d?.at), grid: d?.grid && typeof d.grid === 'object' ? d.grid : null,
        group: groupId(d?.group), pinned: d?.pinned === true, layer: i + 1,
      };
    });
}

/** A decor item's box in slide pixels: its `at`, else its cell range's box, else the whole slide. */
export function decorBox(d, aspect = '16:9') {
  const at = atOf(d?.at);
  if (at) return at;
  if (d?.grid) return boxOf(d.grid, aspect);
  const s = SLIDE_SIZES[aspectOf(aspect)];
  return { x: 0, y: 0, w: s.width, h: s.height };
}

/** A box placed on the face as a share of the slide, like `gridModel.placeOf`. */
export function placeBox(b, aspect = '16:9') {
  const s = SLIDE_SIZES[aspectOf(aspect)];
  const pc = (v, of) => `${(v / of) * 100}%`;
  return { position: 'absolute', left: pc(b.x, s.width), top: pc(b.y, s.height), width: pc(b.w, s.width), height: pc(b.h, s.height) };
}

/** The layers list's name for an item: #3779's library label when the library answered, else its kind and ref. */
export function decorLabel(d, library = null) {
  const v = library?.available ? library.value : null;
  const list = !v ? [] : d?.kind === 'icon' ? (v.icons?.items || []) : (v[`${d?.kind}s`] || []);
  const hit = list.find((x) => x?.ref === d?.ref);
  if (hit?.label) return hit.label;
  const kind = String(d?.kind || 'decor');
  return [kind.charAt(0).toUpperCase() + kind.slice(1), d?.ref || d?.id].filter(Boolean).join(' · ');
}

/** The selected items arrange works on: blocks and decor; free ranges are not items. */
export function itemsOf(card, selection, aspect = '16:9') {
  const out = [];
  for (const sel of Array.isArray(selection) ? selection : []) {
    if (isDecorSel(sel)) {
      const d = decorList(card).find((x) => String(x?.id) === decorIdOf(sel));
      if (d) out.push({ sel, tier: 'decor', id: String(d.id), item: d, box: decorBox(d, aspect), group: d.group || null, pinned: d.pinned === true });
      continue;
    }
    const b = (card?.blocks || []).find((x) => String(x?.id) === String(sel));
    if (b?.grid) out.push({ sel, tier: 'area', id: String(b.id), item: b, grid: b.grid, group: b.group || null, pinned: b.pinned === true });
  }
  return out;
}

const STYLE_KEYS = { decor: ['tone'], text: ['style'], image: ['fit'] };
const styleKeysOf = (it) => (it.tier === 'decor' ? STYLE_KEYS.decor : STYLE_KEYS[it.item?.kind] || []);

/** Whether each operation can run on this selection, and why not: `{ [op]: { ok, why } }`. */
export function arrangeState(card, selection) {
  const items = itemsOf(card, selection);
  const tiers = new Set(items.map((i) => i.tier));
  const mixed = tiers.size > 1;
  const free = items.filter((i) => !i.pinned);
  const st = (ok, why = null) => ({ ok, why: ok ? null : why });
  const need = (n, what) => `Select ${n} or more ${what}.`;
  const align = mixed ? st(false, MIXED) : items.length < 2 ? st(false, need(2, 'items to align')) : !free.length ? st(false, PINNED) : st(true);
  const spread = mixed ? st(false, MIXED) : items.length < 3 ? st(false, need(3, 'items to distribute')) : !free.length ? st(false, PINNED) : st(true);
  const decorOnly = !items.length ? st(false, 'Select a decor item.') : tiers.has('area') ? st(false, NO_LAYERS) : st(true);
  const src = items[0];
  const copyable = items.length >= 2 && !mixed && items.slice(1).some((i) => styleKeysOf(i).length && styleKeysOf(i).join() === styleKeysOf(src).join());
  const out = {};
  for (const { id } of ARRANGE_OPS) {
    if (id.startsWith('align-')) out[id] = align;
    else if (id.startsWith('distribute-')) out[id] = spread;
    else if (id === 'group') out[id] = mixed ? st(false, MIXED) : items.length < 2 && !items[0]?.group ? st(false, need(2, 'items to group')) : st(true);
    else if (id === 'lock') out[id] = items.length ? st(true) : st(false, 'Select an area or a decor item.');
    else if (id === 'forward' || id === 'back') out[id] = decorOnly;
    else if (id === 'copy-style') out[id] = mixed ? st(false, MIXED) : copyable ? st(true) : st(false, 'Select the item to copy from first, then items of the same kind.');
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** New decor boxes for an alignment or a spread, each edge on 8 px inside the slide. */
function decorTargets(items, op, aspect) {
  const s = SLIDE_SIZES[aspectOf(aspect)];
  const boxes = items.map((i) => ({ ...i, b: { x: snap(i.box.x), y: snap(i.box.y), w: Math.max(BASELINE, snap(i.box.w)), h: Math.max(BASELINE, snap(i.box.h)) } }));
  const minX = Math.min(...boxes.map((i) => i.b.x)); const maxR = Math.max(...boxes.map((i) => i.b.x + i.b.w));
  const minY = Math.min(...boxes.map((i) => i.b.y)); const maxB = Math.max(...boxes.map((i) => i.b.y + i.b.h));
  const fit = (b) => {
    const w = Math.min(b.w, snap(s.width)); const h = Math.min(b.h, snap(s.height));
    return { x: clamp(snap(b.x), 0, snap(s.width) - w), y: clamp(snap(b.y), 0, snap(s.height) - h), w, h };
  };
  const at = new Map();
  if (op.startsWith('align-')) {
    for (const i of boxes) {
      if (i.pinned) continue;
      const b = { ...i.b };
      if (op === 'align-left') b.x = minX;
      if (op === 'align-right') b.x = maxR - b.w;
      if (op === 'align-centre') b.x = snap((minX + maxR) / 2 - b.w / 2);
      if (op === 'align-top') b.y = minY;
      if (op === 'align-bottom') b.y = maxB - b.h;
      if (op === 'align-middle') b.y = snap((minY + maxB) / 2 - b.h / 2);
      at.set(i.sel, fit(b));
    }
    return at;
  }
  const h = op === 'distribute-h';
  const pos = (b) => (h ? b.x : b.y); const len = (b) => (h ? b.w : b.h);
  const order = [...boxes].sort((a, z) => pos(a.b) - pos(z.b));
  const first = order[0].b; const last = order[order.length - 1].b;
  const inner = order.slice(1, -1);
  const room = pos(last) - (pos(first) + len(first)) - inner.reduce((n, i) => n + len(i.b), 0);
  const gap = room / (order.length - 1);
  let cursor = pos(first) + len(first);
  for (const i of inner) {
    const start = snap(cursor + gap);
    cursor = start + len(i.b);
    if (i.pinned) continue;
    at.set(i.sel, fit(h ? { ...i.b, x: start } : { ...i.b, y: start }));
  }
  return at;
}

/** New area ranges for an alignment or a spread, each on whole cells; null for a spread with no room. */
function areaTargets(items, op, model) {
  const cols = model?.grid?.cols ?? 12; const rows = model?.grid?.rows ?? 6;
  const minC = Math.min(...items.map((i) => i.grid.c1)); const maxC = Math.max(...items.map((i) => i.grid.c2));
  const minR = Math.min(...items.map((i) => i.grid.r1)); const maxR = Math.max(...items.map((i) => i.grid.r2));
  const out = new Map();
  const put = (i, c1, r1) => {
    const w = i.grid.c2 - i.grid.c1; const hh = i.grid.r2 - i.grid.r1;
    const c = clamp(Math.round(c1), 1, cols - w); const r = clamp(Math.round(r1), 1, rows - hh);
    out.set(i.sel, { c1: c, c2: c + w, r1: r, r2: r + hh });
  };
  if (op.startsWith('align-')) {
    for (const i of items) {
      if (i.pinned) continue;
      const w = i.grid.c2 - i.grid.c1; const hh = i.grid.r2 - i.grid.r1;
      if (op === 'align-left') put(i, minC, i.grid.r1);
      if (op === 'align-right') put(i, maxC - w, i.grid.r1);
      if (op === 'align-centre') put(i, (minC + maxC) / 2 - w / 2, i.grid.r1);
      if (op === 'align-top') put(i, i.grid.c1, minR);
      if (op === 'align-bottom') put(i, i.grid.c1, maxR - hh);
      if (op === 'align-middle') put(i, i.grid.c1, (minR + maxR) / 2 - hh / 2);
    }
    return out;
  }
  const h = op === 'distribute-h';
  const lo = (g) => (h ? g.c1 : g.r1); const hi = (g) => (h ? g.c2 : g.r2); const len = (g) => hi(g) - lo(g) + 1;
  const order = [...items].sort((a, z) => lo(a.grid) - lo(z.grid));
  const first = order[0].grid; const last = order[order.length - 1].grid;
  const inner = order.slice(1, -1);
  const room = lo(last) - hi(first) - 1 - inner.reduce((n, i) => n + len(i.grid), 0);
  if (room < 0) return null;
  const gap = room / (order.length - 1);
  let used = 0;
  inner.forEach((i, k) => {
    const start = hi(first) + 1 + Math.round(gap * (k + 1)) + used;
    used += len(i.grid);
    if (!i.pinned) put(i, h ? start : i.grid.c1, h ? i.grid.r1 : start);
  });
  return out;
}

/** The overlap sentence pd3b draws ("That range overlaps the 3 × 2 metric tile. Pick a free range."). */
function refusal(problem) {
  const overlap = /^It overlaps (.+)\.$/.exec(problem);
  return overlap ? `That range overlaps ${overlap[1]}. Pick a free range.` : `${problem} Pick a free range.`;
}

/** The decor list with each item's layer written as its place, bottom first. */
const relayer = (list) => list.map((d, i) => ({ ...d, layer: i + 1 }));

/** A fresh group id, unlike any on the card. */
function newGroup(card) {
  const used = new Set([...(card?.blocks || []), ...decorList(card)].map((x) => x?.group).filter(Boolean));
  let n = 1;
  while (used.has(`g${n}`)) n += 1;
  return `g${n}`;
}

/**
 * One Arrange operation on the selection. `{ card, line }` with the edited
 * card (one edit, through the editor's `onCard`), `{ same: true, line }` when
 * nothing moves, or `{ error }` with the sentence the tools show; nothing
 * changes then.
 */
export function arrange(card, selection, op, { aspect = '16:9', model = null } = {}) {
  const state = arrangeState(card, selection)[op];
  if (!state) return { error: 'That is not an Arrange tool.' };
  if (!state.ok) return { error: state.why };
  const items = itemsOf(card, selection, aspect);
  const tier = items[0].tier;
  const decor = decorList(card);
  const withDecor = (fn) => ({ ...card, decor: decor.map((d) => fn(d) || d) });
  const withBlocks = (fn) => ({ ...card, blocks: (card.blocks || []).map((b) => fn(b) || b) });
  const chosen = new Set(items.map((i) => i.id));
  const mine = (x) => chosen.has(String(x?.id));

  if (op.startsWith('align-') || op.startsWith('distribute-')) {
    if (tier === 'decor') {
      const at = decorTargets(items, op, aspect);
      const moved = [...at.entries()].filter(([sel, b]) => {
        const was = itemsOf(card, [sel], aspect)[0].box;
        return b.x !== was.x || b.y !== was.y || b.w !== was.w || b.h !== was.h;
      });
      if (!moved.length) return { same: true, line: 'Already in place.' };
      const next = withDecor((d) => (at.has(decorSel(d.id)) ? { ...d, at: at.get(decorSel(d.id)) } : null));
      return { card: next, line: `${ARRANGE_OPS.find((o) => o.id === op).label}: ${moved.length} moved, on the ${BASELINE} px grid.` };
    }
    const grids = areaTargets(items, op, model);
    if (!grids) return { error: 'There is no room to spread them out. Pick a wider range.' };
    const moved = [...grids.entries()].filter(([sel, g]) => {
      const was = items.find((i) => i.sel === sel).grid;
      return g.c1 !== was.c1 || g.r1 !== was.r1;
    });
    if (!moved.length) return { same: true, line: 'Already in place.' };
    const next = withBlocks((b) => (grids.has(String(b.id)) ? { ...b, grid: grids.get(String(b.id)) } : null));
    for (const [sel, g] of moved) {
      const problem = placementProblem(next, g, model, sel);
      if (problem) return { error: refusal(problem) };
    }
    return { card: next, line: `${ARRANGE_OPS.find((o) => o.id === op).label}: ${moved.length} moved.` };
  }

  if (op === 'group') {
    const shared = items[0].group && items.every((i) => i.group === items[0].group) ? items[0].group : null;
    const group = shared ? null : newGroup(card);
    const set = (x) => {
      if (!mine(x)) return null;
      if (!shared) return { ...x, group };
      const { group: _g, ...rest } = x;
      return rest;
    };
    const next = tier === 'decor' ? withDecor(set) : withBlocks(set);
    // A group's decor shares one place in the layer order, where its lowest member stood.
    if (tier === 'decor') next.decor = relayer(gathered(next.decor));
    return { card: next, line: shared ? 'Ungrouped.' : `Grouped ${items.length} items.` };
  }

  if (op === 'lock') {
    const unlock = items.every((i) => i.pinned);
    const set = (x) => {
      if (!mine(x)) return null;
      if (unlock) { const { pinned: _p, ...rest } = x; return rest; }
      return { ...x, pinned: true };
    };
    const next = { ...card };
    if (items.some((i) => i.tier === 'decor')) next.decor = decor.map((d) => (items.find((i) => i.tier === 'decor' && i.id === String(d.id)) ? set(d) : d));
    if (items.some((i) => i.tier === 'area')) next.blocks = (card.blocks || []).map((b) => (items.find((i) => i.tier === 'area' && i.id === String(b.id)) ? set(b) : b));
    return { card: next, line: unlock ? 'Unlocked.' : 'Locked. Unlock to move it.' };
  }

  if (op === 'forward' || op === 'back') {
    const order = decorPlan(card).map((p) => decor.find((d) => String(d.id) === p.id));
    const up = op === 'forward';
    const idx = order.map((d, i) => (mine(d) ? i : -1)).filter((i) => i >= 0);
    const walk = up ? [...idx].reverse() : idx;
    let moved = 0;
    for (const i of walk) {
      const j = up ? i + 1 : i - 1;
      if (j < 0 || j >= order.length || mine(order[j])) continue;
      [order[i], order[j]] = [order[j], order[i]];
      moved += 1;
    }
    if (!moved) return { same: true, line: up ? 'Already at the top.' : 'Already at the bottom.' };
    return { card: { ...card, decor: relayer(order) }, line: up ? 'Brought forward.' : 'Sent back.' };
  }

  // Copy style: the first item selected is the source; the rest of its kind take its style.
  const src = items[0];
  const keys = styleKeysOf(src);
  const style = Object.fromEntries(keys.filter((k) => src.item[k] != null).map((k) => [k, src.item[k]]));
  if (!Object.keys(style).length) return { same: true, line: 'Nothing to copy: the first item has no style set.' };
  const targets = items.slice(1).filter((i) => styleKeysOf(i).join() === keys.join());
  const set = (x) => (targets.some((t) => t.id === String(x.id)) ? { ...x, ...style } : null);
  const next = tier === 'decor' ? withDecor(set) : withBlocks(set);
  return { card: next, line: `Style copied to ${targets.length} ${targets.length === 1 ? 'item' : 'items'}.` };
}

/**
 * The selected decor moved by `dx`, `dy` slide pixels, snapped to 8 px and
 * kept on the slide. Pinned items stay. `{ card, line: 'Moved 8 px' }`,
 * `{ same: true }`, or `{ error }`.
 */
export function moveDecor(card, selection, dx, dy, aspect = '16:9') {
  const items = itemsOf(card, selection, aspect).filter((i) => i.tier === 'decor');
  if (!items.length) return { error: 'Select a decor item.' };
  const free = items.filter((i) => !i.pinned);
  if (!free.length) return { error: PINNED };
  const s = SLIDE_SIZES[aspectOf(aspect)];
  const at = new Map();
  for (const i of free) {
    const w = Math.max(BASELINE, snap(i.box.w)); const h = Math.max(BASELINE, snap(i.box.h));
    at.set(i.id, { x: clamp(snap(i.box.x + dx), 0, snap(s.width) - w), y: clamp(snap(i.box.y + dy), 0, snap(s.height) - h), w, h });
  }
  const step = free.map((i) => { const b = at.get(i.id); return Math.max(Math.abs(b.x - snap(i.box.x)), Math.abs(b.y - snap(i.box.y))); });
  const px = Math.max(...step);
  if (!px && free.every((i) => { const b = at.get(i.id); return b.x === i.box.x && b.y === i.box.y && b.w === i.box.w && b.h === i.box.h; })) return { same: true };
  return { card: { ...card, decor: decorList(card).map((d) => (at.has(String(d.id)) ? { ...d, at: at.get(String(d.id)) } : d)) }, line: movedPx(px || BASELINE) };
}

/** The arrow keys' step: 8 px (Shift: three steps, 24 px). */
export function nudgeStep(key, shift = false) {
  const n = BASELINE * (shift ? 3 : 1);
  return { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[key] || null;
}

/**
 * The violet guides for a box being moved: each vertical (x) and horizontal
 * (y) line where one of its edges or its centre meets another item's edge or
 * centre, or the slide's centre. `{ v: [x…], h: [y…] }`, slide pixels.
 */
export function guidesFor(box, others, aspect = '16:9') {
  const s = SLIDE_SIZES[aspectOf(aspect)];
  const xs = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = (b) => [b.y, b.y + b.h / 2, b.y + b.h];
  const tx = new Set([s.width / 2, ...others.flatMap(xs)]);
  const ty = new Set([s.height / 2, ...others.flatMap(ys)]);
  const v = [...new Set(xs(box).filter((x) => tx.has(x)))].sort((a, z) => a - z);
  const h = [...new Set(ys(box).filter((y) => ty.has(y)))].sort((a, z) => a - z);
  return { v, h };
}

/**
 * The spacing markers ("[24] px"): the nearest gap from the box to an item
 * beside it on each side it has a neighbour, where the two share rows (or
 * columns). `[{ axis, x1, y1, x2, y2, px }]`, slide pixels.
 */
export function spacingOf(box, others) {
  const out = [];
  const rowsMeet = (o) => o.y < box.y + box.h && box.y < o.y + o.h;
  const colsMeet = (o) => o.x < box.x + box.w && box.x < o.x + o.w;
  const near = (list, gap) => list.map((o) => ({ o, g: gap(o) })).filter((x) => x.g > 0).sort((a, z) => a.g - z.g)[0];
  const midY = (o) => (Math.max(box.y, o.y) + Math.min(box.y + box.h, o.y + o.h)) / 2;
  const midX = (o) => (Math.max(box.x, o.x) + Math.min(box.x + box.w, o.x + o.w)) / 2;
  const left = near(others.filter(rowsMeet), (o) => box.x - (o.x + o.w));
  if (left) out.push({ axis: 'h', x1: left.o.x + left.o.w, x2: box.x, y1: midY(left.o), y2: midY(left.o), px: left.g });
  const right = near(others.filter(rowsMeet), (o) => o.x - (box.x + box.w));
  if (right) out.push({ axis: 'h', x1: box.x + box.w, x2: right.o.x, y1: midY(right.o), y2: midY(right.o), px: right.g });
  const up = near(others.filter(colsMeet), (o) => box.y - (o.y + o.h));
  if (up) out.push({ axis: 'v', x1: midX(up.o), x2: midX(up.o), y1: up.o.y + up.o.h, y2: box.y, px: up.g });
  const down = near(others.filter(colsMeet), (o) => o.y - (box.y + box.h));
  if (down) out.push({ axis: 'v', x1: midX(down.o), x2: midX(down.o), y1: box.y + box.h, y2: down.o.y, px: down.g });
  return out;
}

/**
 * Every edge on the card that is off its layer's grid: an area not on whole
 * cells of the 12 × 6 grid, or a decor `at` off the 8 px baseline or off the
 * slide. [] when every edge is on its grid (the property test's check).
 */
export function offGridEdges(card, model = null) {
  const cols = model?.grid?.cols ?? 12; const rows = model?.grid?.rows ?? 6;
  const out = [];
  for (const b of card?.blocks || []) {
    const g = b?.grid;
    const ok = g && [g.c1, g.c2, g.r1, g.r2].every(Number.isInteger) && g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= cols && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= rows;
    if (!ok) out.push(`area ${b?.id}`);
  }
  for (const d of decorList(card)) if (d?.at != null && !atOf(d.at)) out.push(`decor ${d?.id}`);
  return out;
}
