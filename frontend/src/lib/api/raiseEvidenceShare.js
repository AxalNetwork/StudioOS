/**
 * D6864 (#6864): Raise evidence shared outside Axal. The founder's pack links (`/api/cycles/raise/evidence/share-links`),
 * evidence added by hand (`POST /api/cycles/raise/evidence/items`), and the reader's public page (`/api/share/evidence/:token`).
 * Making a link sends nothing; the founder copies the address the Worker returns.
 * D6897 (#6897, RA-30): the readiness snapshot as a link (`POST /api/cycles/raise/readiness/share-links`), listed and
 * revoked with the packs, and its public page (`/api/share/readiness/:token`).
 * D6897 part 2 (RA-28 C, RA-30 B): either as a PDF copy (`POST …/evidence/pdf-copies`, `…/readiness/pdf-copies`), listed
 * on Shared links as `copies`: a copy cannot be stopped or counted.
 */
import { request } from '../api.js';

const q = (projectId) => `project=${encodeURIComponent(String(projectId))}`;
export const raiseEvidenceShareApi = {
  links: (projectId) => request(`/cycles/raise/evidence/share-links?${q(projectId)}`),
  create: (projectId, body) => request(`/cycles/raise/evidence/share-links?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  revoke: (projectId, uid) => request(`/cycles/raise/evidence/share-links/${encodeURIComponent(uid)}/revoke?${q(projectId)}`, { method: 'POST', body: '{}' }),
  createReadiness: (projectId, body) => request(`/cycles/raise/readiness/share-links?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** D6897 part 2: the same content as a PDF copy. Answers { uid, kind: 'pdf', ..., pack | snapshot }; the browser draws it. */
  createPackPdf: (projectId, body) => request(`/cycles/raise/evidence/pdf-copies?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  createReadinessPdf: (projectId, body) => request(`/cycles/raise/readiness/pdf-copies?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  addTyped: (projectId, body) => request(`/cycles/raise/evidence/items?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** The public read: no sign-in, no cookies, no auth headers. Answers `{ status, body }`, a refusal included. */
  async openShared(token, fetchImpl = (typeof fetch === 'function' ? fetch : null), page = 'evidence') {
    if (!fetchImpl) return { status: 0, body: null };
    const res = await fetchImpl(`/api/share/${page === 'readiness' ? 'readiness' : 'evidence'}/${encodeURIComponent(token)}`, { credentials: 'omit', headers: { Accept: 'application/json' } });
    let body = null; try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  },
  /** The readiness snapshot's public read, on the same terms as `openShared`. */
  openReadiness(token, fetchImpl = (typeof fetch === 'function' ? fetch : null)) { return this.openShared(token, fetchImpl, 'readiness'); },
};
