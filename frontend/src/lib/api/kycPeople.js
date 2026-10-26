// D1229 (#3237, KYC part 1) — HQ's people queue and one person's case, beside
// the older `kycAdmin*` calls in api.js that D648's console still uses:
//   GET   /api/kyc/admin/people?status=&q=&id_type=&country=&flag=&assignee=&sort=&dir=&page=&page_size=
//         → { rows, total, page, page_size, counts } (KYC1, KYC2)
//   GET   /api/kyc/admin/figures → decisions per week, the median, the wait bands (KYC3)
//   GET   /api/kyc/admin/:userId/case → assignee, history, notes, documents (KYC5)
//   PATCH /api/kyc/admin/:userId/assign { assignee_id | null }
//   POST  /api/kyc/admin/:userId/notes { body }
//   PATCH /api/kyc/admin/:userId/needs-info { message }   (step-up)
//   PATCH /api/kyc/admin/:userId/recheck { message }      (step-up)
//   PATCH /api/kyc/admin/:userId/approve { note? }        (step-up)
//   GET   /api/kyc/admin/:userId/documents/:docId → one document's bytes (D1233's viewer)
//   GET   /api/kyc/admin/:userId/document         → the single document the older form stored
// Each read is logged by the Worker.
import { request, refusalError, rawRequestHeaders, armDeadline, timeoutError, DEFAULT_TIMEOUT_MS } from '../api.js';

const one = (userId) => `/kyc/admin/${encodeURIComponent(userId)}`;
const QUERY_KEYS = ['status', 'q', 'id_type', 'country', 'flag', 'assignee', 'sort', 'dir', 'page', 'page_size'];

/** The queue's query string, with only the keys the Worker reads and no empty values. */
export function kycPeopleQuery(params = {}) {
  const q = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = params[k];
    if (v != null && String(v).trim() !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * D1233 (#3241) — one document for the viewer inside the page (KYC4). Binary,
 * so a raw `fetch` with `request()`'s headers (`rawRequestHeaders`), as
 * `contracts.js` does; no object URL is made here and nothing opens a tab.
 *
 * Cloudflare Access may stand in front of the documents. Its answer is not
 * the Worker's: a redirect to the sign-in page, a 403 `cf_access_required`
 * from `middleware/cfAccess.ts`, or an HTML page where a document should be.
 * Each becomes `code: 'access_required'` so the viewer can say what is needed
 * (KYC4b). `docId` null reads the older single document.
 */
async function documentBlob(userId, docId = null, { signal } = {}) {
  const path = docId == null
    ? `/api${one(userId)}/document`
    : `/api${one(userId)}/documents/${encodeURIComponent(docId)}`;
  return fetchKycDocument(path, { signal });
}

/** D1234: the same binary read for any KYC document path (a business's too, `kybApi.documentBlob`). */
export async function fetchKycDocument(path, { signal } = {}) {
  const deadline = armDeadline(DEFAULT_TIMEOUT_MS, signal);
  const access = () => { const e = new Error('Your HQ staff sign-in is needed to open this document.'); e.code = 'access_required'; return e; };
  try {
    const res = await fetch(path, { credentials: 'include', redirect: 'manual', headers: rawRequestHeaders('GET'), signal: deadline.signal });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw access();
    if (!res.ok) {
      const e = await refusalError(res, 'The document could not be read.');
      if (e.code === 'cf_access_required') throw access();
      throw e;
    }
    const type = res.headers.get('content-type') || '';
    if (/text\/html/i.test(type)) throw access();
    return { blob: await res.blob(), type };
  } catch (e) {
    if (deadline.timedOut()) throw timeoutError(path, DEFAULT_TIMEOUT_MS, 'GET');
    throw e;
  } finally {
    deadline.cleanup();
  }
}

export const kycPeopleApi = {
  documentBlob,
  people: (params) => request(`/kyc/admin/people${kycPeopleQuery(params)}`),
  figures: () => request('/kyc/admin/figures'),
  caseOf: (userId) => request(`${one(userId)}/case`),
  assign: (userId, assigneeId) => request(`${one(userId)}/assign`, { method: 'PATCH', body: JSON.stringify({ assignee_id: assigneeId ?? null }) }),
  addNote: (userId, body) => request(`${one(userId)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  needsInfo: (userId, message) => request(`${one(userId)}/needs-info`, { method: 'PATCH', body: JSON.stringify({ message }) }),
  recheck: (userId, message) => request(`${one(userId)}/recheck`, { method: 'PATCH', body: JSON.stringify({ message }) }),
  approve: (userId, note) => request(`${one(userId)}/approve`, { method: 'PATCH', body: JSON.stringify(note ? { note } : {}) }),
};
