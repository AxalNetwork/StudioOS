/**
 * D3724 (#3724 Part D, boards ME1–ME13): My events' "Recommended for you", as
 * pure rules and words. `RecommendedRow.jsx` draws them; the reads come
 * through `recommendationsAdapter.js` and nowhere else.
 *
 * The read's shape is D1487's (`GET /api/events/recommended`): `{ enabled, profile, signals: { <name>: 'read'|'not_recorded'|'unreadable' },
 * events: [{ ...event, saved, registration_eligible, reasons: [{ code, text }] }] }`.
 * A missing figure reads "Not recorded", never 0. Attendance never appears in
 * a reason: the owner decided that on 2026-11-04 (D1487), and the Worker
 * quotes no attendee.
 */
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };
export const ROW_TITLE = 'Recommended for you';
export const RANK_LINE = 'Ranked from your own profile. Ranking runs nothing and charges nothing.';
export const NOT_ON = 'Recommendations aren’t available right now. The suggestions below come from your track and event types.';
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
  { key: 'virtual', label: 'Online' },
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
 * ME6's interests: the Worker's own vocabulary (`EVENT_TOPICS`, D1487), as
 * chips. The Worker refuses any other word, so the screen offers no free text.
 */
export const TOPICS = Object.freeze([
  { key: 'fundraising', label: 'Fundraising' },
  { key: 'ai', label: 'AI' },
  { key: 'go_to_market', label: 'Go to market' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'climate', label: 'Climate' },
  { key: 'product', label: 'Product' },
  { key: 'finance', label: 'Finance' },
  { key: 'legal', label: 'Legal' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'networking', label: 'Networking' },
]);
export const TOPICS_MAX = 10;

/** The Worker's prefs (`GET …/recommendation-prefs`) as Tune's form. A null stays blank, never 0. */
export function prefsToForm(prefs = {}) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    enabled: prefs.enabled !== false,
    interests: list(prefs.interests),
    goals: typeof prefs.goals_90d === 'string' ? prefs.goals_90d : '',
    formats: list(prefs.formats),
    home_city: typeof prefs.home_city === 'string' ? prefs.home_city : '',
    travel_km: Number.isInteger(prefs.travel_km) ? String(prefs.travel_km) : '',
  };
}

/** Tune's form as the Worker's prefs (`PUT …/recommendation-prefs`). A blank is null, not 0. */
export function formToPrefs(form = {}) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const km = form.travel_km;
  return {
    enabled: form.enabled !== false,
    interests: Array.isArray(form.interests) ? form.interests : [],
    goals_90d: text(form.goals),
    formats: Array.isArray(form.formats) ? form.formats : [],
    home_city: text(form.home_city),
    travel_km: km == null || km === '' ? null : Number(km),
  };
}

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
