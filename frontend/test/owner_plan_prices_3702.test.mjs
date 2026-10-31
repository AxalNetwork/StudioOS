// D1430: owner targets are offline; every runtime card still reads the mirror.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_PLAN_PRICES, OWNER_UNPRICED } from '../../scripts/lib/ownerPlanPrices.mjs';
import { FOUNDER_PRICES, planFounderPrices } from '../../scripts/plan-founder-prices.mjs';
import { INVESTOR_PRICES, planInvestorPrices } from '../../scripts/plan-investor-prices.mjs';
import { PERSONA_PRICES, planPersonaPrices } from '../../scripts/plan-persona-prices.mjs';
import { PLAN_CATALOGUE } from '../../cloudflare-worker/src/services/planCatalogue.ts';
import { STORAGE_TIERS } from '../../cloudflare-worker/src/services/storagePlans.ts';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planCards } from '../src/lib/pricingModel.js';
const spec = OWNER_PLAN_PRICES;
const price = (id, unit_amount, interval, extra = {}) => ({ id, unit_amount, interval, interval_count: 1, type: 'recurring', currency: 'usd', active: true, ...extra });
const product = (p, prices = []) => ({ id: `prod_${p.metadata_value}`, active: true, kind: 'subscription', metadata: { [p.metadata_key]: p.metadata_value }, prices });
const catalogue = () => ({ products: spec.map(p => product(p)) });

test('the six paid plan targets exactly match the owner table, catalogue metadata and storage amounts', () => {
  assert.deepEqual(spec.map(p => [p.licence_key, p.month, p.year]), [
    ['founder:growth', 2000, 20400], ['founder:studio', 10000, 102000], ['investor:plus', 5000, 51000],
    ['investor:professional', 15000, 153000], ['advisor', 2000, 20400], ['partner', 2000, 20400],
  ]);
  for (const p of spec) {
    const entry = PLAN_CATALOGUE.find(e => e.licence_key === p.licence_key);
    assert.equal(entry.sellable, true);
    assert.deepEqual(entry.matches, { [p.metadata_key]: p.metadata_value });
    assert.equal(p.year, Math.round(p.month * 12 * .85));
  }
  assert.deepEqual(OWNER_UNPRICED, { 'investor:institutional': 'custom', lp_access: 'free', admin: 'staff' });
  for (const [key, rows] of [['tier', FOUNDER_PRICES], ['investor_tier', INVESTOR_PRICES], ['plan_group', PERSONA_PRICES]])
    assert.deepEqual(rows, spec.filter(p => p.metadata_key === key).map(p => ({ tier: p.metadata_value, name: p.name, month: p.month, year: p.year })));
  assert.deepEqual(Object.values(STORAGE_TIERS).map(p => p.label).filter(x => /\$/.test(x)).sort(), [...new Set(spec.map(p => `$${p.month / 100} a month`))].sort());
});

test('the mirrored targets draw each profile price ladder; custom/free plans offer no checkout', () => {
  const plans = spec.map(p => ({ licence_key: p.licence_key, free: false, prices: [price(`price_${p.metadata_value}m`, p.month, 'month'), price(`price_${p.metadata_value}y`, p.year, 'year')] }));
  for (const [family, expected] of [['founder', ['Free', '$20', '$100']], ['investor', ['$0', '$50', '$150', 'Custom']], ['advisor', ['$0', '$20']], ['operating-partner', ['$0', '$20']]]) {
    const { cards } = planCards({ plans }, PLAN_CARDS[family], { signedIn: true });
    assert.deepEqual(cards.map(c => c.price), expected, family);
    for (const c of cards.filter(c => c.price === 'Custom')) {
      assert.equal(c.button.label, 'Contact Axal VC'); assert.equal(c.button.to, '/contact'); assert.ok(!c.button.checkout);
    }
  }
  assert.equal(PLAN_CARDS.admin, undefined);
});

test('planners emit valid reasons/change keys, handle missing persona products and keep unrelated prices', () => {
  for (const run of [planFounderPrices, planInvestorPrices, planPersonaPrices]) {
    const c = catalogue();
    // Two wrong monthly prices require create then archive; a single yearly uses change.
    for (const p of c.products) p.prices = [price('price_oldm1', 9999, 'month'), price('price_oldm2', 8888, 'month'), price('price_oldy', 99999, 'year'), price('price_eur', 4444, 'month', { currency: 'eur' })];
    const result = run(c);
    assert.ok(result.create.length && result.change.length && result.archive_after_verification.length);
    for (const a of [...result.create, ...result.change, ...result.archive_after_verification]) {
      assert.equal(a.method, 'POST'); assert.ok(typeof a.body.reason === 'string' && a.body.reason.length >= 10 && a.body.reason.length <= 500);
      assert.ok(!a.path.includes('price_eur'));
    }
    for (const a of result.change) assert.match(a.body.idempotency_key, /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual(result, run(c), 'retries keep the same offline request keys');
    assert.throws(() => run(c, 'short')); assert.throws(() => run(c, 'x'.repeat(501)));
  }
  assert.deepEqual(planPersonaPrices({ products: [] }).product_needed.map(p => p.metadata), [{ plan_group: 'advisor' }, { plan_group: 'partner' }]);
  const c = catalogue(); c.products.push({ ...c.products.find(p => p.metadata.plan_group === 'advisor') });
  assert.throws(() => planPersonaPrices(c), /exactly one/);
});

test('Investor planning archives old Institutional offers without changing existing subscriptions', () => {
  const c = catalogue(); c.products.push({ id: 'prod_inst', active: true, kind: 'subscription', metadata: { investor_tier: 'institutional' }, prices: [price('price_inst', 59900, 'month')] });
  const result = planInvestorPrices(c);
  assert.deepEqual(result.archive_after_verification, [{ method: 'POST', path: '/api/admin/catalog/prices/price_inst/archive', body: { reason: "Owner's price table, #3702" } }]);
  assert.ok(!JSON.stringify(result).includes('/subscriptions'), 'price archival leaves current subscriptions on their old price');
});

// Mount the real readers with a deliberately priced Institutional mirror row.
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { resetPlansRead } from '../src/lib/planPrices.js';
import { register } from 'node:module';
register(new URL('./_airailRender-hook.mjs', import.meta.url));
const { InvestorBillingPanel, PersonaBillingPanel } = await import('../src/pages/SettingsPage.jsx');
const nodeText = n => n?.childNodes?.length ? n.childNodes.map(nodeText).join('') : n?.textContent || '';

test('Billing shows Institutional as Custom/contact and personas have only two plans', async () => {
  const before = { ...publicPricingApi };
  publicPricingApi.plansAndPacks = async () => ({ plans: [
    ...spec.map(p => ({ licence_key: p.licence_key, free: false, prices: [price(`price_${p.metadata_value}`, p.month, 'month')] })),
    { licence_key: 'investor:institutional', free: false, prices: [price('price_inst', 59900, 'month')] },
  ], packs: [] });
  publicPricingApi.aiModels = async () => ({ models: [] });
  const ready = data => ({ status: 'ready', data, reload() {} });
  try {
    resetPlansRead();
    const investor = await mountContracts(React.createElement(InvestorBillingPanel, { billing: ready({ tier: 'free', has_customer: false }) }), '/account/billing');
    try {
      await investor.flush();
      assert.match(investor.text(), /Institutional — Custom/); assert.doesNotMatch(investor.text(), /\$599|Upgrade to institutional/);
      assert.ok(investor.nodes().some(n => n.tagName === 'A' && nodeText(n) === 'Contact Axal VC' && investor.props(n).href === '/contact'));
    } finally { await investor.unmount(); }
    for (const group of ['advisor', 'partner']) {
      resetPlansRead();
      const persona = await mountContracts(React.createElement(PersonaBillingPanel, { billing: ready({ plan_group: group, status: 'free', has_customer: false }) }), '/account/billing');
      try { await persona.flush(); assert.doesNotMatch(persona.text(), /Enterprise|Custom/); assert.match(persona.text(), /\$20/); }
      finally { await persona.unmount(); }
    }
  } finally { Object.assign(publicPricingApi, before); resetPlansRead(); }
});
