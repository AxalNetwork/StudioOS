/**
 * D1050 (#2901) — one plan catalogue, and no typed price.
 *
 * The parity test: the Worker's plan catalogue (`services/planCatalogue.ts`)
 * is the one table, and Pricing's cards, the paywall, the checkout sheet and
 * Billing are held to it. No file that draws a plan types a dollar amount;
 * a price comes from `GET /api/public/plans-and-packs` (Stripe's D1 mirror).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/plan_catalogue_d1050.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const {
  PLAN_CATALOGUE, PLAN_KEYS, FAMILY_COLOUR, NOT_SOLD, STORAGE_NOT_DECIDED, planByKey, planByLicenceKey, catalogueFields, publicCatalogue,
} = await import('../../cloudflare-worker/src/services/planCatalogue.ts');
const { planOf, plansAndPacks } = await import('../../cloudflare-worker/src/services/aiCredits.ts');
const { PLAN_CARDS, LP_ACCESS } = await import('../src/lib/sitePricing.js');
const { TIER_PLANS, PlanPrice } = await import('../src/components/PaywallModal.jsx');
const { familyOf, includedLines, STORAGE_WAITS } = await import('../src/components/checkout/checkoutModel.js');
const { FOUNDER_TIERS, INVESTOR_TIERS } = await import('../src/data/pricing.js');
const { pricedCatalogue, formatPrice } = await import('../src/pages/site/DoorPage.jsx');
const { PRICE_READING, PRICE_UNREAD, priceOf, priceText } = await import('../src/lib/planPrices.js');

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
/**
 * The code of a file, its comment lines removed, so a sentence about a price
 * is not a price. Line-based on purpose: a block-comment pattern run over a
 * whole file can start inside a string and swallow real code.
 */
const code = (src) => src.split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .map((l) => l.replace(/\s\/\/\s.*$/, ''))
  .join('\n');
/** A typed amount: a dollar sign and a non-zero figure that is not a funding-stage size ($1M, $20K). */
const TYPED = /\$[1-9][\d,]*(?:\.\d+)?(?![\d,.]*[MKB])/;

const SURFACES = [
  'frontend/src/components/PaywallModal.jsx',
  'frontend/src/pages/SettingsPage.jsx',
  'cloudflare-worker/src/middleware/requireTier.ts',
  'cloudflare-worker/src/middleware/requireInvestorTier.ts',
  'frontend/src/lib/sitePricing.js',
  'frontend/src/lib/pricingModel.js',
  'frontend/src/components/checkout/checkoutModel.js',
  'frontend/src/components/checkout/CheckoutSheet.jsx',
  'frontend/src/pages/site/DoorPage.jsx',
  'frontend/src/data/pricing.js',
  'cloudflare-worker/src/services/planCatalogue.ts',
];

// ---------------------------------------------------------------- the catalogue

test('the catalogue has every plan key the issue names, once, and no price', () => {
  assert.deepEqual(PLAN_KEYS, [
    'founder:free', 'founder:growth', 'founder:studio',
    'investor:free', 'investor:plus', 'investor:professional', 'investor:institutional',
    'advisor:free', 'advisor:pro', 'partner:free', 'partner:pro', 'other', 'lp_access', 'admin',
  ]);
  for (const p of PLAN_CATALOGUE) {
    assert.ok(!('price' in p) && !('unit_amount' in p) && !('prices' in p), `${p.key} carries a price`);
    assert.doesNotMatch(JSON.stringify(p), TYPED, `${p.key} types an amount`);
    assert.equal(p.colour, FAMILY_COLOUR[p.family], `${p.key}: its family's colour`);
    assert.equal(p.sellable === (p.sellable_reason === null), true, `${p.key}: a reason exactly when it is not sold`);
    // #2449 decides storage and "Best suited for": none is a figure yet, each says why.
    assert.deepEqual(p.storage, { bytes: null, reason: STORAGE_NOT_DECIDED }, p.key);
    assert.equal(p.best_suited_for, null, p.key);
  }
  assert.equal(planByKey('investor:plus').sellable, false, 'Investor Plus is not sold (D786)');
  assert.equal(planByKey('investor:plus').sellable_reason, NOT_SOLD.plus);
});

test('each sold plan names the Stripe metadata planOf matches, and Investor Plus none', () => {
  for (const p of PLAN_CATALOGUE.filter((x) => x.matches)) {
    assert.equal(planOf(p.matches)?.licence_key, p.licence_key, `${p.key}: planOf maps its metadata to its licence key`);
    assert.equal(planByLicenceKey(p.licence_key)?.key, p.key, `${p.key}: found again by its licence key`);
  }
  assert.equal(planByKey('investor:plus').matches, null, 'no product is sold as Investor Plus');
  assert.equal(planOf({ investor_tier: 'plus' }), null);
});

test('the profile colours are the checkout sheet\'s pill colours', () => {
  for (const family of ['founder', 'investor', 'advisor', 'partner']) {
    assert.equal(familyOf({ family }).tone, FAMILY_COLOUR[family], family);
  }
});

// ---------------------------------------------------------------- the surfaces, held to it

test('Pricing\'s cards are the catalogue: name, line and every included line', () => {
  const FAMILY = { founder: 'founder', investor: 'investor', advisor: 'advisor', 'operating-partner': 'partner' };
  let held = 0;
  for (const [tab, cards] of Object.entries(PLAN_CARDS)) {
    for (const card of cards) {
      const entry = planByKey(`${FAMILY[tab]}:${card.id}`);
      if (!entry) { assert.ok(card.custom, `${tab}/${card.id}: only a sales-priced card is outside the catalogue`); continue; }
      held += 1;
      assert.equal(card.name, entry.name, `${tab}/${card.id}: name`);
      assert.equal(card.tag, entry.tagline, `${tab}/${card.id}: line`);
      assert.deepEqual(card.feats, [...entry.included], `${tab}/${card.id}: included lines`);
      if (card.match) assert.equal(card.match, entry.licence_key, `${tab}/${card.id}: sold under the catalogue's licence key`);
    }
  }
  assert.equal(held, 11, 'eleven of the cards are catalogue plans');
  assert.equal(LP_ACCESS.name, planByKey('lp_access').name);
  assert.deepEqual(LP_ACCESS.feats, [...planByKey('lp_access').included]);
});

test('the paywall is the catalogue, and carries no price', () => {
  for (const [tier, plan] of Object.entries(TIER_PLANS)) {
    const entry = planByKey(plan.key);
    assert.ok(entry, `${tier}: ${plan.key} is in the catalogue`);
    assert.equal(plan.label, entry.name, `${tier}: name`);
    assert.equal(plan.blurb, entry.tagline, `${tier}: line`);
    assert.deepEqual(plan.features, [...entry.included], `${tier}: features`);
    assert.ok(!('price' in plan) && !('period' in plan), `${tier}: no typed price`);
  }
});

test('Billing names its plans from the paywall\'s table and reads its prices, never types them', () => {
  const src = code(read('frontend/src/pages/SettingsPage.jsx'));
  assert.match(src, /import \{ FREE, priceText, usePlansRead \} from '\.\.\/lib\/planPrices';/);
  assert.match(src, /professional: `\$\{TIER_PLANS\.professional\.label\} — \$\{priceText\(prices, TIER_PLANS\.professional\.key, billingCycle === 'yearly' \? 'year' : 'month'\)\}`/);
  assert.match(src, /growth: `\$\{TIER_PLANS\.growth\.label\} — \$\{priceText\(prices, TIER_PLANS\.growth\.key\)\}`/);
  assert.doesNotMatch(src, /\bprice: '/, 'a persona plan types a price');
});

test('the checkout sheet\'s Included lines and storage come from the catalogue the read sends', () => {
  const entry = planByKey('founder:growth');
  const plan = { family: 'founder', prices: [], catalogue: catalogueFields(entry) };
  const lines = includedLines(plan, { feats: ['an old card line'] }, 'monthly');
  assert.deepEqual(lines.slice(2).map((l) => l.text), [...entry.included], 'the catalogue\'s lines, not the card\'s');
  assert.equal(lines[1].text, STORAGE_NOT_DECIDED, 'storage says why it is not a figure');
  assert.equal(lines[1].measured, false);
  // A read from before the catalogue still draws the card's lines.
  assert.deepEqual(includedLines({ prices: [] }, { feats: ['a line'] }, 'monthly').map((l) => l.text).slice(1), [STORAGE_WAITS, 'a line']);
  // A storage figure is drawn only when the catalogue holds one.
  const sized = { ...plan, catalogue: { ...plan.catalogue, storage: { bytes: 5e9, reason: null } } };
  assert.equal(includedLines(sized, null, 'monthly')[1].text, '5 GB of storage');
});

test('no file that draws a plan types a dollar amount', () => {
  for (const f of SURFACES) assert.doesNotMatch(code(read(f)), TYPED, `${f} types a price`);
  // The old figures are gone wherever they were typed.
  for (const f of SURFACES) assert.doesNotMatch(read(f), /PLAN_PRICE_LABEL/, `${f}`);
});

// ---------------------------------------------------------------- the read

function fakeEnv(products) {
  const all = (sql) => ({ success: true, results: /FROM stripe_products/.test(sql) ? products : [] });
  return {
    DB: {
      prepare(sql) {
        const api = { bind: () => api, all: async () => all(sql), first: async () => null, run: async () => ({ success: true }) };
        return api;
      },
    },
  };
}
const PRODUCTS = [
  { id: 'prod_growth', name: 'Validate + Build', active: 1, metadata_json: JSON.stringify({ tier: 'growth' }),
    prices_json: JSON.stringify([{ id: 'price_g', active: true, unit_amount: 4900, currency: 'usd', interval: 'month', interval_count: 1 }]) },
  { id: 'prod_pro', name: 'Investor Pro', active: 1, metadata_json: JSON.stringify({ investor_tier: 'professional' }),
    prices_json: JSON.stringify([{ id: 'price_p', active: true, unit_amount: 19900, currency: 'usd', interval: 'year', interval_count: 1 }]) },
];

test('the plans read sends each plan\'s catalogue fields, the whole catalogue, and no name key', async () => {
  const body = await plansAndPacks(fakeEnv(PRODUCTS));
  const growth = body.plans.find((p) => p.licence_key === 'founder:growth');
  assert.equal(growth.catalogue.key, 'founder:growth');
  assert.equal(growth.catalogue.label, 'Validate + Build');
  assert.deepEqual(growth.catalogue.included, [...planByKey('founder:growth').included]);
  assert.equal(body.plans.find((p) => p.licence_key === 'founder:free').catalogue.key, 'founder:free');
  assert.deepEqual(body.catalogue.map((c) => c.key), PLAN_KEYS, 'every plan, those with no product among them');
  assert.deepEqual(body.catalogue, publicCatalogue());
  const keys = JSON.stringify(body).match(/"name":/g);
  assert.equal(keys, null, 'the public read carries no name key');
});

// ---------------------------------------------------------------- prices, read

const reading = (plans) => ({ status: 'ready', data: { plans } });
const PRICED = [
  { licence_key: 'founder:growth', free: false, prices: [{ unit_amount: 4900, currency: 'usd', interval: 'month', interval_count: 1 }] },
  { licence_key: 'investor:professional', free: false, prices: [{ unit_amount: 19900, currency: 'usd', interval: 'year', interval_count: 1 }] },
];

test('a price is the read\'s, by state: reading, priced, or not read, and never a zero', () => {
  assert.equal(priceText({ status: 'loading' }, 'founder:growth'), PRICE_READING);
  assert.equal(priceText({ status: 'error' }, 'founder:growth'), PRICE_UNREAD);
  assert.equal(priceText(reading(PRICED), 'founder:growth'), '$49 / month');
  assert.equal(priceText(reading(PRICED), 'investor:professional'), PRICE_UNREAD, 'no monthly price is not a monthly price of 0');
  assert.equal(priceText(reading(PRICED), 'investor:professional', 'year'), '$199 / year');
  assert.equal(priceOf(reading([{ licence_key: 'advisor', prices: [{ unit_amount: 900, currency: 'eur', interval: 'month' }] }]).data, 'advisor'), null, 'a price in another currency is not quoted in dollars');
});

test('the door pages price each tier from the read, and say reading or not read meanwhile', () => {
  const ready = pricedCatalogue(reading(PRICED));
  assert.equal(formatPrice(ready.founder.find((t) => t.id === 'growth'), ready.reading), '$49');
  assert.equal(formatPrice(ready.founder.find((t) => t.id === 'free'), ready.reading), '$0', 'a free tier is free');
  const waiting = pricedCatalogue({ status: 'loading' });
  assert.equal(formatPrice(waiting.founder.find((t) => t.id === 'studio'), waiting.reading), PRICE_READING);
  const failed = pricedCatalogue({ status: 'error' });
  assert.equal(formatPrice(failed.investor.find((t) => t.id === 'professional'), failed.reading), PRICE_UNREAD);
  for (const t of [...FOUNDER_TIERS, ...INVESTOR_TIERS]) {
    assert.ok(t.priceMonthly === 0 || t.priceMonthly === null, `${t.id}: no typed monthly price`);
  }
});

test('drawn: the paywall card shows the read\'s price, or that it was not read', () => {
  const text = (read, planKey) => renderToStaticMarkup(h(PlanPrice, { read, planKey })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text(reading(PRICED), 'founder:growth'), /\$49 \/ month/);
  const failed = text({ status: 'error' }, 'founder:growth');
  assert.match(failed, /Price not read The price couldn’t be read just now\. That doesn’t mean it’s free\./);
  assert.doesNotMatch(failed, /\$0/);
  assert.match(text(reading(PRICED), 'founder:studio'), /Price not read/, 'a plan the read does not price is not free');
  assert.match(text({ status: 'loading' }, 'founder:studio'), /Reading…/);
});
