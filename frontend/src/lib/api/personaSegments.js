import { request } from '../api.js';

// D1000 (#2815) — Persona segments part 3: the segment profiles HQ writes
// (migration 559), on routes/persona_segments.ts at /api/personas/segments.
// Reads are any admin's; a write is the Super Admin's and names the version it read.
//   segmentProfiles()             GET   /personas/segments → { segments: [{ key, name, profile, status, who, typical, needs, offers, version, … }] }
//   segmentCoverage()             GET   /personas/segments/coverage → { segments: [{ key, members, needs, gap_kinds, offers }], small_cell_min }
//   segmentProfile(key)           GET   /personas/segments/:key → { segment, history }
//   saveSegmentProfile(key, b)    PATCH /personas/segments/:key { expected_version, reason?, …fields } → { segment, changed }
// A count from 1 to 4 comes back as { count: null, suppressed: true }; admins are in no count.
export const personaSegmentsApi = {
  segmentProfiles: () => request('/personas/segments'),
  segmentCoverage: () => request('/personas/segments/coverage'),
  segmentProfile: (key) => request(`/personas/segments/${encodeURIComponent(key)}`),
  saveSegmentProfile: (key, body) => request(`/personas/segments/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
