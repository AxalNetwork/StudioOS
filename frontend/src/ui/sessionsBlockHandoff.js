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
 * `blockDates` validates and preserves the proposal's two exact instants.
 * Nothing here decides a proposal or writes a slot.
 *
 * The Sessions form decides how to draw those instants in the advisor's zone.
 * A hand-entered range may still omit both times and retain the original
 * whole-day behaviour; a card never loses its narrower range in this handoff.
 */

/** The rail option whose card is accepted on its page. */
export const BLOCK_OPTION = 'sessions:block';
/** The page that holds the Block form. */
export const BLOCK_ROUTE = '/practice/sessions';
/** What the form says when it was filled from a card. */
export const BLOCK_EXACT_SCOPE = 'Filled from an Ask proposal. Only open slots inside this exact time range will be blocked. Already booked slots are left alone. Nothing is blocked until you press Block.';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UID = /^[A-Za-z0-9._:-]{1,80}$/;

const instant = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
const iso = (t) => new Date(t).toISOString();
const pad = (n) => String(n).padStart(2, '0');

function wallParts(ms, zone) {
  const out = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  for (const part of parts) out[part.type] = part.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second),
  };
}

function offsetAt(ms, zone) {
  const p = wallParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** An exact handoff range as the date/time inputs read it in the advisor's zone. */
export function blockWallRange(range, zone = 'UTC') {
  const one = (value) => {
    const at = instant(value);
    if (at === null) return { date: '', time: '' };
    try {
      const p = wallParts(at, zone || 'UTC');
      return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
    } catch { return { date: '', time: '' }; }
  };
  const from = one(range?.from);
  const until = one(range?.until);
  return { from: from.date, startTime: from.time, until: until.date, endTime: until.time };
}

/** A date/time input read on `zone`'s clock, converted to the exact UTC instant the Worker takes. */
export function blockWallInstant(date, time, zone = 'UTC') {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new Error('Choose a date and time for both ends.');
  const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`${date} is not a date.`);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let at;
  try {
    at = wall - offsetAt(wall, zone || 'UTC');
    at = wall - offsetAt(at, zone || 'UTC');
  } catch { throw new Error('Your timezone could not be read.'); }
  const back = blockWallRange({ from: iso(at), until: iso(at) }, zone).from;
  const backTime = blockWallRange({ from: iso(at), until: iso(at) }, zone).startTime;
  if (back !== date || backTime !== time) throw new Error(`${time} on ${date} does not exist in ${zone}: the clocks change then.`);
  return iso(at);
}

/**
 * A card's `from` and `until` as exact, normalized ISO instants. Anything that
 * is not two instants in order gives null, and the form opens empty.
 */
export function blockDates(payload) {
  const a = instant(payload?.from);
  const b = instant(payload?.until);
  if (a === null || b === null || b <= a) return null;
  return { from: iso(a), until: iso(b) };
}

/** Whether a card is accepted on the Sessions page rather than decided in the panel. */
export const needsBlockPage = (card) => card?.option === BLOCK_OPTION;

/** The Sessions address that carries a card: its uid, and its exact range when it has one. */
export function blockHref(uid, range) {
  const q = new URLSearchParams({ block: String(uid ?? '') });
  if (range?.from && range?.until) { q.set('from', range.from); q.set('until', range.until); }
  return `${BLOCK_ROUTE}?${q.toString()}`;
}

const validDay = (s) => DATE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && iso(Date.parse(`${s}T00:00:00Z`)).slice(0, 10) === s;

/**
 * The hand-over read back from the address: `{ uid, from, until, exact }`, or
 * null when there is no card in it. Exact instants are preferred. The legacy
 * date-only shape remains readable as a whole-day handoff for an old open tab.
 * A malformed range opens the form empty rather than guessing.
 */
export function parseBlockQuery(search) {
  const q = new URLSearchParams(search);
  const uid = q.get('block');
  if (!uid || !UID.test(uid)) return null;
  const from = q.get('from');
  const until = q.get('until');
  const a = instant(from);
  const b = instant(until);
  if (from && until && !DATE.test(from) && !DATE.test(until) && a !== null && b !== null && b > a) {
    return { uid, from: iso(a), until: iso(b), exact: true };
  }
  if (from && until && validDay(from) && validDay(until) && until > from) return { uid, from, until, exact: false };
  return { uid, from: '', until: '', exact: false };
}

/** The hand-over's keys, so the page can take them out of its address once read. */
export const BLOCK_QUERY_KEYS = Object.freeze(['block', 'from', 'until']);
