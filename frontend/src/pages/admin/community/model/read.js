/**
 * #4717 package 6 — Reading the Community read (D931): a block in its state (`blockOf`), the page's clock (`clockOf`), and the strict readers every builder uses, so a count that is missing, a string, negative or fractional is unreadable, never 0 (#4717 package 3).
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { nf } from './format.js';

export async function readAllPages(fetchPage, key, { pageSize = 200, maxPages = 50 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const answer = await fetchPage(page * pageSize);
    const rows = answer?.[key];
    if (!Array.isArray(rows)) throw new Error(`The ${key} list was not returned`);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`More than ${nf(pageSize * maxPages)} ${key}; not counted here`);
}

export const failed = (r) => r?.status === 'error';


/**
 * One block of the Community read (D931), at `path` under `blocks`:
 *   - `loading` while the read has not answered;
 *   - `unreadable` when the read failed, or the block says it could not be
 *     read, with the block's own sentence;
 *   - `unrecorded` when no store records it;
 *   - `ready`, with the block.
 */

export function blockOf(overview, path, failedReason = 'The Community read could not be read. That is not the same as none.') {
  if (!overview || overview.status === 'loading') return { state: 'loading' };
  if (failed(overview)) return { state: 'unreadable', reason: failedReason };
  let b = overview.data?.blocks;
  for (const k of path.split('.')) b = b?.[k];
  if (b && b.recorded === false) return { state: 'unrecorded', reason: b.reason };
  if (!b || b.available !== true) {
    return { state: 'unreadable', reason: (b && typeof b.reason === 'string' && b.reason) || 'This figure could not be read. That is not the same as none.' };
  }
  return { state: 'ready', block: b };
}

/** The glance's lane by key, or undefined. `count` is null when the lane failed. */
export function laneOf(glance, key) {
  const lanes = glance?.approvals?.lanes;
  return Array.isArray(lanes) ? lanes.find((l) => l.key === key) : undefined;
}

/**
 * Seats taken on one of Next up's events, as text: "42 / 60", "No cap · 12
 * registered". The count is D918's list row's own `seats_taken` (registered,
 * confirmed and attended together, D915's rule, D1121).
 */

export const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

// #4717 package 3 — THE READ'S SHAPE IS CHECKED, NEVER PATCHED. Every block's
// figures pass through these before anything is drawn. A count that is
// missing, a string, negative or fractional, and a map without a key the card
// draws, make the block unreadable: `Number(x) || 0` used to turn each of them
// into a zero that looked real.
export const FIGURE_UNREAD = 'This figure could not be read. That is not the same as none.';

export const isObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

/** The counts at `keys`, or null when any of them is not a whole number. */
export function countsAt(obj, keys) {
  if (!isObj(obj)) return null;
  const out = {};
  for (const k of keys) {
    const c = count(obj[k]);
    if (c === null) return null;
    out[k] = c;
  }
  return out;
}

/** A map of counts that carries every key in `keys`; null when one is missing or any value is not a whole number. */
export function countMap(obj, keys) {
  if (!isObj(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const c = count(v);
    if (c === null) return null;
    out[k] = c;
  }
  return keys.every((k) => k in out) ? out : null;
}

/** Whole hours waited: a number, or null when the read says none is recorded; undefined when it is malformed. */
export const hoursOf = (v) => (v === null ? null : count(v) ?? undefined);

export const isText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * #4717 — the roster, from the Community read's network block: counted on the
 * server over every row, archived rows out. The page used to count
 * `GET /api/admin/network-profiles`, which answers 200 rows unless asked for
 * more, so a larger roster was counted short with nothing said. A count that
 * is missing or not a whole number makes the roster unreadable, never 0.
 */

export function clockOf(reads, asOf) {
  const ov = reads?.overview;
  if (ov?.status === 'ready') {
    const t = Date.parse(ov.data?.as_of);
    if (Number.isFinite(t)) return t;
  }
  return Number.isFinite(asOf) ? asOf : Date.now();
}

/**
 * #4717 — how many wait in each review queue, from the Community read's
 * `queue` (D918's queue for events, the job board's for postings). Null for a
 * queue that could not be read, or whose count is not a whole number.
 */

export function onWeeks(weeks, rows, key) {
  if (!Array.isArray(rows)) return null;
  const by = new Map();
  for (const r of rows) {
    const c = isObj(r) ? count(r[key]) : null;
    if (c === null || !weeks.includes(r.week)) return null;
    by.set(r.week, c);
  }
  return weeks.map((w) => (by.has(w) ? by.get(w) : null));
}

/** The read's Monday weeks, or null when they are not a list of dates. */
export function weeksOf(data) {
  const w = data?.week_starts;
  return Array.isArray(w) && w.every(isText) ? w : null;
}

export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * CM1 row 3 and CM7: registrations, applications and expert bookings by
 * Monday week, the current week hollow and "so far" in its table. A series
 * whose block could not be read is left out and named; the others draw.
 * Then the one sentence on the biggest change against the weeks before.
 */
