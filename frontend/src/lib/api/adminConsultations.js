// D5885 (#5885, part of #4716) — what the Best-Fit consultations board reads
// and decides (AP-20 to AP-31). Each call is the Worker route, written out in
// full so the drift check reads it against the Worker:
//
//   consultations  GET   /admin/consultations → every booking, newest first, with
//                        `admin_name` (first triaged by) and the latest decision
//                        (`decided_at`, `decided_by_name`); 503 `consultations_unreadable`
//   consultation   GET   /admin/consultations/:id → { booking, history: { available, since, items? } }
//   decide         POST  /admin/consultations/:id/status `{ status, expected_version, slot_at? }`
//                        → { booking }; 409 `version_conflict` / `illegal_transition` with `current`
import { request } from '../api.js';

const enc = encodeURIComponent;

export const adminConsultationsApi = {
  consultations: ({ signal } = {}) => request('/admin/consultations', { signal }),
  consultation: (id, { signal } = {}) => request(`/admin/consultations/${enc(id)}`, { signal }),
  decide: (id, body) => request(`/admin/consultations/${enc(id)}/status`, { method: 'POST', body: JSON.stringify(body || {}) }),
};
