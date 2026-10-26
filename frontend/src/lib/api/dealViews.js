import { request } from '../api.js';

const requireVersion = (version) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Refresh this view before changing it.');
  return version;
};

/** D1239: saved settings never confer deal access; fit always uses my thesis. */
export const dealViewsApi = {
  list: ({ limit, offset } = {}) => request(`/deals/views?${new URLSearchParams({ ...(limit != null ? { limit: String(limit) } : {}), ...(offset != null ? { offset: String(offset) } : {}) })}`),
  create: (body) => request('/deals/views', { method: 'POST', body: JSON.stringify(body) }),
  update: (uid, version, body) => request(`/deals/views/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ ...body, version: requireVersion(version) }) }),
  remove: (uid, version) => request(`/deals/views/${encodeURIComponent(uid)}?version=${requireVersion(version)}`, { method: 'DELETE' }),
  fit: (ids) => request(`/deals/fit?${new URLSearchParams({ ids: ids.join(',') })}`),
};
