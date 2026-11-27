import { api, request } from '../api.js';

/**
 * D712 (#1777) — the fund reporting queue (`/api/fund-reporting`): drafts an
 * Admin builds, reads, prepares and returns, and a Super Admin issues. A
 * draft's figures come only from `read`, which the Worker records before it
 * answers; the list never carries them.
 */
const uid = (value) => {
  if (!/^[0-9a-f]{32}$/.test(String(value))) throw new Error('Choose a draft from the reporting queue.');
  return String(value);
};
const query = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = q.toString();
  return s ? `?${s}` : '';
};
export const fundReportingApi = {
  list: (params) => request(`/fund-reporting/drafts${query(params)}`),
  read: (draftUid) => request(`/fund-reporting/drafts/${uid(draftUid)}`),
  exportCsv: (draftUid) => api._downloadCsv(`/fund-reporting/drafts/${uid(draftUid)}/export`, 'fund-report-draft.csv'),
  build: (body) => request('/fund-reporting/build', { method: 'POST', body: JSON.stringify(body) }),
  rebuild: (draftUid) => request(`/fund-reporting/drafts/${uid(draftUid)}/rebuild`, { method: 'POST' }),
  prepare: (draftUid, body) => request(`/fund-reporting/drafts/${uid(draftUid)}/prepare`, { method: 'POST', body: JSON.stringify(body) }),
  returnDraft: (draftUid, reason) => request(`/fund-reporting/drafts/${uid(draftUid)}/return`, { method: 'POST', body: JSON.stringify({ reason }) }),
  correct: (draftUid) => request(`/fund-reporting/drafts/${uid(draftUid)}/correct`, { method: 'POST' }),
  issue: (draftUid, body) => request(`/fund-reporting/drafts/${uid(draftUid)}/issue`, { method: 'POST', body: JSON.stringify(body) }),
};
