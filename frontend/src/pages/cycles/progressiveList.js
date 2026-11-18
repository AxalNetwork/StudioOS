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
 * Only the modules listed in PROGRESSIVE are affected (Build's six, D5076,
 * Validate's first three, D6004, and Grow's six, D6100 and D6123); the others keep
 * D661's table as it was.
 *
 * D6123 (#6123): Grow's four other record modules (Talent's roles, Partners,
 * Markets, Obligations) take the zero stage only (`zeroOnly`): with nothing
 * recorded they show one heading, one outcome line and their form's own button,
 * with the connector parts folded; with one record or more the page is the full
 * table, unchanged (`moduleStage`).
 *
 * D6100 (#6100): Grow's Product improvement and Revenue and traction take the
 * same three stages. Their copy carries `fold`, D5076's name for the closed
 * region the connector parts move into at zero ("Bring it in from your tools").
 * A records read marked unreadable is never a stage but `many`, so it keeps the
 * table's own Unreadable and Retry.
 */

/** BD18 C: search, filters, sort and pages appear from this many records. */
export const LIST_CONTROLS_FROM = 10;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Each listed module's zero state: what the founder gets from the first record
 * (`outcome`), the one dominant action's label (`action`), and the noun its
 * plain count uses (`one`, `many`). `fold`, where set, names the closed region
 * the module's connector parts sit in at zero (D6100).
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
  // D6004 (#6004): Validate's first three modules, the same three stages. The
  // dominant action is each module's existing Add: Create theme and Create
  // segment (`FORMS.validate`), and Customer research's Record a session, which
  // opens the record lightbox over the page through `onOpen`.
  validate: Object.freeze({
    'problem-discovery': {
      heading: 'Name the problem you are solving',
      outcome: 'Group what customers tell you into pain themes, so every interview and experiment points at one problem.',
      action: 'Create your first pain theme', one: 'pain theme', many: 'pain themes',
    },
    'customer-research': {
      heading: 'Hear it from customers first',
      outcome: 'Talk with people who have the problem and keep what they say, so the pains you name come from their words.',
      action: 'Record your first session', one: 'interview', many: 'interviews',
    },
    'ideal-customer-profile': {
      heading: 'Decide who you are building for',
      outcome: 'Describe the segment that feels the pain most, so research, pricing and outreach aim at the same people.',
      action: 'Create your first segment', one: 'segment', many: 'segments',
    },
  }),
  // D6100 (#6100): Grow's two modules that open on a founder's own entry. The
  // action is the module's existing form button (FORMS.grow), unchanged.
  grow: Object.freeze({
    'product-improvement': {
      heading: 'Hear what your customers ask for',
      outcome: 'Log what customers tell you and group it into themes, so the next thing you build answers the most common ask.',
      action: 'Log feedback', one: 'piece of feedback', many: 'pieces of feedback',
      fold: 'Bring it in from your tools',
    },
    'revenue-and-traction': {
      heading: 'Record the numbers that show traction',
      outcome: 'Enter the KPIs you report, so your updates and your raise read from the same figures.',
      action: 'Enter a KPI', one: 'KPI', many: 'KPIs',
      fold: 'Bring it in from your tools',
    },
    // D6123 (#6123): zero stage only; the action is each module's FORMS.grow button.
    'team-expansion': {
      heading: 'Plan the hires the next stage needs',
      outcome: 'Open the roles you will hire for, so each one has an owner, a plan and its applicants in one place.',
      action: 'Open a role', one: 'role', many: 'roles',
      fold: 'Bring it in from your tools', zeroOnly: true,
    },
    'partner-network': {
      heading: 'Name the partners who help you grow',
      outcome: 'Add the partners you work with, so pitches, introductions and what each one brings in stay with them.',
      action: 'Add partner', one: 'partner', many: 'partners',
      fold: 'Bring it in from your tools', zeroOnly: true,
    },
    'market-expansion': {
      heading: 'Choose the next market to enter',
      outcome: 'Add the markets you are weighing, so each entry has its reasons, its steps and its status in one place.',
      action: 'Add market', one: 'market', many: 'markets',
      fold: 'Bring it in from your tools', zeroOnly: true,
    },
    'durable-company-building': {
      heading: 'Keep the company in good standing',
      outcome: 'Add the obligations the company must meet, so every filing and renewal has a due date and an owner.',
      action: 'Add obligation', one: 'obligation', many: 'obligations',
      fold: 'Bring it in from your tools', zeroOnly: true,
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
  // An unreadable read is not a measured zero (D6100): it keeps the table's Unreadable.
  if (records?.state === 'unreadable') return 'many';
  const rows = Array.isArray(records?.rows) ? records.rows.length : 0;
  const total = num(records?.total) ? records.total : null;
  if (total === 0 && rows === 0) return 'zero';
  // No total: judge by what was sent; nothing sent is not a measured zero.
  const n = total ?? (rows || null);
  if (n === null) return 'many';
  return n < LIST_CONTROLS_FROM ? 'few' : 'many';
}

/**
 * D6123: the stage a module draws. A `zeroOnly` module has no 'few' stage: one
 * record or more keeps the full working table, exactly as before.
 */
export function moduleStage(records, query = {}, copy = null) {
  const stage = listStage(records, query);
  return copy?.zeroOnly && stage === 'few' ? 'many' : stage;
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
