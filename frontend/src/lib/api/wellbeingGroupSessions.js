import { rawRequestHeaders, refusalError, request } from '../api.js';

/** D7120 (#7120): Wellness group sessions and the member's own seat (wellbeing_group_sessions.ts).
 * list({ support_type, language }) -> { sessions: [session] }: upcoming, open or full, never who reserved
 * get(uid)                -> session, with my_reservation { uid, status, calendar } or null
 * reserve(uid, calendar)  -> 201 session + { reserved }, or 200 { already_reserved }; 409 session_full,
 *                            session_cancelled, session_started, facilitator_unavailable
 * mine()                  -> { reservations: [{ uid, status, calendar, reserved_at, cancelled_at, session }] }
 * cancel(uid)             -> { status: 'cancelled', seat_released, refund }; 409 cancellation_window_closed { cutoff_at }
 * calendarUrl(uid)        -> the member's own .ics (no attendee; "Private appointment" unless calendar is 'named')
 * calendarFile(uid)       -> { text, filename }: that .ics read as text with the member's own credentials (D7120 part 3),
 *                            so the page can save it. 404 calendar_entry_not_found for a released seat or 'none'.
 * Facilitator: mySessions() with attendees, schedule(body), cancelSession(uid, reason) (also HQ).
 * A session: { uid, title, support_type, facilitator, format: 'group', language, timezone, starts_at, ends_at,
 *   duration_minutes, free, capacity, seats_left, state: open|full|cancelled|started|facilitator_unavailable,
 *   bookable, cancelled, cancellation: { hours, cutoff_at, rule }, what_facilitator_learns, what_other_members_learn }.
 */
const q = encodeURIComponent;

// D7120 part 3: the calendar entry is text, which `request()` (JSON only) cannot read. It is fetched with exactly what
// `request()` sends (`rawRequestHeaders`), refused through the shared `refusalError`, and checked to be a calendar
// before it is handed back. The file name is the Worker's, which never names the session.
async function calendarFile(uid) {
  const res = await fetch(`/api/wellbeing/group-reservations/${q(uid)}/calendar.ics`, {
    credentials: 'include',
    headers: { Accept: 'text/calendar', ...rawRequestHeaders('GET') },
  });
  if (!res.ok) throw await refusalError(res, 'The calendar entry couldn’t be read.');
  const text = await res.text();
  if (!/^BEGIN:VCALENDAR\r?\n/.test(text)) {
    const e = new Error('The calendar entry couldn’t be read.');
    e.code = 'calendar_unreadable';
    throw e;
  }
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'appointment.ics';
  return { text, filename };
}
export const wellbeingGroupSessionsApi = {
  list: (params = {}) => {
    const s = new URLSearchParams();
    if (params.support_type) s.set('support_type', params.support_type);
    if (params.language) s.set('language', params.language);
    const qs = s.toString();
    return request(`/wellbeing/group-sessions${qs ? `?${qs}` : ''}`);
  },
  get: (uid) => request(`/wellbeing/group-sessions/${q(uid)}`),
  reserve: (uid, calendar = 'discreet') =>
    request(`/wellbeing/group-sessions/${q(uid)}/reserve`, { method: 'POST', body: JSON.stringify({ calendar }) }),
  mine: () => request('/wellbeing/group-reservations/mine'),
  cancel: (uid) => request(`/wellbeing/group-reservations/${q(uid)}/cancel`, { method: 'POST' }),
  calendarUrl: (uid) => `/api/wellbeing/group-reservations/${q(uid)}/calendar.ics`,
  calendarFile,
  mySessions: () => request('/wellbeing/experts/me/group-sessions'),
  schedule: (body) => request('/wellbeing/experts/me/group-sessions', { method: 'POST', body: JSON.stringify(body) }),
  cancelSession: (uid, reason) =>
    request(`/wellbeing/group-sessions/${q(uid)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
