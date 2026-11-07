/**
 * D4855 (#4855) — what a member reads when a licence's promotion ceiling
 * refuses a code: the same words in every checkout, for every reason the
 * Worker's rule can answer with.
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
  ceiling_exceeded: "This code's discount is more than this licence's promotion budget has left. Pay without it.",
  ceiling_not_recorded: 'No discount can be given yet. Pay without the code.',
  ceiling_unreadable: "This code can't be checked right now. Try again in a moment.",
};

function sentences(file) {
  const src = read(file);
  const at = src.indexOf('const PROMO_REASONS = {');
  assert.ok(at >= 0, `${file} has no PROMO_REASONS`);
  const body = src.slice(at, src.indexOf('};', at));
  return Object.fromEntries([...body.matchAll(/^\s*([a-z_]+):\s*(['"])(.*)\2,\s*$/gm)].map((m) => [m[1], m[3]]));
}

test('D4855: each checkout says the same sentence for each ceiling reason', () => {
  for (const file of MAPS) {
    const map = sentences(file);
    for (const [reason, words] of Object.entries(WORDS)) assert.equal(map[reason], words, `${file}: ${reason}`);
  }
});

test('D4855: the plan quote says them too, and the Worker names exactly these reasons', () => {
  const quote = read('frontend/src/components/checkout/checkoutModel.js');
  for (const reason of Object.keys(WORDS)) assert.ok(quote.includes(`${reason}:`), `checkoutModel.js: ${reason}`);
  const src = read('cloudflare-worker/src/services/promoRedemption.ts');
  const block = src.slice(src.indexOf('export type CeilingRefusal ='), src.indexOf(';', src.indexOf('export type CeilingRefusal =')));
  for (const reason of Object.keys(WORDS)) assert.ok(block.includes(`'${reason}'`), reason);
});
