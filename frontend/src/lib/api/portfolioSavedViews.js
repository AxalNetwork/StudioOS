/** D6209: private saved Portfolio table settings; data access remains on each table's read. */
import { request } from '../api.js';
export const portfolioSavedViewsApi = {
  list: page => request(`/portfolio-saved-views?page=${encodeURIComponent(page)}`),
  create: body => request('/portfolio-saved-views', { method: 'POST', body: JSON.stringify(body) }),
  rename: (uid, version, name) => request(`/portfolio-saved-views/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ name, version }) }),
  remove: (uid, version) => request(`/portfolio-saved-views/${encodeURIComponent(uid)}?${new URLSearchParams({ version: String(version) })}`, { method: 'DELETE' }),
};
