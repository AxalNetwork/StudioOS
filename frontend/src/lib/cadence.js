/**
 * The cadence vocabulary, shared by the zone page, its dialogs and its filters.
 *
 * WHY A MODULE AND NOT THREE LITERALS. The kind list is read in four places —
 * the ritual form, the template form, the archive's kind label, and the filter
 * predicate — and the one thing the worker will not forgive is a fifth spelling.
 * `founder_cadence.ts` exports `RITUAL_KINDS` as the server's own list and
 * `frontend/test/cadence_vocabulary.test.mjs` asserts the two agree value for
 * value, so a kind added on one side fails the build rather than silently
 * becoming `other` on the way in.
 */

/** `[value, label]`, in the order the form offers them. */
export const RITUAL_KINDS = [
  ['plan', 'Plan'],
  ['standup', 'Standup'],
  ['retro', 'Retro'],
  ['other', 'Other'],
];

export const RITUAL_FREQUENCIES = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every two weeks'],
  ['monthly', 'Monthly'],
];

/** Index 0 is Sunday, matching `Date.prototype.getUTCDay` and the stored value. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KIND_LABEL = new Map(RITUAL_KINDS);

/**
 * `weekday` + `frequency` as one phrase, or the part that is recorded.
 *
 * Here rather than in the zone page because the Build desk's cadence card
 * prints the same schedule, and two spellings of "every other Friday" would
 * be two answers to one stored row.
 */
export function scheduleLabel(ritual) {
  const day = ritual?.weekday == null ? null : WEEKDAYS[Number(ritual.weekday)];
  const freq = String(ritual?.frequency || 'weekly');
  if (day && freq === 'weekly') return `Every ${day}`;
  if (day && freq === 'biweekly') return `Every other ${day}`;
  if (day && freq === 'monthly') return `Monthly, on a ${day}`;
  if (freq === 'weekly') return 'Weekly';
  if (freq === 'biweekly') return 'Every two weeks';
  return 'Monthly';
}

/** A stored kind as a person reads it; an unknown one reads as itself. */
export const kindLabel = (kind) => KIND_LABEL.get(String(kind)) || String(kind || 'Other');

/**
 * `YYYY-MM-DD` → `Aug 21`, the archive's own date format.
 *
 * SPLIT, NOT `Date.parse`. A bare `YYYY-MM-DD` is parsed as UTC midnight and
 * then rendered in the reader's zone, so west of Greenwich every date in the
 * archive would display one day early — the trap `interview_date` already
 * carries a note about. The parts are the parts; no timezone is involved in
 * naming a month.
 */
export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '—';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '—';
}

/** Today in the archive's own format, from local parts rather than `toISOString`. */
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
