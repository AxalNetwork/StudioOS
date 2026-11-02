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
//   GET   /api/teams/project/:id/work/board?filter=&sort=        (W1, #3969)
//       → { project, items: [card], columns: [{ key, count, estimate_points, cards }], count,
//           viewer: { can_manage, user_uid } }   403 not_member; 400 invalid_filter | invalid_sort
//   GET   /api/teams/tasks/:uid                                   → { task: card }
//   PATCH /api/teams/tasks/:uid/move { column, position? }        → { task }; 403 not_manager (not an editor or the assignee)
//   PATCH /api/teams/tasks/:uid { assignee: { kind, uid } | null } → { task }; 422 assignee_not_member, 409 agent_not_live
//   POST  /api/teams/project/:id/tasks { title, ... }             → { task } (201); 403 not_manager
// A card names people and agents by uid and name, never by numeric id or email.
// Projects only: a company has no Kanban. Days are the member's time zone; a
// day before the first item is `{ day, available: false }`, never zeros.
import { request } from '../api.js';

const enc = encodeURIComponent;
// W1's board and create are declared on `/:scope/:id/…` (routes/work_board.ts); Work is projects only.
const SCOPE = 'project';

export const workApi = {
  board: (projectId, { filter, sort } = {}) => {
    const q = new URLSearchParams();
    if (filter) q.set('filter', filter);
    if (sort) q.set('sort', sort);
    const qs = q.toString();
    return request(`/teams/${SCOPE}/${enc(projectId)}/work/board${qs ? `?${qs}` : ''}`);
  },
  item: (uid) => request(`/teams/tasks/${enc(uid)}`),
  move: (uid, { column, position } = {}) => request(`/teams/tasks/${enc(uid)}/move`, {
    method: 'PATCH', body: JSON.stringify(position == null ? { column } : { column, position }),
  }),
  assign: (uid, assignee) => request(`/teams/tasks/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ assignee: assignee ?? null }) }),
  create: (projectId, body) => request(`/teams/${SCOPE}/${enc(projectId)}/tasks`, { method: 'POST', body: JSON.stringify(body || {}) }),
  burnup: (projectId, { range, from, to, filter } = {}) => {
    const q = new URLSearchParams();
    if (from && to) { q.set('from', from); q.set('to', to); } else if (range) q.set('range', range);
    if (filter) q.set('filter', filter);
    const qs = q.toString();
    return request(`/teams/project/${enc(projectId)}/work/burnup${qs ? `?${qs}` : ''}`);
  },
};
