// D5456 (#5456, ADP-02) — private deal preparations for platform admins: the queue, one draft's authoring view,
// its revision list, create and versioned save. Worker: routes/admin_deal_preparations.ts. Create and save answer
// 403 `preparation_mutations_disabled` until ADP-02 enables them (D5454). Every save names the revision it started
// from and an operation key; retry a lost response with the SAME key to learn its outcome.
import { request } from '../api.js';

const qs = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminDealPreparationsApi = {
  queue: ({ state, limit, cursor } = {}) => request(`/admin/deals${qs({ state, limit, cursor })}`),
  get: (uid) => request(`/admin/deals/${encodeURIComponent(uid)}`),
  revisions: (uid, { before, limit } = {}) => request(`/admin/deals/${encodeURIComponent(uid)}/revisions${qs({ before, limit })}`),
  create: ({ companyId, projectId, operationKey, newRound, content } = {}) => request('/admin/deals', {
    method: 'POST',
    body: JSON.stringify({ company_id: companyId, project_id: projectId, operation_key: operationKey, new_round: newRound, content }),
  }),
  save: (uid, { expectedRevision, operationKey, changes } = {}) => request(`/admin/deals/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expected_revision: expectedRevision, operation_key: operationKey, changes }),
  }),
};
