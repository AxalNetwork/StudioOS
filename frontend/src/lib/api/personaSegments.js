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
// D1003 (#2818) — part 6: an Admin's suggestions (migration 570), and HQ's decision.
//   suggestSegmentChange(b)       POST  /personas/segments/suggestions { segment_key?, kind, text } → 201 { suggestion, notice }
//   segmentSuggestions(status?)   GET   /personas/segments/suggestions?status= → { suggestions, scope: 'all' | 'mine' }
//   decideSegmentSuggestion(uid, b) POST /personas/segments/suggestions/:uid/decide { decision, reason? } → { suggestion, edit, notice }
// `edit` (on accept) is what part 3's edit opens on: { segment_key, expected_version, field, text }.

// D1002 (#2817) — Persona segments part 5, on routes/persona_members.ts at /api/personas/admin:
//   members(params)          GET  /personas/admin/members?segment=<key>|none&q=&profile=&how_set=&band=&sub=&answered=&active=&differs=&why=&sort=&dir=&page=
//                            → { total, page, page_size, rows, why_counts, unreadable }
//   moveMembers(ids, key)    POST /personas/admin/members/move { user_ids, persona_id } → { segment, results, moved }
//   askToFinish(ids)         POST /personas/admin/members/ask-to-finish { user_ids } → { results, asked, every_days }
//   activity(params)         GET  /personas/admin/activity?kind=&segment=&q=&page= → { total, page, page_size, sources, rows }
// D1001 (#2816), mounted by D1005 (#2820), on routes/persona_segment_aggregates.ts: counts only, 1–4 suppressed.
//   answers(key)             GET  /personas/segments/:key/answers    → { segment, small_cell_min, themes_enabled, questions }
//   archetypes(key)          GET  /personas/segments/:key/archetypes → { segment, small_cell_min, profiled, not_recorded, archetypes }
const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export const personaSegmentsApi = {
  audienceSegments: () => request('/personas/audience-segments'),
  answerFollowUp: (persona_id, key, value) => request('/personas/answer', { method: 'POST', body: JSON.stringify({ persona_id, key, value, expected_primary: true }) }),
  createSegment: (body) => request('/personas/segments', { method: 'POST', body: JSON.stringify(body) }),
  completion: (key) => request(`/personas/segments/${encodeURIComponent(key)}/completion`),
  read: () => request('/personas/admin/segments'),
  segmentProfiles: () => request('/personas/segments'),
  segmentCoverage: () => request('/personas/segments/coverage'),
  segmentProfile: (key) => request(`/personas/segments/${encodeURIComponent(key)}`),
  saveSegmentProfile: (key, body) => request(`/personas/segments/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suggestSegmentChange: (body) => request('/personas/segments/suggestions', { method: 'POST', body: JSON.stringify(body) }),
  segmentSuggestions: (status) => request(`/personas/segments/suggestions${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  decideSegmentSuggestion: (uid, body) => request(`/personas/segments/suggestions/${encodeURIComponent(uid)}/decide`, { method: 'POST', body: JSON.stringify(body) }),
  members: (params = {}) => request(`/personas/admin/members${qs(params)}`),
  moveMembers: (userIds, personaId) => request('/personas/admin/members/move', { method: 'POST', body: JSON.stringify({ user_ids: userIds, persona_id: personaId }) }),
  askToFinish: (userIds) => request('/personas/admin/members/ask-to-finish', { method: 'POST', body: JSON.stringify({ user_ids: userIds }) }),
  activity: (params = {}) => request(`/personas/admin/activity${qs(params)}`),
  answers: (key) => request(`/personas/segments/${encodeURIComponent(key)}/answers`),
  archetypes: (key) => request(`/personas/segments/${encodeURIComponent(key)}/archetypes`),
};
