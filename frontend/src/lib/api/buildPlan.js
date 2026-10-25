// D1065 (#2935): the rule-based Validate → Build plan, no automatic acceptance.
// GET /api/cycles/build/plan?project=&scope=venture|h-N
// POST /api/cycles/build/plan?project=&scope=venture|h-N (prepare or update)
// D1066 (#2936): POST /items/:uid/accept, PATCH /items/:uid, POST /items/:uid/dismiss,
// POST /modules/:module/accept?project=&scope=, and GET /api/cycles/build/evidence.
import { request } from '../api.js';
const query = (project, scope) => new URLSearchParams({ project: String(project), scope }).toString();
export const buildPlanApi = {
  read: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`),
  prepare: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  accept: (uid, payload) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}/accept`, { method: 'POST', body: JSON.stringify(payload ? { payload } : {}) }),
  edit: (uid, payload) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ payload }) }),
  dismiss: (uid) => request(`/cycles/build/plan/items/${encodeURIComponent(uid)}/dismiss`, { method: 'POST', body: '{}' }),
  acceptModule: (project, module, scope = 'venture') => request(`/cycles/build/plan/modules/${encodeURIComponent(module)}/accept?${query(project, scope)}`, { method: 'POST', body: '{}' }),
  evidence: (project, table, id) => request(`/cycles/build/evidence?${new URLSearchParams({ project: String(project), table, id: String(id) })}`),
};
