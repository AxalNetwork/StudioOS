import { request } from '../api.js';

// D1051 (#2902, part 3 of #2451) — checkout on the Worker: one route for a new
// plan or a change. Worker: routes/billing_checkout.ts. The sheet (D1048)
// moves onto these in part 5 (#2904).
//
//   quote   POST /billing/checkout/quote   { plan_key, interval, promo_code? }
//           → the plan, its price and allowance, a change's proration and when it applies,
//             the discount, VAT, total due today, step_up_required
//   start   POST /billing/checkout/start   { plan_key, interval, promo_code?, payment_method?, nonce }
//           → { client_secret, ref } for a new plan, { free: true, ref }, or a change:
//             { direction: 'upgrade', client_secret? | paid } or { direction: 'downgrade', scheduled, change_at }.
//             A change and a saved card answer 403 step_up_required first.
//   status  GET  /billing/checkout/status?ref=  → { state: activating | active | failed | scheduled, result?, changes? }
//
// Every path is written out in full so the drift check reads each one against the Worker.
export const checkoutApi = {
  quote: ({ planKey, interval, promoCode } = {}) =>
    request('/billing/checkout/quote', { method: 'POST', body: JSON.stringify({ plan_key: planKey, interval, ...(promoCode ? { promo_code: promoCode } : {}) }) }),
  start: ({ planKey, interval, promoCode, paymentMethod, nonce } = {}) =>
    request('/billing/checkout/start', { method: 'POST', body: JSON.stringify({
      plan_key: planKey, interval, nonce,
      ...(promoCode ? { promo_code: promoCode } : {}),
      ...(paymentMethod ? { payment_method: paymentMethod } : {}),
    }) }),
  status: (ref) => request(`/billing/checkout/status?ref=${encodeURIComponent(ref)}`),
  // D1053 (#2904): the sheet's "Pay with" list. Worker: routes/payments.ts GET /methods.
  methods: () => request('/payments/methods'),
};
