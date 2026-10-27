import { request } from '../api.js';

const query = (projectId, { limit, offset } = {}) => new URLSearchParams({ project: String(projectId), ...(limit != null ? { limit: String(limit) } : {}), ...(offset != null ? { offset: String(offset) } : {}) });
export const raiseEvidenceApi = {
  read: (projectId, page) => request(`/cycles/raise/evidence?${query(projectId, page)}`),
  refresh: (projectId, page) => request(`/cycles/raise/evidence/refresh?${query(projectId, page)}`, { method: 'POST' }),
  accept: (projectId, id, snapshotHash) => request(`/cycles/raise/evidence/items/${encodeURIComponent(id)}/accept?${query(projectId)}`, { method: 'POST', body: JSON.stringify({ snapshot_hash: snapshotHash }) }),
  dismiss: (projectId, id) => request(`/cycles/raise/evidence/items/${encodeURIComponent(id)}/dismiss?${query(projectId)}`, { method: 'POST' }),
  update: (projectId, id, version, body) => request(`/cycles/raise/evidence/items/${encodeURIComponent(id)}?${query(projectId)}`, { method: 'PATCH', body: JSON.stringify({ ...body, version }) }),
  link: (projectId, claimId, itemId, itemVersion, proposalUid) => request(`/cycles/raise/evidence/claims/${encodeURIComponent(claimId)}/link?${query(projectId)}`, { method: 'POST', body: JSON.stringify({ item_id: itemId, item_version: itemVersion, ...(proposalUid != null ? { proposal_uid: proposalUid } : {}) }) }),
  unlink: (projectId, claimId, itemId) => request(`/cycles/raise/evidence/claims/${encodeURIComponent(claimId)}/link?${query(projectId)}`, { method: 'DELETE', body: JSON.stringify({ item_id: itemId }) }),
  // D1265 (#3288): the investor's read — coverage before the NDA, shared items after it.
  shared: (projectUid) => request(`/data-room/shared/${encodeURIComponent(projectUid)}/evidence`),
  forDeal: (dealId) => request(`/deals/${encodeURIComponent(dealId)}/evidence`),
};
