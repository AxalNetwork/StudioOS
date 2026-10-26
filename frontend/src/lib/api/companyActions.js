import { request } from '../api.js';

const body = (data) => ({ method: 'POST', body: JSON.stringify(data) });

// D1135 — self-service company membership and venture restoration.
// D1137 — a company's lifecycle (archive, restore, transfer of the primary
// admin) and a venture's company and owner (move, transfer); D1139 draws
// their dialogs in Account › Companies and projects.
export const companyActionsApi = {
  leave: (uid) => request(`/company/${encodeURIComponent(uid)}/leave`, { method: 'POST' }),
  restoreProject: (id) => request(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  archive: (uid) => request(`/company/${encodeURIComponent(uid)}/archive`, { method: 'POST' }),
  restore: (uid) => request(`/company/${encodeURIComponent(uid)}/restore`, { method: 'POST' }),
  transferAdmin: (uid, { user_id, demote = false }) => request(`/company/${encodeURIComponent(uid)}/transfer`, body({ user_id, demote })),
  moveProject: (id, { company_id }) => request(`/projects/${encodeURIComponent(id)}/move`, body({ company_id })),
  transferProject: (id, { user_id }) => request(`/projects/${encodeURIComponent(id)}/transfer`, body({ user_id })),
};
