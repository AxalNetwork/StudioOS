import { request } from '../api.js';

// D6862 (#6862, D6021 V19/V20) — named shares of one given Validate decision
// (`routes/verdict_shares.ts`). The venture's founder lists, grants and
// revokes; a named Operating Partner or investor reads the one decision
// shared with them. `project` and `decision` are ids.
const scope = (project, decision) => `?project=${encodeURIComponent(project)}&decision=${encodeURIComponent(decision)}`;

export const decisionSharesApi = {
  list: (project, decision) => request(`/cycles/validate/decision-shares${scope(project, decision)}`),
  candidates: (project, decision) => request(`/cycles/validate/decision-shares/candidates${scope(project, decision)}`),
  grant: (project, decision, body) => request(`/cycles/validate/decision-shares${scope(project, decision)}`, { method: 'POST', body: JSON.stringify(body) }),
  revoke: (project, decision, uid) => request(`/cycles/validate/decision-shares/${encodeURIComponent(uid)}/revoke${scope(project, decision)}`, { method: 'POST' }),
  received: (decision) => request(`/shared-decisions/${encodeURIComponent(decision)}`),
};
