// D557 — the Learning center, member side: the federated catalog, a course,
// an item, the caller's own progress and their learning record.
// Worker: routes/learning.ts, mounted at /api/learning.
import { request } from '../api.js';

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const learningApi = {
  // `kind`, `q`, `topic`, `level`, `limit`, `offset`. Each source answers
  // alone: read `sources[kind].status` before reading its rows as "none".
  catalog: (params) => request(`/learning/catalog${qs(params)}`),
  course: (slug) => request(`/learning/courses/${encodeURIComponent(slug)}`),
  item: (uid) => request(`/learning/items/${encodeURIComponent(uid)}`),
  // { subject_kind: 'item'|'lesson'|'course', subject_uid, status: 'started'|'completed', percent?, position_seconds? }
  recordProgress: (body) => request('/learning/progress', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/learning/me'),
};
