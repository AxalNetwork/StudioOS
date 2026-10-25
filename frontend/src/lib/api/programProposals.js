// D964 (#2797, Programs part 11) — the client for part 2's proposal routes
// (D955, #2788) and New program.
// Worker: routes/admin_program_proposals.ts over services/programProposals.ts
// and migration 561; New program is routes/admin_programs.ts' `POST /`.
//   POST  /api/admin/programs/proposals                → 201 { proposal }   start a draft
//   PATCH /api/admin/programs/proposals/:uid           → { proposal }       save any fields
//   POST  /api/admin/programs/proposals/:uid/send      → { proposal }       Send to HQ (403 proposals_closed until OD-PROP)
//   GET   /api/admin/programs/proposals/mine?q=&status=&sort=&page=        Your proposals
//   GET   /api/admin/programs/proposals?q=&status=&licence=&sort=&page=    HQ's queue (Super Admin)
//   GET   /api/admin/programs/proposals/:uid           → { proposal }
//   POST  /api/admin/programs/proposals/:uid/decision  { outcome, note } (Super Admin)
//   POST  /api/admin/programs                          New program (Super Admin) → 201 the program
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/programs/proposals';
const query = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};
const post = (body) => ({ method: 'POST', body: JSON.stringify(body || {}) });

export const programProposalsApi = {
  start: (fields) => request(BASE, post(fields)),
  save: (uid, fields) => request(`${BASE}/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(fields || {}) }),
  send: (uid) => request(`${BASE}/${enc(uid)}/send`, post({})),
  mine: (params) => request(`${BASE}/mine${query(params)}`),
  queue: (params) => request(`${BASE}${query(params)}`),
  one: (uid) => request(`${BASE}/${enc(uid)}`),
  decide: (uid, body) => request(`${BASE}/${enc(uid)}/decision`, post(body)),
  newProgram: (fields) => request('/admin/programs', post(fields)),
};
