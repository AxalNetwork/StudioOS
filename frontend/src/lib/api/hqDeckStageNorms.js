// D4155 K5 (#4192) — HQ › Decks › Stage norms: HQ's norms, the platform
// defaults the deck critic cites after a venture's own (D1589). Worker:
// routes/admin_deck_stage_norms.ts, migration 202611022230's `hq_stage_norms`.
// HQ admin only (`requireHqAdmin`).
//   GET  /api/admin/deck-stage-norms?stage=&status=   → { stage, norms: [HqNorm] }
//   POST /api/admin/deck-stage-norms                  { stage, metric, range: { low, high, unit }, source, last_reviewed?, reason } → 201 { norm }
//   PUT  /api/admin/deck-stage-norms/:uid             the same fields and { reason } → { norm }
//   POST /api/admin/deck-stage-norms/:uid/retire      { reason } → { norm }
//   GET  /api/admin/deck-stage-norms/projects/:id     → { project, read_only: true, norms, last_changed }
// `source` is required and every write takes a reason of ten characters or more.
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/deck-stage-norms';

export const hqDeckStageNormsApi = {
  list: ({ stage, status } = {}) => {
    const q = new URLSearchParams();
    if (stage) q.set('stage', stage);
    if (status) q.set('status', status);
    const s = q.toString();
    return request(`${BASE}${s ? `?${s}` : ''}`);
  },
  add: (norm) => request(BASE, { method: 'POST', body: JSON.stringify(norm || {}) }),
  edit: (uid, changes) => request(`${BASE}/${enc(uid)}`, { method: 'PUT', body: JSON.stringify(changes || {}) }),
  retire: (uid, { reason } = {}) => request(`${BASE}/${enc(uid)}/retire`, { method: 'POST', body: JSON.stringify({ reason }) }),
  projectNorms: (projectId) => request(`${BASE}/projects/${enc(projectId)}`),
};
