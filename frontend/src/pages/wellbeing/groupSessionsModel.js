/**
 * D7120 part 2 (#7120, canvas `Wellness Member Home`, WLM-07, WLM-07B, WLM-08): a group session's seat, as pure
 * rules. A seat is free, never oversold, and confidential: members see a count, never a name
 * (`/api/wellbeing/group-sessions`, `wellbeingGroupSessionsApi`).
 */

const toMs = (v) => {
  const s = String(v || '').trim();
  if (!s) return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
};

function fmt(ms, timeZone, opts) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || 'UTC', ...opts }).format(ms); } catch { return null; }
}

/** "Wed 25 Nov · 18:00–19:00" in the member's zone; null when the times cannot be read. */
export function sessionWhen(s, timeZone) {
  const a = toMs(s?.starts_at); const b = toMs(s?.ends_at);
  if (!Number.isFinite(a)) return null;
  const day = fmt(a, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
  const from = fmt(a, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false });
  const to = Number.isFinite(b) ? fmt(b, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  if (!day || !from) return null;
  return `${day.replace(',', '')} · ${from}${to ? `–${to}` : ''}`;
}

/** "3 of 8 open", or "Full · 0 of 8 open"; the count only, never who. */
export function seatsLine(s) {
  const cap = Number(s?.capacity); const left = Number(s?.seats_left);
  if (!Number.isFinite(cap) || !Number.isFinite(left)) return null;
  return left <= 0 ? `Full · 0 of ${cap} open` : `${left} of ${cap} open`;
}

/** What the member can do with this session now. */
export function seatAction(s) {
  const mine = s?.my_reservation;
  if (mine && mine.status === 'reserved') return { kind: 'reserved' };
  if (s?.state === 'cancelled') return { kind: 'cancelled', line: `Cancelled by the facilitator${s.cancelled?.reason ? `: ${s.cancelled.reason}` : ''}. It was free, so there is nothing to refund.` };
  if (s?.state === 'started') return { kind: 'closed', line: 'This session has started. Seats can’t be reserved now.' };
  if (s?.state === 'facilitator_unavailable') return { kind: 'closed', line: 'The facilitator isn’t taking this session right now. Nothing was reserved.' };
  if (s?.state === 'full' || Number(s?.seats_left) <= 0) return { kind: 'full', line: 'No seats left. There is no wait-list yet.' };
  return s?.bookable === false ? { kind: 'closed', line: 'Seats can’t be reserved for this session.' } : { kind: 'open' };
}

/** The calendar entry choices; the Worker's default is discreet. */
export const CALENDAR = Object.freeze([
  Object.freeze({ key: 'discreet', label: 'Discreet title', note: 'Your calendar shows “Private appointment”, with no description.' }),
  Object.freeze({ key: 'named', label: 'Session title', note: 'Your calendar shows the session’s title.' }),
  Object.freeze({ key: 'none', label: 'No calendar entry', note: 'Nothing is added to your calendar.' }),
]);

const codeOf = (e) => e?.data?.error || e?.data?.code || null;
/** What a refused reservation or release says. Nothing is ever reserved or charged on a refusal. */
export function seatRefusal(e) {
  switch (codeOf(e)) {
    case 'session_full': return 'Someone reserved the last seat first. Nothing was reserved for you, and nothing was charged.';
    case 'session_cancelled': return 'The facilitator cancelled this session. Nothing was reserved.';
    case 'session_started': return 'This session has started, so seats can’t be reserved now.';
    case 'facilitator_unavailable': return 'The facilitator isn’t taking this session right now. Nothing was reserved.';
    case 'cancellation_window_closed': {
      const at = e?.data?.cutoff_at ? sessionWhen({ starts_at: e.data.cutoff_at }, undefined) : null;
      return `Seats can be released only until ${at ? `${at} UTC` : 'the cut-off before the session'}. Your seat is still reserved.`;
    }
    case 'reservation_not_open': return 'This seat isn’t reserved any more.';
    default: return 'That didn’t go through. Nothing changed; try again.';
  }
}
export const isFull = (e) => codeOf(e) === 'session_full';

/** A reservation row for My bookings: when, what, and whether it can be released. */
export function reservationRow(r, timeZone, nowMs) {
  const s = r?.session || {};
  const startMs = toMs(s.starts_at);
  const cutoffMs = toMs(s.cancellation?.cutoff_at);
  const past = Number.isFinite(startMs) && startMs <= nowMs;
  let status;
  if (r?.status === 'cancelled') status = { word: 'Seat released', tone: 'quiet' };
  else if (s.state === 'cancelled') status = { word: 'Cancelled by the facilitator', tone: 'alert' };
  else if (past) status = { word: 'Held', tone: 'quiet' };
  else status = { word: 'Seat reserved', tone: 'ok' };
  const releasable = r?.status === 'reserved' && s.state !== 'cancelled' && !past && (!Number.isFinite(cutoffMs) || cutoffMs > nowMs);
  return {
    uid: r?.uid, title: s.title || 'Group session', when: sessionWhen(s, timeZone), facilitator: s.facilitator?.name || null,
    status, releasable, upcoming: !past && r?.status === 'reserved' && s.state !== 'cancelled', rule: s.cancellation?.rule || null,
    reason: s.state === 'cancelled' ? s.cancelled?.reason || null : null,
  };
}
