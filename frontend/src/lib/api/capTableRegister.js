// D1020/D1026 — a venture's recorded register: the CSV export and the PDF
// snapshot filed to the data room. Each writes its own audit row on the Worker.
// Worker: routes/captable.ts (`/register/:projectId/…`).
import { api, request } from '../api.js';

export const capTableRegisterApi = {
  exportCsv: (projectId) => api._downloadCsv(`/captable/register/${encodeURIComponent(projectId)}/export.csv`, 'cap-table.csv'),
  snapshot: (projectId) => request(`/captable/register/${encodeURIComponent(projectId)}/snapshot`, { method: 'POST' }),
  // The venture's register read, with Carta's connection state for it (D1020 §3).
  live: (projectId) => request(`/captable/live?project_id=${encodeURIComponent(projectId)}`),
  // Name the venture a founder's Carta connection is the record for; null makes its rows account-level again.
  cartaVenture: (projectId) => request('/captable/carta/venture', { method: 'PUT', body: JSON.stringify({ project_id: projectId }) }),
};
