// D999 (#2814) — Persona segments part 2: the segment counts behind
// /admin/persona-segments. Worker: routes/personas.ts (`GET /admin/segments`),
// built in services/personaSegments.ts.
//
// `personaSegmentsApi.read()` → counts only, over every account but admins
// (deactivated ones counted apart). Each block is `{ available: true, … }` or
// `{ available: false, unreadable: true, reason }`: members, segments,
// sub_accounts, by_profile, how_set, confidence, weekly and moves_30d.
import { request } from '../api.js';

export const personaSegmentsApi = {
  read: () => request('/personas/admin/segments'),
};
