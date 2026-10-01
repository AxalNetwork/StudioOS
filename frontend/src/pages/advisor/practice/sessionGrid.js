/**
 * `sessionGrid` — PR4's two-week grid and the four counts above it.
 *
 * This module imports nothing, which is the point twice over: a guard test can
 * load it without React and a stylesheet coming through the component tree,
 * and every count here is unit-tested in both directions so a mutation cannot
 * quietly change what the tiles say.
 *
 * A SLOT TIME IS AN INSTANT; A BLACKOUT DAY IS A CALENDAR DAY. The two are
 * formatted by different rules on purpose, and getting it wrong is invisible
 * until someone reads the page from the wrong side of Greenwich:
 *
 *   * `starts_at` / `ends_at` are written by `nowIso()` at the moment an hour
 *     was placed on a calendar, so the reader's own local day is the right
 *     one and `toLocaleDateString` is correct.
 *   * a blackout window is `{day:'fri', from:'12:00', to:'18:00'}` — a weekday
 *     and a clock reading, never a timestamp. `new Date('2026-11-04')` is
 *     midnight UTC, so treating a calendar day as an instant renders "Nov 3"
 *     for every reader west of Greenwich and moves a Friday blackout onto a
 *     Thursday twice a year.
 *
 * `deliveryTrail.js` holds instants and `engagementBoard.js` holds calendar
 * days; this module is the first to hold both, so the distinction is spelled
 * out rather than assumed.
 */

/**
 * What a slot IS, in the order the grid cares about. A slot can be several
 * things at once in the raw row — booked and awaiting payment, say — so the
 * order below is the precedence the artboard draws, not a set of exclusive
 * flags.
 *
 * `held` comes before `booked` because the artboard counts them separately:
 * its "Booked, next 14 d" tile excludes the held slot, and its own gate note
 * explains why — "it is counted under held rather than under booked. A slot
 * that silently fails to charge is worse than one that says so."
 */
export function slotKind(slot) {
  if (!slot) return 'open';
  if (slot.is_cancelled) return 'cancelled';
  if (slot.blocked_reason) return 'blocked';
  if (slot.payment_state === 'held_unpaid') return 'held';
  if ((slot.taken || 0) > 0) return 'booked';
  return 'open';
}

/** The tone each kind carries, matching the artboard's own palette. */
export const KIND_TONE = {
  open: 'neutral',
  booked: 'ok',
  held: 'warn',
  blocked: 'neutral',
  cancelled: 'danger',
};

export const KIND_LABEL = {
  open: 'Open',
  booked: 'Booked',
  held: 'Held · unpaid',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

/**
 * The four tile numbers, all from one pass over the slots — the artboard's own
 * arrangement, where `ALL_SLOTS` is the single record every count derives
 * from. Deriving them separately is how two tiles come to disagree.
 *
 * A cancelled slot is in NONE of them: it is not open (nobody may take it),
 * not booked (the booking is undone) and not blocked (it was taken once).
 */
export function slotCounts(slots) {
  const list = Array.isArray(slots) ? slots : [];
  let booked = 0; let open = 0; let held = 0; let blocked = 0; let cancelled = 0;
  let paid = 0; let free = 0;
  for (const s of list) {
    switch (slotKind(s)) {
      case 'booked':
        booked++;
        // A booked slot with a price that was actually taken is paid; one with
        // no price attached is a free intro or an unpriced hour. `null` is not
        // zero here — 205's distinction, carried forward.
        if (s.amount_cents != null && s.amount_cents > 0) paid++; else free++;
        break;
      case 'held': held++; break;
      case 'blocked': blocked++; break;
      case 'cancelled': cancelled++; break;
      default: open++;
    }
  }
  return { booked, open, held, blocked, cancelled, paid, free, total: list.length };
}

/**
 * The note under the "Booked" tile. The artboard writes
 * "4 paid, 1 free intro" or "5 paid · no free intros booked", and the second
 * half is a STATED ABSENCE rather than a dropped clause: "no free intros
 * booked" is a fact about the fortnight, and saying nothing would leave the
 * reader unsure whether the count excluded them.
 */
export function bookedNote(counts) {
  const c = counts || {};
  const paid = c.paid || 0;
  const free = c.free || 0;
  return free > 0
    ? `${paid} paid, ${free} free intro${free === 1 ? '' : 's'}`
    : `${paid} paid · no free intros booked`;
}

/**
 * The note under "Open slots". The artboard reads "after buffers and cap · 12
 * slots in the grid", and both halves matter: the number is what remains
 * AFTER the rules, and the denominator says what it is a share of.
 */
export function openNote(counts) {
  const total = counts?.total || 0;
  return `after buffers and cap · ${total} slot${total === 1 ? '' : 's'} in the grid`;
}

/**
 * The artboard's rules note, which exists to stop a reader reading the rules
 * card as a description of THIS fortnight. Its own words: "The rules above
 * govern how many slots exist at all, not which of these are taken."
 */
export function ruleNote(counts) {
  const c = counts || {};
  const parts = [`${c.booked || 0} booked`];
  if (c.held) parts.push(`${c.held} held unpaid`);
  if (c.blocked) parts.push(`${c.blocked} manually blocked`);
  const tail = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
  return `Of the ${c.total || 0} slot${(c.total || 0) === 1 ? '' : 's'} in this grid, ${tail}`
    + ` — leaving ${c.open || 0} open. These counts are what the rules produced;`
    + ' the rules themselves govern how many slots exist at all, not which of'
    + ' these are taken.';
}

/**
 * Group slots into days, newest rule first: the grid is read left to right as
 * a fortnight, so days come in ascending order and slots within a day do too.
 *
 * The key is the slot's LOCAL calendar day, derived from the instant rather
 * than from the ISO string's date part — `2026-11-04T23:30:00Z` belongs to the
 * 5th in Paris and the 4th in New York, and the grid is the reader's.
 */
export function groupByDay(slots) {
  const list = (Array.isArray(slots) ? slots : []).filter((s) => s && s.starts_at);
  const days = new Map();
  for (const s of list) {
    const d = new Date(s.starts_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) days.set(key, { key, label: dayLabel(d), slots: [] });
    days.get(key).slots.push(s);
  }
  const out = [...days.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const day of out) {
    day.slots.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  }
  return out;
}

/** "Mon 24" — the artboard's own day heading. */
export function dayLabel(date) {
  try {
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** "10:00" — the slot's own line, in the reader's clock. */
export function slotTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * The blackout card's line. Rendered from the stored weekday and clock
 * READING — never parsed into a Date, which is the bug this module's header
 * exists to prevent.
 */
const DAY_NAMES = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
export function blackoutLabel(window) {
  if (!window || !window.day) return null;
  const name = DAY_NAMES[String(window.day).toLowerCase()] || window.day;
  if (!window.from || !window.to) return name;
  return `${name} ${window.from}–${window.to}`;
}

/**
 * A rule the advisor has not set reads as absent, and this is the one place
 * that decides so. `0` is a real cap ("accept no paid sessions") and must
 * survive; `null` and `undefined` are "not answered" and must not become a
 * number on the way to the screen. D56/D68.
 */
export function ruleValue(v, suffix = '') {
  if (v == null) return null;
  return suffix ? `${v}${suffix}` : String(v);
}

/**
 * The four artboard views, and what each one keeps. `unpaid_held` is the one
 * that earns its place: it is the only way to see every slot whose booking
 * could not be charged, which is otherwise one amber card scattered across a
 * fortnight.
 */
export function narrowSlots(slots, view) {
  const list = Array.isArray(slots) ? slots : [];
  if (view === 'unpaid_held') return list.filter((s) => slotKind(s) === 'held');
  if (view === 'past') {
    const now = Date.now();
    return list.filter((s) => s.ends_at && new Date(s.ends_at).getTime() < now);
  }
  // 'two_weeks' and 'month' differ by the WINDOW the server was asked for, not
  // by a predicate here — narrowing a fortnight of rows to "a month" would
  // show fewer slots under the wider name, which is the opposite of what the
  // chip promises.
  return list;
}

/** The window each view asks the server for, in days. */
export const VIEW_DAYS = { two_weeks: 14, month: 31, past: 31, unpaid_held: 31 };
