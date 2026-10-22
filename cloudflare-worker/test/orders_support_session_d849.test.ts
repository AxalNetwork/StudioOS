// D849 (#2472): a support session cannot buy AI tokens. `POST /api/orders/intent`
// refuses a token-pack cart under an impersonation token, before any Stripe
// call, and leaves the member's own purchase and a support session's
// non-token order to the route as before.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/orders_support_session_d849.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import ordersRoute from '../src/routes/orders.ts';

const ME = 2, ADMIN = 1;
const price = (id: string) => ({ id, active: true, type: 'one_time', unit_amount: 2500, currency: 'usd' });

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/orders', ordersRoute);
  return a;
}

async function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', ENVIRONMENT: 'development' } as any;
  await ensureCatalogSchema(env);
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,sort,origin) VALUES('pack25','price_Pack25','prod_Pack25',2500,0,1,1,'created')").run();
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_Pack25','$25 of tokens','token_pack',1,'{}',?)").run(JSON.stringify([price('price_Pack25')]));
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_Review','Deck review','alacarte',1,'{}',?)").run(JSON.stringify([price('price_Review')]));
  return { f, env };
}

async function intent(env: any, priceId: string, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: ME, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
  const stripe: string[] = [];
  const before = globalThis.fetch;
  // The fixture reaches no provider: any Stripe call is recorded and fails.
  globalThis.fetch = (async (url: any) => { stripe.push(String(url)); throw new Error('fixture: no Stripe'); }) as any;
  const log = console.error, warn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try {
    const r = await app().request('/api/orders/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ items: [{ price_id: priceId, quantity: 1 }], nonce: 'n1' }),
    }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any, stripe };
  } finally { globalThis.fetch = before; console.error = log; console.warn = warn; }
}

test('a support session cannot buy a token pack: 403, a sentence, and no Stripe call', async () => {
  const { f, env } = await world();
  const r = await intent(env, 'price_Pack25', { impersonated_by: ADMIN });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'support_session_refused');
  assert.equal(r.body.message, 'A support session cannot buy AI tokens.');
  assert.deepEqual(r.stripe, [], 'refused before any provider call');
  assert.equal(Number(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n), 0, 'no order row is written');
  f.db.close();
});

test('the member buying their own pack is not refused: the route goes on to Stripe', async () => {
  const { f, env } = await world();
  const r = await intent(env, 'price_Pack25');
  assert.notEqual(r.status, 403);
  assert.ok(r.stripe.length > 0, 'the route reached Stripe');
  f.db.close();
});

test('a support session ordering something that is not AI tokens is not refused by this rule', async () => {
  const { f, env } = await world();
  const r = await intent(env, 'price_Review', { impersonated_by: ADMIN });
  assert.notEqual(r.body?.error, 'support_session_refused');
  assert.ok(r.stripe.length > 0, 'the route reached Stripe');
  f.db.close();
});
