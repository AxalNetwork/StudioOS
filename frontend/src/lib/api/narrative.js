import { request } from '../api.js';

// D908 (#2692) and D911 (#2695) — the Investor narrative's positioning, on routes/cycle_raise.ts.
// Every call names the venture (`?project=`); the venture's founder or an admin.
//   positioning        GET  /cycles/raise/narrative/positioning?version=   → { version, core, overrides, effective }
//   savePositioning    PUT  /cycles/raise/narrative/positioning?version=   { kind, position?, text | null, source? }
//   positioningDraft   GET  /cycles/raise/narrative/positioning/draft      → { read_from, segments, competitors, withheld, proposals }
//   proposePositioning POST /cycles/raise/narrative/positioning/draft?version=   one Eadwyn run → { proposals, removed, read_from, withheld }
//   decidePositioning  POST /cycles/raise/narrative/positioning/proposals/:uid  { decision: 'accept' | 'discard' }
// No version is the venture's core positioning. A proposal is decided one at a time.
function query(projectId, version) {
  const q = new URLSearchParams({ project: String(projectId) });
  if (version !== undefined && version !== null && version !== '') q.set('version', String(version));
  return `?${q.toString()}`;
}

export const narrativeApi = {
  positioning: (projectId, version) => request(`/cycles/raise/narrative/positioning${query(projectId, version)}`),
  savePositioning: (projectId, version, body) => request(`/cycles/raise/narrative/positioning${query(projectId, version)}`, { method: 'PUT', body: JSON.stringify(body) }),
  positioningDraft: (projectId) => request(`/cycles/raise/narrative/positioning/draft${query(projectId)}`),
  proposePositioning: (projectId, version, headers) => request(`/cycles/raise/narrative/positioning/draft${query(projectId, version)}`, { method: 'POST', body: '{}', headers }),
  decidePositioning: (projectId, uid, decision) => request(`/cycles/raise/narrative/positioning/proposals/${encodeURIComponent(uid)}${query(projectId)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
};
