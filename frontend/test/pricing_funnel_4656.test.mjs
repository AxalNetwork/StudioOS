import test from 'node:test';
import assert from 'node:assert/strict';
import { planCards } from '../src/lib/pricingModel.js';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { FUNNEL_EVENTS } from '../src/lib/funnel.js';

test('pricing selections use the card’s actual interval and keep free plans unbilled', () => {
  const growth = { licence_key: 'founder:growth', prices: [{ unit_amount: 2000, interval: 'month' }] };
  for (const signedIn of [false, true]) {
    const build = () => planCards({ plans: [growth] }, PLAN_CARDS.founder, { billing: 'yearly', tab: 'founder', signedIn }).cards;
    assert.deepEqual(build()[0].selection, { plan: 'founder:free', interval: null });
    assert.deepEqual(build()[1].selection, { plan: 'founder:growth', interval: 'monthly' });
    assert.equal(build()[2].selection, null);
    growth.prices.push({ unit_amount: 20000, interval: 'year' });
    assert.deepEqual(build()[1].selection, { plan: 'founder:growth', interval: 'yearly' });
    growth.prices.pop();
  }
  assert.ok(FUNNEL_EVENTS.has('pricing_view'));
  assert.ok(FUNNEL_EVENTS.has('pricing_plan_selected'));
});
