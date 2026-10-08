// D629 / D640 / D641 / D642 (#1435) — the AI allowance, as the member reads it
// and as HQ sets it. Worker: routes/ai_budget.ts (/api/ai-budget) and the rate
// card in routes/ai.ts (/api/ai/rates).
import { request } from '../api.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});

export const aiBudgetApi = {
  mine: () => request('/ai-budget/me'),
  topUp: () => request('/ai-budget/top-up'),
  // D641 — every model the router can price, read from its own tables.
  rates: () => request('/ai/rates'),
  // D640 — Super Admin: the ten plans' allowances, and runs held for a check.
  caps: () => request('/ai-budget/caps'),
  setCaps: (licence, dailyUsd, monthlyUsd) => request(`/ai-budget/caps/${enc(licence)}`, {
    method: 'PUT', body: body({ daily_usd: dailyUsd, monthly_usd: monthlyUsd }),
  }),
  reviews: () => request('/ai-budget/reviews'),
  settleReview: (uid, action, reason) => request(`/ai-budget/reviews/${enc(uid)}/${action === 'charge' ? 'charge' : 'refund'}`, {
    method: 'POST', body: body({ reason }),
  }),
};
