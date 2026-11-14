/**
 * D1334 (#3540) — /pricing's Investor tab sells Investor Plus once its Stripe
 * product is mirrored; the paywall and the ladders place it between Basic and
 * Pro, and no surface offers Plus for a Pro feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planCards, heldCard } from '../src/lib/pricingModel.js';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planOf } from '../src/lib/plansPricing.js';
import { nextPlanKey, planKeyOfTier, planKeyOfProduct } from '../src/components/checkout/checkoutEntry.js';
import { hasInvestorTier } from '../src/sidebarConfig.js';
import { quotaFullLine } from '../src/components/deals/dealRoomCopy.js';

const price = (unit_amount, interval) => ({ price_id: `price_plus_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 0 });
const PLUS = { family: 'investor', licence_key: 'investor:plus', product_id: 'prod_plus', plan_name: 'Investor Plus', free: false,
  prices: [price(5000, 'month'), price(51000, 'year')] };

test('/pricing\'s Investor tab sells Plus from the mirrored price, with no figure typed', () => {
  const card = planCards({ plans: [PLUS] }, PLAN_CARDS.investor).cards.find((c) => c.id === 'plus');
  assert.equal(card.offered, true);
  assert.equal(card.price, '$50');
  assert.equal(card.button.disabled, false);
  assert.equal(card.button.label, 'Get Investor Plus');
  const yearly = planCards({ plans: [PLUS] }, PLAN_CARDS.investor, { billing: 'yearly' }).cards.find((c) => c.id === 'plus');
  assert.deepEqual([yearly.price, yearly.note], ['$42.50', '$510 billed yearly']);
  const signedIn = planCards({ plans: [PLUS] }, PLAN_CARDS.investor, { signedIn: true, held: 'free' }).cards.find((c) => c.id === 'plus');
  assert.equal(signedIn.button.checkout, true, 'a signed-in investor buys Plus in the checkout sheet');
  // With no product mirrored the card stays on the page and says so, never a price.
  const unpriced = planCards({ plans: [] }, PLAN_CARDS.investor).cards.find((c) => c.id === 'plus');
  assert.equal(unpriced.offered, false);
  assert.equal(unpriced.price, null);
});

test('Plus is a held plan and the next step up from Basic', () => {
  assert.equal(heldCard({ investor_tier: 'plus' }, 'investor', 'investor'), 'plus');
  assert.deepEqual(planOf({ investor_tier: 'plus' }), { family: 'investor', licence_key: 'investor:plus' });
  assert.equal(planKeyOfProduct({ metadata: { investor_tier: 'plus' } }), 'investor:plus');
  assert.equal(planKeyOfTier('plus'), 'investor:plus');
  assert.deepEqual(['free', 'plus'].map((t) => nextPlanKey('investor', t)), ['investor:plus', 'investor:professional']);
});

test('a Plus investor stays locked out of Professional rows, and a full room names Plus from Basic', () => {
  const plus = { role: 'investor', investor_tier: 'plus', investor_subscription_status: 'active' };
  assert.equal(hasInvestorTier(plus, 'plus'), true);
  assert.equal(hasInvestorTier(plus, 'professional'), false);
  assert.equal(hasInvestorTier(plus, 'institutional'), false);
  assert.equal(hasInvestorTier({ ...plus, investor_tier: 'free' }, 'plus'), false);
  assert.match(quotaFullLine({ tier: 'free', used: 1, cap: 1, upgrade_to: 'plus', upgrade_cap: 2 }), /Plus raises this to 2\./);
  assert.match(quotaFullLine({ tier: 'plus', used: 2, cap: 2, upgrade_to: 'professional', upgrade_cap: 5 }), /^Your Plus plan is full.*Professional raises this to 5\./);
});
