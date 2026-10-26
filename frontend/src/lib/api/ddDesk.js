import { request } from '../api.js';

// D1249 (#3264, part 5 of #2385) — Due Diligence's desk: the list and its
// figures, My reviews, the searches, the team and HQ's templates. Worker:
// routes/dd.ts, migration 623. No page reads these yet: the list is part 6
// (#3265), the case tabs part 7 (#3266), the reviewer views part 8 (#3267).
//
//   cases          GET    /dd/cases?q=&subject_type=&stage=&lead=&template=&risk_band=&decision=&past_target=&sort=&page=&page_size=
//                         → { items, total, page, page_size, sort }; each row with stage, checklist, open flags, requests waiting
//   overview       GET    /dd/overview          → { stages, severe_flags, requests, ages, decisions }; 503 when it cannot be read
//   myReviews      GET    /dd/my-reviews        → { items }
//   subjects       GET    /dd/subjects?type=&q= → { items: [{ id, name, type }] }; an investor's startups only
//   people         GET    /dd/people?q=&page=   → { items, total, page, page_size }; an email for an Admin only
//   assign         POST   /dd/cases/:uid/sections/:id/assign { user_id, role: reviewer | observer } (the link lasts 14 days)
//   conflicts      POST   /dd/cases/:uid/sections/:id/conflicts { declared, note }
//   removeReviewer DELETE /dd/cases/:uid/sections/:id/reviewers/:userId
//   widen          POST   /dd/cases/:uid/widen { depth }
//   templates      GET    /dd/templates         → { templates: [{ depth, current, versions }], can_edit }
//   saveTemplate   POST   /dd/templates { depth, sections } (Super Admin)
//
// Every path is written out in full so the drift check reads each one against the Worker.
const enc = encodeURIComponent;
const LIST_KEYS = ['q', 'subject_type', 'status', 'stage', 'lead', 'template', 'risk_band', 'decision', 'past_target', 'sort', 'page', 'page_size'];

export const ddDeskApi = {
  cases: (filters = {}) => {
    const q = new URLSearchParams();
    for (const k of LIST_KEYS) if (filters[k] != null && filters[k] !== '') q.set(k, String(filters[k]));
    const qs = q.toString();
    return request(`/dd/cases${qs ? `?${qs}` : ''}`);
  },
  overview: () => request('/dd/overview'),
  myReviews: () => request('/dd/my-reviews'),
  subjects: (type, q = '') => request(`/dd/subjects?type=${enc(type)}&q=${enc(q)}`),
  people: (q = '', page = 1) => request(`/dd/people?q=${enc(q)}&page=${enc(page)}`),
  assign: (uid, sectionId, userId, role = 'reviewer') =>
    request(`/dd/cases/${enc(uid)}/sections/${enc(sectionId)}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId, role }) }),
  conflicts: (uid, sectionId, declared, note = '') =>
    request(`/dd/cases/${enc(uid)}/sections/${enc(sectionId)}/conflicts`, { method: 'POST', body: JSON.stringify({ declared, note }) }),
  removeReviewer: (uid, sectionId, userId) =>
    request(`/dd/cases/${enc(uid)}/sections/${enc(sectionId)}/reviewers/${enc(userId)}`, { method: 'DELETE' }),
  widen: (uid, depth) => request(`/dd/cases/${enc(uid)}/widen`, { method: 'POST', body: JSON.stringify({ depth }) }),
  templates: () => request('/dd/templates'),
  saveTemplate: (depth, sections) => request('/dd/templates', { method: 'POST', body: JSON.stringify({ depth, sections }) }),
};
