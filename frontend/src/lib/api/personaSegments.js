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
export const personaSegmentsApi = {
  segmentProfiles: () => request('/personas/segments'),
  segmentCoverage: () => request('/personas/segments/coverage'),
  segmentProfile: (key) => request(`/personas/segments/${encodeURIComponent(key)}`),
  saveSegmentProfile: (key, body) => request(`/personas/segments/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suggestSegmentChange: (body) => request('/personas/segments/suggestions', { method: 'POST', body: JSON.stringify(body) }),
  segmentSuggestions: (status) => request(`/personas/segments/suggestions${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  decideSegmentSuggestion: (uid, body) => request(`/personas/segments/suggestions/${encodeURIComponent(uid)}/decide`, { method: 'POST', body: JSON.stringify(body) }),
};
