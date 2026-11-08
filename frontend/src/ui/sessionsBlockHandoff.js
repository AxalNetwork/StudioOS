/**
 * #4737 (D1596 §4) — a `sessions:block` card is accepted on the Sessions page,
 * not in the Ask panel.
 *
 * Accepting a Block card used to call `decide(uid, 'accept')` and nothing else:
 * the card read "Accepted", the proposal left the waiting count, and no slot was
 * blocked. D1596 §4 asks for three steps in this order:
 *
 *   1. the card's dates go into the Sessions page's Block form;
 *   2. the advisor presses Block (`POST /api/advisors/me/slots/block`, with
 *      their own reason);
 *   3. only then is the proposal decided (`railProposalsApi.decide(uid, 'accept')`).
 *
 * This file is steps 1's hand-over, pure: the panel builds an address with
 * `blockHref`, the page reads it back with `parseBlockQuery`, and
 * `blockDates` turns the proposal's two instants into the form's two dates.
 * Nothing here decides a proposal or writes a slot.
 *
 * THE FORM TAKES WHOLE DAYS, in UTC, because its inputs are dates and it
 * sends `<date>T00:00:00.000Z`: `from` is the first day and `until` the day
 * AFTER the last one blocked. A card for 12:00 to 18:00 therefore fills one
 * day, and pressing Block closes that day's open hours, not only the proposed
 * ones. The form says so (`BLOCK_WHOLE_DAYS`), and a booked hour is skipped by
 * the writer as it always is.
 */

/** The rail option whose card is accepted on its page. */
export const BLOCK_OPTION = 'sessions:block';
/** The page that holds the Block form. */
export const BLOCK_ROUTE = '/practice/sessions';
/** What the form says when it was filled from a card, so a wider block than the card is never a surprise. */
export const BLOCK_WHOLE_DAYS = 'Filled from an Ask proposal. Block closes whole days, so every open hour on these days is blocked, not only the hours proposed. Nothing is blocked until you press Block.';

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UID = /^[A-Za-z0-9._:-]{1,80}$/;

const instant = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * A card's `from` and `until` (instants) as the Block form's two dates: the
 * UTC day `from` falls on, and the UTC midnight at or after `until`. Anything
 * that is not two instants in order gives null, and the form opens empty.
 */
export function blockDates(payload) {
  const a = instant(payload?.from);
  const b = instant(payload?.until);
  if (a === null || b === null || b <= a) return null;
  return { from: isoDay(Math.floor(a / DAY) * DAY), until: isoDay(Math.ceil(b / DAY) * DAY) };
}

/** Whether a card is accepted on the Sessions page rather than decided in the panel. */
export const needsBlockPage = (card) => card?.option === BLOCK_OPTION;

/** The Sessions address that carries a card: its uid, and its dates when it has them. */
export function blockHref(uid, dates) {
  const q = new URLSearchParams({ block: String(uid ?? '') });
  if (dates?.from && dates?.until) { q.set('from', dates.from); q.set('until', dates.until); }
  return `${BLOCK_ROUTE}?${q.toString()}`;
}

const validDay = (s) => DATE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && isoDay(Date.parse(`${s}T00:00:00Z`)) === s;

/**
 * The hand-over read back from the address: `{ uid, from, until }`, or null
 * when there is no card in it. Dates are all or nothing and must be real days
 * in order, else the form opens empty for the card; an address that names no
 * valid card uid is not a hand-over at all.
 */
export function parseBlockQuery(search) {
  const q = new URLSearchParams(search);
  const uid = q.get('block');
  if (!uid || !UID.test(uid)) return null;
  const from = q.get('from');
  const until = q.get('until');
  if (from && until && validDay(from) && validDay(until) && until > from) return { uid, from, until };
  return { uid, from: '', until: '' };
}

/** The hand-over's keys, so the page can take them out of its address once read. */
export const BLOCK_QUERY_KEYS = Object.freeze(['block', 'from', 'until']);
