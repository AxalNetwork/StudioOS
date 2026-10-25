/**
 * D898 (#2676, part 4 of #2434) — the Pitch deck editor's derivations, pure.
 *
 * The editor works on one version's slides (`GET /api/decks/:id`) against the
 * slide model the Worker serves (`GET /api/decks/model`): the 12 × 6 grid, the
 * twelve layouts as presets, the block kinds. Nothing here keeps its own copy
 * of those lists; every function takes the model it was given.
 *
 * A save is one `PUT /api/decks/:id` that writes a new version. Before it runs,
 * `changesOf` says, card by card, what the save changes, and the dialog shows
 * exactly that. A value nobody recorded reads "Not recorded", never 0.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

/** PD1b: the three callouts a founder sees the first time, dismissed once with Got it. */
export const CALLOUTS = [
  { n: '1', t: 'Figures come from your records', d: 'Each figure on a card is read from a store, never typed by Eadwyn.' },
  { n: '2', t: 'Every figure shows its source', d: 'Its chip says where it came from, when, and how it is graded.' },
  { n: '3', t: 'Eadwyn drafts, you keep or discard', d: 'Nothing Eadwyn proposes reaches a version until you keep it.' },
];
export const FIRST_RUN_KEY = 'studioos:pitch-editor:first-run-seen';
export const NOTES_PLACEHOLDER = 'What you will say on this card. Only you see these.';
export const NO_CARDS = 'This version has no cards yet.';
export const READ_FAILED = 'This version could not be read.';
export const MODEL_FAILED = 'The editor could not read the slide model.';
export const KIT_FAILED = 'Your brand kit could not be read. The card shows the neutral light theme.';
export const NO_KIT = 'No brand kit yet. Build one in Build › Brand.';
export const PHONE_NOTE = 'Notes and order only on a phone. Edit layouts on a larger screen.';

/** Who a version is written for (PD3), as the Worker stores it. */
export const AUDIENCE_LABELS = {
  angel: 'Angel', pre_seed_fund: 'Pre-seed fund', seed_fund: 'Seed fund', series_a_fund: 'Series A fund',
  strategic: 'Strategic', grant: 'Grant', other: 'Other',
};
export const THEME_LABELS = { brand: 'From your brand kit', neutral_light: 'Neutral light', neutral_dark: 'Neutral dark' };

export const KIND_LABELS = {
  text: 'Text', chart: 'Chart', graphic: 'Graphic', image: 'Image', video: 'Video link', audio: 'Audio link', link: 'Link button', metric: 'Metric tile',
};

/** PD8c's picker, in the canvas's order. Charts are placed from the chart library (PD9b), not this picker. */
export const ADDABLE_KINDS = ['text', 'graphic', 'image', 'video', 'audio', 'link', 'metric'];

/** Read from localStorage, wrapped: a private window or blocked storage reads as "not seen". */
export function firstRunSeen(storage = globalThis.localStorage) {
  try { return storage?.getItem(FIRST_RUN_KEY) === '1'; } catch { return false; }
}
export function markFirstRunSeen(storage = globalThis.localStorage) {
  try { storage?.setItem(FIRST_RUN_KEY, '1'); } catch { /* a convenience: the callouts show again next time */ }
}

const str = (v) => String(v ?? '').trim();
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

/** The version's cards, deep-copied so the editor never mutates what it read. */
export const cardsOf = (deck) => (Array.isArray(deck?.slides) ? clone(deck.slides) : []);

export function cardTitle(card, i) {
  const fromBlock = Array.isArray(card?.blocks) ? card.blocks.find((b) => b?.kind === 'text' && b.style === 'heading' && str(b.text)) : null;
  return str(card?.title) || str(fromBlock?.text) || `Card ${i + 1}`;
}

/** "6 × 1 text": a block's size is the range it covers, columns by rows (PD8b). */
export function blockLabel(block) {
  const g = block?.grid || {};
  const cols = g.c2 - g.c1 + 1;
  const rows = g.r2 - g.r1 + 1;
  return `${cols} × ${rows} ${(KIND_LABELS[block?.kind] || 'block').toLowerCase()}`;
}

export function gridValid(g, model) {
  const cols = model?.grid?.cols ?? 12;
  const rows = model?.grid?.rows ?? 6;
  const ok = (n) => Number.isInteger(n);
  return Boolean(g) && ok(g.c1) && ok(g.c2) && ok(g.r1) && ok(g.r2)
    && g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= cols && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= rows;
}

export const overlaps = (a, b) => a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

/** What stops a block from sitting at `grid` on this card, or null when it fits. */
export function placementProblem(card, grid, model, exceptId = null) {
  if (!gridValid(grid, model)) return `The range must sit on the ${model?.grid?.cols ?? 12} × ${model?.grid?.rows ?? 6} grid.`;
  const blocks = Array.isArray(card?.blocks) ? card.blocks : [];
  if (!exceptId && blocks.length >= (model?.max_blocks ?? 24)) return `A card holds at most ${model?.max_blocks ?? 24} blocks.`;
  const hit = blocks.find((b) => b.id !== exceptId && b.grid && overlaps(b.grid, grid));
  return hit ? `It overlaps the ${blockLabel(hit)}.` : null;
}

/**
 * The standard sizes PD8c offers for a kind, as `{ label, cols, rows }`. A
 * cell on a 16:9 card is 16/12 wide by 9/6 tall, so a 16:9 video is twice as
 * many columns as rows.
 */
export function standardSizes(kind, ratio = null) {
  if (kind === 'video') return [{ label: '16:9', cols: 4, rows: 2 }, { label: '16:9 large', cols: 6, rows: 3 }, { label: '9:16', cols: 2, rows: 3 }];
  if (kind === 'graphic') return [{ label: '1 × 1', cols: 1, rows: 1 }, { label: '2 × 2', cols: 2, rows: 2 }];
  if (kind === 'image' && ratio > 0) {
    // The file's own ratio, to the nearest whole range: cols/rows = ratio / (cell ratio 8/9).
    const want = ratio * (9 / 8);
    const rows = want >= 1 ? 3 : 4;
    const cols = Math.max(1, Math.min(12, Math.round(rows * want)));
    return [{ label: "The file's ratio", cols, rows }];
  }
  if (kind === 'audio' || kind === 'link') return [{ label: '3 × 1', cols: 3, rows: 1 }];
  if (kind === 'metric') return [{ label: '3 × 2', cols: 3, rows: 2 }];
  return [{ label: '6 × 1', cols: 6, rows: 1 }, { label: '6 × 2', cols: 6, rows: 2 }];
}

/** The first free range of `cols × rows` on the card, reading the grid row by row, or null. */
export function firstFree(card, cols, rows, model) {
  const C = model?.grid?.cols ?? 12;
  const R = model?.grid?.rows ?? 6;
  for (let r1 = 1; r1 + rows - 1 <= R; r1 += 1) {
    for (let c1 = 1; c1 + cols - 1 <= C; c1 += 1) {
      const g = { c1, c2: c1 + cols - 1, r1, r2: r1 + rows - 1 };
      if (!placementProblem(card, g, model)) return g;
    }
  }
  return null;
}

const nextId = (blocks) => {
  const used = new Set(blocks.map((b) => b.id));
  let n = blocks.length + 1;
  while (used.has(`b${n}`)) n += 1;
  return `b${n}`;
};

/** The card with one block added, or `{ error }` when it does not fit. */
export function addBlock(card, block, model) {
  const problem = placementProblem(card, block.grid, model);
  if (problem) return { error: problem };
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  return { card: { ...card, blocks: [...blocks, { ...block, id: block.id || nextId(blocks) }] } };
}

export function removeBlock(card, id) {
  return { ...card, blocks: (card.blocks || []).filter((b) => b.id !== id) };
}

export function updateBlock(card, id, patch) {
  return { ...card, blocks: (card.blocks || []).map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/**
 * A layout applied to a card (PD8). The preset's blocks take the card's
 * existing content in order, kind by kind: the first text block keeps the
 * first text, and so on. What the new layout has no place for is returned as
 * `dropped`, so the dialog can say so before anything changes.
 */
export function applyLayout(card, layout) {
  const old = Array.isArray(card?.blocks) ? card.blocks : [];
  const byKind = new Map();
  for (const b of old) byKind.set(b.kind, [...(byKind.get(b.kind) || []), b]);
  const used = new Set();
  const blocks = (layout?.blocks || []).map((p, i) => {
    const queue = byKind.get(p.kind) || [];
    const prev = queue.shift();
    if (prev) used.add(prev.id);
    const { id: _id, grid: _grid, ...content } = prev || {};
    return { ...(prev ? content : {}), ...p, ...(prev && p.style === undefined && content.style ? { style: content.style } : {}), id: `b${i + 1}`, kind: p.kind, grid: { ...p.grid } };
  });
  const dropped = old.filter((b) => !used.has(b.id));
  return { card: { ...card, layout: layout.id, blocks }, dropped };
}

export function moveCard(cards, from, to) {
  if (from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return cards;
  const next = [...cards];
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card);
  return next;
}

/** Arrow keys on a rail card: Up and Down move it one place (PD1's reorder, keyboard). */
export function keyMove(key, i, n) {
  if (key === 'ArrowUp' && i > 0) return i - 1;
  if (key === 'ArrowDown' && i < n - 1) return i + 1;
  return null;
}

/** The cards whose bound figures their store has moved past (D896's refresh: stale or gone). */
export function staleCards(refresh) {
  const out = new Set();
  for (const r of Array.isArray(refresh?.rows) ? refresh.rows : []) {
    if ((r.state === 'stale' || r.state === 'gone') && Number.isInteger(r.slide)) out.add(r.slide);
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What a save changes, as sentences, card by card, and for the whole
 * version. Cards are matched by position after the reorder is named, so a
 * moved card is "moved", not "changed".
 */
export function changesOf(base, next, model = null) {
  const layoutLabel = (id) => (model?.layouts || []).find((l) => l.id === id)?.label || id;
  const out = [];
  const a = base.cards;
  const b = next.cards;
  const key = (c) => JSON.stringify(c);
  if (a.length === b.length && a.some((c, i) => key(c) !== key(b[i])) && [...a].map(key).sort().join() === [...b].map(key).sort().join()) {
    out.push('The cards are in a new order.');
    return withVersion(out, base, next);
  }
  if (b.length > a.length) out.push(`${b.length - a.length} card${b.length - a.length === 1 ? '' : 's'} added.`);
  if (b.length < a.length) out.push(`${a.length - b.length} card${a.length - b.length === 1 ? '' : 's'} removed.`);
  b.forEach((card, i) => {
    const was = a[i];
    if (!was) return;
    const name = `Card ${i + 1}, ${cardTitle(card, i)}`;
    if (card.layout !== was.layout) out.push(`${name}: the layout becomes ${card.layout ? layoutLabel(card.layout) : 'none'}.`);
    if (str(card.notes) !== str(was.notes)) out.push(`${name}: the speaker notes change.`);
    if (!same(card.background, was.background)) out.push(`${name}: the background changes.`);
    const ob = was.blocks || [];
    const nb = card.blocks || [];
    const oldIds = new Map(ob.map((x) => [x.id, x]));
    const added = nb.filter((x) => !oldIds.has(x.id));
    const kept = nb.filter((x) => oldIds.has(x.id));
    const removed = ob.filter((x) => !nb.some((y) => y.id === x.id));
    for (const x of added) out.push(`${name}: adds a ${blockLabel(x)}.`);
    for (const x of removed) out.push(`${name}: removes the ${blockLabel(x)}.`);
    for (const x of kept) if (!same(x, oldIds.get(x.id))) out.push(`${name}: changes the ${blockLabel(x)}.`);
    const restA = { ...was, notes: undefined, layout: undefined, background: undefined, blocks: undefined };
    const restB = { ...card, notes: undefined, layout: undefined, background: undefined, blocks: undefined };
    if (!same(restA, restB)) out.push(`${name}: its words change.`);
  });
  return withVersion(out, base, next);
}

function withVersion(out, base, next) {
  if (!same(base.theme ?? null, next.theme ?? null)) out.push(`The theme becomes ${THEME_LABELS[next.theme?.kind || 'brand']}.`);
  if ((base.audience ?? null) !== (next.audience ?? null)) out.push(`The audience becomes ${AUDIENCE_LABELS[next.audience] || NOT_RECORDED}.`);
  return out;
}

/** The theme applied to every card (PD8's Apply to all): each card's own background is cleared. */
export function applyToAll(cards) {
  return cards.map((c) => { const { background: _bg, ...rest } = c; return rest; });
}

/** PD1's "Saved · …": when the version on screen was written, or that there are changes to save. */
export function saveState({ dirty, savedAt, now = Date.now(), readOnly = false, version = null }) {
  const v = version == null ? '' : ` · v${version}`;
  if (readOnly) return `Read only${v}`;
  if (dirty) return 'Unsaved changes';
  const t = Date.parse(savedAt ? String(savedAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(savedAt)) ? '' : 'Z') : '');
  if (!Number.isFinite(t)) return `Saved${v}`;
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'Saved · just now';
  if (mins < 60) return `Saved · ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Saved · ${hours} h ago`;
  return `Saved · ${Math.round(hours / 24)} d ago`;
}

/** The colours the centre card draws with: the brand kit, or a neutral theme, or neutral light when the kit is missing. */
export function cardColours(theme, kit) {
  if (theme?.kind === 'neutral_dark') return { bg: '#111827', ink: '#f9fafb', accent: '#a78bfa', muted: '#9ca3af' };
  const light = { bg: '#ffffff', ink: '#0f2a3d', accent: '#6d28d9', muted: '#6b7280' };
  if (theme?.kind === 'neutral_light' || !kit?.palette) return light;
  const p = kit.palette;
  return { bg: p.bg || light.bg, ink: p.ink || light.ink, accent: p.accent || light.accent, muted: p.secondary || light.muted };
}

/** A metric tile's figure: its value, or Not recorded. Never 0 for a missing one. */
export const tileValue = (block) => (str(block?.value) ? str(block.value) : NOT_RECORDED);
