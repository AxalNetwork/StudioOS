import { request } from '../api.js';

// D931 (#2715) — Admin › Community's one counts read, on routes/admin_community.ts.
// Any admin; counts only. Each block is `{ available: true, … }`,
// `{ available: false, unreadable: true, reason }` or `{ recorded: false, reason }`;
// `queue`, `participation_by_role` and `wellbeing` are made of parts, each one of those.
//   overview  GET /admin/community/overview  { weeks: 4|12|52 }
//             → { weeks, week_starts, current_week, window, previous, as_of,
//                 blocks: { queue: { events, jobs, overdue_hours }, events, jobs,
//                           participation_by_role: { events, jobs }, circles, network,
//                           wellbeing: { experts, bookings, checkins },
//                           active_members, circle_discussions } }
// Another `weeks` answers 400 `bad_weeks`.
export const communityApi = {
  overview: ({ weeks } = {}) => request(`/admin/community/overview${weeks ? `?weeks=${encodeURIComponent(weeks)}` : ''}`),
};
