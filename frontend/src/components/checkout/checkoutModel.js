/**
 * D1048 (#2451) — the checkout sheet as pure functions: who may pay for which
 * plan here, and the plan summary built from the reads that exist today. No
 * React here, so `node --test` loads it alone.
 *
 * The reads (D1048 §2):
 *   - `GET /api/public/plans-and-packs` — each plan's `product_id`, `prices[]`
 *     (with `price_id`), its `monthly` and `yearly` views and their AI
 *     allowance, and `yearly_saving_percent`. No storage figure yet (#2449).
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
 *   - `staff`     an admin account holds no plan (PAYX16);
 *   - `explorer`  no profile yet: choose one first (PAYX15);
 *   - `other`     a plan for another profile (PAYX19);
 *   - `unsellable` no monthly or yearly price is on sale (PAYX18);
 *   - `change`    the member already pays for a plan in this family: a
 *                 change prorates on Billing until part 3's start route
 *                 (the intent refuses a second subscription, D892);
 *   - `pay`       a new plan, paid here.
 */
const ROLE_FAMILY = { founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'partner' };
export function sheetMode({ user, role, plan, held }) {
  const r = String(role || user?.role || '').toLowerCase();
  if (r === 'admin' || r === 'super_admin') return 'staff';
  if (r === 'exploring') return 'explorer';
  if (ROLE_FAMILY[r] && plan?.family && ROLE_FAMILY[r] !== plan.family) return 'other';
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
    ? { key: 'storage', text: `${(bytes / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB of storage`, measured: true }
    : { key: 'storage', text: cat?.storage?.reason || STORAGE_WAITS, measured: false };
  return [
    { key: 'ai', text: price?.ai || 'AI runs from AI tokens you top up', measured: !!price?.ai },
    storage,
    ...feats.map((f) => ({ key: f, text: f, measured: true })),
  ];
}
