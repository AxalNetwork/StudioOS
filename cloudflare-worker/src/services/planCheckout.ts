/**
 * D1051 (#2902, part 3 of #2451) — the rules behind one checkout route for a
 * new plan or a change: which plan a member may buy, at which price, whether
 * it is new or a change, and which way a change goes.
 *
 * WHO BUYS WHAT. A member buys a plan of their own profile only: a founder
 * the founder plans, an investor the investor plans, an advisor or an
 * operating partner their Pro plan. Staff hold no plan, and a member with no
 * profile chooses one first (D1048 §3's sheet modes, held here on the Worker).
 *
 * THE PRICE IS STRIPE'S. It is read from the catalogue mirror (`stripe_products`,
 * `services/catalog.ts`) by the plan's own metadata (`services/planCatalogue.ts`
 * `matches`), never typed and never taken from the client. A token pack price
 * is never a plan (D755 §9).
 *
 * A CHANGE (#2451 owner question 7, A). An upgrade applies now, with the
 * prorated difference charged today. A downgrade applies at the end of the
 * paid period, and nothing is charged. Which way a change goes is decided by
 * what the two prices cost a month: more is an upgrade, less a downgrade.
 */
import type { CatalogPrice, CatalogProduct } from './catalog';
import { planByKey, type CatalogueEntry } from './planCatalogue';
import { planMetaForProduct, type PlanMeta } from './planSubscription';
import { monthsPerCharge } from './planAllowance';

export type CheckoutInterval = 'month' | 'year';
export type CheckoutRefusal = { status: 400 | 403 | 404 | 409 | 503; code: string; message: string };

/** The plan family a role buys in, or why it buys none. Pure. */
export function familyForRole(role: unknown): { family: 'founder' | 'investor' | 'advisor' | 'partner' } | { refusal: CheckoutRefusal } {
  const r = String(role || '').toLowerCase();
  if (r === 'founder' || r === 'investor' || r === 'advisor' || r === 'partner') return { family: r };
  if (r === 'admin') return { refusal: { status: 403, code: 'staff_no_plan', message: 'Staff accounts hold no plan.' } };
  return { refusal: { status: 403, code: 'choose_profile', message: 'Choose your profile first. Its plans then show here.' } };
}

/**
 * The plan a caller asked for, if they may buy it: a catalogue entry of their
 * own family that is sold. The refusal says why not, in the catalogue's words.
 */
export function plannedEntry(role: unknown, planKey: unknown): { entry: CatalogueEntry } | { refusal: CheckoutRefusal } {
  const entry = typeof planKey === 'string' ? planByKey(planKey) : null;
  if (!entry) return { refusal: { status: 400, code: 'unknown_plan', message: 'That plan is not one Axal VC sells.' } };
  const fam = familyForRole(role);
  if ('refusal' in fam) return fam;
  if (entry.family !== fam.family) return { refusal: { status: 403, code: 'other_profile', message: 'This plan is for another profile.' } };
  if (!entry.sellable || !entry.matches) return { refusal: { status: 409, code: 'not_sellable', message: entry.sellable_reason || 'This plan is not sold here.' } };
  return { entry };
}

/** `month` or `year`; anything else is refused, never read as monthly. Pure. */
export const checkoutIntervalOf = (v: unknown): CheckoutInterval | null => (v === 'month' || v === 'year' ? v : null);

/**
 * The catalogue price a plan sells at for an interval: an active recurring
 * price, charged every one month or one year, on an active product whose
 * metadata is the plan's. Null when the mirror has none.
 */
export function priceForEntry(products: readonly CatalogProduct[], entry: CatalogueEntry, interval: CheckoutInterval):
  { product: CatalogProduct; price: CatalogPrice; meta: PlanMeta } | null {
  if (!entry.matches) return null;
  for (const product of products) {
    if (product.active === false || product.kind !== 'subscription') continue;
    if (!Object.entries(entry.matches).every(([k, v]) => product.metadata?.[k] === v)) continue;
    const price = product.prices.find((p) => p.active !== false && p.type === 'recurring' && p.interval === interval
      && (p.interval_count ?? 1) === 1 && Number.isSafeInteger(p.unit_amount));
    if (!price) continue;
    const meta = planMetaForProduct(product, price);
    if (meta) return { product, price, meta };
  }
  return null;
}

/** What a price costs a month, in its smallest unit, or null when it is not a monthly or yearly charge. Pure. */
export function monthlyCost(unitAmount: unknown, interval: unknown, count: unknown): number | null {
  const months = monthsPerCharge(interval, count ?? 1);
  const n = Number(unitAmount);
  return months && Number.isFinite(n) ? n / months : null;
}

/**
 * Which way a change goes (owner question 7, A): `upgrade` applies now and
 * charges the prorated difference; `downgrade` applies at the end of the paid
 * period and charges nothing; `same` is the plan already held.
 */
export function changeDirection(
  current: { price_id: string | null; unit_amount: unknown; interval: unknown; interval_count?: unknown },
  next: { price_id: string; unit_amount: unknown; interval: unknown; interval_count?: unknown },
): 'upgrade' | 'downgrade' | 'same' {
  if (current.price_id && current.price_id === next.price_id) return 'same';
  const a = monthlyCost(current.unit_amount, current.interval, current.interval_count);
  const b = monthlyCost(next.unit_amount, next.interval, next.interval_count);
  if (a == null || b == null) return 'upgrade';
  return b >= a ? 'upgrade' : 'downgrade';
}

/** The share of a year price saved against twelve months, as a whole percent, or null. The plans read's own rule (D816). Pure. */
export function yearlySavingPercent(products: readonly CatalogProduct[], entry: CatalogueEntry): number | null {
  const m = priceForEntry(products, entry, 'month');
  const y = priceForEntry(products, entry, 'year');
  if (!m || !y || !m.price.unit_amount || String(m.price.currency).toLowerCase() !== String(y.price.currency).toLowerCase()) return null;
  const saving = Math.round((1 - Number(y.price.unit_amount) / (12 * Number(m.price.unit_amount))) * 100);
  return saving > 0 ? saving : null;
}

/** A Stripe status that means the subscription will not become the plan: the start failed. */
export const FAILED_STATUSES = new Set(['incomplete_expired', 'canceled', 'unpaid']);
/** A Stripe status that means the plan is on. */
export const ON_STATUSES = new Set(['active', 'trialing']);
