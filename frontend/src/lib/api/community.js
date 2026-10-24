import { request } from '../api.js';

// D932 (#2716) — Admin · Community's reads, on routes/admin_community.ts. Any admin.
//   activity  GET /admin/community/activity  { kind: 'events'|'jobs'|'circles'|'wellbeing'|'admin', from: 'YYYY-MM-DD',
//                                              to: 'YYYY-MM-DD', q, limit: 1–50 (10), offset }
//             → { rows: [{ kind, actor: 'admin'|'member', icon, sentence, title, href, at, dated_by?, count? }],
//                 total, limit, offset, filters, sources, unreadable: [{ source, reason }], definition }
// No row names a member; an admin is "An admin". A source that failed is in `unreadable` and its rows are absent.
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const communityApi = {
  activity: (params) => request(`/admin/community/activity${query(params)}`),
};
