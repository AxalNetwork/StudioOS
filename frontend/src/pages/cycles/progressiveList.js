/**
 * D5076 (#5076) — progressive complexity on Build's six module pages, to the
 * Build V2 canvas's BD18 A/B/C (0 / few / many records; list controls from 10).
 *
 *   · zero  — the store's own total is 0 and nothing is being searched: one
 *             guided first action and the founder outcome it serves. No
 *             search, filters, sort, column header, "0 of 0" or pages.
 *   · few   — 1 to LIST_CONTROLS_FROM − 1 records: the rows and one Add,
 *             with a plain count. No search, filters, sort or pages.
 *   · many  — LIST_CONTROLS_FROM records or more, or any search or filter in
 *             force (so it can be cleared): the full working table.
 *
 * A total the read does not carry is never taken for zero: with no rows and
 * no total the page keeps the full table, which says "Not recorded".
 * Only the modules listed in PROGRESSIVE are affected; the other cycles keep
 * D661's table as it was.
 */

/** BD18 C: search, filters, sort and pages appear from this many records. */
export const LIST_CONTROLS_FROM = 10;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Each Build module's zero state: what the founder gets from the first record
 * (`outcome`), the one dominant action's label (`action`), and the noun its
 * plain count uses (`one`, `many`).
 */
export const PROGRESSIVE = Object.freeze({
  build: Object.freeze({
    'solution-design': {
      heading: 'Design the solution from what you validated',
      outcome: 'Name the features that answer the pains and hypotheses you validated, so the build starts from evidence.',
      action: 'Add your first feature', one: 'feature', many: 'features',
    },
    'prototype-mvp': {
      heading: 'Decide what the first version must do',
      outcome: 'List the few must-haves your first users need. Everything else waits until they use it.',
      action: 'Add your first must-have', one: 'must-have', many: 'must-haves',
    },
    'product-roadmap': {
      heading: 'Put the build in order',
      outcome: 'Place what you build Now, Next and Later, so the team works on one thing at a time.',
      action: 'Add your first roadmap item', one: 'roadmap item', many: 'roadmap items',
    },
    'founding-team': {
      heading: 'Record who founds the company',
      outcome: 'Each founder, their role and their equity, so vesting and the cap table start from the same record.',
      action: 'Add your first founder', one: 'founder', many: 'founders',
    },
    'company-creation': {
      heading: 'Make the company real',
      outcome: 'Track each filing, from incorporation to the bank account, and keep its proof with it.',
      action: 'Add your first filing', one: 'filing', many: 'filings',
    },
    'operating-systems': {
      heading: 'Connect what the company runs on',
      outcome: 'Connect the systems your company already uses, so the week’s work reads from one place.',
      action: 'Connect your first system', one: 'system', many: 'systems',
    },
  }),
});

/** The module's progressive copy, or null when the module keeps the full table. */
export function progressiveFor(cycle, slug) {
  const byCycle = Object.hasOwn(PROGRESSIVE, cycle) ? PROGRESSIVE[cycle] : null;
  return byCycle && Object.hasOwn(byCycle, slug) ? byCycle[slug] : null;
}

/** True when a search or a filter is in force. */
export const isSearching = (query) => !!(query?.q || Object.values(query?.filter || {}).some(Boolean));

/** 'zero' | 'few' | 'many' for a records read and the query it answers. */
export function listStage(records, query = {}) {
  if (isSearching(query)) return 'many';
  const rows = Array.isArray(records?.rows) ? records.rows.length : 0;
  const total = num(records?.total) ? records.total : null;
  if (total === 0 && rows === 0) return 'zero';
  // No total: judge by what was sent; nothing sent is not a measured zero.
  const n = total ?? (rows || null);
  if (n === null) return 'many';
  return n < LIST_CONTROLS_FROM ? 'few' : 'many';
}

/** A few records' plain count: "1 feature", "3 features". Never "0 of 0". */
export function fewCountLabel(records, copy) {
  const total = num(records?.total) ? records.total : (Array.isArray(records?.rows) ? records.rows.length : 0);
  return `${total} ${total === 1 ? copy?.one || 'record' : copy?.many || 'records'}`;
}

/** The first usable Add as handed (`add`, else the read's own), relabelled with the module's dominant action. */
export function dominantAdd(add, records, copy, usable = () => true) {
  const list = Array.isArray(add) ? add : [add || records?.add].filter(Boolean);
  const first = list.find((a) => a?.text && usable(a)) || null;
  return first && copy?.action ? { ...first, text: copy.action } : first;
}
