// D1017 — a venture's cap table record: what was issued (by holder, by class,
// outstanding, fully diluted), its proposals, history, share classes and
// currency, apart from the model a scenario computes. Worker: the
// `/record/:projectId` section of routes/captable.ts.
import { api, request } from '../api.js';

const base = (projectId) => `/captable/record/${encodeURIComponent(projectId)}`;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const capTableRecordApi = {
  read: (projectId) => request(base(projectId)),
  history: (projectId, { page = 1, pageSize } = {}) => {
    const q = new URLSearchParams({ page: String(page) });
    if (pageSize) q.set('page_size', String(pageSize));
    return request(`${base(projectId)}/history?${q}`);
  },
  propose: (projectId, body) => post(`${base(projectId)}/proposals`, body),
  accept: (projectId, uid, body) => post(`${base(projectId)}/proposals/${encodeURIComponent(uid)}/accept`, body),
  dismiss: (projectId, uid, body) => post(`${base(projectId)}/proposals/${encodeURIComponent(uid)}/dismiss`, body),
  record: (projectId, body) => post(`${base(projectId)}/issuances`, body),
  void: (projectId, uid, reason) => post(`${base(projectId)}/issuances/${encodeURIComponent(uid)}/void`, { reason }),
  // D1026 — a spreadsheet's rows as proposals (origin 'import'), never on the record.
  importRows: (projectId, body) => post(`${base(projectId)}/proposals/import`, body),
  // D1026 — the record and its history as one spreadsheet (CSV), audited on the Worker.
  exportCsv: (projectId) => api._downloadCsv(`${base(projectId)}/export.csv`, 'cap-table-record.csv'),
  createClass: (projectId, body) => post(`${base(projectId)}/classes`, body),
  updateClass: (projectId, uid, body) => request(`${base(projectId)}/classes/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify(body || {}),
  }),
  setCurrency: (projectId, currency, reason) => request(`${base(projectId)}/currency`, {
    method: 'PUT',
    body: JSON.stringify(reason ? { currency, reason } : { currency }),
  }),
};
