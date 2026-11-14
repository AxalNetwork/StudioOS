// D752 — Axal's admins on HQ read an investor's shared proof of funds. Every read is audited before it answers
// and counts as a view on the investor's own list. Reads only; nothing here moves money.
// Worker: routes/admin_capital_attestations.ts.
import { request } from '../api.js';

const BASE = '/admin/capital-attestations';
const q = (params) => `${BASE}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;

export const adminCapitalAttestationsApi = {
  forTarget: (purpose, targetId) => request(q({ purpose, target_id: targetId })),
  forDeal: (dealId) => request(q({ deal_id: dealId })),
  forFund: (fundId) => request(q({ fund_id: fundId })),
};
