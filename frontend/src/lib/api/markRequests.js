// D6205 (#6205) — an investor's requests to HQ for a mark, a correction or a
// missing follow-on round on a company they hold, and HQ's answer. Worker:
// routes/mark_requests.ts (/api/mark-requests).
// D6909 (#6909): optional evidence on a request (a link or one file), HQ's
// queue across companies oldest first, and the evidence file's download.
// D6909 part 4: Eadwyn's drafts (`/api/mark-requests/drafts/*`): the investor's reason ({ kind: 'reason', project_uid,
// request_kind }) and HQ's basis and source on a request ({ kind: 'basis', request_uid }), never a value. Quoted first.
import { rawRequestHeaders, refusalError, request } from '../api.js';

// A binary answer `request()` would parse as JSON, so it is fetched here with exactly the headers `request()` sends (D717).
async function download(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: rawRequestHeaders('GET') });
  if (!res.ok) throw await refusalError(res, 'The evidence file could not be downloaded.');
  const blob = await res.blob();
  if (!blob || !blob.size) throw new Error('The file came back empty.');
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || null;
  return { blob, filename };
}

export const markRequestsApi = {
  // The caller's own requests, newest first; an admin reads every one. `state`: open | resolved | declined.
  // `projectUid` narrows to one company (D6205 part 2: the admin position sheet).
  list: ({ state, projectUid } = {}) => {
    const q = new URLSearchParams();
    if (state) q.set('state', state);
    if (projectUid) q.set('project_uid', projectUid);
    const s = q.toString();
    return request(`/mark-requests${s ? `?${s}` : ''}`);
  },
  // { project_uid, kind: 'mark' | 'correction' | 'follow_on', reason, evidence_url? }. 409 `request_open` carries the open one.
  // D6909: `evidenceFile` (PDF, PNG, JPEG or WebP, at most 10 MB) goes as a multipart form; a link or a file, never both.
  create: ({ projectUid, kind, reason, evidenceUrl, evidenceFile } = {}) => {
    if (evidenceFile) {
      const fd = new FormData();
      fd.append('project_uid', String(projectUid ?? ''));
      fd.append('kind', String(kind ?? ''));
      fd.append('reason', String(reason ?? ''));
      fd.append('evidence_file', evidenceFile, evidenceFile.name || 'evidence');
      return request('/mark-requests', { method: 'POST', body: fd });
    }
    return request('/mark-requests', {
      method: 'POST',
      body: JSON.stringify({ project_uid: projectUid, kind, reason, ...(evidenceUrl ? { evidence_url: evidenceUrl } : {}) }),
    });
  },
  // D6909, admin: every open request across companies, oldest first, each with its company's latest mark.
  queue: () => request('/mark-requests/queue'),
  // D6909: the request's evidence file, to the investor who asked or HQ. Resolves { blob, filename }.
  downloadEvidence: (uid) => download(`/mark-requests/${encodeURIComponent(uid)}/evidence`),
  // D6909 part 4: quote → { quote: { hold_microusd, model, confirm_quote } }; run (+ confirm_quote) → { draft | null, cost }.
  draftQuote: (scope) => request('/mark-requests/drafts/quote', { method: 'POST', body: JSON.stringify(scope) }),
  draftRun: (scope, confirmQuote) => request('/mark-requests/drafts/run', { method: 'POST', body: JSON.stringify({ ...scope, confirm_quote: confirmQuote }) }),
  // Accept writes the draft only → { draft, kept }. `edit` is { reason } or { basis?, source?, as_of_date? }.
  draftAccept: (uid, scope, edit = {}) => request(`/mark-requests/drafts/${encodeURIComponent(uid)}/accept`, { method: 'POST', body: JSON.stringify({ ...scope, ...edit }) }),
  draftDiscard: (uid, scope) => request(`/mark-requests/drafts/${encodeURIComponent(uid)}/discard`, { method: 'POST', body: JSON.stringify(scope) }),
  // Admin: { state: 'resolved' | 'declined', mark_uid?, note? }.
  answer: (uid, { state, markUid, note } = {}) => request(`/mark-requests/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ state, mark_uid: markUid ?? null, note: note ?? null }),
  }),
};
