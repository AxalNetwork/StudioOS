// D647: mounted admin_contracts routes. Auth and step-up use the shared client.
import { request, refusalError } from '../api.js';
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
  paperFonts: () => request('/admin/contracts/templates/paper-fonts'),
  // D717 (#1782): publish one template at the version the editor saved, withdraw
  // its publication, push the recorded publications to every branch, and the
  // bundled documents not in the catalog.
  publishOne: (slug, version) => request(`/admin/contracts/published-templates/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: JSON.stringify({ version }) }),
  withdraw: slug => request(`/admin/contracts/published-templates/${encodeURIComponent(slug)}/withdraw`, { method: 'POST', body: JSON.stringify({}) }),
  push: () => request('/admin/contracts/published-templates/push', { method: 'POST', body: JSON.stringify({}) }),
  outside: () => request('/admin/contracts/templates/outside'),
  // D717 PR 2b: page 1 as a PNG (binary, outside the typed drift surface, like
  // preview.pdf). The URL names the version: the image is cached privately for a
  // day, so a save must change the URL. The route ignores the query.
  thumbnailBlob: (slug, version) => pngBlob(`/api/admin/contracts/templates/store/${encodeURIComponent(slug)}/thumbnail.png?v=${encodeURIComponent(version ?? '')}`),
  outsideThumbnailBlob: key => pngBlob(`/api/admin/contracts/templates/outside/${encodeURIComponent(key)}/thumbnail.png`),
};
// A refusal keeps its `code` and the Worker's sentence. The caller revokes `url`.
async function pngBlob(path) {
  const token = localStorage.getItem('token');
  const res = await fetch(path, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw await refusalError(res, 'Thumbnail not drawn.');
  const blob = await res.blob();
  return { blob, url: URL.createObjectURL(blob) };
}
