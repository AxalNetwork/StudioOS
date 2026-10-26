/**
 * D1273 (#3299) — what a member reads when a code's billing period or its
 * per-member limits refuse it, the same words in every checkout.
 * D222's test holds that every reason has a sentence; this one holds which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const MAPS = [
  'frontend/src/components/AxalCheckout.jsx',
  'frontend/src/components/products/CartDrawer.jsx',
  'frontend/src/pages/CheckoutPage.jsx',
];
const WORDS = {
  interval_not_eligible: "This code doesn't apply to this billing period.",
  already_used: "You've already used this code.",
  not_first_purchase: 'This code is for a first purchase only.',
  first_purchase_unreadable: "We couldn't confirm this is your first purchase. Try again in a moment.",
};

function sentences(file) {
  const src = read(file);
  const at = src.indexOf('const PROMO_REASONS = {');
  assert.ok(at >= 0, `${file} has no PROMO_REASONS`);
  const body = src.slice(at, src.indexOf('};', at));
  return Object.fromEntries([...body.matchAll(/^\s*([a-z_]+):\s*(['"])(.*)\2,\s*$/gm)].map((m) => [m[1], m[3]]));
}

test('D1273: each checkout says the same sentence for each new reason', () => {
  for (const file of MAPS) {
    const map = sentences(file);
    for (const [reason, words] of Object.entries(WORDS)) assert.equal(map[reason], words, `${file}: ${reason}`);
  }
});

test('D1273: the Worker names exactly these reasons', () => {
  const src = read('cloudflare-worker/src/services/promos.ts');
  const block = src.slice(src.indexOf('export type PromoRejectReason ='), src.indexOf(';', src.indexOf('export type PromoRejectReason =')));
  for (const reason of Object.keys(WORDS)) assert.ok(block.includes(`'${reason}'`), reason);
});
