// D840 part 4 (#2349) — an investor's own Mercury feeds their sections:
// capacity beside their commitments, and proposals for Closing, Calls,
// Accounting and Reporting that write nothing until they accept. Read-only:
// nothing here moves money. Every figure is the caller's own.
// Worker: routes/mercury_investor.ts.
import { request } from '../api.js';

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export const mercuryInvestorApi = {
  feeds: () => request('/mercury/investor'),
  accounts: () => request('/mercury/investor/accounts'),
  capacity: () => request('/mercury/investor/commit'),
  setCapacity: (account_ids) => request('/mercury/investor/commit', { method: 'POST', body: JSON.stringify({ account_ids }) }),
  deleteCapacity: () => request('/mercury/investor/commit', { method: 'DELETE' }),
  sync: ({ section, fund_id, account_ids, from, to }) => request('/mercury/investor/sync', {
    method: 'POST',
    body: JSON.stringify({ section, fund_id, account_ids, from, to }),
  }),
  proposals: (kind, fundId) => request(`/mercury/investor/proposals${q({ kind, fund_id: fundId })}`),
  accept: (uid, body = {}) => request(`/mercury/investor/proposals/${encodeURIComponent(uid)}/accept`, { method: 'POST', body: JSON.stringify(body) }),
  dismiss: (uid) => request(`/mercury/investor/proposals/${encodeURIComponent(uid)}/dismiss`, { method: 'POST' }),
  reporting: (fundId) => request(`/mercury/investor/reporting${q({ fund_id: fundId })}`),
  deleteMonthEndCash: (id) => request(`/mercury/investor/reporting/cash/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  ledgerMap: (fundId) => request(`/mercury/investor/ledger/map${q({ fund_id: fundId })}`),
};
