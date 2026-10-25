import { request } from '../api.js';

// D962 (#2795) — the program pages' reads and writes on part 1's Worker
// (D954, #2787: routes/admin_programs.ts and routes/learning_programs.ts),
// which added no client. Part 9 draws them; part 10 (#2796) reuses them.
//   program        GET  /admin/programs/:key                  (requireAdmin)
//                  → { program, playbook: { published, version, published_at, sections }, draft? }
//                  `draft` ({ sections, edited_at, differs }) is a Super Admin's only.
//   editSection    PUT  /admin/programs/:key/playbook/sections/:section  { title?, body? }  (requireSuperAdmin)
//                  → the same body as `program`, draft included. 400 `computed_section` on a body for a
//                  computed section, 404 `unknown_section`.
//   publish        POST /admin/programs/:key/playbook/publish  (requireSuperAdmin)
//                  → the detail; 409 `nothing_to_publish` when the draft is what is published,
//                  409 `publish_conflict` when another publish landed first.
//   activity       GET  /admin/programs/:key/activity?before=&limit=  (requireAdmin)
//                  → { program, rows: [{ at, kind, by: 'hq'|'admin', concerns }], next_before,
//                      not_audited: { recorded: false, reason } | null, scope? }
//   mentorSessions GET  /admin/programs/mentor-cohorts/sessions  (requireAdmin)
//                  → { cycles: [{ cycle_id, year, month, start_at, end_at, status, mentors, sessions }], rule }
//   learningWeekly GET  /learning/programs/mine/enrolments?weeks=4|12|52  (/programs/mine's gate and scope)
//                  → { weeks, week_axis, current_week, total, by_week, programs: [{ uid, name, weeks, total }], rule }
//   learner        GET  /learning/programs/:uid/learners/:userUid  (assigned admin or Super Admin)
//                  → { program, contents, learner }; 403 `not_assigned`, 404 `not_enrolled`.
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const at = (key) => `/admin/programs/${encodeURIComponent(key)}`;

export const programsApi = {
  program: (key) => request(at(key)),
  editSection: (key, section, body) => request(`${at(key)}/playbook/sections/${encodeURIComponent(section)}`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  publish: (key) => request(`${at(key)}/playbook/publish`, { method: 'POST', body: '{}' }),
  activity: (key, params = {}) => request(`${at(key)}/activity${query(params)}`),
  mentorSessions: () => request('/admin/programs/mentor-cohorts/sessions'),
  learningWeekly: (weeks = 12) => request(`/learning/programs/mine/enrolments${query({ weeks })}`),
  learner: (programUid, userUid) => request(`/learning/programs/${encodeURIComponent(programUid)}/learners/${encodeURIComponent(userUid)}`),
};
