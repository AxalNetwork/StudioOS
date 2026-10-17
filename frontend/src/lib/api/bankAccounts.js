// D708 (#1773) — each Axal entity's bank accounts, for the Super Admin on HQ,
// and an LP's own wire details for one open Fund I line. Lists are masked;
// `reveal` and `linePayInstructions` return one full number each, recorded by
// the Worker before it decrypts. Never store what they return.
// Worker: routes/admin_bank_accounts.ts and routes/funds.ts.
import { request } from '../api.js';

const account = (uid) => `/admin/bank-accounts/${encodeURIComponent(uid)}`;

export const bankAccountsApi = {
  list: () => request('/admin/bank-accounts'),
  add: (body) => request('/admin/bank-accounts', { method: 'POST', body: JSON.stringify(body) }),
  /** The label and the purposes only; any other field is refused. */
  update: (uid, { label, purposes } = {}) => request(account(uid), {
    method: 'PATCH',
    body: JSON.stringify({
      ...(label !== undefined ? { label } : {}),
      ...(purposes !== undefined ? { purposes } : {}),
    }),
  }),
  retire: (uid, reason) => request(`${account(uid)}/retire`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reveal: (uid, reason) => request(`${account(uid)}/reveal`, { method: 'POST', body: JSON.stringify({ reason }) }),
  linePayInstructions: (fundId, lineId) => request(
    `/funds/${encodeURIComponent(fundId)}/capital-calls/lines/${encodeURIComponent(lineId)}/pay-instructions`,
  ),
};
