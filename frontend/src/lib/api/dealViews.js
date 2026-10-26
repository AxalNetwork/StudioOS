import { request } from '../api.js';

const requireVersion = (version) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Refresh this view before changing it.');
  return version;
};

const contextQuery = (context) => {
  if (context === undefined) return {};
  if (!['unbound', 'archived'].includes(context)) throw new Error('The view context is invalid.');
  return { context };
};
const viewPath = (path, query) => {
  const params = new URLSearchParams(query).toString();
  return `/deals/views${path}${params ? `?${params}` : ''}`;
};

/** D1239: saved settings never confer deal access; fit always uses my thesis. */
export const dealViewsApi = {
  list: ({ limit, offset, context } = {}) => request(viewPath('', { ...(limit != null ? { limit: String(limit) } : {}), ...(offset != null ? { offset: String(offset) } : {}), ...contextQuery(context) })),
  create: (body, { context } = {}) => request(viewPath('', contextQuery(context)), { method: 'POST', body: JSON.stringify(body) }),
  update: (uid, version, body, { context } = {}) => request(viewPath(`/${encodeURIComponent(uid)}`, contextQuery(context)), { method: 'PATCH', body: JSON.stringify({ ...body, version: requireVersion(version) }) }),
  remove: (uid, version, { context } = {}) => request(viewPath(`/${encodeURIComponent(uid)}`, { version: requireVersion(version), ...contextQuery(context) }), { method: 'DELETE' }),
  fit: (ids) => request(`/deals/fit?${new URLSearchParams({ ids: ids.join(',') })}`),
};
