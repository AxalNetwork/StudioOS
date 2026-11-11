// D1019/D1026 — who sees a venture's cap table: the caller's view at their
// level, an admin's support read, the grants, the access log, the share links
// by level, the public venture link, HQ's log across companies, and (D1027) an
// investor's ask for access, stored as a request the founder approves or
// declines (D1130).
// Worker: routes/captable_access.ts (mounted at /api/captable/access).
import { request } from '../api.js';

const base = (projectId) => `/captable/access/${encodeURIComponent(projectId)}`;
const json = (method, body) => ({ method, body: JSON.stringify(body || {}) });
const pageQuery = (before) => (before ? `?before=${encodeURIComponent(before)}` : '');

export const capTableAccessApi = {
  view: (projectId) => request(base(projectId)),
  support: (projectId, reason) => request(`${base(projectId)}/support`, json('POST', { reason })),
  /** D1027 (CT15n): an investor not shared with asks the founder: `{ level?, note? }`. D1130 stores it. */
  ask: (projectId, body) => request(`${base(projectId)}/ask`, json('POST', body)),
  /** D1130: the pending asks, for the founders (`{ requests, can_change }`). */
  requests: (projectId) => request(`${base(projectId)}/requests`),
  /** D1130: the owner approves an ask at a level (the asked one when none is named). */
  approveRequest: (projectId, uid, level) => request(`${base(projectId)}/requests/${encodeURIComponent(uid)}/approve`, json('POST', level ? { level } : {})),
  /** D1130: the owner declines an ask; nothing is granted. */
  declineRequest: (projectId, uid) => request(`${base(projectId)}/requests/${encodeURIComponent(uid)}/decline`, json('POST')),
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
