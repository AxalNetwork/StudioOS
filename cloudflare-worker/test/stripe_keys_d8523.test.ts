/**
 * #8523 — the idempotency keys of the Stripe calls that move money on the platform's own initiative.
 * Two identical calls send the same `Idempotency-Key` header; a different thing or a later window sends another.
 * `fetch` is replaced here: no Stripe call is made.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_keys_d8523.test.ts
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripeCall } from '../src/routes/billing.ts';
import { KEY_WINDOW_MS, incorporationKey, planSubscriptionKey, planSwapKey, windowKey } from '../src/util/stripeKey.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Every call's Idempotency-Key header, in order, answering `{}` each time. */
function capture(): Array<string | undefined> {
  const keys: Array<string | undefined> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return keys;
}
const env: any = { STRIPE_SECRET_KEY: 'sk_test_synthetic_d8523' };
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);

test('a plan subscription pressed twice sends one key; another price or another user sends another', async () => {
  const keys = capture();
  const send = (uid: string, price: string, now: number) =>
    stripeCall(env, '/subscriptions', { customer: 'cus_x' }, { moneyKind: 'platform_plan', idempotencyKey: planSubscriptionKey(uid, price, now) });
  await send('u-1', 'price_a', T0); await send('u-1', 'price_a', T0 + 5_000);
  assert.equal(keys[0], keys[1], 'the same press, a few seconds apart');
  assert.ok(keys[0], 'a key is sent');
  await send('u-1', 'price_b', T0); await send('u-2', 'price_a', T0);
  assert.equal(new Set(keys).size, 3, 'another price, another user: another key');
});

test('a plan swap pressed twice sends one key; swapping back later is a new change', async () => {
  const keys = capture();
  const swap = (from: string, to: string, now: number) =>
    stripeCall(env, '/subscriptions/sub_1', { 'items[0][price]': to }, { idempotencyKey: planSwapKey(7, 'sub_1', from, to, now) });
  await swap('price_a', 'price_b', T0); await swap('price_a', 'price_b', T0 + 30_000);
  assert.equal(keys[0], keys[1]);
  await swap('price_b', 'price_a', T0 + 60_000);
  assert.notEqual(keys[2], keys[0], 'the opposite swap is not the first one replayed');
  await swap('price_a', 'price_b', T0 + 2 * KEY_WINDOW_MS);
  assert.notEqual(keys[3], keys[0], 'the same swap again, a window later, runs');
});

test('the three steps of an incorporation invoice each send one stable key, and no two steps share one', async () => {
  const keys = capture();
  for (let pass = 0; pass < 2; pass += 1) {
    await stripeCall(env, '/invoices', { customer: 'c' }, { moneyKind: 'marketplace', idempotencyKey: incorporationKey(41, 'invoice') });
    await stripeCall(env, '/invoiceitems', { customer: 'c' }, { moneyKind: 'marketplace', idempotencyKey: incorporationKey(41, 'item') });
    await stripeCall(env, '/invoices/in_1/finalize', {}, { idempotencyKey: incorporationKey(41, 'finalize') });
  }
  assert.deepEqual(keys.slice(0, 3), keys.slice(3), 'a retry of the whole sequence repeats every key');
  assert.equal(new Set(keys.slice(0, 3)).size, 3, 'each step has its own');
  assert.notEqual(incorporationKey(42, 'invoice'), incorporationKey(41, 'invoice'), 'another order, another key');
});

test('windowKey is the parts and the window, and does not read the clock when given one', () => {
  assert.equal(windowKey(['a', 1], 0), 'a:1:w0');
  assert.equal(windowKey(['a', 1], KEY_WINDOW_MS - 1), 'a:1:w0');
  assert.equal(windowKey(['a', 1], KEY_WINDOW_MS), 'a:1:w1');
});

test('the call sites send those keys', () => {
  const read = (p: string) => readFileSync(new URL(`../src/routes/${p}`, import.meta.url), 'utf8');
  const billing = read('billing.ts'); const legal = read('legal.ts');
  assert.match(billing, /'\/subscriptions', subParams, \{ moneyKind: 'platform_plan', idempotencyKey: planSubscriptionKey\(user\.uid, priceId\) \}/);
  assert.match(billing, /idempotencyKey: planSwapKey\(Number\(user\.id\), subId, fromPriceId, priceId\)/);
  for (const step of ['invoice', 'item', 'finalize']) assert.ok(legal.includes(`incorporationKey(incId, '${step}')`), `legal.ts sends the ${step} key`);
});
