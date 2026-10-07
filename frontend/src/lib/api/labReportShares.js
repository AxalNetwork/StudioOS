// D588 — a founder shares one official scoring run with one named account.
// The token comes back once, on create. Worker: routes/lab_report_shares.ts.
import { request } from '../api.js';

export const labReportSharesApi = {
  create: (body) => request('/lab-report-shares', { method: 'POST', body: JSON.stringify(body) }),
  list: (projectId) => request(`/lab-report-shares?project_id=${encodeURIComponent(projectId)}`),
  revoke: (id) => request(`/lab-report-shares/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  open: (token) => request(`/lab-report-shares/open/${encodeURIComponent(token)}`),
};
