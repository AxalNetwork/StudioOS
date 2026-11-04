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
//   GET /api/teams/project/:id/work/workload?weeks=1..12   (W4, #3972)
//       → { weeks: [week_start], people: [{ person: { uid, name }, capacity, weeks: [{ week_start, items, estimate_points,
//            unestimated, over_capacity }], unscheduled }], agents: [{ agent: { uid, name, role_key }, capacity: null, … }] }
//       capacity is { available: true, value } or { available: false, reason: 'Not recorded' }; over_capacity is null when unset.
//       400 invalid_weeks; 403 not_member; 404 for a company.
//   PUT /api/teams/project/:id/work/capacity/:personUid   { weekly_capacity_points: number | null } → { person, capacity }  (W4)
//       one's own, or a project editor's; 400 invalid_capacity; 403 not_manager; 404 not on the project.
//   A task's time block is the board's PATCH /api/teams/tasks/:uid { scheduled_start, scheduled_end } (W4).
//   GET /api/teams/project/:id/assignable                    (W8, #3994; routes/agent_engine.ts)
//       → { team: [{ kind: 'person', uid, name, team_role, licence, open_tasks, capacity } | { kind: 'agent', uid, name, role, status, open_tasks }] }
//       this project's Team only; never an email. 403 not_member; 404 not_found.
//   GET /api/teams/me/tasks?state=open|closed|all&project=&due=overdue|today|week|none   (W8, #3994)
//       → { projects: [{ project: { id, name }, tasks: [{ uid, task_number, title, type, column, state, due_at, blocked, needs_reassignment, link }] }],
//           compliance: [{ company: { uid, name }, tasks: [{ uid, title, type, state, due_at, needs_reassignment, project_id, link }] }], has_more }
//       only tasks the caller can read; 400 invalid_filter.
// Projects only: a company has no Kanban. Days are the member's time zone; a
// day before the first item is `{ day, available: false }`, never zeros.
// W7 (#3993, #4418), routes/work_items.ts, under /api/teams:
//   GET /teams/project/:id/tasks/:number/timeline — timeline
//   POST /teams/project/:id/tasks/:number/comments — comment
//   PATCH /teams/project/:id/comments/:uid — editComment
//   DELETE /teams/project/:id/comments/:uid — deleteComment
//   POST /teams/project/:id/tasks/:number/review — review
//   PUT /teams/project/:id/tasks/:number/labels — setLabels
//   PUT /teams/project/:id/tasks/:number/milestone — setMilestone
//   GET /teams/project/:id/work/drafts — drafts
//   POST /teams/project/:id/work/drafts/:uid/accept — acceptDraft
//   POST /teams/project/:id/work/drafts/:uid/discard — discardDraft
//   GET /teams/project/:id/work/labels — labels
//   POST /teams/project/:id/work/labels — createLabel
//   PATCH /teams/project/:id/work/labels/:uid — updateLabel
//   DELETE /teams/project/:id/work/labels/:uid — deleteLabel
//   GET /teams/project/:id/work/milestones — milestones
//   POST /teams/project/:id/work/milestones — createMilestone
//   PATCH /teams/project/:id/work/milestones/:uid — updateMilestone
//   DELETE /teams/project/:id/work/milestones/:uid — deleteMilestone
import { request } from '../api.js';

const enc = encodeURIComponent;
// W1's board and create are declared on `/:scope/:id/…` (routes/work_board.ts); Work is projects only.
const SCOPE = 'project';

export const workApi = {
  // #4420: project-only counts, behind the board's flags and read gate.
  summary: (projectId) => request(`/teams/${SCOPE}/${enc(projectId)}/work/summary`),
  timeline: (projectId, number) => request(`/teams/project/${enc(projectId)}/tasks/${enc(number)}/timeline`),
  comment: (projectId, number, body) => request(`/teams/project/${enc(projectId)}/tasks/${enc(number)}/comments`, { method: 'POST', body: JSON.stringify(body || {}) }),
  editComment: (projectId, uid, body) => request(`/teams/project/${enc(projectId)}/comments/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  deleteComment: (projectId, uid) => request(`/teams/project/${enc(projectId)}/comments/${enc(uid)}`, { method: 'DELETE' }),
  review: (projectId, number, body) => request(`/teams/project/${enc(projectId)}/tasks/${enc(number)}/review`, { method: 'POST', body: JSON.stringify(body || {}) }),
  setLabels: (projectId, number, body) => request(`/teams/project/${enc(projectId)}/tasks/${enc(number)}/labels`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  setMilestone: (projectId, number, body) => request(`/teams/project/${enc(projectId)}/tasks/${enc(number)}/milestone`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  drafts: (projectId) => request(`/teams/project/${enc(projectId)}/work/drafts`),
  acceptDraft: (projectId, uid) => request(`/teams/project/${enc(projectId)}/work/drafts/${enc(uid)}/accept`, { method: 'POST' }),
  discardDraft: (projectId, uid, body) => request(`/teams/project/${enc(projectId)}/work/drafts/${enc(uid)}/discard`, { method: 'POST', body: JSON.stringify(body || {}) }),
  labels: (projectId) => request(`/teams/project/${enc(projectId)}/work/labels`),
  createLabel: (projectId, body) => request(`/teams/project/${enc(projectId)}/work/labels`, { method: 'POST', body: JSON.stringify(body || {}) }),
  updateLabel: (projectId, uid, body) => request(`/teams/project/${enc(projectId)}/work/labels/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  deleteLabel: (projectId, uid) => request(`/teams/project/${enc(projectId)}/work/labels/${enc(uid)}`, { method: 'DELETE' }),
  milestones: (projectId) => request(`/teams/project/${enc(projectId)}/work/milestones`),
  createMilestone: (projectId, body) => request(`/teams/project/${enc(projectId)}/work/milestones`, { method: 'POST', body: JSON.stringify(body || {}) }),
  updateMilestone: (projectId, uid, body) => request(`/teams/project/${enc(projectId)}/work/milestones/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  deleteMilestone: (projectId, uid) => request(`/teams/project/${enc(projectId)}/work/milestones/${enc(uid)}`, { method: 'DELETE' }),

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
  // D1614 W6 (#3974): WK7's "Schedule work", the task's time block on the same PATCH (W4).
  schedule: (uid, block) => request(`/teams/tasks/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ scheduled_start: block?.scheduled_start ?? null, scheduled_end: block?.scheduled_end ?? null }) }),
  create: (projectId, body) => request(`/teams/${SCOPE}/${enc(projectId)}/tasks`, { method: 'POST', body: JSON.stringify(body || {}) }),
  burnup: (projectId, { range, from, to, filter } = {}) => {
    const q = new URLSearchParams();
    if (from && to) { q.set('from', from); q.set('to', to); } else if (range) q.set('range', range);
    if (filter) q.set('filter', filter);
    const qs = q.toString();
    return request(`/teams/project/${enc(projectId)}/work/burnup${qs ? `?${qs}` : ''}`);
  },
  workload: (projectId, { weeks } = {}) => request(`/teams/project/${enc(projectId)}/work/workload${weeks ? `?weeks=${enc(weeks)}` : ''}`),
  // D1614 W8 (#3994): who may be given a task here (this Team's people and agents), and every task given to me.
  assignable: (projectId) => request(`/teams/project/${enc(projectId)}/assignable`),
  myTasks: ({ state, project, due } = {}) => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    if (project != null && project !== '') q.set('project', String(project));
    if (due) q.set('due', due);
    const qs = q.toString();
    return request(`/teams/me/tasks${qs ? `?${qs}` : ''}`);
  },
  setCapacity: (projectId, personUid, points) => request(`/teams/project/${enc(projectId)}/work/capacity/${enc(personUid)}`, {
    method: 'PUT', body: JSON.stringify({ weekly_capacity_points: points }),
  }),
};
