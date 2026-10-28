/**
 * D1366 — the token packs on sale, and a custom amount from $5. On D755's D1
 * harness (migrations 486 and 509); Stripe is stubbed, and a URL no stub
 * answers fails the test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/token_topup_custom_d1366.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { AI_TOPUP_UNIT, recordAiTopupPurchase, creditAiTopupFromPayment, resetAiTopupMirrorWindow } from '../src/services/aiTopups.ts';
import { TOKEN_PACK_REFUSALS, customTopUp, isTokenPackPrice, isTokenPackProduct, mirrorPackPrices, packsOnSale, tokenPackQuote } from '../src/services/aiCredits.ts';

const MIGRATION_654 = readFileSync(new URL('../sql/migrations/654_token_packs_on_sale.sql', import.meta.url), 'utf8');
const UNIT = 'price_unit';
const product = (id: string, name: string, price: string, cents: number) => [id, name, JSON.stringify([{ id: price, product: id, active: true, currency: 'usd', unit_amount: cents, nickname: null, type: 'one_time', recurring: null }])];

async function shop(unitCents = 100, extra: Record<string, unknown> = {}) {
  resetAiTopupMirrorWindow();
  const f = aiBudgetFixture();
  const env = { DB: f.DB, ENVIRONMENT: 'development', STRIPE_WEBHOOK_SECRET: 'd1366-fixture-only-webhook-secret', STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000', STRIPE_PRICE_AI_TOPUP_UNIT: UNIT, ...extra } as any;
  await ensureCatalogSchema(env); await ensureOrdersSchema(env);
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,'token_pack',1,'{}',?)").run(...product('prod_unit', 'AI tokens, any amount', UNIT, unitCents));
  return { ...f, env };
}
const cart = (quantity: number, priceId = UNIT, unit = 100) => ({ lines: [{ price_id: priceId, product_id: 'prod_unit', name: 'AI tokens', kind: 'token_pack', quantity, unit_amount: unit, line_total: unit * quantity }], subtotal: unit * quantity, currency: 'usd' }) as any;

test('a custom amount is N of the $1 price, any whole N from $5 to $500, credited at face value with no bonus', async () => {
  // Mutation checked: drop the minimum → $4 is quoted.
  const f = await shop();
  assert.deepEqual([AI_TOPUP_UNIT.minDollars, AI_TOPUP_UNIT.maxDollars], [5, 500]);
  assert.equal(await isTokenPackPrice(f.env, UNIT), true, 'never sold as an ordinary product');
  assert.equal(await isTokenPackProduct(f.env, 'prod_unit'), true, 'never on a promo');
  assert.deepEqual(await tokenPackQuote(f.env, 2, cart(25), ''), { priceId: UNIT, packUid: null, creditMicrousd: 25_000_000, bonusMicrousd: 0, firstPurchaseOnly: false });
  assert.equal((await tokenPackQuote(f.env, 2, cart(5), '') as any).creditMicrousd, 5_000_000, '$5 is the minimum and is sold');
  assert.equal((await tokenPackQuote(f.env, 2, cart(500), '') as any).creditMicrousd, 500_000_000);
  for (const n of [0, 1, 4, 501, 2.5]) assert.deepEqual(await tokenPackQuote(f.env, 2, cart(n), ''), { error: 'token_amount_invalid' }, `quantity ${n}`);
  assert.equal(TOKEN_PACK_REFUSALS.token_amount_invalid.message, 'Choose a whole amount from $5 to $500.');
  assert.deepEqual(await tokenPackQuote(f.env, 2, cart(25), 'SAVE10'), { error: 'promo_not_for_token_packs' });
  assert.deepEqual(await tokenPackQuote(f.env, 2, cart(25, UNIT, 90), ''), { error: 'token_pack_not_on_sale' }, 'the price is the mirror\'s, never the cart\'s');
  const two = cart(5); two.lines.push({ ...two.lines[0] });
  assert.deepEqual(await tokenPackQuote(f.env, 2, two, ''), { error: 'token_pack_alone' });
  // The same limits as a pack: the $1,000 balance ceiling.
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(800_000_000);
  assert.deepEqual(await tokenPackQuote(f.env, 2, cart(201), ''), { error: 'token_balance_ceiling' });
  assert.equal((await tokenPackQuote(f.env, 2, cart(200), '') as any).creditMicrousd, 200_000_000);
  f.db.close();
});

test('the custom amount is offered only while its price is a $1 one-time USD price on sale', async () => {
  // Mutation checked: accept any unit_amount → a $2 price is offered as the custom amount.
  const f = await shop();
  assert.deepEqual(await customTopUp(f.env), { price_id: UNIT, unit_amount: 100, currency: 'usd', min_cents: 500, max_cents: 50_000 });
  f.db.close();
  const wrong = await shop(200);
  assert.equal(await customTopUp(wrong.env), null);
  assert.deepEqual(await tokenPackQuote(wrong.env, 2, cart(25, UNIT, 200), ''), { error: 'token_pack_not_on_sale' });
  wrong.db.close();
  const unset = await shop(100, { STRIPE_PRICE_AI_TOPUP_UNIT: undefined });
  assert.equal(await customTopUp(unset.env), null);
  assert.equal(await tokenPackQuote(unset.env, 2, cart(25), ''), null, 'not a token pack when unset');
  unset.db.close();
});

test('a custom amount is credited once, by the webhook, at what was paid', async () => {
  const f = await shop();
  const quote = await tokenPackQuote(f.env, 2, cart(37), '') as any;
  await recordAiTopupPurchase(f.env, { paymentIntentId: 'pi_custom', orderRef: 'order_custom', userId: 2, totalCents: 3700, currency: 'usd', quote });
  assert.equal(await creditAiTopupFromPayment(f.env, { id: 'pi_custom', status: 'succeeded', currency: 'usd', amount_received: 3700, metadata: { kind: 'cart_order', order_ref: 'order_custom', user_id: '2' } }), true);
  assert.equal(f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get().b, 37_000_000);
  f.db.close();
});

test('migration 654 puts four packs on sale, and a pack price the mirror lacks is fetched once, then sold', async () => {
  // Mutation checked: skip mirrorPackPrices → the packs stay missing_from_catalog and none is on sale.
  const f = await shop();
  f.db.exec(MIGRATION_654);
  f.db.exec(MIGRATION_654); // re-runnable
  const packs = f.db.prepare('SELECT face_cents, on_sale, origin FROM ai_token_packs ORDER BY sort').all().map((r: any) => ({ ...r }));
  assert.deepEqual(packs, [
    { face_cents: 1000, on_sale: 1, origin: 'adopted' }, { face_cents: 2500, on_sale: 1, origin: 'created' },
    { face_cents: 5000, on_sale: 1, origin: 'created' }, { face_cents: 10000, on_sale: 1, origin: 'created' }]);
  assert.equal((await packsOnSale(f.env)).packs.length, 0, 'nothing is sold before its price is mirrored');

  const rows = f.db.prepare('SELECT price_id, product_id, face_cents FROM ai_token_packs').all() as any[];
  const before = globalThis.fetch; const asked: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const id = decodeURIComponent(/\/v1\/prices\/([^?]+)/.exec(url)?.[1] ?? '');
    const row = rows.find((r) => r.price_id === id);
    if (!row) throw new Error(`no Stripe stub answers ${url}`);
    asked.push(id);
    return new Response(JSON.stringify({ id, object: 'price', active: true, currency: 'usd', unit_amount: row.face_cents, type: 'one_time', recurring: null, nickname: null, livemode: false,
      product: { id: row.product_id, name: `$${row.face_cents / 100} of tokens`, active: true, metadata: { kind: 'token_pack' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    await mirrorPackPrices(f.env);
    await mirrorPackPrices(f.env);
  } finally { globalThis.fetch = before; }
  assert.equal(asked.length, 4, 'each missing price is fetched once');
  const sale = await packsOnSale(f.env);
  assert.deepEqual([sale.state, sale.packs.map((p) => p.unit_amount)], ['ready', [1000, 2500, 5000, 10000]]);
  f.db.close();
});
