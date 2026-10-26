import { request } from '../api.js';

/** D1239: saved settings never confer deal access; fit always uses my thesis. */
export const dealViewsApi = {
  list: ({ limit, offset } = {}) => request(`/deals/views?${new URLSearchParams({ ...(limit != null ? { limit: String(limit) } : {}), ...(offset != null ? { offset: String(offset) } : {}) })}`),
  create: (body) => request('/deals/views', { method: 'POST', body: JSON.stringify(body) }),
  update: (uid, body) => request(`/deals/views/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (uid) => request(`/deals/views/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  fit: (ids) => request(`/deals/fit?${new URLSearchParams({ ids: ids.join(',') })}`),
};
