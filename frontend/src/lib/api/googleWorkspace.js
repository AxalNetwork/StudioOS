import { request } from '../api.js';
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
const base = '/connectors/google-workspace';
export const googleWorkspace = {
  pickerConfig: (project) => request(`${base}/picker-config?project=${encodeURIComponent(project)}`),
  connect: (project, enableCompany = false) => post('/calendar/google/workspace-files/connect', { project, enable_company: enableCompany }),
  files: (project) => request(`${base}/files?project=${encodeURIComponent(project)}`),
  choose: (project, module, ids) => post(`${base}/files`, { project, module, ids }),
  mapping: (uid, mapping) => request(`${base}/files/${encodeURIComponent(uid)}/mapping`, { method: 'PUT', body: JSON.stringify({ mapping }) }),
  stop: (uid) => request(`${base}/files/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  preview: (uid) => post(`${base}/files/${encodeURIComponent(uid)}/preview`, {}),
};
