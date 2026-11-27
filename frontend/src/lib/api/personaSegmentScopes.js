/** D4438 (#4438) — Super Admin's SEG7 registry scopes, scoped overview and open suggestion inset. */
import { request } from '../api.js';
const base = '/admin/persona-segment-scopes';
const query = (scope) => `?scope=${encodeURIComponent(scope || 'hq')}`;
export const personaSegmentScopesApi = {
  scopes: () => request(base),
  overview: (scope = 'hq') => request(`${base}/overview${query(scope)}`),
  suggestions: (scope = 'hq') => request(`${base}/suggestions${query(scope)}`),
};
