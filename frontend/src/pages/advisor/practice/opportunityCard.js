/**
 * #4830 (D4830), board PX-02 — what a request card on Opportunities says beyond the decision log: how long the request
 * has waited for an answer, and the session's length. Pure, so the tests read it without a page.
 */

/** "4 h", "2 days": how long since the request arrived. Null when the arrival time is not recorded. */
export function waitingFor(createdAt, nowMs) {
  const at = Date.parse(String(createdAt || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(createdAt || '')) ? '' : 'Z'));
  if (!Number.isFinite(at) || at > nowMs) return null;
  const hours = Math.floor((nowMs - at) / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The session's length in minutes from the request's slot (`bookingView`'s `startsAt`/`endsAt`); null when unknown. */
export function requestMinutes(view) {
  const a = Date.parse(view?.startsAt || '');
  const b = Date.parse(view?.endsAt || '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}
