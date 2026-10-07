import { request } from '../api.js';
export const fundLedgerApi = {
  list: () => request('/fund-ledger'),
  read: (id, periodId) => request(`/fund-ledger/${id}${periodId ? `?period_id=${periodId}` : ''}`),
};
