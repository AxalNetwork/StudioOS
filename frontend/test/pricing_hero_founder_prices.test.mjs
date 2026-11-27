/** Owner's hero and Founder price correction: same artwork as Learning,
 * exact audited catalogue actions, and prices/discounts read by the page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { planCards } from '../src/lib/pricingModel.js';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planFounderPrices } from '../../scripts/plan-founder-prices.mjs';

const product = (tier, prices = []) => ({ id: `prod_${tier}`, active: true, kind: 'subscription', metadata: { tier }, prices });
const price = (id, unit_amount, interval, extra = {}) => ({ id: `price_${id}`, active: true, currency: 'usd', type: 'recurring', interval, interval_count: 1, unit_amount, ...extra });
const catalog = { products: [product('growth', [price('oldgrowth', 7900, 'month')]), product('studio', [price('oldstudio', 24900, 'month')])] };

test('Pricing hero carries Learning artwork and a decorative, readable overlay', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PricingBody)));
  assert.match(html, /<section class="axp-hero">\s*<img[^>]+src="\/site\/home-hero.webp"[^>]+alt=""/);
  assert.match(html, /aria-hidden="true" class="axp-hero-shade"/);
  const css = readFileSync('frontend/src/pages/pricing.css', 'utf8');
  assert.match(css, /\.axp-hero \{[^}]*position: relative;[^}]*isolation: isolate;[^}]*overflow: hidden;/);
  assert.match(css, /\.axp-hero-image \{[^}]*object-fit: cover;[^}]*object-position: center 45%;/);
  assert.match(css, /\.axp-hero-shade \{[^}]*background: var\(--p-hero\)/);
  for (const block of [css.split('.dark .axp.axp-app')[0], css.split('.dark .axp.axp-app')[1].split('}')[0]])
    assert.match(block, /--p-hero: linear-gradient\(90deg, rgba\(/, 'image remains visible beneath both palettes');
});

test('offline catalogue plan changes old monthly prices and creates the missing yearly prices', () => {
  const plan = planFounderPrices(catalog);
  assert.deepEqual(plan.change.map(a => [a.path, a.body.unit_amount]), [
    ['/api/admin/catalog/prices/price_oldgrowth/change', 2000], ['/api/admin/catalog/prices/price_oldstudio/change', 10000],
  ]);
  assert.deepEqual(plan.create.map(a => [a.path, a.body.unit_amount, a.body.interval]), [
    ['/api/admin/catalog/products/prod_growth/prices', 20400, 'year'], ['/api/admin/catalog/products/prod_studio/prices', 102000, 'year'],
  ]);
  assert.deepEqual(plan.archive_after_verification, [], 'single old prices use the existing change route');
  const plans = [{ licence_key: 'founder:growth', free: false, prices: [{ unit_amount: 2000, currency: 'usd', interval: 'month' }, plan.create[0].body] },
    { licence_key: 'founder:studio', free: false, prices: [{ unit_amount: 10000, currency: 'usd', interval: 'month' }, plan.create[1].body] }];
  const monthly = planCards({ plans }, PLAN_CARDS.founder);
  assert.deepEqual(monthly.cards.map(c => c.price), ['Free', '$20', '$100']);
  assert.equal(monthly.cards[2].lead, 'Everything in Validate + Build, plus:');
  const yearly = planCards({ plans }, PLAN_CARDS.founder, { billing: 'yearly' });
  assert.deepEqual(yearly.cards.map(c => [c.price, c.note]), [['Free', ''], ['$17', '$204 billed yearly'], ['$85', '$1,020 billed yearly']]);
  assert.equal(yearly.saving, 'Save 15%');
});

test('replanning is a no-op once prices match; other currencies and products are untouched', () => {
  const input = { products: [product('growth', [price('gm', 2000, 'month'), price('gy', 20400, 'year'), price('eur', 7900, 'month', { currency: 'eur' }), price('multi', 7900, 'month', { interval_count: 3 })]),
    product('studio', [price('sm', 10000, 'month'), price('sy', 102000, 'year')]), product('unrelated')] };
  assert.deepEqual(planFounderPrices(input), { change: [], create: [], archive_after_verification: [] });
});

test('missing, ambiguous and malformed catalogue entries fail closed', () => {
  for (const input of [null, { products: [] }, { products: [...catalog.products, product('growth')] },
    { products: [{ ...catalog.products[0], id: 'prod_bad/route' }, catalog.products[1]] },
    { products: [{ ...catalog.products[0], prices: null }, catalog.products[1]] },
    { products: [{ ...catalog.products[0], active: false }, catalog.products[1]] },
    { products: [{ ...catalog.products[0], kind: 'one_time' }, catalog.products[1]] },
    { products: [{ ...catalog.products[0], prices: [price('bad/route', 7900, 'month')] }, catalog.products[1]] }])
    assert.throws(() => planFounderPrices(input));
});
