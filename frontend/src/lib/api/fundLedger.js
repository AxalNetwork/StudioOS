/** D628: a fund's ledger reads (`/api/fund-ledger`): the funds the caller administers, and one fund's ledger for a period. */
import { request } from '../api.js';
export const fundLedgerApi = {
  list: () => request('/fund-ledger'),
  read: (id, periodId) => request(`/fund-ledger/${id}${periodId ? `?period_id=${periodId}` : ''}`),
};
