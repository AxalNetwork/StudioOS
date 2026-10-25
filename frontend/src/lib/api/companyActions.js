import { request } from '../api.js';

// D1135 — self-service company membership and venture restoration.
export const companyActionsApi = {
  leave: (uid) => request(`/company/${encodeURIComponent(uid)}/leave`, { method: 'POST' }),
  restoreProject: (id) => request(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
};
