// D1147: preview is transient; only Keep saves the signed reading.
import { request } from '../api.js';
const query = project => new URLSearchParams({ project: String(project) });
export const pmfExplainApi = {
  read: project => request(`/cycles/raise/pmf/explain?${query(project)}`),
  preview: (project, mode, headers) => request(`/cycles/raise/pmf/explain?${query(project)}`, { method: 'POST', headers, body: JSON.stringify({ mode }) }),
  keep: (project, receipt) => request(`/cycles/raise/pmf/explain/keep?${query(project)}`, { method: 'POST', body: JSON.stringify({ receipt }) }),
};
