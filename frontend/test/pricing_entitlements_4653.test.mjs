/** D4653: public investor defaults stay derived; licence/usage terms are shared without inventing a price, seat charge or research allowance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { plansAndPacks } from '../../cloudflare-worker/src/services/aiCredits.ts';
import { INVESTOR_QUOTAS } from '../../cloudflare-worker/src/middleware/requireInvestorTier.ts';
import { publicEntitlementCatalogue } from '../../cloudflare-worker/src/services/planEntitlements.ts';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planCards } from '../src/lib/pricingModel.js';
import { entitlementQuestions, investorCapacityLine, investorCapacityGroup, planCapacityLine, LICENCE_CHARGE, LICENCE_SCOPE, ADDITIONAL_LICENCE,
  USAGE_SCOPE, INTRODUCTION_SCOPE, SERVICE_SCOPE, MATCHING_SCOPE, RESEARCH_SCOPE, SUPPORT_SCOPE, AVAILABILITY_SCOPE } from '../src/lib/pricingEntitlements.js';
import account from '../src/pages/docs/sections/account.js';
import CheckoutSheet from '../src/components/checkout/CheckoutSheet.jsx';

function emptyCatalogueEnv() {
  return { DB: { prepare() {
    const statement = { bind: () => statement, all: async () => ({ success: true, results: [] }),
      first: async () => null, run: async () => ({ success: true }) };
    return statement;
  } } };
}

test('the actual public plans read publishes quota defaults even without a sellable price', async () => {
  const body = await plansAndPacks(emptyCatalogueEnv());
  const plus = body.catalogue.find(row => row.key === 'investor:plus');
  assert.equal(plus.entitlements.charging_unit, 'member_licence');
  assert.equal(plus.entitlements.investor_defaults.active_deal_rooms, INVESTOR_QUOTAS.plus.dealroom_max);
  assert.equal(plus.entitlements.investor_defaults.introduction_requests_per_quarter, INVESTOR_QUOTAS.plus.intros_per_quarter);
  assert.equal(plus.entitlements.investor_defaults.colleague_seats, INVESTOR_QUOTAS.plus.seats);
  assert.deepEqual(body.plans.find(row => row.licence_key === 'investor:plus').catalogue.entitlements, plus.entitlements);
  assert.equal(plus.entitlements.research_search_export_limits, 'not_published_in_catalogue');
  assert.equal(plus.entitlements.human_sessions_and_third_party_fees, 'separately_quoted');
  assert.equal(plus.entitlements.support_commitment, 'no_sla_or_included_onboarding');
  assert.equal(body.catalogue.find(row => row.key === 'founder:free').entitlements.charging_unit, null);
  assert.equal(body.catalogue.find(row => row.key === 'founder:growth').entitlements.investor_defaults, null);
  assert.equal(body.catalogue.find(row => row.key === 'investor:institutional').entitlements.investor_defaults.negotiated, true);
});

test('changing the enforcement default changes the public read and its buyer-facing explanation', async () => {
  const previous = INVESTOR_QUOTAS.plus.dealroom_max;
  try {
    INVESTOR_QUOTAS.plus.dealroom_max = previous + 17;
    const body = await plansAndPacks(emptyCatalogueEnv());
    assert.ok(investorCapacityLine(body.catalogue).includes(`Investor Plus: ${previous + 17} active deal rooms`));
    assert.match(investorCapacityLine(body.catalogue), /requests per quarter/);
    assert.match(investorCapacityLine(body.catalogue), /Institutional capacity and seat terms are agreed/);
  } finally { INVESTOR_QUOTAS.plus.dealroom_max = previous; }
});

test('missing, negative or fractional quota data is unavailable, never zero or unlimited', () => {
  const entries = publicEntitlementCatalogue();
  for (const bad of [null, {}, [], entries.filter(row => row.key !== 'investor:plus')]) {
    assert.match(investorCapacityLine(bad), /unreadable/);
    assert.doesNotMatch(investorCapacityLine(bad), /0 active|unlimited/i);
  }
  for (const value of [null, -1, 1.5, '10', NaN]) {
    const changed = structuredClone(entries);
    changed.find(row => row.key === 'investor:plus').entitlements.investor_defaults.introduction_requests_per_quarter = value;
    assert.match(investorCapacityLine(changed), /unreadable/);
  }
});

test('a paid card states the charging unit and preserves the actual price; free is still free', () => {
  const read = { plans: [{ licence_key: 'founder:growth', free: false,
    prices: [{ unit_amount: 3700, currency: 'usd', interval: 'month', interval_count: 1, allowance_microusd: 0 }] }] };
  const cards = planCards(read, PLAN_CARDS.founder);
  assert.equal(cards.cards.find(card => card.id === 'growth').price, '$37');
  assert.match(cards.cards.find(card => card.id === 'growth').unit, /per licence/);
  assert.equal(cards.cards.find(card => card.id === 'free').price, 'Free');
});

test('comparison and Checkout retain recorded zero, negotiated capacity and unknown values distinctly', () => {
  const entries = publicEntitlementCatalogue();
  const group = investorCapacityGroup('investor', entries);
  assert.equal(group[1].find(row => row[0] === 'Active deal rooms (default)')[2], String(INVESTOR_QUOTAS.plus.dealroom_max));
  assert.equal(group[1].find(row => row[0] === 'Colleague seats (default)')[2], '0');
  assert.equal(group[1][0][4], 'Agreed with Axal VC');
  assert.equal(group[1].find(row => row[0] === 'Colleague seats (default)')[4], String(INVESTOR_QUOTAS.institutional.seats));
  assert.equal(investorCapacityGroup('founder', entries), null);
  assert.equal(investorCapacityGroup('investor', null)[1][0][1], 'Not recorded');
  assert.equal(investorCapacityGroup('investor', {})[1][0][1], 'Not recorded');
  const plus = entries.find(row => row.key === 'investor:plus');
  assert.ok(planCapacityLine(plus).includes(`${INVESTOR_QUOTAS.plus.intros_per_quarter} introduction requests per UTC quarter`));
  assert.match(planCapacityLine({ ...plus, entitlements: null }), /unavailable/);
  assert.match(planCapacityLine(entries.find(row => row.key === 'investor:institutional')), /agreed with Axal VC/);
  assert.doesNotMatch(planCapacityLine(entries.find(row => row.key === 'investor:institutional')), /1,?000,?000|unlimited/);
  assert.equal(planCapacityLine({ key: 42 }), null);
});

test('Pricing and Help use the same licence, shared-usage and service explanations', () => {
  const questions = entitlementQuestions('investor', publicEntitlementCatalogue()).map(([, answer]) => answer).join('\n');
  for (const term of [LICENCE_CHARGE, LICENCE_SCOPE, ADDITIONAL_LICENCE, USAGE_SCOPE, INTRODUCTION_SCOPE, SERVICE_SCOPE, MATCHING_SCOPE, RESEARCH_SCOPE, SUPPORT_SCOPE, AVAILABILITY_SCOPE]) {
    assert.ok(questions.includes(term), term);
  }
  const help = JSON.stringify(account);
  for (const term of [LICENCE_SCOPE, ADDITIONAL_LICENCE, USAGE_SCOPE, INTRODUCTION_SCOPE, SERVICE_SCOPE, RESEARCH_SCOPE, SUPPORT_SCOPE, AVAILABILITY_SCOPE]) assert.ok(help.includes(term), term);
  assert.doesNotMatch(questions, /Standard research usage limits|Higher AI research usage limits|Inbound demand on tap/);
  assert.match(LICENCE_SCOPE, /without a paid plan stays on its free tier/);
  assert.match(LICENCE_SCOPE, /Institutional colleague seat uses the primary account/);
  assert.match(ADDITIONAL_LICENCE, /Admin grants it/);
  assert.match(ADDITIONAL_LICENCE, /billed separately at its own list price/);
  assert.match(USAGE_SCOPE, /Storage allowances are not added/);
  assert.match(INTRODUCTION_SCOPE, /UTC calendar month/);
  assert.match(INTRODUCTION_SCOPE, /separate UTC calendar-quarter counter/);
});

test('Checkout shows licence scope and service boundaries before a payment can start', () => {
  const plan = { family: 'investor', licence_key: 'investor:plus', catalogue: publicEntitlementCatalogue().find(row => row.key === 'investor:plus'),
    prices: [{ unit_amount: 3700, currency: 'usd', interval: 'month', interval_count: 1, allowance_microusd: 0 }] };
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(CheckoutSheet,
    { plan, spec: PLAN_CARDS.investor[1], user: null, role: null, held: null, interval: 'monthly', onClose() {} })));
  assert.ok(html.includes('checkout-licence-scope'));
  assert.ok(html.includes(LICENCE_CHARGE));
  assert.ok(html.includes('checkout-service-scope'));
  assert.ok(html.includes(SERVICE_SCOPE));
  assert.ok(html.includes(SUPPORT_SCOPE));
  assert.ok(html.includes(AVAILABILITY_SCOPE));
  assert.ok(html.includes('checkout-plan-capacity'));
  assert.ok(html.includes(planCapacityLine(plan.catalogue)));
});
