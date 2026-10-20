/**
 * D794 (#2219) — the words for Billing's Auto-reload card, from
 * `GET /api/ai-budget/auto-reload` and the packs on `GET /api/ai-budget/top-up`.
 * Pure, so `frontend/test/auto_reload_card_d794.test.mjs` holds each rule.
 *
 * The card never shows a card number: the Worker sends only the brand and the
 * last four Stripe reports for the member's own saved card.
 */

/** The Worker's sentences for a reason that turned auto-reload off (`DISABLED_WORDS`, services/aiAutoReload.ts). */
export const OFF_WORDS = Object.freeze({
  card_declined: 'Auto-reload is off: your card was declined. Update it on Billing.',
  authentication_required: 'Auto-reload is off: your bank asked to confirm the payment. Update your card on Billing.',
  card_unusable: 'Auto-reload is off: your saved card could not be charged. Update it on Billing.',
  pack_unavailable: 'Auto-reload is off: its token pack is no longer sold. Choose another pack on Billing.',
});

/** Why the last reload was not made, when it was skipped rather than turned off. */
const SKIPPED_WORDS = Object.freeze({
  token_pack_daily_limit: 'The last reload was not made: five token packs were ordered in the last 24 hours.',
  token_balance_ceiling: 'The last reload was not made: it would take your token balance above $1,000.',
  token_packs_on_hold: 'The last reload was not made: token packs are on hold for this account.',
  pack_not_on_sale: 'The last reload was not made: the pack is not on sale right now.',
  // D790: a first-purchase pack is sold once; a reload is never a first purchase.
  token_pack_first_purchase_only: 'The last reload was not made: that pack is for a first token purchase only. Choose another pack on Billing.',
  error: 'The last reload was not made: the payment service did not answer. It is tried again after your next run.',
  spend_limit: 'The last reload was not made: it would pass your monthly AI spend limit. Raise it on Usage › Limits, or it resumes next month.',
});

const usd = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : null);

/** "Visa ending 4242", or null with no card. */
export function cardText(card) {
  if (!card || typeof card !== 'object' || typeof card.last4 !== 'string' || !/^\d{4}$/.test(card.last4)) return null;
  const brand = typeof card.brand === 'string' && card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card';
  return `${brand} ending ${card.last4}`;
}

/** The packs auto-reload can charge: on sale, HQ's own (a pack row with an id), and not for a first purchase only (D790). */
export function packOptions(topUp) {
  const packs = Array.isArray(topUp?.packs) ? topUp.packs : [];
  return packs.filter((p) => p && typeof p.uid === 'string' && p.uid && typeof p.label === 'string' && p.first_purchase_only !== true)
    .map((p) => ({ uid: p.uid, label: p.label }));
}

/** A typed threshold in US dollars: 0 to 500, at most two decimals, or null. Mirrors the Worker's `thresholdMicro`. */
export function parseThreshold(text) {
  const t = String(text ?? '').trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= 500 ? n : null;
}

/** The card's one-line state. */
export function stateLine(read, packs = []) {
  if (!read || typeof read !== 'object') return null;
  if (!read.enabled && read.disabled_reason && OFF_WORDS[read.disabled_reason]) return { tone: 'warn', text: OFF_WORDS[read.disabled_reason] };
  if (!read.enabled) return { tone: 'neutral', text: 'Off. Nothing is charged automatically.' };
  const pack = packs.find((p) => p.uid === read.pack_uid)?.label ?? 'your token pack';
  const card = cardText(read.card) ?? 'your saved card';
  return { tone: 'ok', text: `On: when your token balance drops below ${usd(read.threshold_usd) ?? 'your threshold'}, ${card} is charged for ${pack}.` };
}

/** Why the last attempt did not charge, when it was skipped; null otherwise. */
export function lastSkipped(read) {
  return read?.enabled && SKIPPED_WORDS[read.last_outcome] ? SKIPPED_WORDS[read.last_outcome] : null;
}
