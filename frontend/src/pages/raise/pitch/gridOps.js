/**
 * D1515 (#3767, deck v2 A4c, plan §5.9.2) — THE UNDO MODEL: every edit on the
 * deck is an operation, and every operation has its inverse.
 *
 *   apply(doc, op) → { doc, inverse }      or { doc, inverse: null, error }
 *
 * `doc` is the editor's working deck, `{ cards, theme, audience }`. Each
 * reducer is pure: it never mutates `doc` (cards it does not touch are the
 * same objects), it reads no clock and no network, and `inverse` is an
 * operation that, applied to the result, gives back `doc` exactly (the
 * property test `deck_grid_ops_d1515` holds every op to it, over seeded
 * random decks). An op the slide model refuses (a divider past a chart's
 * minimum, a structure that is not one of the seventeen) answers its sentence
 * and changes nothing.
 *
 * The ops of plan §5.9.2:
 *   setStructure, moveDivider, addBlock, updateBlock, removeBlock, moveArea,
 *   insertProposal, insertBatch, setTheme, applyBrand, reorderCards,
 *   duplicateCard, hideCard, moveOverflowToNotes, findReplace, decorOp
 * and the plain ones the editor's other edits use: setCard, setCards,
 * setDoc, setAudience, moveCard, insertCard, removeCard, setFlag, insertBlock.
 *
 * THE HISTORY (`emptyHistory`, `record`, `undo`, `redo`) keeps 100 steps.
 * A step is a list of ops and their inverses, undone last to first:
 *   - typing in one field, and a nudge burst on one block, are one step while
 *     the edits come within 800 ms of each other (`coalesce`);
 *   - Accept all is one step however many areas it places (`group`);
 *   - Apply theme, Apply structure, Move overflow to notes, Reorder for stage
 *     and Find and replace are each one op, so one step.
 * A step that placed an accepted run keeps `charged`, so undoing it can say
 * that the run is still charged (undo never refunds it, plan §4.5).
 *
 * Bound figures: `findReplace` never changes a metric, a block that carries a
 * `binding`, or a chart's series ("Bound figures are never replaced.").
 *
 * The history is frontend-only: no Worker route stores it, so
 * `deckV2Adapter.history` answers it without `through()`.
 */

import { addBlock as placeBlock, applyToAll, moveCard as moveCardIn, updateBlock as patchBlock } from './editorModel.js';
import { applyStructure, minSizeProblem, moveOverflow } from './structureModel.js';
import { moveDivider as divide } from './gridSelection.js';
import { charsOf, spliceChars, textOf, withChars } from './richText.js';

/** Plan §5.9.2: history is 100 entries. */
export const HISTORY_STEPS = 100;
/** Typing (800 ms idle) and one nudge burst count as one step. */
export const COALESCE_MS = 800;

const refused = (doc, error) => ({ doc, inverse: null, error });
const cardsOf = (doc) => (Array.isArray(doc?.cards) ? doc.cards : []);
const at = (doc, i) => (Number.isInteger(i) && i >= 0 && i < cardsOf(doc).length ? cardsOf(doc)[i] : null);
const withCard = (doc, i, card) => ({ ...doc, cards: cardsOf(doc).map((c, j) => (j === i ? card : c)) });
const restoreCard = (doc, i, was) => ({ type: 'setCard', index: i, card: was });
const noCard = (doc) => refused(doc, 'That card is no longer in this deck.');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/** A block that holds a figure from a record: a metric, or anything with a binding. Never rewritten here. */
export const isBound = (b) => b?.kind === 'metric' || Boolean(b?.binding && typeof b.binding === 'object') || b?.kind === 'chart';

// ─────────────────────────────────────────────────────────────── the reducers

const REDUCERS = {
  /** One card replaced as a whole. */
  setCard(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    return { doc: withCard(doc, op.index, op.card), inverse: restoreCard(doc, op.index, was) };
  },
  /** Every card replaced (the inverse of an op that touches many cards). */
  setCards(doc, op) {
    return { doc: { ...doc, cards: Array.isArray(op.cards) ? op.cards : [] }, inverse: { type: 'setCards', cards: cardsOf(doc) } };
  },
  /** Several parts of the deck at once (the slide size: the cards and the theme together). */
  setDoc(doc, op) {
    const parts = op.parts || {};
    const back = {};
    for (const k of ['cards', 'theme', 'audience']) if (own(parts, k)) back[k] = doc[k];
    return { doc: { ...doc, ...parts }, inverse: { type: 'setDoc', parts: back } };
  },
  setTheme(doc, op) {
    return { doc: { ...doc, theme: op.theme ?? null }, inverse: { type: 'setTheme', theme: doc.theme ?? null } };
  },
  setAudience(doc, op) {
    return { doc: { ...doc, audience: op.audience ?? null }, inverse: { type: 'setAudience', audience: doc.audience ?? null } };
  },
  /** Apply brand (Theme › Apply to all cards): the theme, if given, and every card's own background cleared. */
  applyBrand(doc, op) {
    const next = { ...doc, cards: applyToAll(cardsOf(doc)), ...(own(op, 'theme') ? { theme: op.theme ?? null } : {}) };
    return { doc: next, inverse: { type: 'setDoc', parts: { cards: cardsOf(doc), ...(own(op, 'theme') ? { theme: doc.theme ?? null } : {}) } } };
  },
  /** One of the 17 structures on one card (D1513): what has no area moves to the notes. */
  setStructure(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const r = applyStructure(was, op.structure);
    if (r.error) return refused(doc, r.error);
    return { doc: withCard(doc, op.index, r.card), inverse: restoreCard(doc, op.index, was) };
  },
  /** A divider moved by whole cells, both blocks resized together (D1513). */
  moveDivider(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const r = divide(was, op.div, op.delta, op.model ?? null, minSizeProblem);
    if (r.error) return refused(doc, r.error);
    if (r.same) return { doc, inverse: { type: 'noop' } };
    return { doc: withCard(doc, op.index, r.card), inverse: restoreCard(doc, op.index, was) };
  },
  /** Move overflow to notes: the words that fit stay, the rest go to the notes (D1513). */
  moveOverflowToNotes(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const r = moveOverflow(was, op.id, op.aspect || '16:9');
    if (r.same) return { doc, inverse: { type: 'noop' } };
    return { doc: withCard(doc, op.index, r.card), inverse: restoreCard(doc, op.index, was) };
  },
  addBlock(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const r = placeBlock(was, op.block, op.model ?? null);
    if (r.error) return refused(doc, r.error);
    return { doc: withCard(doc, op.index, r.card), inverse: restoreCard(doc, op.index, was) };
  },
  /** A block put back where it stood in the card's list (the inverse of removeBlock). */
  insertBlock(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const blocks = Array.isArray(was.blocks) ? was.blocks : [];
    const k = Math.max(0, Math.min(blocks.length, op.at ?? blocks.length));
    const card = { ...was, blocks: [...blocks.slice(0, k), op.block, ...blocks.slice(k)] };
    return { doc: withCard(doc, op.index, card), inverse: { type: 'removeBlock', index: op.index, id: op.block.id } };
  },
  removeBlock(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const blocks = Array.isArray(was.blocks) ? was.blocks : [];
    const k = blocks.findIndex((b) => b.id === op.id);
    if (k < 0) return refused(doc, 'That block is no longer on this card.');
    const card = { ...was, blocks: blocks.filter((_, j) => j !== k) };
    return { doc: withCard(doc, op.index, card), inverse: { type: 'insertBlock', index: op.index, at: k, block: blocks[k] } };
  },
  /** Some fields of one block; the inverse puts back each field as it was, or takes away one that was not there. */
  updateBlock(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const block = (was.blocks || []).find((b) => b.id === op.id);
    if (!block) return refused(doc, 'That block is no longer on this card.');
    const patch = op.patch || {};
    const back = {};
    const drop = [];
    for (const k of Object.keys(patch)) { if (own(block, k)) back[k] = block[k]; else drop.push(k); }
    for (const k of op.drop || []) if (own(block, k)) back[k] = block[k];
    let card = patchBlock(was, op.id, patch);
    if ((op.drop || []).length) card = { ...card, blocks: card.blocks.map((b) => (b.id === op.id ? omit(b, op.drop) : b)) };
    return { doc: withCard(doc, op.index, card), inverse: { type: 'updateBlock', index: op.index, id: op.id, patch: back, drop } };
  },
  /** A block moved to another range on the Grid, its size kept (a drag or a nudge). */
  moveArea(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const block = (was.blocks || []).find((b) => b.id === op.id);
    if (!block) return refused(doc, 'That block is no longer on this card.');
    return { doc: withCard(doc, op.index, patchBlock(was, op.id, { grid: op.grid })), inverse: { type: 'moveArea', index: op.index, id: op.id, grid: block.grid } };
  },
  /** An accepted proposal placed: the card as Accept left it. */
  insertProposal(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    return { doc: withCard(doc, op.index, op.card), inverse: { type: 'insertProposal', index: op.index, card: was } };
  },
  /** Several accepted proposals placed at once: `{ index, card }` each. */
  insertBatch(doc, op) {
    const items = Array.isArray(op.items) ? op.items : [];
    if (items.some((x) => !at(doc, x.index))) return noCard(doc);
    let next = doc;
    const back = [];
    for (const x of items) { back.unshift({ index: x.index, card: at(next, x.index) }); next = withCard(next, x.index, x.card); }
    return { doc: next, inverse: { type: 'insertBatch', items: back } };
  },
  /** One card moved to another place. */
  moveCard(doc, op) {
    const cards = cardsOf(doc);
    if (!at(doc, op.from) || !at(doc, op.to)) return noCard(doc);
    return { doc: { ...doc, cards: moveCardIn(cards, op.from, op.to) }, inverse: { type: 'moveCard', from: op.to, to: op.from } };
  },
  /** Reorder for stage: `order[i]` is the index, now, of the card that goes to place i. */
  reorderCards(doc, op) {
    const cards = cardsOf(doc);
    const order = Array.isArray(op.order) ? op.order : [];
    const ok = order.length === cards.length && new Set(order).size === order.length && order.every((i) => Number.isInteger(i) && i >= 0 && i < cards.length);
    if (!ok) return refused(doc, 'That order does not name every card once.');
    const back = new Array(order.length);
    order.forEach((from, to) => { back[from] = to; });
    return { doc: { ...doc, cards: order.map((i) => cards[i]) }, inverse: { type: 'reorderCards', order: back } };
  },
  /** A copy of a card right after it, with the uid it is given (a duplicate never shares its original's). */
  duplicateCard(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const copy = { ...JSON.parse(JSON.stringify(was)), uid: op.uid };
    const cards = cardsOf(doc);
    return { doc: { ...doc, cards: [...cards.slice(0, op.index + 1), copy, ...cards.slice(op.index + 1)] }, inverse: { type: 'removeCard', index: op.index + 1 } };
  },
  insertCard(doc, op) {
    const cards = cardsOf(doc);
    const k = Math.max(0, Math.min(cards.length, op.index ?? cards.length));
    return { doc: { ...doc, cards: [...cards.slice(0, k), op.card, ...cards.slice(k)] }, inverse: { type: 'removeCard', index: k } };
  },
  removeCard(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    return { doc: { ...doc, cards: cardsOf(doc).filter((_, j) => j !== op.index) }, inverse: { type: 'insertCard', index: op.index, card: was } };
  },
  /** One field of a card (`appendix`, `section`, `decor`…): `value` undefined takes it away. */
  setFlag(doc, op) {
    const was = at(doc, op.index);
    if (!was) return noCard(doc);
    const card = op.value === undefined ? omit(was, [op.key]) : { ...was, [op.key]: op.value };
    return { doc: withCard(doc, op.index, card), inverse: { type: 'setFlag', index: op.index, key: op.key, value: own(was, op.key) ? was[op.key] : undefined } };
  },
  /** Hide: left out of Present (D1500's `hidden`); shown again takes the field away. */
  hideCard(doc, op) {
    return REDUCERS.setFlag(doc, { index: op.index, key: 'hidden', value: op.hidden ? true : undefined });
  },
  /** A card's decor list (D1500, at most 16 items); an empty list takes it away. */
  decorOp(doc, op) {
    const list = Array.isArray(op.decor) && op.decor.length ? op.decor.slice(0, 16) : undefined;
    return REDUCERS.setFlag(doc, { index: op.index, key: 'decor', value: list });
  },
  /** Every match of `find` in the deck's words replaced; bound figures are never touched. */
  findReplace(doc, op) {
    const r = replaceAll(doc, op);
    if (r.error) return refused(doc, r.error);
    return { doc: { ...doc, cards: r.cards }, inverse: { type: 'setCards', cards: cardsOf(doc) } };
  },
  noop(doc) { return { doc, inverse: { type: 'noop' } }; },
};

function omit(o, keys) {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

/** The ops this module answers, for the property test and the adapter. */
export const OPS = Object.freeze(Object.keys(REDUCERS));

/** Apply one op. An unknown op is refused, never ignored. */
export function apply(doc, op) {
  const fn = REDUCERS[op?.type];
  if (!fn) return refused(doc, `That edit (${String(op?.type)}) is not one the editor knows.`);
  return fn(doc, op);
}

// ─────────────────────────────────────────────────────── find and replace

export const BOUND_NEVER = 'Bound figures are never replaced.';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const finder = (find, matchCase) => new RegExp(escape(String(find)), matchCase ? 'g' : 'gi');

/** Where `find` is in a string, as [start, end) pairs, left to right. */
function spans(text, find, matchCase) {
  if (!find) return [];
  const out = [];
  const re = finder(find, matchCase);
  let m;
  while ((m = re.exec(text))) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex += 1; }
  return out;
}

/** A text block with every match replaced, its rich runs kept (the replacement takes the marks of the words it replaces). */
function replaceInBlock(block, find, replace, matchCase) {
  let chars = charsOf(block);
  const hits = spans(textOf(chars), find, matchCase);
  if (!hits.length) return { block, n: 0 };
  for (const [s, e] of [...hits].reverse()) chars = spliceChars(chars, s, e, replace);
  return { block: Array.isArray(block.paras) ? withChars(block, chars) : { ...block, text: textOf(chars) }, n: hits.length };
}

/**
 * What Find would change: `{ matches, cards, skipped }`, where `skipped`
 * counts matches inside bound figures, which Replace all leaves alone.
 */
export function findIn(doc, { find, matchCase = false } = {}) {
  let matches = 0; let skipped = 0;
  const hitCards = new Set();
  cardsOf(doc).forEach((c, i) => {
    let n = spans(String(c.title ?? ''), find, matchCase).length + spans(String(c.notes ?? ''), find, matchCase).length;
    for (const b of Array.isArray(c.blocks) ? c.blocks : []) {
      const words = [b.text, b.label, b.value, b.title].filter((v) => typeof v === 'string').join('\n');
      if (isBound(b)) { skipped += spans(words, find, matchCase).length; continue; }
      if (b.kind === 'text') n += spans(textOf(charsOf(b)), find, matchCase).length;
    }
    if (n) { matches += n; hitCards.add(i); }
  });
  return { matches, cards: hitCards.size, skipped };
}

function replaceAll(doc, { find, replace = '', matchCase = false }) {
  if (typeof find !== 'string' || !find) return { error: 'Type the words to find.' };
  let total = 0;
  const cards = cardsOf(doc).map((c) => {
    let changed = false;
    const next = { ...c };
    for (const k of ['title', 'notes']) {
      if (typeof c[k] !== 'string') continue;
      const n = spans(c[k], find, matchCase).length;
      if (n) { next[k] = c[k].replace(finder(find, matchCase), () => replace); total += n; changed = true; }
    }
    if (Array.isArray(c.blocks)) {
      const blocks = c.blocks.map((b) => {
        if (isBound(b) || b.kind !== 'text') return b;
        const r = replaceInBlock(b, find, replace, matchCase);
        if (r.n) { total += r.n; changed = true; }
        return r.block;
      });
      if (changed) next.blocks = blocks;
    }
    return changed ? next : c;
  });
  if (!total) return { error: `No match for “${find}”. Nothing changed.` };
  return { cards, count: total };
}

// ───────────────────────────────────────────────────────────── the history

export const emptyHistory = () => ({ past: [], future: [] });

/**
 * A step recorded after its ops were applied: `{ ops, inverses, label,
 * charged, group, coalesce, at }`. It joins the step before when both carry
 * the same `group` (Accept all), or the same `coalesce` key within 800 ms of
 * that step's last edit (typing, a nudge burst). The oldest step past 100
 * is forgotten, and anything that was undone can no longer be redone.
 */
export function record(history, step, limit = HISTORY_STEPS) {
  const h = history || emptyHistory();
  const top = h.past[h.past.length - 1];
  const joins = top && ((step.group && top.group === step.group)
    || (step.coalesce && top.coalesce === step.coalesce && Number.isFinite(step.at) && step.at - top.last <= COALESCE_MS));
  if (joins) {
    const merged = { ...top, ops: [...top.ops, ...step.ops], inverses: [...top.inverses, ...step.inverses], charged: Boolean(top.charged || step.charged), last: step.at ?? top.last };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const entry = { label: step.label || 'Edit', ops: step.ops, inverses: step.inverses, charged: Boolean(step.charged), group: step.group || null, coalesce: step.coalesce || null, last: step.at ?? null };
  return { past: [...h.past, entry].slice(-limit), future: [] };
}

/** Apply ops one after another; the first refusal stops them and nothing changes. */
function run(doc, ops) {
  let next = doc;
  const inverses = [];
  for (const op of ops) {
    const r = apply(next, op);
    if (r.error) return { error: r.error };
    next = r.doc;
    inverses.push(r.inverse);
  }
  return { doc: next, inverses };
}

/** Apply ops and record them as one step. `{ doc, history }`, or `{ error }` with nothing changed. */
export function perform(doc, history, ops, meta = {}) {
  const list = Array.isArray(ops) ? ops : [ops];
  const r = run(doc, list);
  if (r.error) return { error: r.error };
  return { doc: r.doc, history: record(history, { ...meta, ops: list, inverses: r.inverses }) };
}

/** One step back: its inverses, last first. `{ doc, history, step }`, or null when there is nothing to undo. */
export function undo(doc, history) {
  const top = history?.past?.[history.past.length - 1];
  if (!top) return null;
  const r = run(doc, [...top.inverses].reverse());
  if (r.error) return null;
  return { doc: r.doc, history: { past: history.past.slice(0, -1), future: [...history.future, top] }, step: top };
}

/** One step forward again: its ops, first to last. */
export function redo(doc, history) {
  const top = history?.future?.[history.future.length - 1];
  if (!top) return null;
  const r = run(doc, top.ops);
  if (r.error) return null;
  return { doc: r.doc, history: { past: [...history.past, { ...top, inverses: r.inverses }], future: history.future.slice(0, -1) }, step: top };
}

/** What Undo and Redo say: how many steps each can take. */
export const historyCounts = (h) => ({ undo: h?.past?.length ?? 0, redo: h?.future?.length ?? 0 });

/**
 * The editing keys (plan §5.9.2): Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z (and
 * Ctrl+Y) redo, Cmd/Ctrl+F find. Inside a text field Z is the field's own
 * undo, so it answers null there; F opens Find everywhere.
 */
export function editKey(e) {
  if (!e || !(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = String(e.key || '').toLowerCase();
  const tag = String(e.target?.tagName || '').toUpperCase();
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable === true;
  if (key === 'f' && !e.shiftKey) return 'find';
  if (typing) return null;
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.metaKey) return 'redo';
  return null;
}
