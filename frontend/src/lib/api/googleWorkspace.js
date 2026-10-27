import { request } from '../api.js';
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
const base = '/connectors/google-workspace';
const q = (project) => new URLSearchParams({ project: String(project) }).toString();
export const googleWorkspace = {
  pickerConfig: (project) => request(`${base}/picker-config?project=${encodeURIComponent(project)}`),
  connect: (project, enableCompany = false) => post('/calendar/google/workspace-files/connect', { project, enable_company: enableCompany }),
  files: (project) => request(`${base}/files?project=${encodeURIComponent(project)}`),
  choose: (project, module, ids) => post(`${base}/files`, { project, module, ids }),
  mapping: (uid, mapping) => request(`${base}/files/${encodeURIComponent(uid)}/mapping`, { method: 'PUT', body: JSON.stringify({ mapping }) }),
  stop: (uid) => request(`${base}/files/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  preview: (uid) => post(`${base}/files/${encodeURIComponent(uid)}/preview`, {}),
  // D1092 (#2957): From Google on Validate (`routes/cycle_validate.ts`), the venture in the query.
  validate: {
    sync: (project) => post(`/cycles/validate/google/sync?${q(project)}`, {}),
    previewForm: (project, uid, mapping) => post(`/cycles/validate/google/forms/${encodeURIComponent(uid)}/preview?${q(project)}`, { mapping }),
    accept: (project, id, body) => post(`/cycles/validate/google/proposals/${encodeURIComponent(id)}/accept?${q(project)}`, body),
    dismiss: (project, id) => post(`/cycles/validate/google/proposals/${encodeURIComponent(id)}/dismiss?${q(project)}`, {}),
    deleteFact: (project, id) => request(`/cycles/validate/google/facts/${encodeURIComponent(id)}?${q(project)}`, { method: 'DELETE' }),
  },
};
