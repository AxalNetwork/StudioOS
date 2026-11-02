// #3959 — a member's own learning plan: the courses, lessons, videos,
// webinars, exercises, exams and study blocks they put on their calendar.
// Worker: routes/learning_plan.ts, mounted at /api/learning/plan.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const learningPlanApi = {
  // { from, to } ISO instants, at most 92 days apart. Each item carries its
  // `occurrences` inside the range, its `href` and whether it is done.
  list: ({ from, to } = {}) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const s = p.toString();
    return request(`/learning/plan${s ? `?${s}` : ''}`);
  },
  // { item_kind, item_uid?, starts_at, duration_min?, repeat?, repeat_weekdays?,
  //   repeat_until?, remind_min_before?, title_override?, goal? }. A webinar is
  // planned at its own time and registers the member (409 `full` when it is full).
  create: (body) => request('/learning/plan', { method: 'POST', body: JSON.stringify(body) }),
  // Move, resize, repeat, remind, rename, or status 'planned' | 'skipped'.
  update: (uid, body) => request(`/learning/plan/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (uid) => request(`/learning/plan/${enc(uid)}`, { method: 'DELETE' }),
  markDone: (uid) => request(`/learning/plan/${enc(uid)}/done`, { method: 'POST' }),
};
