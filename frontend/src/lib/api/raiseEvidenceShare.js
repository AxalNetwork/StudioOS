/**
 * D6864 (#6864): Raise evidence shared outside Axal. The founder's pack links (`/api/cycles/raise/evidence/share-links`),
 * evidence added by hand (`POST /api/cycles/raise/evidence/items`), and the reader's public page (`/api/share/evidence/:token`).
 * Making a link sends nothing; the founder copies the address the Worker returns.
 * D6897 (#6897, RA-30): the readiness snapshot as a link (`POST /api/cycles/raise/readiness/share-links`), listed and
 * revoked with the packs, and its public page (`/api/share/readiness/:token`).
 * D6897 part 2 (RA-28 C, RA-30 B): either as a PDF copy (`POST …/evidence/pdf-copies`, `…/readiness/pdf-copies`), listed
 * on Shared links as `copies`: a copy cannot be stopped or counted.
 * D6897 part 3 (RA-27 A, RA-30): Eadwyn's drafts (`/api/cycles/raise/share-drafts`) — a pack selection for one reader and
 * the snapshot's covering line. Quoted first, run on the founder's press; accepting writes the draft only.
 * D6897 part 4 (RA-31): the Raise status page as a link (`POST …/status/share-links`) or a PDF copy
 * (`POST …/status/pdf-copies`), listed and revoked with the others, and its public page (`/api/share/status/:token`).
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
  /** D6897 part 4: the Raise status page. A link answers { uid, output: 'status', path, ... }; a copy answers { ..., status }. */
  createStatus: (projectId, body) => request(`/cycles/raise/status/share-links?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  createStatusPdf: (projectId, body) => request(`/cycles/raise/status/pdf-copies?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** D6897 part 3: the founder's latest draft of each kind. Answers { drafts: [{ uid, kind, status, audience, items, left_out, line }] }. */
  drafts: (projectId) => request(`/cycles/raise/share-drafts?${q(projectId)}`),
  /** { kind: 'pack', audience } or { kind: 'covering-line' } → { quote: { hold_microusd, model, confirm_quote } }. */
  quoteDraft: (projectId, body) => request(`/cycles/raise/share-drafts/quote?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** The same body plus the quote's `confirm_quote` → { draft | null, cost }. */
  runDraft: (projectId, body) => request(`/cycles/raise/share-drafts/run?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** Pack: → { draft, tick, dropped }. Covering line: { line? } (the founder's edit) → { draft, line }. Writes the draft only. */
  acceptDraft: (projectId, uid, body = {}) => request(`/cycles/raise/share-drafts/${encodeURIComponent(uid)}/accept?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  discardDraft: (projectId, uid) => request(`/cycles/raise/share-drafts/${encodeURIComponent(uid)}/discard?${q(projectId)}`, { method: 'POST', body: '{}' }),
  addTyped: (projectId, body) => request(`/cycles/raise/evidence/items?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** The public read: no sign-in, no cookies, no auth headers. Answers `{ status, body }`, a refusal included. */
  async openShared(token, fetchImpl = (typeof fetch === 'function' ? fetch : null), page = 'evidence') {
    if (!fetchImpl) return { status: 0, body: null };
    const res = await fetchImpl(`/api/share/${page === 'readiness' || page === 'status' ? page : 'evidence'}/${encodeURIComponent(token)}`, { credentials: 'omit', headers: { Accept: 'application/json' } });
    let body = null; try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  },
  /** The readiness snapshot's public read, on the same terms as `openShared`. */
  openReadiness(token, fetchImpl = (typeof fetch === 'function' ? fetch : null)) { return this.openShared(token, fetchImpl, 'readiness'); },
  /** The Raise status page's public read, on the same terms. */
  openStatus(token, fetchImpl = (typeof fetch === 'function' ? fetch : null)) { return this.openShared(token, fetchImpl, 'status'); },
};
