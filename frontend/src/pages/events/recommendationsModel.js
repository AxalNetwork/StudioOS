/**
 * D3724 (#3724 Part D, boards ME1–ME13): My events' "Recommended for you", as
 * pure rules and words. `RecommendedRow.jsx` draws them; the reads come
 * through `recommendationsAdapter.js` and nowhere else.
 *
 * The read's shape is D1487's (`GET /api/events/recommended`, not on main
 * yet): `{ enabled, profile, signals: { <name>: 'read'|'not_recorded'|'unreadable' },
 * events: [{ ...event, saved, registration_eligible, reasons: [{ code, text }] }] }`.
 * A missing figure reads "Not recorded", never 0. Attendance never appears in
 * a reason (owner question 3 is open; the board draws none).
 */
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };
export const ROW_TITLE = 'Recommended for you';
export const RANK_LINE = 'Ranked from your own profile. Ranking runs nothing and charges nothing.';
export const NOT_ON = 'Recommendations aren’t switched on yet. Until they are, the suggestions below come from your track and event types.';
export const ERROR_LINE = 'Recommendations could not be read. That is not the same as having none.';
export const EMPTY_LINE = 'Nothing to recommend right now.';
export const FEW_LINE = 'Set your goals to get picks.';
export const OFF_LINE = 'Recommendations are off. These are the suggestions from your track.';
export const NOT_FOR_ME_DONE = 'Hidden. Fewer like this.';
export const HOST_NEVER = 'The host never sees this.';
export const NO_ATTENDEES = 'No attendee names or counts are used.';
export const EXPLORER_REASON = 'Popular with new members';
export const GOALS_MAX = 500;
export const GOALS_TOO_LONG = `Goals can be at most ${GOALS_MAX} characters.`;

/** ME4's chips. The host never sees the choice. */
export const NOT_FOR_ME_REASONS = Object.freeze([
  { key: 'topic', label: 'Topic' },
  { key: 'format', label: 'Format' },
  { key: 'location', label: 'Location' },
  { key: 'timing', label: 'Timing' },
  { key: 'other', label: 'Other' },
]);

/** ME6's choices. Formats and event types are the editor's own words. */
export const FORMATS = Object.freeze([
  { key: 'online', label: 'Online' },
  { key: 'in_person', label: 'In person' },
  { key: 'hybrid', label: 'Hybrid' },
]);

/** ME6's signals, in the board's order, with the words a member reads. */
export const SIGNALS = Object.freeze([
  { key: 'interests', label: 'Interests' },
  { key: 'goals', label: 'Goals' },
  { key: 'formats', label: 'Formats' },
  { key: 'event_types', label: 'Event types' },
  { key: 'home_city', label: 'Home city' },
  { key: 'travel_km', label: 'Travel range' },
]);

/**
 * The owner's questions on #3724, open until the owner answers them on the
 * thread. The page draws each as "pending owner", and nothing here picks an
 * answer: S1's proposed defaults are kept beside them, unadopted.
 */
export const PENDING_OWNER = Object.freeze([
  { n: 1, key: 'external', question: 'Recommend events from outside Axal?', proposed: 'Axal events only', where: 'ME5: External events, "Not enabled"' },
  { n: 2, key: 'cost', question: 'What does a recommendation cost?', proposed: 'Ranking free; Explain charged', where: 'ME1, ME3: ranking, "Why this event?"' },
  { n: 3, key: 'attendance', question: 'May reasons mention who else attends?', proposed: 'Never', where: 'ME3, ME8: reasons' },
  { n: 4, key: 'people_met', question: 'Use the people a member has met?', proposed: 'Off', where: 'ME6: signals' },
  { n: 5, key: 'explorers', question: 'Do Explorers get recommendations?', proposed: 'On', where: 'ME2: "Popular with new members"' },
]);
export const PENDING_WORD = 'Pending owner';

/**
 * The row's state, from the adapter's answer (`{ available, value, reason }`)
 * or a read in flight. Every answer is one of these; none of them is "empty"
 * unless the Worker said so.
 */
export function rowState(read) {
  if (!read || read.status === 'loading') return { kind: 'loading' };
  if (read.status === 'error') return { kind: 'error', line: ERROR_LINE };
  const b = read.data;
  if (!b || b.available === false) {
    if (b?.unreadable) return { kind: 'error', line: ERROR_LINE };
    return { kind: 'not_on', line: b?.reason || NOT_ON };
  }
  const v = b.value || {};
  if (v.enabled === false) return { kind: 'off', line: OFF_LINE };
  const events = Array.isArray(v.events) ? v.events : null;
  if (!events) return { kind: 'error', line: ERROR_LINE };
  if (!events.length) {
    const sig = v.signals && typeof v.signals === 'object' ? Object.values(v.signals) : [];
    const few = sig.length > 0 && sig.every((s) => s !== 'read');
    return few ? { kind: 'few', line: FEW_LINE } : { kind: 'empty', line: EMPTY_LINE };
  }
  return { kind: 'ready', events, signals: v.signals || {}, profile: v.profile || null };
}

/** A reason's words: the stored text, never a count of people. */
export function reasonWords(reason) {
  const t = typeof reason?.text === 'string' ? reason.text.trim() : '';
  return t || null;
}

/** The reasons drawn on a card and in Why this?: stored, free, at most `limit`. */
export function reasonsOf(event, { explorer = false, limit = 3 } = {}) {
  const list = (Array.isArray(event?.reasons) ? event.reasons : []).map(reasonWords).filter(Boolean);
  if (!list.length && explorer) list.push(EXPLORER_REASON);
  return list.slice(0, limit);
}

/** A signal's word in Tune: read, not recorded, or could not be read. Never 0. */
export function signalWord(state) {
  if (state === 'read') return 'Used';
  if (state === 'unreadable') return 'Could not be read';
  return NOT_RECORDED;
}

/** The card's register line, from `registration_eligible` (D1131's words). */
export function registerState(event, explorer = false) {
  if (event?.registration_eligible === false) return { kind: 'closed', line: explorer ? 'Not open to Explorers' : 'Not open to your profile' };
  if (typeof event?.registration_eligible !== 'boolean') return { kind: 'unknown', line: 'Eligibility not recorded' };
  if (event?.full === true || event?.seats_left === 0) return { kind: 'full', line: 'Join the waitlist' };
  return { kind: 'open', line: 'Register' };
}

/** ME6's prefs, checked before they are sent. Answers `{ ok, field?, error? }`. */
export function checkPrefs(p = {}) {
  const goals = typeof p.goals === 'string' ? p.goals : '';
  if (goals.length > GOALS_MAX) return { ok: false, field: 'goals', error: GOALS_TOO_LONG };
  const km = p.travel_km;
  if (km != null && km !== '' && !(Number.isFinite(Number(km)) && Number(km) >= 0 && Number(km) <= 20000)) {
    return { ok: false, field: 'travel_km', error: 'Travel range is a distance in kilometres, from 0 to 20,000.' };
  }
  return { ok: true };
}

/** A travel range as words. A blank range is "Not recorded", never 0 km. */
export function travelWords(km) {
  if (km == null || km === '' || !Number.isFinite(Number(km))) return NOT_RECORDED;
  return `${Number(km).toLocaleString('en-US')} km`;
}

/** Explain's quote as a line: the figure before any run, or why there is none. */
export function explainQuoteLine(q) {
  const m = q?.microusd;
  if (m == null || !Number.isFinite(Number(m))) return 'Price not recorded';
  const usd = Number(m) / 1e6;
  return `Costs $${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)} from your AI tokens`;
}
