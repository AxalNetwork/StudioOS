/** Owner prices: Plus $50, Pro $150, each 15% off yearly. Never sell an
 * unsupported Plus licence merely by creating a Stripe price. */
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
  assert.deepEqual(result.create.map(a => [a.method, a.path, a.body.unit_amount, a.body.interval]), [
    ['POST', '/api/admin/catalog/products/prod_pro/prices', 15000, 'month'],
    ['POST', '/api/admin/catalog/products/prod_pro/prices', 153000, 'year'],
  ]);
  assert.deepEqual(result.archive_after_verification.map(a => a.path), ['/api/admin/catalog/prices/price_oldmonth/archive', '/api/admin/catalog/prices/price_oldyear/archive']);
  const plans = [{ licence_key: 'investor:professional', product_id: pro.id, free: false, prices: result.create.map(a => a.body) }];
  const monthly = planCards({ plans }, PLAN_CARDS.investor);
  assert.equal(monthly.cards.find(c => c.id === 'professional').price, '$150');
  const yearly = planCards({ plans }, PLAN_CARDS.investor, { billing: 'yearly' });
  const card = yearly.cards.find(c => c.id === 'professional');
  assert.deepEqual([card.price, card.note, yearly.saving], ['$127.50', '$1,530 billed yearly', 'Save 15%']);
});

test('Plus remains blocked, even if the input contains an unsupported Plus product', () => {
  const result = planInvestorPrices({ products: [pro, { ...pro, id: 'prod_plus', metadata: { investor_tier: 'plus' } }] });
  assert.deepEqual(result.blocked.map(b => [b.licence_key, b.month, b.year]), [['investor:plus', 5000, 51000]]);
  assert.match(result.blocked[0].reason, /billing tier|licence/);
  assert.ok(result.create.every(a => a.path.includes('/prod_pro/')));
});

test('existing correct Pro prices are reused and Founder products are ignored', () => {
  const result = planInvestorPrices({ products: [{ ...pro, prices: pro.prices.map((p, i) => ({ ...p, unit_amount: i ? 153000 : 15000 })) },
    { ...pro, id: 'prod_founder', metadata: { tier: 'growth' } }] });
  assert.deepEqual([result.create, result.archive_after_verification], [[], []]);
  assert.throws(() => planInvestorPrices({ products: [pro, pro] }));
});
