// D999 (#2814) — Persona segments part 2: the segment counts behind
// /admin/persona-segments. Worker: routes/personas.ts (`GET /admin/segments`),
// built in services/personaSegments.ts.
//
// `personaSegmentsApi.read()` → counts only, over every account but admins
// (deactivated ones counted apart). Each block is `{ available: true, … }` or
// `{ available: false, unreadable: true, reason }`: members, segments,
// sub_accounts, by_profile, how_set, confidence, weekly and moves_30d.
import { request } from '../api.js';

// D1000 (#2815) — Persona segments part 3: the segment profiles HQ writes
// (migration 559), on routes/persona_segments.ts at /api/personas/segments.
// Reads are any admin's; a write is the Super Admin's and names the version it read.
//   segmentProfiles()             GET   /personas/segments → { segments: [{ key, name, profile, status, who, typical, needs, offers, version, … }] }
//   segmentCoverage()             GET   /personas/segments/coverage → { segments: [{ key, members, needs, gap_kinds, offers }], small_cell_min }
//   segmentProfile(key)           GET   /personas/segments/:key → { segment, history }
//   saveSegmentProfile(key, b)    PATCH /personas/segments/:key { expected_version, reason?, …fields } → { segment, changed }
// A count from 1 to 4 comes back as { count: null, suppressed: true }; admins are in no count.
// D1002 (#2817) — Persona segments part 5, on routes/persona_members.ts at /api/personas/admin:
//   members(params)          GET  /personas/admin/members?segment=<key>|none&q=&profile=&how_set=&band=&sub=&answered=&active=&differs=&why=&sort=&dir=&page=
//                            → { total, page, page_size, rows, why_counts, unreadable }
//   moveMembers(ids, key)    POST /personas/admin/members/move { user_ids, persona_id } → { segment, results, moved }
//   askToFinish(ids)         POST /personas/admin/members/ask-to-finish { user_ids } → { results, asked, every_days }
//   activity(params)         GET  /personas/admin/activity?kind=&q=&page= → { total, page, page_size, sources, rows }
const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export const personaSegmentsApi = {
  read: () => request('/personas/admin/segments'),
  segmentProfiles: () => request('/personas/segments'),
  segmentCoverage: () => request('/personas/segments/coverage'),
  segmentProfile: (key) => request(`/personas/segments/${encodeURIComponent(key)}`),
  saveSegmentProfile: (key, body) => request(`/personas/segments/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  members: (params = {}) => request(`/personas/admin/members${qs(params)}`),
  moveMembers: (userIds, personaId) => request('/personas/admin/members/move', { method: 'POST', body: JSON.stringify({ user_ids: userIds, persona_id: personaId }) }),
  askToFinish: (userIds) => request('/personas/admin/members/ask-to-finish', { method: 'POST', body: JSON.stringify({ user_ids: userIds }) }),
  activity: (params = {}) => request(`/personas/admin/activity${qs(params)}`),
};
