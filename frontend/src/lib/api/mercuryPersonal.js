// D715 (#1780) PR 3b and D713 (#1778) — a founder's or partner's own
// read-only Mercury, for income and payment evidence only.
// `status()` is the caller's connection and the uses their role holds
// (`venture_revenue`, `practice_income`, `partner_deals`, each with
// `available` and a `reason`). It reads the caller's own integrations row only,
// never the bank. #1778's PR C adds the import and match calls: a founder reads
// their project's credits and imports the ones they pick; a partner matches
// their own invoices, payouts and settlements to their own bank lines. A
// candidate's counterparty name is shown to its owner only: never store it.
// D752 (#1988) adds the founder's spending: months, burn, cash and runway, read
// per request, and the save of the last full month into Grow, which the
// Worker refuses without `confirm_visible: true`; the sheet sends it only
// after the founder confirms who reads saved figures.
// Nothing here sends, transfers or requests money.
// Worker: routes/mercury_personal.ts, and routes/revenue.ts (credits, import, spending).
import { request } from '../api.js';

const project = (id) => `/revenue/projects/${encodeURIComponent(id)}`;
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const mercuryPersonalApi = {
  status: () => request('/mercury/personal/status'),
  /** The project's posted credits, each importable or listed with its reason. Writes nothing. */
  credits: (projectId, { from, to } = {}) => request(`${project(projectId)}/mercury-credits${qs({ from, to })}`),
  /** `items`: `[{ transaction_id, customer, revenue_type }]`, at most 200. Amount and date are Mercury's. */
  importCredits: (projectId, items) => request(`${project(projectId)}/entries/import-mercury`, {
    method: 'POST', body: JSON.stringify({ items }),
  }),
  /** `months`: 1 to 12 (the Worker's default is 6). Months, net burn, cash and runway. Writes nothing. */
  spend: (projectId, months) => request(`${project(projectId)}/mercury-spend${qs({ months })}`),
  /** The last full month's net burn, and cash on hand only when `include_cash` is true, as one `mercury` metrics row. */
  saveSpendSnapshot: (projectId, { include_cash = false } = {}) => request(`${project(projectId)}/mercury-spend/snapshot`, {
    method: 'POST', body: JSON.stringify({ include_cash: include_cash === true, confirm_visible: true }),
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
