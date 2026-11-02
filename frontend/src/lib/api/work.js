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
};
