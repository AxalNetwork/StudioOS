// D647: mounted admin_contracts routes. Auth and step-up use the shared client.
import { request } from '../api.js';
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
};
