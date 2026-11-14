/**
 * D224 — a refund carries a written reason, and this is the shortest one the
 * worker accepts. It mirrors `REFUND_REASON_MIN` in
 * `cloudflare-worker/src/routes/admin_billing.ts`; the worker is the gate and
 * this copy only lets a form say so before the request is sent.
 * `frontend/test/revenue_billing_exceptions_d224.test.mjs` fails if the two
 * numbers drift apart.
 */
export const REFUND_REASON_MIN = 12;

/** True when `text` is long enough, once trimmed, to be sent as a reason. */
export function refundReasonOk(text) {
  return typeof text === 'string' && text.trim().length >= REFUND_REASON_MIN;
}
