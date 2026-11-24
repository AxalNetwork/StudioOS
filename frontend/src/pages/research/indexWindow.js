/**
 * D7708 (#7708) — how a sector index point names the window it covers, in one
 * place for the sector page, the Research overview and the Top movers card.
 *
 * A point is keyed by month but holds the score over the 30 days before its
 * last recompute; the Worker stores and returns that window. A point written
 * before D7708 has none and reads "Window not recorded", never a derived date.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const WINDOW_NOT_RECORDED = 'Window not recorded';

/** "2026-11-22T12:00:00.000Z" → "22 Nov 2026" (UTC); anything else → null. */
export function windowDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A window as words: "23 Oct 2026 to 22 Nov 2026", or "Window not recorded". */
export function windowText(w) {
  const start = windowDay(w?.window_start);
  const end = windowDay(w?.window_end);
  return start && end ? `${start} to ${end}` : WINDOW_NOT_RECORDED;
}

/** What a change compares: "against 30 Sep 2026 to 30 Oct 2026", or the previous point's window not recorded. */
export function againstText(w) {
  const t = windowText(w);
  return t === WINDOW_NOT_RECORDED ? 'against the previous point (window not recorded)' : `against ${t}`;
}

/** The note a dimension fed only by copied macro figures carries (D7708, #7737 Q6 A). */
export const GLOBAL_CONTEXT = 'Global context · the same figure for every sector';

/** "window 23 Oct 2026 to 22 Nov 2026", or "window not recorded". */
export function windowPhrase(w) {
  const t = windowText(w);
  return t === WINDOW_NOT_RECORDED ? 'window not recorded' : `window ${t}`;
}
