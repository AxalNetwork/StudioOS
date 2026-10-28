/**
 * D1048 (#2451) — the checkout sheet as pure functions: who may pay for which
 * plan here, and the plan summary built from the reads that exist today. No
 * React here, so `node --test` loads it alone.
 *
 * The reads (D1048 §2):
 *   - `GET /api/public/plans-and-packs` — each plan's `product_id`, `prices[]`
 *     (with `price_id`), its `monthly` and `yearly` views and their AI
 *     allowance, `yearly_saving_percent` and D1167's binary-GB storage figure.
 *   - `POST /api/payments/intent` (through `AxalCheckout`) — the payment,
 *     once the member presses Continue: it stamps the plan on the
 *     subscription and refuses a second one in the same family (D892).
 * Nothing here is a price, a total or a date the Worker did not send.
 */

export const TITLE = 'Checkout';
export const NOT_YET = 'Not read here yet';
export const SECURE_LINE = 'Paid securely through Stripe. Axal VC never stores your card details.';
export const SELLER_LINE = 'Sold by Axal VC Management LLC.';
export const PROCESSING_CLOSE = 'Your payment is still being confirmed. You can close this; we’ll tell you when it’s done.';
export const ACTIVATING = 'Payment received. Your plan switches on as soon as Stripe confirms it, usually within seconds.';
export const RENEWS = 'Renews each billing period. Cancel any time from Billing.';
export const STORAGE_WAITS = 'Storage per plan is #2449’s, not read here yet.';
export const TOTALS_WAIT = 'Tax, any discount and the amount due today are shown in the payment form.';

/** Profile colours on the plan pill (the canvas's), by plan family. */
const FAMILY = {
  founder: { label: 'Founder', tone: 'violet' },
  investor: { label: 'Investor', tone: 'sky' },
  advisor: { label: 'Advisor', tone: 'amber' },
  partner: { label: 'Operating Partner', tone: 'emerald' },
};
export const familyOf = (plan) => FAMILY[plan?.family] || { label: 'Plan', tone: 'muted' };

const usd = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });
const usd2 = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/**
 * One interval's price as the sheet shows it, with the `price_id` the payment
 * needs, from `prices[]`: the `monthly` and `yearly` views carry no id.
 * Null when the plan does not sell that interval.
 */
export function intervalPrice(plan, interval) {
  const want = interval === 'yearly' ? 'year' : 'month';
  const p = (Array.isArray(plan?.prices) ? plan.prices : []).find((x) => x && x.interval === want && (x.interval_count ?? 1) === 1
    && Number.isSafeInteger(x.unit_amount) && x.price_id);
  if (!p) return null;
  const currency = String(p.currency || 'usd').toLowerCase();
  if (currency !== 'usd') return null;
  return {
    priceId: p.price_id, interval: want, unitAmount: p.unit_amount,
    line: want === 'year' ? `${usd(Math.round(p.unit_amount / 12))} / month, ${usd(p.unit_amount)} billed yearly` : `${usd(p.unit_amount)} / month`,
    subtotal: usd2(p.unit_amount),
    ai: Number(p.allowance_microusd) > 0 ? `${usd2(Math.floor(Number(p.allowance_microusd) / 10_000))} of AI a month` : null,
  };
}

/** The intervals the plan sells, and the saving the Worker computed (never typed). */
export function intervalsOf(plan) {
  const monthly = intervalPrice(plan, 'monthly');
  const yearly = intervalPrice(plan, 'yearly');
  const saving = Number.isFinite(Number(plan?.yearly_saving_percent)) && Number(plan.yearly_saving_percent) > 0 ? `Save ${Number(plan.yearly_saving_percent)}%` : null;
  return { monthly, yearly, saving };
}

/**
 * What the sheet can do for this member and plan (D1048 §3), in order:
 *   - `signin`    no account: sign in first, the plan kept (D1053, PAYX19a);
 *   - `staff`     an admin account holds no plan (PAYX16);
 *   - `explorer`  no profile yet: choose one first (PAYX15);
 *   - `other`     a plan for another profile (PAYX19);
 *   - `notsold`   the catalogue does not sell this plan: Institutional is
 *                 priced by sales (D1054, PAYX13);
 *   - `unsellable` no monthly or yearly price is on sale (PAYX18);
 *   - `change`    the member already pays for a plan in this family: since
 *                 D1053 the change is quoted and made here, through D1051's
 *                 routes (an upgrade now, a downgrade at the period's end);
 *   - `pay`       a new plan, paid here.
 */
const ROLE_FAMILY = { founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'partner' };
export function sheetMode({ user, role, plan, held }) {
  // D1053 (PAYX19a): a visitor signs in first, and lands back on the plan they chose.
  if (!user && !role) return 'signin';
  const r = String(role || user?.role || '').toLowerCase();
  // D1054 (PAYX16): a licence administrator holds no plan either.
  if (r === 'admin' || r === 'super_admin' || r === 'branch_admin') return 'staff';
  if (r === 'exploring') return 'explorer';
  if (ROLE_FAMILY[r] && plan?.family && ROLE_FAMILY[r] !== plan.family) return 'other';
  if (plan?.catalogue?.sellable === false) return 'notsold';
  const { monthly, yearly } = intervalsOf(plan);
  if (!monthly && !yearly) return 'unsellable';
  if (held && held !== 'free') return 'change';
  return 'pay';
}

/**
 * The plan summary's "Included" lines: the AI allowance, storage, then the
 * plan's own lines. D1050 (#2901): the lines and the storage are the plan
 * catalogue's, sent on the plans read as `plan.catalogue`; the Pricing card's
 * lines are the fallback for a read from before it. Storage is a figure only
 * when the catalogue holds one, else its reason (#2449).
 */
export function includedLines(plan, spec, interval) {
  const price = intervalPrice(plan, interval) || intervalPrice(plan, interval === 'yearly' ? 'monthly' : 'yearly');
  const cat = plan?.catalogue;
  const lines = Array.isArray(cat?.included) ? cat.included : (spec?.feats || []);
  const feats = lines.filter((f) => !/of AI tokens a month$/.test(f) && f !== 'AI runs from AI tokens you top up');
  const bytes = Number(cat?.storage?.bytes);
  const storage = Number.isFinite(bytes) && bytes > 0
    ? { key: 'storage', text: `${(bytes / (1024 ** 3)).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB of storage`, measured: true }
    : { key: 'storage', text: cat?.storage?.reason || STORAGE_WAITS, measured: false };
  return [
    { key: 'ai', text: price?.ai || 'AI runs from AI tokens you top up', measured: !!price?.ai },
    storage,
    ...feats.map((f) => ({ key: f, text: f, measured: true })),
  ];
}

// ─────────────────────────────────────────────────────────────── D1053 (#2904)
//
// Part 5: the sheet pays on D1051's routes. Every figure below is one the
// quote, the start or the status sent; a missing one is its reason, never 0.
//   POST /api/billing/checkout/quote   the totals, a change's proration and date, the promo
//   POST /api/billing/checkout/start   the payment (a client secret), free, paid or scheduled
//   GET  /api/billing/checkout/status  activating, active, failed or scheduled
//   GET  /api/payments/methods         the saved cards ("Pay with")

/** The plan key the Worker sells by (D1050's catalogue), or null. */
export const planKeyOf = (plan) => (typeof plan?.catalogue?.key === 'string' && plan.catalogue.key ? plan.catalogue.key : null);

/** Cents in the quote's currency, or null: never "$0.00" for a figure that was not sent. */
export function moneyOf(cents, currency = 'usd') {
  if (cents == null || cents === '' || !Number.isFinite(Number(cents))) return null;
  const code = String(currency || 'usd').toUpperCase();
  try {
    return (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2 });
  } catch {
    return `${(Number(cents) / 100).toFixed(2)} ${code}`;
  }
}

/** A Worker date (ISO or epoch seconds) as "21 Nov 2026", or null. */
export function dayOf(at) {
  if (at == null || at === '' || at === 'now') return null;
  const d = typeof at === 'number' ? new Date(at * 1000) : new Date(String(at));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * PAYX2–PAYX5: the totals rows from the quote, and the one primary button's
 * words. `Pay [$total]` only when the Worker sent the total; otherwise "Pay"
 * with the Worker's reason under it.
 */
export function quoteView(quote) {
  if (!quote) return null;
  const cur = quote.currency || 'usd';
  const rows = [];
  if (quote.mode === 'change') {
    if (quote.direction === 'upgrade') {
      rows.push({ key: 'plan', label: quote.plan_name || 'New plan', value: moneyOf(quote.unit_amount, cur) });
      rows.push({ key: 'proration', label: 'Prorated difference', value: moneyOf(quote.proration_amount, cur), reason: quote.proration_amount == null ? quote.total_reason : null });
    }
    if (quote.vat?.amount != null) rows.push({ key: 'vat', label: 'VAT', value: moneyOf(quote.vat.amount, cur) });
    else if (quote.vat?.reason) rows.push({ key: 'vat', label: 'VAT', value: null, reason: quote.vat.reason });
    const due = moneyOf(quote.total_due_today, cur);
    rows.push({ key: 'due', label: 'Due today', value: due, reason: due ? null : quote.total_reason, strong: true });
    const when = quote.direction === 'downgrade' ? dayOf(quote.change_at) : null;
    return {
      rows,
      due,
      change: quote.direction,
      line: quote.direction === 'downgrade'
        ? `Your plan changes to ${quote.plan_name || 'the new plan'} on ${when || 'the end of your paid period'}. Nothing is charged today.`
        : `Your plan changes to ${quote.plan_name || 'the new plan'} now. The unused time on your current plan is credited.`,
      storage: quote.direction === 'downgrade' ? STORAGE_DOWNGRADE : null,
      stepUp: quote.step_up_required ? STEP_UP_LINE : null,
      button: quote.direction === 'downgrade' ? 'Schedule the change' : due ? `Confirm change · ${due}` : 'Confirm change',
    };
  }
  rows.push({ key: 'subtotal', label: 'Subtotal', value: moneyOf(quote.unit_amount, cur) });
  if (quote.discount) rows.push({ key: 'discount', label: `Discount · ${quote.discount.code}`, value: `−${moneyOf(quote.discount.amount, cur)}` });
  if (quote.vat?.amount != null) rows.push({ key: 'vat', label: 'VAT', value: moneyOf(quote.vat.amount, cur) });
  else if (quote.vat?.reason) rows.push({ key: 'vat', label: 'VAT', value: null, reason: quote.vat.reason });
  const due = moneyOf(quote.total_due_today, cur);
  rows.push({ key: 'due', label: 'Due today', value: due, reason: due ? null : quote.total_reason, strong: true });
  const free = quote.total_due_today === 0 && !!quote.discount;
  return {
    rows, due, change: null, line: null, storage: null, stepUp: null, free,
    button: free ? 'Start my plan' : due ? `Pay ${due}` : 'Pay',
  };
}

/**
 * D1055 (PAYX20): the phone's one-row summary, "[Plan] · [$20]/month", from the
 * interval's own price line. Null without a price: the row then names the plan.
 */
export function summaryRow(plan, spec, price) {
  const name = plan?.plan_name || spec?.name || plan?.catalogue?.label || 'Plan';
  const line = typeof price?.line === 'string' ? price.line.split(',')[0].replace(' / ', '/').trim() : '';
  return line ? `${name} · ${line}` : name;
}

/** D1055 (PAYX20): the total beside the phone's Pay, only when the Worker sent it. */
export function payTotal(view) {
  return view?.due ? { label: 'Due today', value: view.due } : null;
}

/**
 * D1055 (PAYX21): the Payment Element's dark style on the sheet. The shared
 * appearance (`lib/stripe.js`, used by six forms) is left as it is. In dark it
 * draws a selected tab's label and icon in the deep brand violet, which does
 * not read on the dark card, so the sheet gives them their dark pair
 * (violet-300), and gives the tabs a hairline and a violet-400 edge that read
 * on its gray-900 ground. Light is unchanged.
 */
export const SHEET_DARK_RULES = Object.freeze({
  '.Tab': { backgroundColor: '#111827', border: '1px solid #374151', boxShadow: 'none' },
  '.Tab:hover': { border: '1px solid #4b5563' },
  '.Tab--selected': { border: '1px solid #a78bfa', boxShadow: '0 0 0 1px #a78bfa' },
  '.TabLabel, .TabIcon': { color: '#e5e7eb' },
  '.TabLabel--selected, .TabIcon--selected': { color: '#c4b5fd' },
});
export function sheetAppearance(base, isDark) {
  if (!isDark || !base) return base;
  return { ...base, rules: { ...(base.rules || {}), ...SHEET_DARK_RULES } };
}

export const STEP_UP_LINE = 'Plan changes need a fresh code from your authenticator app.';
export const STORAGE_DOWNGRADE = 'The new plan’s storage applies from that day. Check Usage › Storage first: nothing is deleted, but new uploads wait while you are over it.';
export const FREE_FIRST = 'Your code covers the first payment. Your card is saved for renewals.';

/** PAYX5: a code the quote refused, in the canvas's words; a raw reason is never shown. */
const PROMO_WORDS = {
  not_found: 'That code isn’t valid.',
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  usage_limit_reached: 'This code has reached its usage limit.',
  currency_mismatch: 'This code can’t be used for this purchase.',
  amount_below_minimum: 'This code lowers the total below the minimum we can process.',
  interval_not_eligible: 'This code doesn’t apply to this billing period.',
  already_used: 'You’ve already used this code.',
  not_first_purchase: 'This code is for a first purchase only.',
  first_purchase_unreadable: 'We couldn’t confirm this is your first purchase. Try again in a moment.',
  product_list_unreadable: 'This code can’t be checked right now. Try again in a moment.',
};
export function promoState(quote, asked) {
  if (!asked) return { state: 'none' };
  if (!quote) return { state: 'applying', code: asked };
  if (quote.discount) {
    return { state: quote.total_due_today === 0 ? 'covers' : 'valid', code: quote.discount.code, amount: moneyOf(quote.discount.amount, quote.currency) };
  }
  const reason = String(quote.discount_reason || 'not_found');
  const line = reason === 'product_not_eligible'
    ? `This code doesn’t apply to ${quote.plan_name || 'this plan'}.`
    : PROMO_WORDS[reason] || 'That code can’t be applied to this purchase.';
  return { state: reason === 'product_not_eligible' ? 'other_plan' : 'invalid', code: asked, line };
}

/**
 * PAYX9: the decline map. Stripe's `code` and `decline_code` become one of
 * five families of words; fraud and any code not listed read "Card
 * declined". A raw code is never shown, and each line says the member was not
 * charged.
 */
export const DECLINE = Object.freeze({
  declined: { title: 'Card declined', line: 'Your card was declined. Your bank didn’t say why. Try another card, or contact your bank. You were not charged.' },
  funds: { title: 'Insufficient funds', line: 'Your card doesn’t have enough funds for this payment. You were not charged.' },
  expired: { title: 'Expired card', line: 'This card has expired. Use another card. You were not charged.' },
  auth: { title: 'Authentication failed', line: 'Your bank couldn’t confirm it was you. Try again, or use another card. You were not charged.' },
  generic: { title: 'Payment didn’t go through', line: 'Something went wrong and the payment didn’t go through. You were not charged. Try again in a moment.' },
});
const FUNDS = new Set(['insufficient_funds', 'card_velocity_exceeded', 'withdrawal_count_limit_exceeded']);
const EXPIRED = new Set(['expired_card']);
const AUTH = new Set(['authentication_required', 'payment_intent_authentication_failure', 'setup_intent_authentication_failure', 'incorrect_cvc', 'invalid_cvc']);
const GENERIC = new Set(['processing_error', 'api_error', 'api_connection_error', 'rate_limit', 'try_again_later', 'issuer_not_available', 'reenter_transaction']);
export function declineFamily(err) {
  const code = String(err?.code || '');
  const decline = String(err?.decline_code || '');
  const type = String(err?.type || '');
  let key = 'declined';
  if (FUNDS.has(decline) || FUNDS.has(code)) key = 'funds';
  else if (EXPIRED.has(decline) || EXPIRED.has(code)) key = 'expired';
  else if (AUTH.has(code) || AUTH.has(decline)) key = 'auth';
  else if (GENERIC.has(code) || GENERIC.has(decline) || type === 'api_error' || type === 'api_connection_error' || type === 'rate_limit_error') key = 'generic';
  return { key, ...DECLINE[key] };
}

/** PAYX18: a quote or start the Worker refused, by its code. Each says no money moved. */
export function refusalView(err) {
  const code = String(err?.code || '');
  if (code === 'stripe_not_configured') return { key: 'not_set_up', title: 'Payments aren’t set up here.', line: 'Nothing can be bought here yet. You were not charged.', retry: false };
  if (code === 'price_missing' || code === 'catalogue_unreadable' || code === 'not_sellable') {
    return { key: 'price', title: 'Price couldn’t be read', line: 'This plan’s price couldn’t be read just now. That doesn’t mean it’s free.', retry: true };
  }
  if (code === 'other_profile') return { key: 'other', title: 'This plan is for another profile.', line: 'Plans are sold to the profile they belong to. You were not charged.', retry: false };
  if (code === 'already_on_plan' || code === 'subscription_exists') {
    return { key: code, title: typeof err?.message === 'string' && err.message ? err.message : 'You already pay for a plan of this kind.', line: 'Nothing was charged.', retry: false, billing: true };
  }
  if (code === 'step_up_required') return { key: 'step_up', title: 'Confirm it’s you.', line: `${STEP_UP_LINE} Nothing changed.`, retry: true };
  // Any other refusal keeps the Worker's own sentence when it says what happened to the money, else the canvas's.
  const said = typeof err?.message === 'string' && /charged|changed/i.test(err.message) ? err.message : null;
  return { key: 'start', title: 'Checkout couldn’t start.', line: said || 'You were not charged. Try again in a moment.', retry: true };
}

/** PAYX8: after this long the activating view says the plan is still being switched on. */
export const SLOW_MS = 60_000;
export const POLL_MS = 2_000;

/** PAYX7–PAYX8: the status route's state, in the sheet's words. */
export function statusView(status, { slow = false } = {}) {
  const state = status?.state;
  if (state === 'active') return { key: 'active', title: 'Payment received. Your plan is on.' };
  if (state === 'scheduled') {
    const when = dayOf(status.change_at);
    return { key: 'scheduled', title: `Your plan changes on ${when || 'the end of your paid period'}.`, line: 'Nothing was charged today. You keep your current plan until then.' };
  }
  if (state === 'failed') return { key: 'failed', title: 'The payment didn’t go through.', line: 'You were not charged. Try again, or use another card.' };
  return slow
    ? { key: 'slow', title: 'Your payment went through, and your plan is still being switched on.', line: 'You can close this; we’ll tell you when it’s ready.' }
    : { key: 'activating', title: 'Payment received. Activating your plan…', line: 'This usually takes a few seconds.' };
}

/** PAYX7: "What you get now", from the status route's result; a figure not recorded says so. */
export function whatYouGet(result) {
  if (!result) return [];
  const reasons = result.reasons || {};
  const ai = Number(result.ai_allowance_microusd);
  const bytes = Number(result.storage_bytes);
  const lines = [
    Number.isFinite(ai) && ai > 0
      ? { key: 'ai', text: `${moneyOf(Math.floor(ai / 10_000))} of AI a month, starting today`, measured: true }
      : { key: 'ai', text: reasons.ai_allowance_microusd || 'AI allowance: Not recorded.', measured: false },
    Number.isFinite(bytes) && bytes > 0
      ? { key: 'storage', text: `${(bytes / (1024 ** 3)).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB of storage`, measured: true }
      : { key: 'storage', text: reasons.storage_bytes || 'Storage: Not recorded.', measured: false },
  ];
  for (const f of Array.isArray(result.included) ? result.included : []) {
    if (/of AI tokens a month$/.test(f) || f === 'AI runs from AI tokens you top up') continue;
    lines.push({ key: f, text: f, measured: true });
  }
  return lines;
}

/** "Pay with": a saved card's words. The investor plan is paid on its own customer (D892 §6), so it takes none. */
export const cardWords = (m) => `${m?.brand ? m.brand.charAt(0).toUpperCase() + m.brand.slice(1) : 'Card'} ending ${m?.last4 || '••••'}${m?.exp_month && m?.exp_year ? ` · expires ${String(m.exp_month).padStart(2, '0')}/${String(m.exp_year).slice(-2)}` : ''}`;
export const savedCardsApply = (plan) => plan?.family !== 'investor';

/**
 * D1054 (PAYX13): a plan the catalogue does not sell, in the canvas's words,
 * with the catalogue's own reason. A plan priced by sales offers Contact sales.
 */
export function notSoldView(plan) {
  const reason = typeof plan?.catalogue?.sellable_reason === 'string' ? plan.catalogue.sellable_reason : null;
  if (reason && /sales team/i.test(reason)) return { title: 'Contact sales', line: 'This plan is priced by our sales team for each firm. Nothing is bought here.', contact: true };
  return { title: 'Not sold here', line: reason || 'This plan is not sold here.', contact: false };
}

/** PAYX19a: the sign-in address that brings the member back to this plan. */
export function signinHref(plan, interval) {
  const key = planKeyOf(plan);
  const back = key ? `/pricing?checkout=${encodeURIComponent(key)}&interval=${interval === 'yearly' ? 'yearly' : 'monthly'}` : '/pricing';
  return `/login?next=${encodeURIComponent(back)}`;
}

/** A nonce for one press of Pay (D1051 §3): a retry of the same press reuses it. */
export function newNonce() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
