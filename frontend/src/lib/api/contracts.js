// D647: mounted admin_contracts routes. Auth and step-up use the shared client.
import { request, refusalError, rawRequestHeaders, armDeadline, timeoutError, DEFAULT_TIMEOUT_MS } from '../api.js';
// D717 (#1853): the largest body render.pdf draws. Mirrors admin_contracts.ts's
// 256 KB limit, so an over-long draft is refused here without a request.
export const RENDER_BODY_MAX = 256 * 1024;
const BODY_TOO_LARGE = 'The body is over 256 KB, so it cannot be previewed.';

/**
 * The draft's real PDF from POST /templates/render.pdf, for the editor's Pages
 * view. Binary, so outside the typed drift surface (ROUTE_MAP.md); a raw
 * `fetch` that sends `request()`'s headers through `rawRequestHeaders`.
 * Resolves to `{ blob, renderer }`; no object URL is made.
 */
async function renderPdfBlob(body, { signal } = {}) {
  if (new TextEncoder().encode(body?.body || '').length > RENDER_BODY_MAX) {
    const e = new Error(BODY_TOO_LARGE);
    e.status = 413;
    e.code = 'body_too_large';
    throw e;
  }
  const path = '/api/admin/contracts/templates/render.pdf';
  const deadline = armDeadline(DEFAULT_TIMEOUT_MS, signal);
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...rawRequestHeaders('POST') },
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
    if (!res.ok) throw await refusalError(res, 'The pages could not be drawn.');
    return { blob: await res.blob(), renderer: res.headers.get('X-Axal-Renderer') };
  } catch (e) {
    if (deadline.timedOut()) throw timeoutError(path, DEFAULT_TIMEOUT_MS, 'POST');
    throw e;
  } finally {
    deadline.cleanup();
  }
}

const query = params => new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value !== '' && value != null)).toString();
export const contractsApi = {
  templates: () => request('/admin/contracts/templates/store?recorded=true'),
  agreements: params => request(`/admin/contracts?${query({ ...params, recorded: true })}`),
  stats: () => request('/admin/contracts/stats?recorded=true'),
  recipients: params => request(`/admin/contracts/recipients?${query(params)}`),
  deals: params => request(`/admin/contracts/deal-options?${query(params)}`),
  published: () => request('/admin/contracts/published-templates'),
  publish: () => request('/admin/contracts/published-templates/publish', { method: 'POST', body: JSON.stringify({}) }),
  providers: () => request('/admin/contracts/envelope-providers'),
  preview: body => request('/admin/contracts/envelopes/preview', { method: 'POST', body: JSON.stringify(body) }),
  send: body => request('/admin/contracts/envelopes/send', { method: 'POST', body: JSON.stringify(body) }),
  history: uid => request(`/admin/contracts/${encodeURIComponent(uid)}/history`),
  signedPdf: uid => request(`/admin/contracts/${encodeURIComponent(uid)}/signed-pdf`),
  // D711 (#1776): the envelope's recorded files; the template paper as HTML; its faces.
  files: uid => request(`/admin/contracts/${encodeURIComponent(uid)}/files`),
  renderPaper: body => request('/admin/contracts/templates/render', { method: 'POST', body: JSON.stringify(body) }),
  // D717 (#1853): the same draft as a PDF, for the editor's Pages view. Binary,
  // outside the typed drift surface (ROUTE_MAP.md); size-checked before any request.
  renderPdfBlob,
  paperFonts: () => request('/admin/contracts/templates/paper-fonts'),
  // D717 (#1782): publish one template at the version the editor saved, withdraw
  // its publication, push the recorded publications to every branch, and the
  // bundled documents not in the catalog.
  publishOne: (slug, version) => request(`/admin/contracts/published-templates/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: JSON.stringify({ version }) }),
  withdraw: slug => request(`/admin/contracts/published-templates/${encodeURIComponent(slug)}/withdraw`, { method: 'POST', body: JSON.stringify({}) }),
  push: () => request('/admin/contracts/published-templates/push', { method: 'POST', body: JSON.stringify({}) }),
  outside: () => request('/admin/contracts/templates/outside'),
};
