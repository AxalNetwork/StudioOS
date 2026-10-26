// D1046 (#2894, Approvals part 8 of #2390) — what the three lane boards read
// and decide (APR4–APR8). Each call is the Worker route the board needs, written
// out in full so the drift check reads it against the Worker:
//
//   testers          GET   /admin/product-testers?status=&in_programme=&page=&page_size=
//                         → { rows, page, page_size, matching, totals } (D1042, D1200)
//   tester           GET   /admin/product-testers/:id → { tester, programs, events }
//   decideTester     POST  /admin/product-testers/:id/approve, /decline, /pause, /resume or /remove
//                         `{ note?, reason? }`; refusals carry a code and the member-facing sentence
//   pitches          GET   /comarketing/admin/queue?status=&limit=&offset=
//                         → { items, total, limit, offset, attribution_30d, attribution_since } (D1043)
//   pitch            GET   /comarketing/admin/pitches/:uid → the pitch with `decided` (D1132)
//   decidePitch      POST  /comarketing/admin/pitches/:uid/approve, /reject or /publish
//                         `{ notes }`, a publish `{ published_url, notes }`
//   experts          GET   /wellbeing/admin/experts?state=&limit=&offset= → { items, total, limit, offset } (D1043)
//   expert           GET   /wellbeing/admin/experts/:uid/review → { expert, history }
//   verifyExpert     POST  /wellbeing/admin/experts/:uid/verify `{ verified, credentials_checked?, expected_version? }`
//   hideExpert       POST  /wellbeing/admin/experts/:uid/hide `{ hidden }`
//   declineExpert    POST  /wellbeing/admin/experts/:uid/decline `{ reason }`
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });
const query = (pairs) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(pairs)) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const approvalBoardsApi = {
  testers: ({ status, inProgramme, page, pageSize } = {}) =>
    request(`/admin/product-testers${query({ status, in_programme: inProgramme, page, page_size: pageSize })}`),
  tester: (id) => request(`/admin/product-testers/${enc(id)}`),
  decideTester: (id, action, { note, reason } = {}) => {
    const body = { note: note || null, reason: reason || null };
    if (action === 'approve') return post(`/admin/product-testers/${enc(id)}/approve`, body);
    if (action === 'decline') return post(`/admin/product-testers/${enc(id)}/decline`, body);
    if (action === 'pause') return post(`/admin/product-testers/${enc(id)}/pause`, body);
    if (action === 'resume') return post(`/admin/product-testers/${enc(id)}/resume`, body);
    if (action === 'remove') return post(`/admin/product-testers/${enc(id)}/remove`, body);
    throw new Error(`Unknown tester decision: ${action}`);
  },
  pitches: (status, { limit = 25, offset = 0 } = {}) => request(`/comarketing/admin/queue${query({ status, limit, offset })}`),
  pitch: (uid) => request(`/comarketing/admin/pitches/${enc(uid)}`),
  decidePitch: (uid, action, { notes, publishedUrl } = {}) => {
    if (action === 'approve') return post(`/comarketing/admin/pitches/${enc(uid)}/approve`, { notes: notes || null });
    if (action === 'reject') return post(`/comarketing/admin/pitches/${enc(uid)}/reject`, { notes: notes || null });
    if (action === 'publish') return post(`/comarketing/admin/pitches/${enc(uid)}/publish`, { published_url: publishedUrl, notes: notes || null });
    throw new Error(`Unknown pitch decision: ${action}`);
  },
  experts: ({ state = 'all', limit = 200, offset = 0 } = {}) => request(`/wellbeing/admin/experts${query({ state, limit, offset })}`),
  expert: (uid) => request(`/wellbeing/admin/experts/${enc(uid)}/review`),
  verifyExpert: (uid, verified, version) => post(`/wellbeing/admin/experts/${enc(uid)}/verify`, verified
    ? { verified: true, credentials_checked: true, expected_version: version }
    : { verified: false }),
  hideExpert: (uid, hidden) => post(`/wellbeing/admin/experts/${enc(uid)}/hide`, { hidden: !!hidden }),
  declineExpert: (uid, reason) => post(`/wellbeing/admin/experts/${enc(uid)}/decline`, { reason }),
};
