// D755 (#1915, CR5 PR 2) — every plan's AI allowance on /plans-and-pricing,
// from `GET /api/public/plans-and-packs` (CR2, #1919). Pure, so the desktop
// cards, the phone rows and the tests read the same words. The Token packs
// section is CR7's (components/products/TokenPacksSection.jsx, #1985).
//
// `reading` is `{ status, data }` as `useAccountRead` answers it: `loading`,
// `ready` or anything else (unreadable). Prices are the read's, which are the
// Stripe catalog's D1 mirror; nothing here types a price.
import { NO_PLAN_LINE, planAllowanceLine } from './planAllowance.js';

export const TOKEN_PACKS_ID = 'token-packs';
export const TOP_UP_WITH_PACKS = { label: 'Top up with token packs', href: `#${TOKEN_PACKS_ID}` };
export const YOUR_PLAN = 'Your plan';
// D783: a free plan includes no AI; every run uses tokens.
export const NO_ALLOWANCE = NO_PLAN_LINE;
export const ALLOWANCE_UNREADABLE = "Unreadable · The AI allowances · The plans' prices are unaffected.";

/** The family names (§11): after the role, as on the rail. */
export const FAMILY_LABELS = {
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Operating Partner',
  market_intelligence: 'Market Intelligence Pro',
  other: 'Exploring or other',
};
const FAMILY_ORDER = Object.keys(FAMILY_LABELS);
/** The card title of a plan with no product (§11's "no product; $0" rows). */
const FREE_TITLES = { founder: 'Founder Free', investor: 'Investor Free', other: 'Exploring and other accounts' };

/**
 * A subscription product's family and licence key, from its metadata, exactly
 * as the Worker's `planOf` (services/aiCredits.ts) reads it. Null: not a plan.
 */
export function planOf(metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : {};
  if (m.tier === 'growth' || m.tier === 'studio') return { family: 'founder', licence_key: `founder:${m.tier}` };
  if (m.investor_tier === 'professional' || m.investor_tier === 'institutional') return { family: 'investor', licence_key: `investor:${m.investor_tier}` };
  if (m.plan_group === 'advisor' || m.plan_group === 'partner') return { family: m.plan_group, licence_key: m.plan_group };
  if (m.plan === 'mi_pro') return { family: 'market_intelligence', licence_key: null };
  return null;
}

const micro = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * D783: "Includes $19.75 of AI each month: 25% of the price. Past it, runs use
 * your tokens.", or the no-plan line at $0. Null when the allowance is not
 * readable, so the caller says Unreadable and never "$0.00".
 */
export const allowanceLine = planAllowanceLine;

const plansOf = (reading) => (reading?.status === 'ready' && Array.isArray(reading.data?.plans) ? reading.data.plans : null);

/**
 * What one plan card says about AI (§11). `plan` is the read's row, or for a
 * catalog product the row with its `product_id`. Returns `null` while loading.
 *   { allowance, unreadable, covers, resets, topUp, current }
 * D783: Market Intelligence Pro is a paid plan like any other, so it gives
 * its 25% too.
 */
export function planAi(plan, reading, { licence = null } = {}) {
  if (reading?.status === 'loading') return null;
  const data = reading?.status === 'ready' ? reading.data : null;
  const current = !!plan && typeof licence === 'string' && plan.licence_key === licence;
  const line = plan ? allowanceLine(plan.allowance) : null;
  if (!data || !line) return { allowance: ALLOWANCE_UNREADABLE, unreadable: true, covers: null, resets: null, topUp: null, current };
  return {
    allowance: line, unreadable: false,
    covers: typeof data.covers === 'string' ? data.covers : null,
    resets: typeof data.resets === 'string' ? data.resets : null,
    topUp: TOP_UP_WITH_PACKS, current,
  };
}

/** The read's row for a catalog product, by its id. */
export function planForProduct(product, reading) {
  const plans = plansOf(reading);
  return plans ? plans.find((p) => p && p.product_id === product?.id) || null : null;
}

/** The read's free plans (no product), in family order, with their card titles. */
export function freePlans(reading) {
  const plans = plansOf(reading) || [];
  return plans.filter((p) => p && p.free === true && FREE_TITLES[p.family])
    .sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family))
    .map((p) => ({ ...p, title: FREE_TITLES[p.family] }));
}

/** "$20 / month", "$200 / year", or the one-time amount; "$0" for a free plan; null without a price. */
export function planPriceLabel(plan) {
  if (plan?.free) return '$0';
  const prices = Array.isArray(plan?.prices) ? plan.prices.filter((p) => p && micro(p.unit_amount) && p.currency === 'usd') : [];
  const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const monthly = prices.find((p) => p.interval === 'month' && (p.interval_count ?? 1) === 1);
  if (monthly) return `${money(monthly.unit_amount)} / month`;
  const yearly = prices.find((p) => p.interval === 'year' && (p.interval_count ?? 1) === 1);
  if (yearly) return `${money(yearly.unit_amount)} / year`;
  return prices[0] ? money(prices[0].unit_amount) : null;
}

/**
 * Every plan in the read, families in §11's order, free first in each family:
 * the phone's Plans rows. Each carries `title` (family · plan name) and `price`.
 */
export function phonePlans(reading) {
  const plans = plansOf(reading);
  if (!plans) return null;
  const rank = (p) => FAMILY_ORDER.indexOf(p.family);
  return plans.filter((p) => p && FAMILY_LABELS[p.family])
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => rank(a) - rank(b) || (b.free === true) - (a.free === true) || a.i - b.i)
    .map((p) => ({ ...p, title: p.free ? FREE_TITLES[p.family] : `${FAMILY_LABELS[p.family]} · ${p.plan_name}`, price: planPriceLabel(p) }));
}

// D755 §13 (#1915): a visitor cannot read the catalog (`/api/catalog/products`
// needs a session), so their plan cards come from the public read. Each paid
// plan becomes the product shape BundleCard reads: the plan's metadata rebuilt
// from its licence key (planOf's inverse), its prices as the catalog spells them.
const METADATA_FOR = {
  'founder:growth': { tier: 'growth' },
  'founder:studio': { tier: 'studio' },
  'investor:professional': { investor_tier: 'professional' },
  'investor:institutional': { investor_tier: 'institutional' },
  advisor: { plan_group: 'advisor' },
  partner: { plan_group: 'partner' },
};
const CATEGORY_FOR = { founder: 'founders', investor: 'investors_lps', advisor: 'advisors', partner: 'service_partners' };

/** The read's paid plans as catalog-shaped products, in the read's order. */
export function visitorPlanProducts(reading) {
  const plans = plansOf(reading) || [];
  return plans
    .filter((p) => p && p.free !== true && typeof p.product_id === 'string' && p.product_id && FAMILY_LABELS[p.family])
    .map((p) => ({
      id: p.product_id,
      name: p.plan_name || FAMILY_LABELS[p.family],
      kind: 'subscription',
      active: true,
      metadata: p.family === 'market_intelligence' ? { plan: 'mi_pro' } : { ...(METADATA_FOR[p.licence_key] || {}) },
      categories: CATEGORY_FOR[p.family] ? [CATEGORY_FOR[p.family]] : [],
      prices: (Array.isArray(p.prices) ? p.prices : []).filter((x) => x && typeof x.price_id === 'string').map((x) => ({
        id: x.price_id, active: true, type: x.interval ? 'recurring' : 'one_time',
        interval: x.interval || null, unit_amount: x.unit_amount, currency: x.currency,
      })),
    }));
}

/** Where a visitor's Subscribe goes: sign in, then back to the plans. */
export const VISITOR_SIGN_IN = `/login?next=${encodeURIComponent('/plans-and-pricing')}`;

/**
 * D755 §13 (#1915): a tier of the public /pricing page with its prices from
 * the read, never from `data/pricing.js`'s typed figures. A free tier stays $0.
 * A paid tier the read does not price has `priceMonthly: null`: the page says
 * "—" and offers no Schema.org price for it.
 */
export function pricedTier(tier, family, reading) {
  if (tier?.priceMonthly === 0) return { ...tier, priceMonthly: 0, priceAnnual: 0 };
  const plans = plansOf(reading) || [];
  const plan = plans.find((p) => p && p.licence_key === `${family}:${tier?.id}`);
  const prices = Array.isArray(plan?.prices) ? plan.prices.filter((p) => p && micro(p.unit_amount) && p.currency === 'usd') : [];
  const monthly = prices.find((p) => p.interval === 'month' && (p.interval_count ?? 1) === 1);
  const yearly = prices.find((p) => p.interval === 'year' && (p.interval_count ?? 1) === 1);
  const dollars = (cents) => Math.round(cents) / 100;
  return {
    ...tier,
    priceMonthly: monthly ? dollars(monthly.unit_amount) : null,
    // The page shows annual billing per month, as `data/pricing.js` always did.
    priceAnnual: yearly ? Math.round(yearly.unit_amount / 12) / 100 : null,
  };
}
