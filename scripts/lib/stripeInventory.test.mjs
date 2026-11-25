/** #8523: the Stripe idempotency inventory reads calls correctly and its check fails on an unkeyed charge. No Stripe call is made. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, checkInventory, movesMoney, normalizePath, readCalls, readRawClients } from './stripeInventory.mjs';
import { ALLOWLIST, build } from '../build-stripe-inventory.mjs';

const file = (src, rel = 'routes/x.ts') => [{ rel, src }];
/** A fixture tree padded past the floor, so a test of one call is not about the floor. */
const padded = (calls) => ({
  calls: [...calls, ...Array.from({ length: FLOOR.calls }, (_, i) => ({ file: 'p.ts', line: i, method: 'GET', path: '/x', dynamicPath: false, moneyMoving: false, key: null, source: 'none' })),
    ...Array.from({ length: FLOOR.moneyMoving }, (_, i) => ({ file: 'k.ts', line: i, method: 'POST', path: '/refunds', dynamicPath: false, moneyMoving: true, key: '`r:${id}`', source: 'stable' }))],
  rawClients: [],
});
const call = (over) => ({ file: 'routes/x.ts', line: 1, method: 'POST', path: '/payment_intents', dynamicPath: false, moneyMoving: true, key: null, source: 'none', ...over });

test('the reader takes the method, path, money and key of a call, and skips the definition', () => {
  const rows = readCalls(file([
    'export async function stripeCall<T>(env, path, body, opts) {}',
    "await stripeCall(env, '/payment_intents', body, { moneyKind: 'marketplace' });",
    "await stripeCall<X>(env, `/payment_intents/${id}/confirm`, {}, { idempotencyKey: `pi:${order.id}:confirm` });",
    "await stripeCall(env, '/subscriptions', p, { idempotencyKey: crypto.randomUUID(), moneyKind: k });",
    "await stripeCall(env, `/customers/${c}`, {}, { method: 'GET' });",
    "const key = `refund:${inv.id}`;\nawait stripeCall(env, '/refunds', f, { idempotencyKey: key });",
    'await stripeCall(env, somePath, body);',
  ].join('\n')));
  assert.deepEqual(rows.map((r) => [r.path, r.method, r.moneyMoving, r.source]), [
    ['/payment_intents', 'POST', true, 'none'],
    ['/payment_intents/:x/confirm', 'POST', true, 'stable'],
    ['/subscriptions', 'POST', true, 'random'],
    ['/customers/:x', 'GET', false, 'none'],
    ['/refunds', 'POST', true, 'stable'],
    [null, 'POST', false, 'none'],
  ]);
  assert.equal(rows[4].via, 'key', 'a local identifier key is read through its const');
  assert.equal(rows[5].dynamicPath, true);
});

test('which paths move money', () => {
  for (const p of ['/refunds', '/payment_intents', '/payment_intents/pi_1/confirm', '/invoices/in_1/finalize', '/subscriptions/sub_1', '/customers/c/balance_transactions']) assert.equal(movesMoney('POST', p), true, p);
  for (const p of ['/customers', '/products', '/prices/p', '/setup_intents', '/billing_portal/sessions', '/webhook_endpoints']) assert.equal(movesMoney('POST', p), false, p);
  assert.equal(movesMoney('GET', '/refunds'), false);
  assert.equal(normalizePath('/a/${x}/b?x=1'), '/a/:x/b');
});

test('a fixture with an unkeyed charge fails the check, naming the file, line and path', () => {
  const errors = checkInventory(padded([call({ file: 'routes/charge.ts', line: 42 })]), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /routes\/charge\.ts:42 POST \/payment_intents moves money and sends no idempotency key/);
});

test('a random key, and a key taken from the caller, fail; a stable key passes', () => {
  assert.equal(checkInventory(padded([call({ source: 'random', key: 'crypto.randomUUID()' })]), []).length, 1);
  assert.equal(checkInventory(padded([call({ source: 'param', key: 'opts.idempotencyKey' })]), []).length, 1);
  assert.deepEqual(checkInventory(padded([call({ source: 'stable', key: '`pi:${order.id}`' })]), []), []);
});

test('a call that moves no money, or a GET, needs no key', () => {
  assert.deepEqual(checkInventory(padded([call({ moneyMoving: false, path: '/customers' }), call({ method: 'GET', moneyMoving: false })]), []), []);
});

test('an allowlist entry covers its calls; one that is stale, miscounted or unexplained fails', () => {
  const entry = { file: 'routes/x.ts', path: '/payment_intents', count: 1, reason: 'The customer pays the intent; a second one charges nothing.' };
  assert.deepEqual(checkInventory(padded([call()]), [entry]), []);
  assert.match(checkInventory(padded([]), [entry]).join(), /no unkeyed money-moving call matches any more/, 'stale');
  assert.match(checkInventory(padded([call(), call({ line: 9 })]), [entry]).join(), /lists 1 call\(s\) but 2 are unkeyed/, 'miscounted');
  assert.match(checkInventory(padded([call()]), [{ ...entry, reason: '' }]).join(), /a reason is required/);
  assert.match(checkInventory(padded([call()]), [{ ...entry, reason: 'ok' }]).join(), /a reason is required/, 'a one-word reason is not one');
  assert.match(checkInventory(padded([call({ source: 'stable', key: 'k' })]), [entry]).join(), /no unkeyed money-moving call matches/, 'a keyed call needs no entry');
});

test('a POST to a path the reader cannot read, a raw client POST to a money path, and a tree below the floor all fail', () => {
  assert.match(checkInventory(padded([call({ path: null, dynamicPath: true, moneyMoving: false })]), []).join(), /path read from a variable/);
  const raw = { ...padded([]), rawClients: [{ file: 'integrations/y.ts', line: 3, method: 'POST', path: '/v1/refunds', moneyMoving: true }] };
  assert.match(checkInventory(raw, []).join(), /raw Stripe client POSTs to \/v1\/refunds/);
  assert.match(checkInventory({ calls: [], rawClients: [] }, []).join(), /scan is broken/);
  const money = padded([]).calls.filter((c) => c.moneyMoving);
  assert.match(checkInventory({ calls: money, rawClients: [] }, []).join(), /only \d+ stripeCall sites found/, 'enough money calls, too few calls');
  const few = padded([]).calls.filter((c) => !c.moneyMoving);
  assert.match(checkInventory({ calls: few, rawClients: [] }, []).join(), /fewer than \d+ money-moving calls/, 'enough calls, too few money-moving');
});

test('the raw reader finds a fetch to the Stripe host and its method', () => {
  const rows = readRawClients(file("const STRIPE_API = 'https://api.stripe.com';\nawait fetch(`${STRIPE_API}/v1/refunds`, { method: 'POST' });\nawait fetch(`${STRIPE_API}/v1/account`, { headers: {} });"));
  assert.deepEqual(rows.map((r) => [r.method, r.path, r.moneyMoving]), [['POST', '/v1/refunds', true], ['GET', '/v1/account', false]]);
});

test('the real tree passes: every money-moving POST is keyed from a stable id or allowlisted with a reason', () => {
  const inv = build();
  assert.deepEqual(checkInventory(inv, ALLOWLIST), []);
  assert.ok(ALLOWLIST.every((a) => a.reason.length >= 20));
});
