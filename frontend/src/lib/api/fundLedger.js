/** D628: a fund's ledger reads (`/api/fund-ledger`): the funds the caller administers, and one fund's ledger for a period. */
import { request } from '../api.js';
export const fundLedgerApi = {
  list: () => request('/fund-ledger'),
  read: (id, periodId) => request(`/fund-ledger/${id}${periodId ? `?period_id=${periodId}` : ''}`),
  /** D4812 part 3: assign (or, with null, remove) the fund's ledger administrator — the Super Admin's act. */
  setAdministrator: (id, userId) => request(`/fund-ledger/${id}/administrator`, { method: 'PUT', body: JSON.stringify({ user_id: userId }) }),
};
