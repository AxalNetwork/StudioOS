/**
 * D6864 (#6864): Raise evidence shared outside Axal. The founder's pack links (`/api/cycles/raise/evidence/share-links`),
 * evidence added by hand (`POST /api/cycles/raise/evidence/items`), and the reader's public page (`/api/share/evidence/:token`).
 * Making a link sends nothing; the founder copies the address the Worker returns.
 */
import { request } from '../api.js';

const q = (projectId) => `project=${encodeURIComponent(String(projectId))}`;
export const raiseEvidenceShareApi = {
  links: (projectId) => request(`/cycles/raise/evidence/share-links?${q(projectId)}`),
  create: (projectId, body) => request(`/cycles/raise/evidence/share-links?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  revoke: (projectId, uid) => request(`/cycles/raise/evidence/share-links/${encodeURIComponent(uid)}/revoke?${q(projectId)}`, { method: 'POST', body: '{}' }),
  addTyped: (projectId, body) => request(`/cycles/raise/evidence/items?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** The public read: no sign-in, no cookies, no auth headers. Answers `{ status, body }`, a refusal included. */
  async openShared(token, fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
    if (!fetchImpl) return { status: 0, body: null };
    const res = await fetchImpl(`/api/share/evidence/${encodeURIComponent(token)}`, { credentials: 'omit', headers: { Accept: 'application/json' } });
    let body = null; try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  },
};
