/**
 * D661 (#1474) — one door from a cycle's read to the page's shape.
 *
 * A read already in D661's shape passes through untouched: a `series` that is
 * a list of chart specs, `cols` of `{ key, label }` and `rows` of
 * `{ id, cells }`. Build (#1475) and Raise (#1476) were told to return that
 * shape and need no adapter. Validate (#1487) and Grow (#1488) merged with
 * their own, so each has a file here, one function per module slug.
 *
 * A card whose cycle or slug has no adapter keeps its state and reason and
 * gets `series: null`, so an `ok` card reads as unreadable rather than as a
 * chart this layer guessed.
 */
import * as validate from './validate.js';

/**
 * NAME → FUNCTION TABLES ARE MAPS. A slug comes from a read or a URL, and a
 * plain object looked up by it would reach Object.prototype's own methods
 * (`constructor`, `toString`, …). A Map has no inherited entries, so such a
 * slug finds nothing and reads as "no adapter". CodeQL's
 * js/unvalidated-dynamic-method-call is what this answers.
 */
export const toFnMap = (obj) => new Map(Object.entries(obj || {}).filter(([, v]) => typeof v === 'function'));

/** The function a Map holds under `key`, or null. Anything but a Map gives null. */
export function fnOf(map, key) {
  const fn = map instanceof Map ? map.get(key) : undefined;
  return typeof fn === 'function' ? fn : null;
}

const ADAPTERS = new Map([
  ['validate', { cards: toFnMap(validate.CARDS), records: new Map(Object.entries(validate.RECORDS)), figure: validate.figure }],
]);

const isSpecList = (s) => Array.isArray(s) && s.every((x) => x && typeof x === 'object' && typeof x.kind === 'string');
const isColList = (c) => Array.isArray(c) && c.every((x) => x && typeof x === 'object' && typeof x.key === 'string');

export function adaptCard(cycle, card) {
  if (!card || typeof card !== 'object') return card;
  if (card.series == null || isSpecList(card.series)) return card;
  const fn = fnOf(ADAPTERS.get(cycle)?.cards, card.slug);
  return { ...card, series: fn ? fn(card.series) : null };
}

export function adaptFigure(cycle, fig) {
  const fn = ADAPTERS.get(cycle)?.figure;
  return typeof fn === 'function' ? fn(fig) : fig;
}

export function adaptRecords(cycle, slug, records) {
  if (!records || typeof records !== 'object') return records;
  if (isColList(records.cols)) return records;
  const def = ADAPTERS.get(cycle)?.records.get(slug) ?? null;
  const labels = Array.isArray(records.cols) ? records.cols : [];
  if (!def) return { ...records, cols: [], rows: [] };
  // The read lists its labels in the canvas's order; the adapter names the
  // key each label's cell is filled from, in the same order.
  const cols = labels.map((label, i) => ({ key: def.keys[i] ?? `col${i}`, label: String(label) }));
  const rows = (Array.isArray(records.rows) ? records.rows : []).map((r, i) => def.row(r || {}, i));
  return {
    ...records,
    cols,
    rows,
    filters: records.filters ?? def.filters,
    sorts: records.sorts ?? def.sorts,
  };
}

export function adaptOverview(cycle, data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ...data,
    figures: (Array.isArray(data.figures) ? data.figures : []).map((f) => adaptFigure(cycle, f)),
    cards: (Array.isArray(data.cards) ? data.cards : []).map((c) => adaptCard(cycle, c)),
  };
}

export function adaptModule(cycle, slug, data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ...data,
    card: adaptCard(cycle, data.card ? { slug, ...data.card } : data.card),
    records: adaptRecords(cycle, slug, data.records),
  };
}
