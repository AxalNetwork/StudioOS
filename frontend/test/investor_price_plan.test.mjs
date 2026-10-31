/** Owner prices: Plus $50, Pro $150, each 15% off yearly. D1334 (#3540):
 * Plus is a billing tier, so its prices are planned once its product exists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVESTOR_PRICES, planInvestorPrices } from '../../scripts/plan-investor-prices.mjs';
import { planCards } from '../src/lib/pricingModel.js';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
const pro = { id: 'prod_pro', active: true, kind: 'subscription', metadata: { investor_tier: 'professional' }, prices: [
  { id: 'price_oldmonth', active: true, type: 'recurring', currency: 'usd', unit_amount: 14900, interval: 'month', interval_count: 1 },
  { id: 'price_oldyear', active: true, type: 'recurring', currency: 'usd', unit_amount: 142800, interval: 'year', interval_count: 1 },
] };

test('approved Investor amounts and annual equivalents', () => {
  assert.deepEqual(INVESTOR_PRICES.map(p => [p.tier, p.month, p.year]), [['plus', 5000, 51000], ['professional', 15000, 153000]]);
  const result = planInvestorPrices({ products: [pro] });
  assert.deepEqual(result.change.map(a => [a.method, a.path, a.body.unit_amount]), [
    ['POST', '/api/admin/catalog/prices/price_oldmonth/change', 15000], ['POST', '/api/admin/catalog/prices/price_oldyear/change', 153000],
  ]);
  assert.deepEqual(result.create, []);
  assert.deepEqual(result.archive_after_verification, []);
  const plans = [{ licence_key: 'investor:professional', product_id: pro.id, free: false, prices: result.change.map((a, i) => ({ ...pro.prices[i], ...a.body })) }];
  const monthly = planCards({ plans }, PLAN_CARDS.investor);
  assert.equal(monthly.cards.find(c => c.id === 'professional').price, '$150');
  const yearly = planCards({ plans }, PLAN_CARDS.investor, { billing: 'yearly' });
  const card = yearly.cards.find(c => c.id === 'professional');
  assert.deepEqual([card.price, card.note, yearly.saving], ['$127.50', '$1,530 billed yearly', 'Save 15%']);
});

test('D1334: with no Plus product the plan asks for one; with one, Plus is priced on it alone', () => {
  const none = planInvestorPrices({ products: [pro] });
  assert.deepEqual(none.product_needed.map(b => [b.licence_key, b.month, b.year]), [['investor:plus', 5000, 51000]]);
  assert.deepEqual(none.product_needed[0].metadata, { investor_tier: 'plus' });
  assert.ok(none.create.every(a => a.path.includes('/prod_pro/')));
  const plusProduct = { ...pro, id: 'prod_plus', metadata: { investor_tier: 'plus' }, prices: [] };
  const result = planInvestorPrices({ products: [pro, plusProduct] });
  assert.deepEqual(result.product_needed, []);
  assert.deepEqual(result.create.filter(a => a.path.includes('/prod_plus/')).map(a => [a.body.unit_amount, a.body.interval]), [[5000, 'month'], [51000, 'year']]);
});

test('existing correct Pro prices are reused and Founder products are ignored', () => {
  const result = planInvestorPrices({ products: [{ ...pro, prices: pro.prices.map((p, i) => ({ ...p, unit_amount: i ? 153000 : 15000 })) },
    { ...pro, id: 'prod_founder', metadata: { tier: 'growth' } }] });
  assert.deepEqual([result.create, result.archive_after_verification], [[], []]);
  assert.throws(() => planInvestorPrices({ products: [pro, pro] }));
});
