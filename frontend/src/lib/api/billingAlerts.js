import { request } from '../api.js';

/**
 * D1052 (#2903): the member's billing alerts, /api/billing (billing.ts).
 * list() -> { alerts: [{ id, kind, plan_family, attempt_count, next_attempt_at,
 * amount_cents, currency, can_confirm, created_at, updated_at }] }, open only.
 * confirm(id) -> { client_secret, payment_intent } for a `needs_confirmation`
 * alert, fetched from Stripe when pressed; hand it to Stripe.js and keep it nowhere.
 */
export const billingAlertsApi = {
  list: () => request('/billing/alerts'),
  confirm: (id) => request(`/billing/alerts/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
};
