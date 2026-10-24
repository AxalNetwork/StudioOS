import { request } from '../api.js';

// D914 (#2698) — the Investor narrative's admin read: the reasons an admin
// gives for opening a venture's narrative, and its notes thread. Worker:
// routes/cycle_raise.ts (`services/narrative/adminRead.ts`).
//   narrativeReads(pid)          GET  /cycles/raise/narrative/reads → { reads: [{ id, reason, by: { name, kind }, created_at, expires_at }], mine, viewer }
//   narrativeGiveReason(pid, r)  POST /cycles/raise/narrative/reads { reason } → { read }   (an admin only)
//   narrativeNotes(pid)          GET  /cycles/raise/narrative/notes → { notes: [{ id, version, body, author: { name, kind }, created_at }], viewer }
//   narrativePostNote(pid, b)    POST /cycles/raise/narrative/notes { body, version? } → { note }
// An admin's narrative reads answer 403 `read_reason_required` until a reason is given.
const q = (projectId) => `project=${encodeURIComponent(projectId)}`;

export const narrativeApi = {
  narrativeReads: (projectId) => request(`/cycles/raise/narrative/reads?${q(projectId)}`),
  narrativeGiveReason: (projectId, reason) => request(`/cycles/raise/narrative/reads?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  narrativeNotes: (projectId) => request(`/cycles/raise/narrative/notes?${q(projectId)}`),
  narrativePostNote: (projectId, body, version = null) => request(`/cycles/raise/narrative/notes?${q(projectId)}`, {
    method: 'POST', body: JSON.stringify(version == null ? { body } : { body, version }),
  }),
};
