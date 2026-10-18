// D713 (#1778) — a member's own read-only Mercury, for income and payment
// evidence only. A founder reads their project's credits and imports the ones
// they pick; a partner matches their own invoices, payouts and settlements to
// their own bank lines. Nothing here sends, transfers or requests money, and a
// candidate's counterparty name is shown to its owner only: never store it.
// Worker: routes/revenue.ts (credits, import) and routes/mercury_personal.ts.
import { request } from '../api.js';

const project = (id) => `/revenue/projects/${encodeURIComponent(id)}`;
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const mercuryPersonalApi = {
  /** The project's posted credits, each importable or listed with its reason. Writes nothing. */
  credits: (projectId, { from, to } = {}) => request(`${project(projectId)}/mercury-credits${qs({ from, to })}`),
  /** `items`: `[{ transaction_id, customer, revenue_type }]`, at most 200. Amount and date are Mercury's. */
  importCredits: (projectId, items) => request(`${project(projectId)}/entries/import-mercury`, {
    method: 'POST', body: JSON.stringify({ items }),
  }),
  /** `target`: `invoice`, `payout` or `settlement`. Open targets with their candidate lines, and confirmed matches. */
  matches: (target) => request(`/mercury/personal/matches${qs({ target })}`),
  confirm: ({ target_kind, target_id, transaction_id }) => request('/mercury/personal/matches', {
    method: 'POST', body: JSON.stringify({ target_kind, target_id, transaction_id }),
  }),
  /** `reason`: at least 10 characters. */
  withdraw: (uid, reason) => request(`/mercury/personal/matches/${encodeURIComponent(uid)}/withdraw`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
};
