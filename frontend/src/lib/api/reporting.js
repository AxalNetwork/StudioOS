// D1058 (#2928, part 2 of #2427) — reporting duties and periods. Worker:
// routes/reporting.ts, at /api/reporting.
//
// The founder's desk reads a venture's duties, periods (each with its state
// worked out on read: upcoming, due, late, missing, sent or waived), the
// investors' asks and the reminder settings. The investor reads only the
// duties owed to them, and may ask once per late period or waive one.
import { request } from '../api.js';

const period = (uid) => `/reporting/periods/${encodeURIComponent(uid)}`;
const post = (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const reportingApi = {
  desk: (projectId) => request(`/reporting/desk?project=${encodeURIComponent(projectId)}`),
  /** {expected_on: 'YYYY-MM-DD', note?}: the founders' date, which the investor sees. */
  setExpected: (periodUid, expectedOn, note) => post(`${period(periodUid)}/expected`, { expected_on: expectedOn, note: note || undefined }),
  /** {project, offsets[], channels[], recipient_user_ids[]}: reminders go to the team only. */
  setReminders: (body) => request('/reporting/reminders', { method: 'PUT', body: JSON.stringify(body) }),
  portfolio: () => request('/reporting/portfolio'),
  company: (projectUid) => request(`/reporting/companies/${encodeURIComponent(projectUid)}`),
  /** Once per period, while it is late or missing. */
  ask: (periodUid) => post(`${period(periodUid)}/ask`),
  waive: (periodUid) => post(`${period(periodUid)}/waive`),
};
