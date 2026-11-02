/**
 * D1513 (#3765, deck v2 A4) — a card's structure, chosen and applied, and the
 * minimum sizes a block keeps when a structure or a divider changes its range.
 * Pure: no React, no network.
 *
 *   applyStructure  one of the 17 structures (`gridModel.STRUCTURES`) on a
 *                   card: its blocks, in reading order, take the structure's
 *                   areas in the structure's order; a block with no area left,
 *                   or one too small for an area (a chart needs 4 × 3 cells),
 *                   moves to the card's speaker notes. The card keeps
 *                   `structure` and `areas` (D1499's save rules). One edit, so
 *                   one undo step (#3767 owns undo itself).
 *   movedLine       pd10's preview: "[1] block moves to the notes".
 *   minSizeProblem  "A chart needs at least 4 × 3 cells." (pd12), or null.
 *   overflowOf      after a divider moves: the words a text block no longer
 *                   holds at its new size (`deckReflow`'s capacity, the
 *                   Worker's `designSystem` rule), and `moveOverflow` puts
 *                   them in the notes, one edit (pd12: "[18] words over ·
 *                   Move overflow to notes · One undo step").
 */
import { STRUCTURES, structureOf } from './gridModel.js';
import { withFieldBlocks, KIND_LABELS } from './editorModel.js';
import { NOTES_MAX, fitWords, textCapacity, typeRoleOf } from './deckReflow.js';

/** The smallest range a block of each kind keeps, in cells (pd12). Kinds not listed take any whole cell. */
export const MIN_CELLS = Object.freeze({ chart: Object.freeze({ cols: 4, rows: 3 }) });

const span = (g) => ({ cols: g.c2 - g.c1 + 1, rows: g.r2 - g.r1 + 1 });

/** pd12's sentence when `grid` is too small for the block's kind, else null. */
export function minSizeProblem(block, grid) {
  const min = MIN_CELLS[block?.kind];
  if (!min || !grid) return null;
  const s = span(grid);
  if (s.cols >= min.cols && s.rows >= min.rows) return null;
  const name = (KIND_LABELS[block.kind] || block.kind || 'block').toLowerCase();
  return `A ${name} needs at least ${min.cols} × ${min.rows} cells.`;
}

/** Top to bottom, then left to right: the reading order of a card without a structure. */
export const readingOrder = (blocks) => [...blocks].sort((a, b) => (a.grid?.r1 ?? 0) - (b.grid?.r1 ?? 0) || (a.grid?.c1 ?? 0) - (b.grid?.c1 ?? 0));

/** What a block says in the notes when it leaves the slide. */
export function blockNote(b) {
  if (b.kind === 'text') return String(b.text ?? '').trim();
  if (b.kind === 'metric') return [String(b.label ?? '').trim(), String(b.value ?? '').trim()].filter(Boolean).join(': ');
  const label = KIND_LABELS[b.kind] || b.kind || 'Block';
  return [label, b.title || b.label || b.alt || ''].filter(Boolean).join(': ');
}

export const MOVED_HEADING = 'Moved from the slide when its structure changed:';

/** The structure's areas as a card stores them (D1499: whole cells, ≤ 12, its own order). */
const cardAreas = (s) => s.areas.map((a) => ({ id: a.id, c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2, order: a.order, inset: 0, align: 'start', ...(a.role ? { role: a.role } : {}) }));

/**
 * `{ card, moved: [{ id, kind, why, text }], count }`, or `{ error, card }` when
 * a card from before the Grid cannot be converted. Nothing is lost: what has
 * no area is in the notes, under one heading.
 */
export function applyStructure(cardIn, structureIn) {
  const structure = typeof structureIn === 'string' ? structureOf(structureIn) : structureIn;
  if (!structure) return { error: 'That structure is not one of the seventeen.', card: cardIn, moved: [], count: 0 };
  const ready = withFieldBlocks(cardIn, null);
  if (ready.error) return { error: ready.error, card: cardIn, moved: [], count: 0 };
  const card = ready.card;
  const areas = [...structure.areas].sort((a, b) => a.order - b.order);
  const blocks = [];
  const moved = [];
  const used = new Set();
  for (const b of readingOrder(Array.isArray(card.blocks) ? card.blocks : [])) {
    // The first area, in the structure's order, that is free and big enough: a chart passes over one too small for it.
    const free = areas.filter((a) => !used.has(a.id));
    const fit = free.find((a) => !minSizeProblem(b, a));
    if (fit) {
      used.add(fit.id);
      blocks.push({ ...b, grid: { c1: fit.c1, c2: fit.c2, r1: fit.r1, r2: fit.r2 } });
    } else {
      moved.push({ id: String(b.id), kind: b.kind, why: free.length ? minSizeProblem(b, free[0]) : 'No area is left for it.', text: blockNote(b) });
    }
  }
  const lines = moved.map((m) => m.text).filter(Boolean);
  const was = typeof card.notes === 'string' ? card.notes.trimEnd() : '';
  const notes = lines.length ? [was, `${MOVED_HEADING}\n${lines.join('\n')}`].filter(Boolean).join('\n\n').slice(0, NOTES_MAX) : card.notes;
  const out = { ...card, structure: structure.id, areas: cardAreas(structure), blocks, ...(notes !== undefined ? { notes } : {}) };
  return { card: out, moved, count: moved.length };
}

/** pd10's preview line. */
export const movedLine = (n) => (n === 0 ? 'Every block keeps a place.' : `${n} ${n === 1 ? 'block moves' : 'blocks move'} to the notes`);

/** pd10's "Recommended for Seed" (the plan's stage words). */
export const recommendedLine = (s) => ((s.recommended || []).includes('seed') ? 'Recommended for Seed' : null);

export { STRUCTURES };

const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

/** `{ id, words, kept }` for a text block whose words no longer fit its range, else null. */
export function overflowOf(card, id, aspect = '16:9') {
  const b = (card?.blocks || []).find((x) => String(x.id) === String(id));
  if (!b || b.kind !== 'text' || !b.grid) return null;
  const text = String(b.text ?? '');
  const cap = textCapacity(b.grid, typeRoleOf(b.style, card.layout ?? null), aspect);
  if (text.length <= cap) return null;
  const kept = fitWords(text, cap);
  const over = words(text) - words(kept);
  return over > 0 ? { id: String(b.id), words: over, kept } : null;
}

/** pd12's line: "[18] words over". */
export const overLine = (n) => `${n} ${n === 1 ? 'word' : 'words'} over`;

export const OVERFLOW_HEADING = 'Moved from the slide when its area got smaller:';

/** The card with the block's overflow in the notes: the words that fit stay, the rest follow the heading. */
export function moveOverflow(card, id, aspect = '16:9') {
  const o = overflowOf(card, id, aspect);
  if (!o) return { card, same: true };
  const b = card.blocks.find((x) => String(x.id) === o.id);
  const rest = String(b.text).slice(o.kept.length).trim();
  const was = typeof card.notes === 'string' ? card.notes.trimEnd() : '';
  const notes = [was, `${OVERFLOW_HEADING}\n${rest}`].filter(Boolean).join('\n\n').slice(0, NOTES_MAX);
  return { card: { ...card, notes, blocks: card.blocks.map((x) => (x === b ? { ...b, text: o.kept } : x)) }, moved: o.words };
}

