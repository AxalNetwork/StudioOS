// D1434 (#3703): the AI tokens top-up (which pays for AI runs and API calls)
// is offered everywhere a member can run out, including when no token pack
// is on sale: the custom amount ($1 each, from the Worker's minimum of $5 to
// its maximum) is drawn as its own card, and every "Add tokens" opens the
// sheet on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CUSTOM_PACK, customRangeLine } from '../src/lib/aiTokens.js';
import { CUSTOM_KEY, startingPack } from '../src/components/checkout/packModel.js';
import { addState } from '../src/pages/tokensBandModel.js';
import { TOKEN_PACKS_ADMIN_PATH, needsYouAll } from '../src/pages/admin/payments/payModel.js';

const CUSTOM = { price_id: 'price_1UXfXFFA2hGHNbZ5ATCdUAgr', unit_amount: 100, currency: 'usd', min_cents: 500, max_cents: 50000 };
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the range line comes from the offer: a $5 minimum reads "from $5"', () => {
  assert.equal(customRangeLine(CUSTOM), 'Any amount from $5 to $500');
  assert.equal(customRangeLine({ ...CUSTOM, min_cents: 1000 }), 'Any amount from $10 to $500', 'never a typed minimum');
  assert.equal(customRangeLine(null), null, 'no offer, no card');
  assert.equal(customRangeLine({ ...CUSTOM, unit_amount: 500 }), null, 'only the $1 price is the custom amount');
});

test('the sheet opens on the custom amount when a caller asks for it, even with packs on sale', () => {
  const rows = [{ key: 'pk_10', priceId: 'price_10' }, { key: 'pk_25', priceId: 'price_25' }];
  assert.equal(CUSTOM_PACK, CUSTOM_KEY, 'the key callers pass is the key the sheet knows');
  assert.equal(startingPack(rows, CUSTOM_PACK, CUSTOM), CUSTOM_KEY);
  assert.equal(startingPack(rows, CUSTOM_PACK, null), 'pk_10', 'no custom offer: the first pack, as before');
  assert.equal(startingPack(rows, 'pk_25', CUSTOM), 'pk_25', 'a named pack is still that pack');
  assert.equal(startingPack([], null, CUSTOM), CUSTOM_KEY, 'no pack: the custom amount, as before');
});

test('Pricing\'s Add tokens is enabled by the custom amount when no pack is on sale', () => {
  assert.deepEqual(addState({ meLoading: false, packCount: 0, custom: true }), { enabled: true, line: null });
  assert.equal(addState({ meLoading: false, packCount: 0, custom: false }).enabled, false, 'nothing on sale stays disabled');
  assert.equal(addState({ meLoading: false, packCount: 0 }).enabled, false, 'callers that pass no custom are unchanged');
  assert.equal(addState({ meLoading: true, packCount: 0, custom: true }).enabled, false, 'still reading');
});

test('every surface that sells tokens draws the custom amount beside its packs', () => {
  const pricing = src('pages/PricingPage.jsx');
  assert.match(pricing, /custom: packs\.status === 'ready' && sellableCustom\(packs\.body\?\.custom\)/, 'the band counts it');
  assert.match(pricing, /data-testid="pricing-pack-custom"/);
  assert.match(pricing, /onBuy\(CUSTOM_PACK\)/, 'Pricing\'s card opens the sheet on it');
  assert.match(pricing, /packs\.length \|\| anyAmount \?/, 'no pack: the custom card instead of "isn\'t available"');
  const products = src('components/products/TokenPacksSection.jsx');
  assert.match(products, /reading\.packs\.length === 0 && !reading\.custom \? <p>\{TOPUP_UNAVAILABLE\}/);
  assert.match(products, /addTokensHref\(CUSTOM_PACK\)/);
  const billing = src('pages/account/BillingCards.jsx');
  assert.match(billing, /cards\.length === 0 && !anyAmount \?/);
  assert.match(billing, /openAddTokens\(\{ from: 'Billing', pack_uid: CUSTOM_PACK \}\)/);
  const api = src('pages/account/builder/ApiUsagePage.jsx');
  assert.match(api, /openAddTokens\(\{ from: 'API usage' \}\)/, 'API calls draw on the same tokens: Add tokens on API usage');
});

test('a token pack with no live price is fixed in Token packs, not Stripe connection', () => {
  const items = needsYouAll({ config: null, summary: null, webhook: null, catalog: { products: [], checks: [
    { code: 'pack_not_ready', severity: 'blocker', product_id: null, price_id: 'price_old', message: 'This token pack has no sellable price in this Stripe mode.' },
    { code: 'secret_key_missing', severity: 'blocker', product_id: null, price_id: null, message: 'No key.' },
  ] } });
  assert.equal(items[0].href, TOKEN_PACKS_ADMIN_PATH);
  assert.equal(items[0].action, 'Open Token packs');
  assert.equal(TOKEN_PACKS_ADMIN_PATH, '/admin/platform/allowances');
  assert.equal(items[1].action, 'Open Stripe connection', 'other key checks still open Stripe connection');
});
