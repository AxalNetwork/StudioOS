/**
 * D792 (#2217) — the Billing page's cards (B3 of the "Usage & Billing console"
 * canvas, `design/incoming/Usage Page.dc.html`, `screen: 'billing'`), as
 * pure rules so a Node test holds every sentence. No React, no fetch.
 *
 * WHERE EACH READS FROM.
 *   Token balance, Included with your plan  `GET /api/ai-budget/me`
 *   Buy tokens                              `GET /api/ai-budget/top-up`'s packs,
 *                                           with D790's offer fields
 *   Payment details                         `GET /api/billing/overview`'s cards
 * A read that failed is drawn Unreadable by the page; nothing here guesses a
 * figure the Worker did not send.
 *
 * WORDS (D793, D-c): "AI tokens" and "token balance". Perks credits never
 * appear on this page.
 */
import { microMoney } from '../../lib/aiTokens';

/** The canvas's footnote under Buy tokens. */
export const TOKENS_FOOTNOTE = '$1 of tokens buys $1 of AI use at the posted rates. Tax does not buy tokens. Tokens you buy never expire.';
/** Included with your plan, with no plan (or a plan that includes nothing). */
export const NO_PLAN = 'No plan: top up as you go.';
/** Payment details with no card on file. */
export const NO_CARD = 'No payment method on file.';

const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "12 Nov": a day, as the canvas writes it, in UTC (the Worker's periods are UTC). */
export function shortDay(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DAY.format(d);
}

/** The first day of the next UTC month, when the plan's monthly allowance resets. */
export function nextReset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** The token balance, "$27.50", or null when the read carries none. */
export function balanceText(me) {
  return whole(me?.balance_microusd) ? microMoney(me.balance_microusd) : null;
}

/**
 * Included with your plan: what is left of this month's allowance, of what,
 * when it resets, and the share used for the bar. `{ kind: 'none' }` with no
 * plan, or a plan that includes nothing (D783: no plan, no allowance).
 * Null when the read is not one this page understands.
 */
export function allowanceView(me, now = new Date()) {
  if (!me || typeof me !== 'object') return null;
  const monthly = me.plan?.monthly_microusd;
  if (!me.plan || monthly === 0) return { kind: 'none', text: NO_PLAN };
  if (!whole(monthly) || !whole(me.month_spend_microusd)) return null;
  const left = Math.max(0, monthly - me.month_spend_microusd);
  return {
    kind: 'plan', left: microMoney(left), of: microMoney(monthly), resets: shortDay(nextReset(now).toISOString()),
    usedPct: Math.min(100, Math.round(((monthly - left) / monthly) * 100)),
  };
}

/**
 * Buy tokens: one card per pack on sale, with D790's offer lines when the
 * Worker sends a live offer ("+10% bonus, ends 12 Nov", "First purchase
 * only"), and Buy's link to the existing checkout with that pack.
 */
export function packCards(topUp) {
  const packs = Array.isArray(topUp?.packs) ? topUp.packs : [];
  return packs.filter((p) => p && whole(p.unit_amount) && p.unit_amount > 0 && (p.uid || p.price_id)).map((p) => {
    const key = p.uid || p.price_id;
    const credit = whole(p.credit_microusd) && p.credit_microusd > 0 ? p.credit_microusd : p.unit_amount * 10_000;
    const bonus = whole(p.bonus_microusd) ? p.bonus_microusd : 0;
    let offer = null;
    if (bonus > 0) {
      const pct = Math.round((bonus / credit) * 1000) / 10;
      const ends = p.offer_ends_at ? shortDay(p.offer_ends_at) : null;
      offer = `+${pct}% bonus${ends ? `, ends ${ends}` : ''}`;
    }
    const dollars = p.unit_amount % 100 === 0 ? String(p.unit_amount / 100) : (p.unit_amount / 100).toFixed(2);
    return {
      key, amount: `$${dollars}`, offer, firstOnly: p.first_purchase_only === true,
      href: `/checkout?token_pack=${encodeURIComponent(key)}`,
    };
  });
}

const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', jcb: 'JCB', diners: 'Diners Club', unionpay: 'UnionPay' };

/**
 * Payment details: the default card on the billing customer (else the first),
 * its brand, last four and expiry. Null for none.
 */
export function paymentCard(overview) {
  const cards = Array.isArray(overview?.payment_methods) ? overview.payment_methods : [];
  const pm = cards.find((c) => c?.is_default) || cards[0];
  if (!pm || typeof pm.last4 !== 'string' || !/^\d{4}$/.test(pm.last4)) return null;
  const brand = BRAND[String(pm.brand || '').toLowerCase()] || (pm.brand ? `${String(pm.brand)[0].toUpperCase()}${String(pm.brand).slice(1)}` : 'Card');
  const ok = Number.isInteger(pm.exp_month) && pm.exp_month >= 1 && pm.exp_month <= 12 && Number.isInteger(pm.exp_year);
  return { brand, last4: pm.last4, expires: ok ? `${String(pm.exp_month).padStart(2, '0')}/${String(pm.exp_year % 100).padStart(2, '0')}` : null };
}
