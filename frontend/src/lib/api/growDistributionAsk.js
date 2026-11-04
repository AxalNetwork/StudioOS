/** D4488 (#4488): Distribution Ask quotes, proposals and decisions; no send or campaign client. */
import { request } from '../api.js';
const root = '/grow/distribution/ask';
const post = (path, body) => request(`${root}${path}`, { method: 'POST', body: JSON.stringify(body) });
export const growDistributionAsk = {
  quote: (body) => post('/quote', body),
  run: (body) => post('/run', body),
  proposals: (project, campaignUid) => request(`${root}/proposals?${new URLSearchParams({ project: String(project), ...(campaignUid ? { campaign_uid: campaignUid } : {}) })}`),
  decide: (uid, body) => post(`/${encodeURIComponent(uid)}/decide`, body),
  acceptSafe: (body) => post('/accept-safe', body),
};
