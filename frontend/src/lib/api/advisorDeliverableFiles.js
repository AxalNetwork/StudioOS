import { rawRequestHeaders, refusalError, request } from '../api.js';

/**
 * #5961 (D4833-p3): a deliverable version's stored file, both ways (`routes/advisors_deliverables.ts`, D5960).
 *
 * The JSON writes stay where they were (`api.createMyAdvisorDeliverable`, `api.addMyAdvisorDeliverableVersion`,
 * which carry `version_summary` as any other field, D5959). `api.js` is a frozen hub (D5615), so the file half
 * lives here:
 *
 * createWithFile(body, file)          POST /advisors/me/deliverables, multipart: v1 with its file
 * addVersionWithFile(id, body, file)  POST /advisors/me/deliverables/:id/versions, multipart
 *   body is { summary, version_summary?, title?, client_name?, engagement_id? }; never `link_url` (a version's
 *   document is a link or a file, 422 `two_documents`). The Worker refuses a file over 10 MB (413
 *   `file_too_large`) or that is not a PDF, JPEG or PNG by its bytes (400 `file_type_invalid`), storing nothing;
 *   the thrown error's message is its sentence.
 * downloadVersionFile(id, version)    GET /advisors/me/deliverables/:id/versions/:version/file (the advisor's own)
 * downloadReceivedFile(uid)           GET /advisors/received/deliverables/:uid/file (the recipient's)
 *   -> { blob, filename }. A refusal, or a body that came back empty, throws: never an empty file.
 */
function versionForm(body, file) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(body || {})) {
    if (value == null || value === '') continue;
    fd.append(key, String(value));
  }
  fd.append('file', file, file?.name || 'document');
  return fd;
}

// A binary answer `request()` would parse as JSON, so it is fetched here with exactly the headers `request()` sends (D717).
async function download(path) {
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: rawRequestHeaders('GET') });
  if (!res.ok) throw await refusalError(res, 'The file could not be downloaded.');
  const blob = await res.blob();
  if (!blob || !blob.size) throw new Error('The file came back empty.');
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || null;
  return { blob, filename };
}

export const advisorDeliverableFilesApi = {
  createWithFile: (body, file) =>
    request('/advisors/me/deliverables', { method: 'POST', body: versionForm(body, file) }),
  addVersionWithFile: (id, body, file) =>
    request(`/advisors/me/deliverables/${id}/versions`, { method: 'POST', body: versionForm(body, file) }),
  downloadVersionFile: (id, version) =>
    download(`/advisors/me/deliverables/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/file`),
  downloadReceivedFile: (uid) => download(`/advisors/received/deliverables/${encodeURIComponent(uid)}/file`),
};
