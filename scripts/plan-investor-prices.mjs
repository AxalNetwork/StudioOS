/** Owner's 2026-10-21 Investor prices. Offline only; no production access. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planRecurringPrices, OWNER_PRICE_REASON } from './plan-founder-prices.mjs';

import { pricesForMetadata } from './lib/ownerPlanPrices.mjs';

export const INVESTOR_PRICES = pricesForMetadata('investor_tier');

export function planInvestorPrices(catalog, reason = OWNER_PRICE_REASON) {
  if (!Array.isArray(catalog?.products)) throw new Error('Expected a catalogue products array');
  // D1334 (#3540): Investor Plus is a billing tier now, so its prices are
  // planned like Pro's. Until HQ › Payments has created the Plus product
  // (metadata investor_tier=plus), it is listed as a product still to make,
  // never priced on another product.
  const hasPlus = catalog.products.some(p => p.active === true && p.kind === 'subscription' && p.metadata?.investor_tier === 'plus');
  const specs = INVESTOR_PRICES.filter(p => p.tier !== 'plus' || hasPlus);
  const plus = INVESTOR_PRICES.find(p => p.tier === 'plus');
  const planned = planRecurringPrices(catalog, specs, 'investor_tier', reason);
  // Archived prices stay on existing subscriptions; Custom is no new checkout.
  const customPrices = catalog.products.filter(p => p.active === true && p.kind === 'subscription' && p.metadata?.investor_tier === 'institutional').flatMap(p => {
    if (!Array.isArray(p.prices)) throw new Error('Unreadable Institutional prices');
    return p.prices.filter(x => x.active === true).map(x => {
      if (!/^price_[A-Za-z0-9]+$/.test(x.id)) throw new Error('Invalid price identifier');
      return { method: 'POST', path: `/api/admin/catalog/prices/${x.id}/archive`, body: { reason: reason.trim() } };
    });
  });
  return {
    ...planned,
    archive_after_verification: [...planned.archive_after_verification, ...customPrices],
    product_needed: hasPlus ? [] : [{ licence_key: 'investor:plus', metadata: { investor_tier: 'plus' }, month: plus.month, year: plus.year,
      reason: 'Create the Investor Plus product in HQ › Payments first (D1334), then plan again.' }],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--catalog') throw new Error('Invalid arguments');
    console.log(JSON.stringify(planInvestorPrices(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch {
    console.error('Cannot plan Investor prices. Supply --catalog /path/to/catalog-export.json with exactly one active Investor Pro subscription product, and at most one Investor Plus.');
    process.exitCode = 1;
  }
}
