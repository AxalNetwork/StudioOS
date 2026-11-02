// D1614 (#3968) — Work, a project's board, backlog and burn-up. S1's Work page
// calls these through `pages/work/workAdapter.js`. Each method lands with its
// Worker route.
// Worker: routes/work_board.ts. Every route answers 404 `agent_engine_off`
// until AGENT_ENGINE is on (and TEAM_AGENTS_ENABLED).
//   GET /api/teams/project/:id/work/burnup?range=2w|1m|3m|max&from=&to=&filter=   (W2, #3970)
//       → { available: false, range } | { available: true, range: { from, to, time_zone },
//            series: [{ day, available: false } | { day, scope, completed, open, not_planned, duplicate,
//                       completed_by: { person, agent, none } }] }
//       400 invalid_range; 403 not_member; 404 for a company or an unknown project.
//   GET /api/teams/project/:id/work/workload?weeks=1..12   (W4, #3972)
//       → { weeks: [week_start], people: [{ person: { uid, name }, capacity, weeks: [{ week_start, items, estimate_points,
//            unestimated, over_capacity }], unscheduled }], agents: [{ agent: { uid, name, role_key }, capacity: null, … }] }
//       capacity is { available: true, value } or { available: false, reason: 'Not recorded' }; over_capacity is null when unset.
//       400 invalid_weeks; 403 not_member; 404 for a company.
//   PUT /api/teams/project/:id/work/capacity/:personUid   { weekly_capacity_points: number | null } → { person, capacity }  (W4)
//       one's own, or a project editor's; 400 invalid_capacity; 403 not_manager; 404 not on the project.
//   A task's time block is the board's PATCH /api/teams/tasks/:uid { scheduled_start, scheduled_end } (W4).
// Projects only: a company has no Kanban. Days are the member's time zone; a
// day before the first item is `{ day, available: false }`, never zeros.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const workApi = {
  burnup: (projectId, { range, from, to, filter } = {}) => {
    const q = new URLSearchParams();
    if (from && to) { q.set('from', from); q.set('to', to); } else if (range) q.set('range', range);
    if (filter) q.set('filter', filter);
    const qs = q.toString();
    return request(`/teams/project/${enc(projectId)}/work/burnup${qs ? `?${qs}` : ''}`);
  },
  workload: (projectId, { weeks } = {}) => request(`/teams/project/${enc(projectId)}/work/workload${weeks ? `?weeks=${enc(weeks)}` : ''}`),
  setCapacity: (projectId, personUid, points) => request(`/teams/project/${enc(projectId)}/work/capacity/${enc(personUid)}`, {
    method: 'PUT', body: JSON.stringify({ weekly_capacity_points: points }),
  }),
};
