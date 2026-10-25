import { request } from '../api.js';

// D908 (#2692), D910 (#2694) and D911 (#2695) — the Investor narrative's Story and Positioning, on routes/cycle_raise.ts.
// Every call names the venture (`?project=`); the venture's founder or an admin.
//   read               GET  /cycles/raise/narrative/:version → sections and bindings
//   saveSection        PUT  /cycles/raise/narrative/:version/sections/:section → changed fields
// D914 (#2698) — the Investor narrative's admin read: the reasons an admin
// gives for opening a venture's narrative, and its notes thread. Worker:
// routes/cycle_raise.ts (`services/narrative/adminRead.ts`).
//   narrativeReads(pid)          GET  /cycles/raise/narrative/reads → { reads: [{ id, reason, by: { name, kind }, created_at, expires_at }], mine, viewer }
//   narrativeGiveReason(pid, r)  POST /cycles/raise/narrative/reads { reason } → { read }   (an admin only)
//   narrativeNotes(pid)          GET  /cycles/raise/narrative/notes → { notes: [{ id, version, body, author: { name, kind }, created_at }], viewer }
//   narrativePostNote(pid, b)    POST /cycles/raise/narrative/notes { body, version? } → { note }
// An admin's narrative reads answer 403 `read_reason_required` until a reason is given.
const q = (projectId) => `project=${encodeURIComponent(projectId)}`;



// D908 (#2692) and D911 (#2695) — the Investor narrative's positioning, on routes/cycle_raise.ts.
// Every call names the venture (`?project=`); founders write, admins read after giving a reason.
//   positioning        GET  /cycles/raise/narrative/positioning?version=   → { version, core, overrides, effective }
//   savePositioning    PUT  /cycles/raise/narrative/positioning?version=   { kind, position?, text | null, source? }
//   positioningDraft   GET  /cycles/raise/narrative/positioning/draft      → { read_from, segments, competitors, withheld, proposals }
//   proposePositioning POST /cycles/raise/narrative/positioning/draft?version=   one Eadwyn run → { proposals, removed, read_from, withheld }
//   decidePositioning  POST /cycles/raise/narrative/positioning/proposals/:uid  { decision: 'accept' | 'discard' }
// In Positioning, no version is the venture's core positioning. A proposal is decided one at a time.
function query(projectId, version) {
  const q = new URLSearchParams({ project: String(projectId) });
  if (version !== undefined && version !== null && version !== '') q.set('version', String(version));
  return `?${q.toString()}`;
}

// Story reads and section saves use D908; version 0 (the live deck) is read only.
const enc = encodeURIComponent;

export const narrativeApi = {
  read: (projectId, version) => request(`/cycles/raise/narrative/${enc(version)}?project=${enc(projectId)}`),
  saveSection: (projectId, version, section, body) => request(`/cycles/raise/narrative/${enc(version)}/sections/${enc(section)}?project=${enc(projectId)}`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  // D1114 (#2994): Story's "Ask Eadwyn ▾". One metered run; it writes nothing.
  //   POST /cycles/raise/narrative/:version/sections/:section/draft { mode: draft | shorten | plain, words? } → { text, removed }
  draftSection: (projectId, version, section, body, headers) => request(`/cycles/raise/narrative/${enc(version)}/sections/${enc(section)}/draft?project=${enc(projectId)}`, {
    method: 'POST', body: JSON.stringify(body), headers,
  }),
  narrativeReads: (projectId) => request(`/cycles/raise/narrative/reads?${q(projectId)}`),
  narrativeGiveReason: (projectId, reason) => request(`/cycles/raise/narrative/reads?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  narrativeNotes: (projectId) => request(`/cycles/raise/narrative/notes?${q(projectId)}`),
  narrativePostNote: (projectId, body, version = null) => request(`/cycles/raise/narrative/notes?${q(projectId)}`, {
    method: 'POST', body: JSON.stringify(version == null ? { body } : { body, version }),
  }),

  positioning: (projectId, version) => request(`/cycles/raise/narrative/positioning${query(projectId, version)}`),
  savePositioning: (projectId, version, body) => request(`/cycles/raise/narrative/positioning${query(projectId, version)}`, { method: 'PUT', body: JSON.stringify(body) }),
  positioningDraft: (projectId) => request(`/cycles/raise/narrative/positioning/draft${query(projectId)}`),
  proposePositioning: (projectId, version, headers) => request(`/cycles/raise/narrative/positioning/draft${query(projectId, version)}`, { method: 'POST', body: '{}', headers }),
  decidePositioning: (projectId, uid, decision) => request(`/cycles/raise/narrative/positioning/proposals/${encodeURIComponent(uid)}${query(projectId)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
};
