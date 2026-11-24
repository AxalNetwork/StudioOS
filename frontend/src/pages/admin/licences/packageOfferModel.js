/** #5026: immutable offer display/input and recoverable decision rules; prices/reviews always come from the Worker. */
import { parseMinor, plainAmount, formatMinor } from '../../../lib/money.js';
export const money = (n, currency) => n == null ? 'Not recorded' : formatMinor(n, currency, { locale: 'en-GB', trimWhole: true }) ?? 'Not recorded';
export const priceText = (n, currency) => n == null ? '' : plainAmount(n, currency, { locale: 'en-US' })?.replaceAll(',', '') ?? '';
export const validReason = text => typeof text === 'string' && text.trim().length >= 10 && text.trim().length <= 500;
export function reviewedPrice(offer, text, reason) {
  const p = parseMinor(text, offer.currency);
  if (!p.ok || (p.minor !== offer.recommended_annual_fee_cents && !validReason(reason))) return null;
  return { accepted_annual_fee_cents: p.minor, override_reason: p.minor === offer.recommended_annual_fee_cents ? null : reason.trim() };
}
export function canAccept(review) {
  return !!review?.review_hash && review.offer?.state === 'offered' && Array.isArray(review.conflicts) && review.conflicts.length === 0 && Number.isSafeInteger(review.offer.revision);
}
export function operation(action, offer, review, price, reason, key = crypto.randomUUID()) {
  if (!validReason(reason) || !Number.isSafeInteger(offer?.revision)) return null;
  if (action === 'accept' && !canAccept(review)) return null;
  return Object.freeze({ action, offer: offer.uid, body: Object.freeze({ expected_revision: offer.revision, reason: reason.trim(), ...(action === 'accept' ? { ...price, review_hash: review.review_hash, idempotency_key: key } : {}) }) });
}
export function offerFailure(error) {
  if (error?.status >= 400 && error.status < 500) return error?.message || 'Refused: read the offer and review its current consequences again.';
  return 'Outcome unknown. Keep this operation and retry it with the same key, or read the offer again. Do not create a replacement decision.';
}
export function loadPending(storage, key) {
  try {
    const x = JSON.parse(storage?.getItem(key) || 'null');
    if (!x || !['create', 'accept', 'offer', 'decline', 'expire', 'supersede'].includes(x.action) || !x.body || typeof x.body !== 'object') return null;
    return x;
  } catch { return null; }
}
export function savePending(storage, key, value) {
  try { if (value) storage?.setItem(key, JSON.stringify(value)); else storage?.removeItem(key); } catch { /* In-memory exact retry remains available if browser storage is unavailable. */ }
}
