// D1065 (#2935): the rule-based Validate → Build plan, no automatic acceptance.
// GET /api/cycles/build/plan?project=&scope=venture|h-N
// POST /api/cycles/build/plan?project=&scope=venture|h-N (prepare or update)
// D1066 (#2936): POST /items/:uid/accept, PATCH /items/:uid, POST /items/:uid/dismiss,
// POST /modules/:module/accept?project=&scope=, and GET /api/cycles/build/evidence.
// D1067 (#2937): POST /pause, POST /resume, GET /since?project=&scope=.
// D1071 (#2941): POST|GET /word?project=&scope=, POST /word/:uid/keep|discard, and
// PATCH /items/:uid { wording } — Keep wording is the item's Save.
import { request } from '../api.js';
const query = (project, scope) => new URLSearchParams({ project: String(project), scope }).toString();
export const buildPlanApi = {
  read: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`),
  prepare: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  accept: (uid, payload) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}/accept`, { method: 'POST', body: JSON.stringify(payload ? { payload } : {}) }),
  edit: (uid, payload, wording) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify(wording ? { payload, wording } : { payload }) }),
  dismiss: (uid) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}/dismiss`, { method: 'POST', body: '{}' }),
  acceptModule: (project, module, scope = 'venture') => request(`/cycles/build/plan/modules/${encodeURIComponent(module)}/accept?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  word: (project, scope = 'venture', headers) => request(`/cycles/build/plan/word?${query(project, scope)}`, { method: 'POST', body: '{}', headers }),
  wording: (project, scope = 'venture') => request(`/cycles/build/plan/word?${query(project, scope)}`),
  keepWording: (project, uid, target, scope = 'venture') => request(`/cycles/build/plan/word/${encodeURIComponent(uid)}/keep?${query(project, scope)}`, { method: 'POST', body: JSON.stringify({ target }) }),
  discardWording: (project, uid, target, scope = 'venture') => request(`/cycles/build/plan/word/${encodeURIComponent(uid)}/discard?${query(project, scope)}`, { method: 'POST', body: JSON.stringify({ target }) }),
  // D1067 (#2937): pause, resume, and new evidence since the plan (VB13, VB14).
  pause: (project, scope = 'venture') => request(`/cycles/build/plan/pause?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  resume: (project, scope = 'venture') => request(`/cycles/build/plan/resume?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  since: (project, scope = 'venture') => request(`/cycles/build/plan/since?${query(project, scope)}`),
  evidence: (project, table, id) => request(`/cycles/build/evidence?${new URLSearchParams({ project: String(project), table, id: String(id) })}`),
};
