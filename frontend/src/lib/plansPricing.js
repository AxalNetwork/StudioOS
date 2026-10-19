// D755 (#1915, CR5 PR 2) — what /plans-and-pricing shows from
// `GET /api/public/plans-and-packs` (CR2, #1919): every plan's AI allowance,
// the token packs on sale, and the page's footer. Pure, so the desktop cards,
// the phone rows and the tests read the same words.
//
// `reading` is `{ status, data }` as `useAccountRead` answers it: `loading`,
// `ready` or anything else (unreadable). Prices are the read's, which are the
// Stripe catalog's D1 mirror; nothing here types a price.
import { microMoney, packLabel, TOKENS_LINE, TOPUP_UNAVAILABLE } from './aiTokens.js';

export const TOKEN_PACKS_ID = 'token-packs';
export const TOP_UP_WITH_PACKS = { label: 'Top up with token packs', href: `#${TOKEN_PACKS_ID}` };
export const YOUR_PLAN = 'Your plan';
export const NO_ALLOWANCE = 'No AI allowance on this plan. Runs use your top-up balance.';
export const MI_ALLOWANCE = 'Does not change your AI allowance.';
export const ALLOWANCE_UNREADABLE = "Unreadable · The AI allowances · The plans' prices are unaffected.";
export const PACKS_UNREADABLE = 'Unreadable · The token packs · Your allowance is unaffected.';
export const PRICING_FOOTER = 'Sold by Axal VC Management LLC. Paid by card through Stripe; Axal never stores your card details. VAT, where it applies, is added at checkout and is not part of the tokens.';
export const TOKEN_PACKS_TITLE = 'Token packs';
export { TOKENS_LINE };

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
 * "$1.00 a day · $5.00 a month", with only the parts above zero; the
 * no-allowance sentence when both are zero. Null when the allowance is not a
 * readable pair, so the caller says Unreadable and never "$0.00".
 */
export function allowanceLine(allowance) {
  if (!allowance || !micro(allowance.daily_microusd) || !micro(allowance.monthly_microusd)) return null;
  const parts = [];
  if (allowance.daily_microusd > 0) parts.push(`${microMoney(allowance.daily_microusd)} a day`);
  if (allowance.monthly_microusd > 0) parts.push(`${microMoney(allowance.monthly_microusd)} a month`);
  return parts.length ? parts.join(' · ') : NO_ALLOWANCE;
}

const plansOf = (reading) => (reading?.status === 'ready' && Array.isArray(reading.data?.plans) ? reading.data.plans : null);

/**
 * What one plan card says about AI (§11). `plan` is the read's row, or for a
 * catalog product the row with its `product_id`. Returns `null` while loading.
 *   { allowance, unreadable, covers, resets, topUp, current }
 * Market Intelligence Pro says it does not change the allowance and offers no
 * covers, resets or top-up lines: it has no allowance of its own.
 */
export function planAi(plan, reading, { licence = null } = {}) {
  if (reading?.status === 'loading') return null;
  const data = reading?.status === 'ready' ? reading.data : null;
  const current = !!plan && typeof licence === 'string' && plan.licence_key === licence;
  if (plan?.family === 'market_intelligence') return { allowance: MI_ALLOWANCE, unreadable: false, covers: null, resets: null, topUp: null, current: false };
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

/** The checkout link for one pack (CR7 reads `?token_pack=`). */
export const packHref = (uid) => `/checkout?token_pack=${encodeURIComponent(uid)}`;

/**
 * The Token packs section (§10): `loading`, `unreadable`, `none` (nothing on
 * sale: TOPUP_UNAVAILABLE and no Buy) or `ready` with one card per pack.
 */
export function tokenPacks(reading) {
  if (reading?.status === 'loading') return { state: 'loading', packs: [], note: null };
  if (reading?.status !== 'ready' || !reading.data || !Array.isArray(reading.data.packs)) return { state: 'unreadable', packs: [], note: PACKS_UNREADABLE };
  const packs = reading.data.packs
    .filter((p) => p && typeof p.uid === 'string' && p.uid && micro(p.unit_amount) && p.unit_amount > 0 && p.currency === 'usd')
    .map((p) => ({ uid: p.uid, label: packLabel(p.unit_amount), line: TOKENS_LINE, href: packHref(p.uid) }));
  return packs.length ? { state: 'ready', packs, note: null } : { state: 'none', packs: [], note: TOPUP_UNAVAILABLE };
}

/** The price ids of every pack on sale: the Add-ons grid leaves those out. */
export function packPriceIds(reading) {
  const packs = reading?.status === 'ready' && Array.isArray(reading.data?.packs) ? reading.data.packs : [];
  return new Set(packs.map((p) => p?.price_id).filter((id) => typeof id === 'string'));
}

/** A catalog product the Add-ons grid must not draw: a token pack, or any product holding a pack's price. */
export function isTokenPackProduct(product, priceIds = new Set()) {
  if (product?.kind === 'token_pack' || product?.metadata?.kind === 'token_pack') return true;
  const prices = Array.isArray(product?.prices) ? product.prices : [];
  return prices.some((p) => priceIds.has(p?.id));
}
