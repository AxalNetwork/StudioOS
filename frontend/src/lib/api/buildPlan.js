// D1065 (#2935): the rule-based Validate → Build plan, no automatic acceptance.
// GET /api/cycles/build/plan?project=&scope=venture|h-N
// POST /api/cycles/build/plan?project=&scope=venture|h-N (prepare or update)
import { request } from '../api.js';
const query = (project, scope) => new URLSearchParams({ project: String(project), scope }).toString();
export const buildPlanApi = {
  read: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`),
  prepare: (project, scope = 'venture') => request(`/cycles/build/plan?${query(project, scope)}`, { method: 'POST', body: '{}' }),
};
