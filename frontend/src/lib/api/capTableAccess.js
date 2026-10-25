// D1019/D1026 — who sees a venture's cap table: the caller's view at their
// level, an admin's support read, the grants, the access log, the share links
// by level, the public venture link, and HQ's log across companies.
// Worker: routes/captable_access.ts (mounted at /api/captable/access).
import { request } from '../api.js';

const base = (projectId) => `/captable/access/${encodeURIComponent(projectId)}`;
const json = (method, body) => ({ method, body: JSON.stringify(body || {}) });
const pageQuery = (before) => (before ? `?before=${encodeURIComponent(before)}` : '');

export const capTableAccessApi = {
  view: (projectId) => request(base(projectId)),
  support: (projectId, reason) => request(`${base(projectId)}/support`, json('POST', { reason })),
  grants: (projectId) => request(`${base(projectId)}/grants`),
  grant: (projectId, body) => request(`${base(projectId)}/grants`, json('PUT', body)),
  revokeGrant: (projectId, id) => request(`${base(projectId)}/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  log: (projectId, before) => request(`${base(projectId)}/log${pageQuery(before)}`),
  links: (projectId) => request(`${base(projectId)}/links`),
  createLink: (projectId, body) => request(`${base(projectId)}/links`, json('POST', body)),
  revokeLink: (projectId, id) => request(`${base(projectId)}/links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  shared: (token) => request(`/captable/access/shared/${encodeURIComponent(token)}`),
  hqLog: (before) => request(`/captable/access/log${pageQuery(before)}`),
};
