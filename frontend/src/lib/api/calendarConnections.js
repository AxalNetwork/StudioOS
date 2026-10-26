// D1212 (#3178, part 7 of #2420) — the connected calendars (CAL9, CAL10) and
// Subscribe (CAL11). The status reads stay api.js's `googleCalStatus` and
// `microsoftCalStatus`; these are D1209's routes the page now calls.
// Worker: routes/calendar.ts.
import { request } from '../api.js';

const removeQuery = (removeCopies) => (removeCopies ? '?remove_copies=1' : '');

export const calendarConnectionsApi = {
  /** `{ subscribed, created_at, last_used_at }`: whether the whole-calendar link is on. Never the link. */
  subscription: () => request('/calendar/subscription'),
  /** Make the link, or replace it (`replaced: true`): the old one stops at once. The link is shown this once. */
  makeSubscription: () => request('/calendar/subscription', { method: 'POST' }),
  /** Turn the link off. */
  turnOffSubscription: () => request('/calendar/subscription', { method: 'DELETE' }),
  /** Disconnect Google. The copies stay unless `removeCopies`; then a copy Google refuses stops it (502 `copies_not_removed`). */
  disconnectGoogle: ({ removeCopies = false } = {}) => request(`/calendar/google${removeQuery(removeCopies)}`, { method: 'DELETE' }),
  /** Disconnect Outlook, with the same choice. */
  disconnectMicrosoft: ({ removeCopies = false } = {}) => request(`/calendar/microsoft${removeQuery(removeCopies)}`, { method: 'DELETE' }),
};
