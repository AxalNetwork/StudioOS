/** Owner's 2026-10-21 Founder pricing. Offline planner for existing audited
 * admin catalogue routes; never calls Stripe, D1 or the production API. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FOUNDER_PRICES = Object.freeze([
  Object.freeze({ tier: 'growth', name: 'Validate + Build', month: 2000, year: 20400 }),
  Object.freeze({ tier: 'studio', name: 'Raise + Grow', month: 10000, year: 102000 }),
]);
const checkedId = (value, prefix) => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)) throw new Error(`Invalid ${prefix} identifier`);
  return value;
};

/** Input is GET /api/admin/catalog/products's export, kept outside the repo.
 * Create replacements first; verify them before executing any archive action.
 * Re-export and re-plan after an interrupted application to avoid duplicates. */
export function planFounderPrices(catalog) {
  return planRecurringPrices(catalog, FOUNDER_PRICES, 'tier');
}

/** Shared offline request planner; metadata keys come from its fixed callers. */
export function planRecurringPrices(catalog, specs, metadataKey) {
  if (!Array.isArray(catalog?.products)) throw new Error('Expected a catalogue products array');
  const create = [], archive = [];
  for (const spec of specs) {
    const products = catalog.products.filter(p => p.active === true && p.kind === 'subscription' && p.metadata?.[metadataKey] === spec.tier);
    if (products.length !== 1) throw new Error(`Expected exactly one active ${spec.tier} subscription product`);
    const product = products[0];
    const id = checkedId(product.id, 'prod');
    if (!Array.isArray(product.prices)) throw new Error(`Unreadable ${spec.tier} prices`);
    for (const interval of ['month', 'year']) {
      const prices = product.prices.filter(p => p.active === true && p.type === 'recurring'
        && p.currency?.toLowerCase() === 'usd' && p.interval === interval && p.interval_count === 1);
      if (!prices.some(p => p.unit_amount === spec[interval])) {
        create.push({ method: 'POST', path: `/api/admin/catalog/products/${id}/prices`, body: {
          currency: 'usd', unit_amount: spec[interval], type: 'recurring', interval, interval_count: 1,
          nickname: `${spec.name} — ${interval === 'year' ? 'yearly (15% off)' : 'monthly'}`,
        } });
      }
      for (const price of prices.filter(p => p.unit_amount !== spec[interval])) {
        archive.push({ method: 'POST', path: `/api/admin/catalog/prices/${checkedId(price.id, 'price')}/archive`, body: {} });
      }
    }
  }
  return { create, archive_after_verification: archive };
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
