// D755 (#1919) — the Super Admin's token packs and AI accounts, as HQ › AI
// allowances draws them. Worker: the token-pack routes on routes/catalog.ts
// (/api/admin/catalog/token-packs*) and the member-account routes in
// routes/ai_budget.ts (/api/ai-budget/members/*, /reconcile). Super Admin only.
import { request } from '../api.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const tokenPacksApi = {
  // One line per pack: its state and reason, the price ID's last six characters and the Stripe mode.
  status: () => request('/ai-budget/top-up/status'),
  create: (amountUsd, idempotencyKey) => request('/admin/catalog/token-packs', {
    method: 'POST', body: body({ amount_usd: amountUsd, idempotency_key: idempotencyKey }),
  }),
  adopt: (priceId) => request('/admin/catalog/token-packs/adopt', { method: 'POST', body: body({ price_id: priceId }) }),
  // `{ on_sale?, bonus_usd?, sort? }`. An amount never changes: a new amount is a new pack.
  update: (uid, patch) => request(`/admin/catalog/token-packs/${enc(uid)}`, { method: 'PATCH', body: body(patch) }),
  archive: (uid) => request(`/admin/catalog/token-packs/${enc(uid)}/archive`, { method: 'POST' }),
  member: (userId, { before, limit } = {}) => request(`/ai-budget/members/${enc(userId)}${query({ before, limit })}`),
  adjust: (userId, amountUsd, reason, idempotencyKey) => request(`/ai-budget/members/${enc(userId)}/adjustments`, {
    method: 'POST', body: body({ amount_usd: amountUsd, reason, idempotency_key: idempotencyKey }),
  }),
  reconcile: () => request('/ai-budget/reconcile'),
};
