/**
 * #4830 (D4830), board PX-01 of the Practice v2 canvas (D4874): "Set up your practice", as pure functions over the
 * five reads that answer each step. One coordinated setup state replaces five separate empty cards on `/practice`
 * while the advisor has not finished the minimum setup.
 *
 * EACH STEP IS A RECORDED FACT, NEVER A GUESS:
 *   1. Practice profile          `GET /advisors/me` answers with a display name
 *   2. A session type             `GET /advisors/me/session-types` has an active one
 *   3. Availability               `GET /advisors/me/slots?days=60` has an upcoming, unblocked slot with a seat left
 *   4. A booking link             `GET /advisors/me/booking-links` has an active one
 *   5. Payout details             `GET /advisors/me/payout-account` says payouts are enabled
 *
 * A read that failed is `unreadable`: neither done nor to do, and it does not count toward "n of 5". The setup state
 * takes over only when at least one step is KNOWN to be missing; a page whose reads all failed keeps the board,
 * whose own sections say what could not be read.
 */

export const SETUP_STEPS = Object.freeze([
  { key: 'profile', label: 'Practice profile', action: 'Create your profile', to: '/expertise/profile' },
  { key: 'session_type', label: 'Create a service or session type', action: 'Add a session type', to: '/practice/sessions#session-types' },
  { key: 'availability', label: 'Set availability', action: 'Set availability', to: '/practice/sessions#publish-availability' },
  { key: 'booking_link', label: 'Create a booking link', action: 'Create a booking link', to: '/practice/sessions#booking-links' },
  { key: 'payout', label: 'Set payout details', action: 'Set payout details', to: '/practice/earnings' },
]);

/** The lifecycle PX-01 explains under the checklist. */
export const PRACTICE_LIFECYCLE = Object.freeze([
  'Share your profile or booking link.',
  'A client requests a session.',
  'Accept and manage the engagement.',
  'Deliver the work.',
  'Record billing and collection.',
]);

/** A read's outcome: the value, or `UNREADABLE` when the read failed. */
export const UNREADABLE = Symbol('unreadable');

const items = (r) => (Array.isArray(r?.items) ? r.items : []);

/** One step's state from its read: 'done', 'todo' or 'unreadable'. */
export function stepState(key, read, nowMs = Date.now()) {
  if (read === UNREADABLE) return 'unreadable';
  switch (key) {
    case 'profile': return read && String(read.display_name || '').trim() ? 'done' : 'todo';
    case 'session_type': return items(read).some((t) => t.is_active !== false) ? 'done' : 'todo';
    // A slot a client can book: upcoming, not blocked, with a seat left (`ownSlotDto`).
    case 'availability': return items(read).some((s) => {
      const at = Date.parse(s.starts_at || '');
      return !s.blocked_reason && Number(s.available) > 0 && Number.isFinite(at) && at > nowMs;
    }) ? 'done' : 'todo';
    case 'booking_link': return items(read).some((l) => l.is_active !== false) ? 'done' : 'todo';
    case 'payout': return read && read.payouts_enabled === true ? 'done' : 'todo';
    default: return 'unreadable';
  }
}

/**
 * The checklist from the five reads (`reads[key]`). `next` is the first step still to do, which the primary action
 * advances; `takeOver` is true when at least one step is known to be missing.
 */
export function setupProgress(reads, nowMs = Date.now()) {
  const steps = SETUP_STEPS.map((s) => ({ ...s, state: stepState(s.key, reads?.[s.key], nowMs) }));
  const done = steps.filter((s) => s.state === 'done').length;
  const next = steps.find((s) => s.state === 'todo') || null;
  return {
    steps,
    done,
    total: steps.length,
    next,
    takeOver: next !== null,
    unreadable: steps.filter((s) => s.state === 'unreadable').map((s) => s.key),
  };
}
