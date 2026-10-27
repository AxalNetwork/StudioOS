/**
 * D1319 (#3480, part 1 of #2400) — founder publishing, over `/api/publish`
 * (`cloudflare-worker/src/routes/publish.ts`). Nothing here sends on its own:
 * `confirm` is called only from the confirm dialog the founder presses
 * (part 3), with an idempotency key the dialog makes once.
 */
import { request } from '../api.js';

const enc = encodeURIComponent;
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
const post = (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const publishApi = {
  destinations: (project) => request(`/publish/destinations?${q({ project })}`),
  refreshDestinations: (integrationUid, project) => post(`/publish/destinations/refresh/${enc(integrationUid)}`, { project }),
  setDestination: (uid, project, body) => request(`/publish/destinations/${enc(uid)}?${q({ project })}`, { method: 'PUT', body: JSON.stringify(body) }),
  createDraft: (body) => post('/publish/drafts', body),
  draft: (uid) => request(`/publish/drafts/${enc(uid)}`),
  saveDraft: (uid, body) => request(`/publish/drafts/${enc(uid)}`, { method: 'PUT', body: JSON.stringify(body) }),
  archiveDraft: (uid) => request(`/publish/drafts/${enc(uid)}`, { method: 'DELETE' }),
  preview: (uid, destinationUids) => post(`/publish/drafts/${enc(uid)}/preview`, { destination_uids: destinationUids }),
  confirm: (uid, body) => post(`/publish/drafts/${enc(uid)}/confirm`, body),
  sends: (project, filters = {}) => request(`/publish/sends?${q({ project, module: filters.module, provider: filters.provider, status: filters.status })}`),
  send: (uid) => request(`/publish/sends/${enc(uid)}`),
  retry: (uid) => post(`/publish/sends/${enc(uid)}/retry`),
  check: (uid) => post(`/publish/sends/${enc(uid)}/check`),
  markNotSent: (uid) => post(`/publish/sends/${enc(uid)}/mark-not-sent`),
  retract: (uid, reason) => post(`/publish/sends/${enc(uid)}/retract`, { reason }),
  markRemoved: (uid) => post(`/publish/sends/${enc(uid)}/mark-removed`),
};
