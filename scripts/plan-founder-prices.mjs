/** Owner's 2026-10-21 Founder pricing. Offline planner for existing audited
 * admin catalogue routes; never calls Stripe, D1 or the production API. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { pricesForMetadata } from './lib/ownerPlanPrices.mjs';

export const FOUNDER_PRICES = pricesForMetadata('tier');
export const OWNER_PRICE_REASON = "Owner's price table, #3702";
const checkedId = (value, prefix) => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)) throw new Error(`Invalid ${prefix} identifier`);
  return value;
};

/** Input is GET /api/admin/catalog/products's export, kept outside the repo.
 * Create replacements first; verify them before executing any archive action.
 * Re-export and re-plan after an interrupted application to avoid duplicates. */
export function planFounderPrices(catalog, reason = OWNER_PRICE_REASON) {
  return planRecurringPrices(catalog, FOUNDER_PRICES, 'tier', reason);
}

/** Shared offline request planner; metadata keys come from its fixed callers. */
export function planRecurringPrices(catalog, specs, metadataKey, reason = OWNER_PRICE_REASON) {
  if (!Array.isArray(catalog?.products)) throw new Error('Expected a catalogue products array');
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500)
    throw new Error('A reason of 10 to 500 characters is required for price changes');
  reason = reason.trim();
  const change = [], create = [], archive = [];
  for (const spec of specs) {
    const products = catalog.products.filter(p => p.active === true && p.kind === 'subscription' && p.metadata?.[metadataKey] === spec.tier);
    if (products.length !== 1) throw new Error(`Expected exactly one active ${spec.tier} subscription product`);
    const product = products[0];
    const id = checkedId(product.id, 'prod');
    if (!Array.isArray(product.prices)) throw new Error(`Unreadable ${spec.tier} prices`);
    for (const interval of ['month', 'year']) {
      const prices = product.prices.filter(p => p.active === true && p.type === 'recurring'
        && p.currency?.toLowerCase() === 'usd' && p.interval === interval && p.interval_count === 1);
      const matching = prices.some(p => p.unit_amount === spec[interval]);
      const nickname = `${spec.name} — ${interval === 'year' ? 'yearly (15% off)' : 'monthly'}`;
      if (!matching && prices.length === 1) {
        change.push({ method: 'POST', path: `/api/admin/catalog/prices/${checkedId(prices[0].id, 'price')}/change`, body: {
          unit_amount: spec[interval], reason, idempotency_key: `own3702-${spec.tier}-${interval}`, nickname,
        } });
        continue;
      }
      if (!matching) create.push({ method: 'POST', path: `/api/admin/catalog/products/${id}/prices`, body: {
        currency: 'usd', unit_amount: spec[interval], type: 'recurring', interval, interval_count: 1, nickname, reason,
      } });
      for (const price of prices.filter(p => p.unit_amount !== spec[interval])) {
        archive.push({ method: 'POST', path: `/api/admin/catalog/prices/${checkedId(price.id, 'price')}/archive`, body: { reason } });
      }
    }
  }
  return { change, create, archive_after_verification: archive };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--catalog') throw new Error('Usage: node scripts/plan-founder-prices.mjs --catalog /path/to/catalog-export.json');
    console.log(JSON.stringify(planFounderPrices(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch {
    // Never echo export contents or parsing errors: the input stays private.
    console.error('Cannot plan Founder prices. Supply a valid catalogue export with exactly one active subscription product for each Founder tier.');
    process.exitCode = 1;
  }
}
