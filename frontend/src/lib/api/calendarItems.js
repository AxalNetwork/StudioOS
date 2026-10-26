// D1207 (#3173, part 2 of #2420) — the Calendar's Reschedule and its pickers.
// Each `/calendar/events` item already carries `family`, `my_role`, `can`,
// `all_day`, `href`, `cancel_reason`, `deal_name`, `project_name` and
// `time_zone` (api.js's `listCalendarEvents`). People come back with a uid
// and a name, never an email or a user number; the creates take the uids
// (`attendee_uids`, `founder_uid`, `counterpart_uid`).
// Worker: routes/calendar.ts.
import { request } from '../api.js';

export const calendarItemsApi = {
  /** Move an IC meeting: the organiser or an admin. Attendees' calendar copies move too. */
  rescheduleIcMeeting: (id, { start_at, duration_min } = {}) => request(`/calendar/ic-meetings/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ start_at, ...(duration_min != null ? { duration_min } : {}) }),
  }),
  /** Move a check-in: either of its two people, or an admin. */
  rescheduleCheckin: (id, { start_at, duration_min } = {}) => request(`/calendar/founder-checkins/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ start_at, ...(duration_min != null ? { duration_min } : {}) }),
  }),
  /** People you work with, by name. `for` is 'ic' (with the deal) or 'checkin'. */
  people: ({ q = '', for: purpose, deal_id } = {}) => {
    const query = new URLSearchParams({ for: String(purpose || '') });
    if (q) query.set('q', String(q));
    if (deal_id != null) query.set('deal_id', String(deal_id));
    return request(`/calendar/people?${query}`);
  },
  /** The deals you can open, by venture name. */
  deals: (q = '') => request(`/calendar/deals${q ? `?q=${encodeURIComponent(q)}` : ''}`),
};
