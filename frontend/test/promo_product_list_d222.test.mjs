/**
 * D222 — every shopper map names every promo rejection, and an unreadable
 * product list is not drawn as every product.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PromoProductScope } from '../src/pages/PromoProductScope.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const html = (props) => renderToStaticMarkup(createElement(PromoProductScope, props));

const MAPS = [
  'frontend/src/components/AxalCheckout.jsx',
  'frontend/src/components/products/CartDrawer.jsx',
  'frontend/src/pages/CheckoutPage.jsx',
];

function reasons() {
  const src = read('cloudflare-worker/src/services/promos.ts');
  const at = src.indexOf('export type PromoRejectReason =');
  assert.ok(at >= 0, 'PromoRejectReason is gone');
  const end = src.indexOf(';', at);
  const block = src.slice(at, end);
  const found = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(found.length >= 6, `parsed too few reasons: ${found.join(',')}`);
  return found;
}

function mapBody(file) {
  const src = read(file);
  const at = src.indexOf('const PROMO_REASONS = {');
  assert.ok(at >= 0, `${file} has no PROMO_REASONS`);
  const end = src.indexOf('};', at);
  return src.slice(at, end);
}

function mapKeys(file) {
  return [...mapBody(file).matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
}

test('every checkout map has a sentence for every PromoRejectReason', () => {
  const need = reasons();
  assert.ok(need.includes('product_list_unreadable'));
  assert.ok(need.includes('currency_mismatch'));
  for (const file of MAPS) {
    const keys = mapKeys(file);
    for (const reason of need) {
      assert.ok(keys.includes(reason), `${file} has no sentence for ${reason}`);
    }
    assert.match(mapBody(file), /product_list_unreadable:\s*"This code can't be applied right now\."/);
  }
});

test('an unreadable product list renders Unreadable, and a readable empty list is every product', () => {
  const bad = html({
    promo: { product_ids: [], product_ids_readable: false },
    productName: (id) => id,
  });
  assert.match(bad, /Product list could not be read/);
  assert.match(bad, /not a claim that the code applies to every product/);
  assert.equal(bad.includes('All products'), false);

  const all = html({
    promo: { product_ids: [], product_ids_readable: true },
    productName: (id) => id,
  });
  assert.match(all, /All products/);
  assert.equal(all.includes('could not be read'), false);

  const one = html({
    promo: { product_ids: ['prod_x'], product_ids_readable: true },
    productName: (id) => (id === 'prod_x' ? 'Widget' : id),
  });
  assert.match(one, /Widget/);
  assert.equal(one.includes('All products'), false);
});

test('the admin promo list draws scope through PromoProductScope', () => {
  const src = read('frontend/src/pages/AdminPage.jsx');
  assert.match(src, /<PromoProductScope promo=\{p\} productName=\{productName\} \/>/);
  assert.doesNotMatch(src, /product_ids\.length === 0/);
});
