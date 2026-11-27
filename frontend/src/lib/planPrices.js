/**
 * D1050 (#2901) — a plan's price, for every surface that names one (the
 * paywall, Billing and the door pages), from the one read that holds it:
 * `GET /api/public/plans-and-packs`, Stripe's D1 mirror through the Worker.
 * No price is typed in the code that draws a plan (`frontend/test/
 * plan_catalogue_d1050.test.mjs` fails on one).
 *
 * The read is made once per page load and shared. While it is reading, a
 * price says so; a price it could not read, or a plan it does not price,
 * says that, never a zero. A free plan is free without a read.
 */
import { useEffect, useState } from 'react';
import { publicPricingApi } from './api/publicPricing';

export const PRICE_READING = 'Reading…';
export const PRICE_UNREAD = 'Price not read';
export const PRICE_UNREAD_LINE = 'The price couldn’t be read just now. That doesn’t mean it’s free.';
export const FREE = 'Free';

let pending = null;

/** The plans read, once per page load. A failure is not kept, so a later call reads again. */
export function loadPlans() {
  if (!pending) pending = Promise.resolve().then(() => publicPricingApi.plansAndPacks()).catch((e) => { pending = null; throw e; });
  return pending;
}

/** For tests: forget the shared read. */
export function resetPlansRead() { pending = null; }

/** The plans read as a state: `{ status: 'loading' | 'ready' | 'error', data }`. */
export function usePlansRead() {
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let live = true;
    loadPlans().then(
      (data) => { if (live) setRead(data && Array.isArray(data.plans) ? { status: 'ready', data } : { status: 'error', data: null }); },
      () => { if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, []);
  return read;
}

/** The read's plan sold under a `licence_key` (`founder:growth`, `investor:professional`, `advisor`, `partner`), or null. */
export function planOfKey(data, licenceKey) {
  const plans = Array.isArray(data?.plans) ? data.plans : [];
  return plans.find((p) => p && p.free !== true && p.licence_key === licenceKey) || null;
}

const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * One interval's price in US dollars, `{ amount: '$20', per: 'month' }`, or
 * null when the plan does not sell that interval in dollars.
 */
export function priceOf(data, licenceKey, interval = 'month') {
  const plan = planOfKey(data, licenceKey);
  const prices = Array.isArray(plan?.prices) ? plan.prices : [];
  const p = prices.find((x) => x && x.interval === interval && (x.interval_count ?? 1) === 1
    && Number.isSafeInteger(x.unit_amount) && x.unit_amount >= 0 && String(x.currency || 'usd').toLowerCase() === 'usd');
  return p ? { amount: money(p.unit_amount), per: interval } : null;
}

/**
 * What a price reads as text in each state of the read:
 *   - reading: "Reading…";
 *   - read, priced: "$20 / month" (or "/ year");
 *   - could not be read, or not priced: "Price not read", never a zero.
 */
export function priceText(read, licenceKey, interval = 'month') {
  if (!read || read.status === 'loading') return PRICE_READING;
  if (read.status !== 'ready') return PRICE_UNREAD;
  const p = priceOf(read.data, licenceKey, interval);
  return p ? `${p.amount} / ${p.per}` : PRICE_UNREAD;
}
