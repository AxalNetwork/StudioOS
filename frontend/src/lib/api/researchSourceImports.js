// D7753 (#7753) — Research source imports: the Super Admin console's client for `/api/research-source-imports` (D7745).
// Every method is a route mounted by `cloudflare-worker/src/routes/research_source_imports.ts`. Reads are
// `requireSuperAdmin`; writes are `requireSuperAdminWriteBar`, so a lapsed step-up answers 403 `step_up_required`
// and `request` asks for it again. Record content travels only in POST bodies: no path or query here carries
// anything from the file, only the Worker's own run id and a page offset. `preview` writes nothing.
import { request } from '../api.js';

const pageOf = (offset) => (Number.isSafeInteger(offset) && offset > 0 ? `?offset=${offset}` : '');

export const researchSourceImportsApi = {
  /** POST /preview — `{ manifest, pages }`; per source new, unchanged, changed, removed. Writes nothing. */
  preview: (body) => request('/research-source-imports/preview', { method: 'POST', body: JSON.stringify(body) }),
  /** GET /runs — the 50 newest runs. */
  runs: () => request('/research-source-imports/runs'),
  /** GET /runs/:uid — one run: counts, held chunks, list digests and members in pages of 1,000. */
  run: (uid, offset) => request(`/research-source-imports/runs/${encodeURIComponent(uid)}${pageOf(offset)}`),
  /** POST /runs — open a run: `{ idempotency_key, manifest, column_classes, file_sha256 }`. */
  openRun: (body) => request('/research-source-imports/runs', { method: 'POST', body: JSON.stringify(body) }),
  /** POST /runs/:uid/chunks — `{ chunk_index, records }`, within the bound the open answered. */
  sendChunk: (uid, body) => request(`/research-source-imports/runs/${encodeURIComponent(uid)}/chunks`, { method: 'POST', body: JSON.stringify(body) }),
  /** POST /runs/:uid/seal — `{ expected }`; the read-back against the expected list. */
  seal: (uid, body) => request(`/research-source-imports/runs/${encodeURIComponent(uid)}/seal`, { method: 'POST', body: JSON.stringify(body) }),
  /** POST /runs/:uid/reconcile — `{ action: 'resume' | 'close' }`. */
  reconcile: (uid, body) => request(`/research-source-imports/runs/${encodeURIComponent(uid)}/reconcile`, { method: 'POST', body: JSON.stringify(body) }),
  /** POST /removals — `{ scope: 'private_fields' | 'record' | 'source', source_key, provider_record_id? }`. */
  remove: (body) => request('/research-source-imports/removals', { method: 'POST', body: JSON.stringify(body) }),
};
