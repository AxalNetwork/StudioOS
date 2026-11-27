/**
 * Task #12 — unit tests for the Stripe Tax (automatic_tax) helpers.
 *
 * Locks in the flag-gating contract so a stray default never enables
 * automatic_tax (which would 502 every Checkout/Subscription/Invoice create
 * until Stripe Tax is activated in the dashboard) and so callers can always
 * unconditionally spread the result.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripeTax.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { stripeTaxEnabled, automaticTaxParams } from '../src/util/stripeTax.ts';

test('stripeTaxEnabled: default OFF for unset / empty / falsey values', () => {
  assert.equal(stripeTaxEnabled({}), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: '' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: '0' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'false' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'no' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'off' }), false);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'maybe' }), false);
});

test('stripeTaxEnabled: ON for accepted truthy values (case/space-insensitive)', () => {
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: '1' }), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'true' }), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'TRUE' }), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: ' Yes ' }), true);
  assert.equal(stripeTaxEnabled({ STRIPE_TAX_ENABLED: 'On' }), true);
});

test('automaticTaxParams: disabled → empty object (safe unconditional spread)', () => {
  assert.deepEqual(automaticTaxParams(false), {});
  assert.deepEqual(automaticTaxParams(false, { checkout: true, hasExistingCustomer: true }), {});
});

test('automaticTaxParams: enabled, non-checkout (subscription/invoice) → just the flag', () => {
  assert.deepEqual(automaticTaxParams(true), { 'automatic_tax[enabled]': 'true' });
});

test('automaticTaxParams: enabled checkout WITHOUT existing customer → no customer_update', () => {
  // customer_update[address]=auto is invalid without a `customer` (customer_email
  // path): Checkout creates + addresses the customer itself.
  assert.deepEqual(
    automaticTaxParams(true, { checkout: true, hasExistingCustomer: false }),
    { 'automatic_tax[enabled]': 'true' },
  );
});

test('automaticTaxParams: enabled checkout WITH existing customer → adds customer_update', () => {
  assert.deepEqual(
    automaticTaxParams(true, { checkout: true, hasExistingCustomer: true }),
    { 'automatic_tax[enabled]': 'true', 'customer_update[address]': 'auto' },
  );
});

test('automaticTaxParams: customer_update only applies on the checkout surface', () => {
  // hasExistingCustomer on a non-checkout surface must NOT leak customer_update.
  assert.deepEqual(
    automaticTaxParams(true, { hasExistingCustomer: true }),
    { 'automatic_tax[enabled]': 'true' },
  );
});
