/** Owner's 2026-10-21 Investor prices. Offline only; no production access. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planRecurringPrices } from './plan-founder-prices.mjs';

export const INVESTOR_PRICES = Object.freeze([
  Object.freeze({ tier: 'plus', name: 'Investor Plus', month: 5000, year: 51000 }),
  Object.freeze({ tier: 'professional', name: 'Investor Pro', month: 15000, year: 153000 }),
]);

export function planInvestorPrices(catalog) {
  const plus = INVESTOR_PRICES.find(p => p.tier === 'plus');
  // Only professional/institutional currently exist in billing, metadata
  // validation, entitlements and public plan reads. Do not sell a licence
  // whose subscription cannot be fulfilled by merely making a price.
  return {
    ...planRecurringPrices(catalog, INVESTOR_PRICES.filter(p => p.tier === 'professional'), 'investor_tier'),
    blocked: [{ licence_key: 'investor:plus', month: plus.month, year: plus.year,
      reason: 'Investor Plus needs a supported billing tier and licence, with owner-defined quotas, before activation.' }],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--catalog') throw new Error('Invalid arguments');
    console.log(JSON.stringify(planInvestorPrices(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch {
    console.error('Cannot plan Investor prices. Supply --catalog /path/to/catalog-export.json with exactly one active Investor Pro subscription product.');
    process.exitCode = 1;
  }
}
