/** D1430 (#3702): Advisor and Operating Partner price requests, offline only. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OWNER_PLAN_PRICES, pricesForMetadata } from './lib/ownerPlanPrices.mjs';
import { planRecurringPrices, OWNER_PRICE_REASON } from './plan-founder-prices.mjs';
export const PERSONA_PRICES = pricesForMetadata('plan_group');
export function planPersonaPrices(catalog, reason = OWNER_PRICE_REASON) {
  if (!Array.isArray(catalog?.products)) throw new Error('Expected a catalogue products array');
  const missing = PERSONA_PRICES.filter(s => !catalog.products.some(p => p.active === true && p.kind === 'subscription' && p.metadata?.plan_group === s.tier));
  return {
    ...planRecurringPrices(catalog, PERSONA_PRICES.filter(s => !missing.includes(s)), 'plan_group', reason),
    product_needed: missing.map(s => ({ licence_key: OWNER_PLAN_PRICES.find(p => p.metadata_key === 'plan_group' && p.metadata_value === s.tier).licence_key,
      metadata: { plan_group: s.tier }, month: s.month, year: s.year,
      reason: 'Create this subscription product in HQ › Payments, then plan again.' })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--catalog') throw new Error('Invalid arguments');
    console.log(JSON.stringify(planPersonaPrices(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch {
    console.error('Cannot plan Advisor and Operating Partner prices. Supply --catalog /path/to/catalog-export.json with unambiguous subscription products.');
    process.exitCode = 1;
  }
}
