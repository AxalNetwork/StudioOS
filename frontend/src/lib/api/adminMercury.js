// D715 (#1780) — the admin's Mercury, for the four Axal entity connections
// (D710, #1775): read the connections, connect or replace a Read Only token,
// disconnect with a reason, sync now, and read accounts, transactions and
// matches. #1779's console imports this module rather than adding its own.
// Nothing here sends, transfers, pays or wires: every route under
// /api/admin/mercury only reads Mercury (`mercury_read_only_d710`).
// Worker: routes/admin_mercury.ts.
import { request } from '../api.js';

const BASE = '/admin/mercury';
const entity = (key) => `${BASE}/connections/${encodeURIComponent(key)}`;
const match = (uid) => `${BASE}/matches/${encodeURIComponent(uid)}`;

/** A query string from the set values only. */
const query = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminMercuryApi = {
  /** The four entities, each with its connection (and its accounts by ending) or null. Audited. */
  connections: () => request(`${BASE}/connections`),
  /** Super Admin, behind the write bar: a Read Only token, confirmed as such. */
  connect: (entityKey, apiToken) => request(entity(entityKey), {
    method: 'PUT', body: JSON.stringify({ api_token: apiToken, confirm_read_only: true }),
  }),
  /** Super Admin, behind the write bar: a reason of at least ten characters. */
  disconnect: (entityKey, reason) => request(entity(entityKey), { method: 'DELETE', body: JSON.stringify({ reason }) }),
  /** Once in five minutes per connection. */
  sync: (entityKey) => request(`${entity(entityKey)}/sync`, { method: 'POST' }),
  accounts: ({ entity: key } = {}) => request(`${BASE}/accounts${query({ entity: key })}`),
  transactions: ({ entity: key, account, from, to, match: state, page } = {}) => request(
    `${BASE}/transactions${query({ entity: key, account, from, to, match: state, page })}`,
  ),
  matches: ({ state } = {}) => request(`${BASE}/matches${query({ state })}`),
  proposeMatch: ({ transaction_uid, target_kind, target_id }) => request(`${BASE}/matches`, {
    method: 'POST', body: JSON.stringify({ transaction_uid, target_kind, target_id }),
  }),
  confirmMatch: (uid) => request(`${match(uid)}/confirm`, { method: 'POST' }),
  rejectMatch: (uid, reason) => request(`${match(uid)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
