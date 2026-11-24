/** D7820 (#7820): the admin client for the Research › Companies review ledger (`routes/research_company_reviews.ts`). Admin only; no screen yet. */
import { request } from '../api.js';

const base = '/research/company-reviews';
export const researchCompanyReviewsApi = {
  /** Place, change or clear (`status: 'admitted'`) a status for up to 200 uids, all or nothing. */
  set: (body) => request(base, { method: 'POST', body: JSON.stringify(body) }),
  recordCheck: (body) => request(`${base}/checks`, { method: 'POST', body: JSON.stringify(body) }),
  holds: ({ status, page, pageSize } = {}) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (page) q.set('page', String(page));
    if (pageSize) q.set('page_size', String(pageSize));
    const s = q.toString();
    return request(s ? `${base}?${s}` : base);
  },
  history: (uid) => request(`${base}/${encodeURIComponent(uid)}/history`),
};
