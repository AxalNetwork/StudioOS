/** Search Console property selection, explicit sync and stored results (#5841); routes/search_console.ts. */
import { request } from '../api.js';
export const searchConsoleApi = {
  properties: project => request(`/search-console/properties?${new URLSearchParams({ project: String(project) })}`),
  results: project => request(`/search-console/results?${new URLSearchParams({ project: String(project) })}`),
  select: (project, site_url) => request('/search-console/property', { method: 'PUT', body: JSON.stringify({ project, site_url }) }),
  check: project => request('/search-console/property/check', { method: 'POST', body: JSON.stringify({ project }) }),
  sync: project => request('/search-console/sync', { method: 'POST', body: JSON.stringify({ project }) }),
};
