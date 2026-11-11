// D4652: prices and included AI allowance are distinct, derived from the public catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planCards, planIntervalAllowance } from '../src/lib/pricingModel.js';
import { PLAN_CARDS, HERO, AI_BAND, FAQ } from '../src/lib/sitePricing.js';

const month = (cents, allowance) => ({ unit_amount: cents, currency: 'usd', interval:'month', interval_count: 1, allowance_microusd: allowance });
const year = (cents, allowance) => ({ unit_amount: cents, currency: 'usd', interval:'year', interval_count: 1, allowance_microusd: allowance });
const founder = (monthly, yearly) => ({
  family: 'founder', licence_key: 'founder:growth', free: false,
  monthly, yearly, prices: [monthly, yearly].filter(Boolean),
});

test('annual total and monthly-vs-annual AI allowance reflect the catalogue, not the discount label',()=>{
  const plan = founder(month(2000,5_000_000), year(19200,4_000_000));
  assert.deepEqual(planIntervalAllowance(plan),{
    monthly:'$5',yearly:'$4',annualCharge:'$192',differs:true,
  });
  const built = planCards({ plans:[plan] }, PLAN_CARDS.founder,{billing:'yearly',tab:'founder'});
  const growth = built.cards.find(x=>x.id==='growth');
  assert.equal(growth.note,'$192 billed yearly');
  assert.equal(growth.allowanceComparison?.monthly,'$5');
  assert.equal(growth.allowanceComparison?.yearly,'$4');
});

test('does not invent a yearly price, a missing allowance or a false discount',()=>{
  assert.equal(planIntervalAllowance(founder(month(2000,5_000_000),null)),null);
  assert.equal(planIntervalAllowance(founder(month(2000,5_000_000),{unit_amount:19200,currency:'usd',interval:'year'})),null);
  assert.equal(planIntervalAllowance(null),null);
  assert.equal(planIntervalAllowance(founder(month(1000,0),year(9600,0)))?.differs,false);
});

test('public wording clearly separates free AI access from funded allowance and purchased tokens',()=>{
  assert.match(HERO.line,/Free users can add AI tokens/);
  assert.doesNotMatch(HERO.line,/AI is included with every plan/);
  assert.match(AI_BAND.text,/Free plans include no funded AI allowance/);
  assert.match(AI_BAND.text,/Purchased tokens remain separate/);
  const faqs = new Map(FAQ);
  for(const q of ['What happens if I choose yearly billing?','When does my subscription renew or stop?','What if I downgrade, cancel or a payment fails?','What currency and taxes will I pay?','What about AI allowance resets and tokens?'])assert.ok(faqs.get(q),q);
  assert.match(faqs.get('How do refunds work?'),/applicable law/);
});

test('pricing page shows per-card comparison and near-selector explanation without altering checkout calculations',()=>{
  const s=readFileSync(new URL('../src/pages/PricingPage.jsx',import.meta.url),'utf8');
  assert.match(s,/pricing-ai-interval-/);
  assert.match(s,/pricing-billing-allowance-note/);
  assert.match(s,/allowanceComparison\.monthly/);
  assert.match(s,/allowanceComparison\.yearly/);
  assert.match(s,/Full annual charges are shown on the cards/);
});
