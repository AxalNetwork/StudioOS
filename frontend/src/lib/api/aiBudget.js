// D629 / D640 / D641 / D642 (#1435) — the AI allowance, as the member reads it
// and as HQ sets it. Worker: routes/ai_budget.ts (/api/ai-budget) and the rate
// card in routes/ai.ts (/api/ai/rates).
import { api, request } from '../api.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});

export const aiBudgetApi = {
  mine: () => request('/ai-budget/me'),
  // D755 — the packs on sale, the hold and the latest purchase; D750's `configured`/`product` stay until CR4 and CR7.
  topUp: () => request('/ai-budget/top-up'),
  // D755 — the member's own top-up history, newest first; `runs` adds each run's hold, release and spend.
  history: ({ before, limit, runs } = {}) => {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (limit) q.set('limit', String(limit));
    if (runs) q.set('runs', '1');
    const s = q.toString();
    return request(`/ai-budget/history${s ? `?${s}` : ''}`);
  },
  // D776 — the member's own runs this month (or `month` YYYY-MM), grouped by page, option or record, with charge and split.
  runs: ({ group = 'page', month } = {}) => {
    const q = new URLSearchParams({ group });
    if (month) q.set('month', month);
    return request(`/ai-budget/runs?${q}`);
  },
  // D788 — the member's own monthly spend limit: the limit, this UTC month's charge, the share used, the notices, the allowance.
  // D805 — also `pack_orders: { today, per_day, window_hours, resets_at }`, counted as the purchase check counts. Read by #2246's Limits.
  // D792 part 2 (#2270): `pack_orders` is null, with `pack_orders_reason: 'pack_orders_unreadable'`, when only that count failed; the limit still reads.
  spendLimit: () => request('/ai-budget/limit'),
  // D788 — set the limit in dollars (null removes it) and its 50/80/100% notices. Needs a recent sign-in (403 step_up_required).
  setSpendLimit: (monthlyLimitUsd, notify) => request('/ai-budget/limit', {
    method: 'PUT', body: body({ monthly_limit_usd: monthlyLimitUsd, ...(notify ? { notify } : {}) }),
  }),
  // D776 PR 2 — HQ (Admin or Super Admin): one member's month by option within a page, and each run. Audited.
  memberRuns: (userId, { month } = {}) => request(`/ai-budget/members/${enc(userId)}/runs${month ? `?month=${enc(month)}` : ''}`),
  // D776 PR 2 — HQ: how members are charged, and the models offered with the pages that name them.
  models: () => request('/ai/catalogue/hq'),
  // D794 — the member's own opt-in auto-reload: each call asks for a recent TOTP sign-in (the step-up prompt handles it).
  autoReload: () => request('/ai-budget/auto-reload'),
  // `{ enabled, pack_uid, threshold_usd, setup_intent_id? }`; the card is read back from the SetupIntent on the Worker.
  saveAutoReload: (settings) => request('/ai-budget/auto-reload', { method: 'PUT', body: body(settings) }),
  autoReloadSetup: (nonce) => request('/ai-budget/auto-reload/setup', { method: 'POST', body: body({ nonce }) }),
  // D787 — the member's own cost per day and per model (`range`: mtd, 30d or prev_month; `group`: model, page or option).
  // D805 — `totals.by_kind` ({ tokens, audio_speech, image, other }, each cost_usd and charged_microusd), `totals.other_models`
  // and `totals.output_not_recorded`; the CSV gains a `kind` column. Read by #2214's Usage and Cost.
  cost: ({ range = 'mtd', group = 'model' } = {}) => request(`/ai-budget/cost?${new URLSearchParams({ range, group })}`),
  // D787 — the same read as a CSV download, one row per day and model.
  costCsv: ({ range = 'mtd', group = 'model' } = {}) => api._downloadCsv(`/ai-budget/cost.csv?${new URLSearchParams({ range, group })}`, `ai-cost-${range}.csv`),
  // D750 — Super Admin: why the top-up is or is not offered.
  topUpStatus: () => request('/ai-budget/top-up/status'),
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
