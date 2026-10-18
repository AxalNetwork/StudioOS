// D750 (#1841) — the AI top-up says what is wrong instead of "could not be
// Key-shaped fixtures are split ('sk' + '_live_…') so secret scanning does not read them as keys.
// read", fetches a price the mirror lacks once per window, tells HQ why, and
// still sells only through the D629 order → verified webhook path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { loadAiBudget } from '../src/services/aiBudget.ts';
import { MIRROR_FETCH_WINDOW_MS, aiTopupStatus, memberTopupReading, readAiTopupProduct, resetAiTopupMirrorWindow } from '../src/services/aiTopups.ts';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import billingRoute from '../src/routes/billing.ts';
import ordersRoute from '../src/routes/orders.ts';

const ID = 'price_TopUp123abc';
const PRICE = { id: ID, product: 'prod_topup', active: true, currency: 'usd', unit_amount: 2500, nickname: null, type: 'one_time', recurring: null };
const PRODUCT = { id: 'prod_topup', object: 'product', name: 'AI tokens', active: true, metadata: {} };
const READY = { configured: true, state: 'ready', product: { price_id: ID, product_id: 'prod_topup', name: 'AI tokens', currency: 'usd', unit_amount: 2500, cycle: 'onetime', credit_microusd: 25000000 } };

function fixture(extra: Record<string, unknown> = {}) {
  resetAiTopupMirrorWindow();
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd750-fixture-only-signing-secret', STRIPE_WEBHOOK_SECRET: 'd750-fixture-only-webhook-secret',
    ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk' + '_live_fixtureOnly000', STRIPE_PRICE_AI_TOPUP: ID, ...extra } as any;
  return { ...f, env };
}
/** The mirror as the last Sync from Stripe left it: one other product, so the lazy empty-table sync never runs. */
async function mirror(f: any, prices: unknown[] = [], product: Record<string, unknown> = {}) {
  await ensureCatalogSchema(f.env);
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_other','Other','alacarte',1,'{}','[]')").run();
  if (prices.length) {
    f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_topup','AI tokens','alacarte',?,'{}',?)")
      .run(product.active === false ? 0 : 1, JSON.stringify(prices));
  }
}
/** Stripe, stubbed: `GET /v1/prices/:id` answers `price`; every call is counted. */
function stripe(answer: (url: string, init: any) => Response) {
  const before = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (input: any, init: any) => { const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`); return answer(url, init); }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notReady = (reason: string) => ({ configured: true, state: 'not_ready', reason });
async function bearer(f: any, user: number) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}

test('unset is not configured and asks Stripe nothing; a malformed variable is bad_config, never an error', async () => {
  const s = stripe(() => { throw new Error('no provider call expected'); });
  try {
    for (const value of [undefined, '']) {
      const f = fixture({ STRIPE_PRICE_AI_TOPUP: value });
      try { assert.deepEqual(await readAiTopupProduct(f.env), { configured: false }); } finally { f.db.close(); }
    }
    for (const value of ['prod_123', 'sk' + '_live_pastedHere', 'price_', 'price_has space', 42]) {
      const f = fixture({ STRIPE_PRICE_AI_TOPUP: value });
      try { assert.deepEqual(await readAiTopupProduct(f.env), notReady('bad_config'), String(value)); } finally { f.db.close(); }
    }
    assert.deepEqual(s.calls, []);
  } finally { s.restore(); }
});

test('each mirrored price problem is its own reason; a sellable one is ready with its credit', async () => {
  const s = stripe(() => { throw new Error('a mirrored price needs no provider call'); });
  try {
    const cases: [Record<string, unknown>, Record<string, unknown>, unknown][] = [
      [{}, {}, READY],
      [{ active: false }, {}, notReady('inactive')],
      [{}, { active: false }, notReady('inactive')],
      [{ type: 'recurring', recurring: { interval: 'month', interval_count: 1 } }, {}, notReady('not_one_time')],
      [{ currency: 'eur' }, {}, notReady('not_usd')],
      [{ unit_amount: 0 }, {}, notReady('bad_amount')],
      [{ unit_amount: null }, {}, notReady('bad_amount')],
      [{ unit_amount: 12.5 }, {}, notReady('bad_amount')],
    ];
    for (const [price, product, want] of cases) {
      const f = fixture();
      try { await mirror(f, [{ ...PRICE, ...price }], product); assert.deepEqual(await readAiTopupProduct(f.env), want, JSON.stringify([price, product])); } finally { f.db.close(); }
    }
    assert.deepEqual(s.calls, []);
  } finally { s.restore(); }
});

test('a price the mirror lacks is fetched once, mirrored as syncCatalog writes it, and ready on the next read too', async () => {
  const f = fixture();
  const s = stripe((url) => url.includes(`/v1/prices/${ID}`) ? json({ ...PRICE, livemode: true, product: PRODUCT }) : json({ error: 'unexpected' }, 500));
  try {
    await mirror(f);
    const t0 = Date.parse('2026-10-18T12:00:00Z');
    assert.deepEqual(await readAiTopupProduct(f.env, t0), READY);
    assert.deepEqual(await readAiTopupProduct(f.env, t0 + 1000), READY);
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0], /^GET https:\/\/api\.stripe\.com\/v1\/prices\/price_TopUp123abc\?expand%5B%5D=product$/);
    const row = { ...f.db.prepare("SELECT id,name,kind,active,prices_json FROM stripe_products WHERE id='prod_topup'").get() };
    assert.equal(row.name, 'AI tokens'); assert.equal(row.active, 1); assert.equal(row.kind, 'alacarte');
    assert.deepEqual(JSON.parse(row.prices_json).map((p: any) => [p.id, p.type, p.currency, p.unit_amount, p.active]), [[ID, 'one_time', 'usd', 2500, true]]);
  } finally { s.restore(); f.db.close(); }
});

test('Stripe 404 is missing_from_catalog, asked again only after the window; another mode is mode_mismatch', async () => {
  const f = fixture();
  let answer: Response | (() => Response) = () => json({ error: { message: `No such price: '${ID}'` } }, 404);
  const s = stripe(() => (answer as () => Response)());
  try {
    await mirror(f);
    const t0 = Date.parse('2026-10-18T12:00:00Z');
    assert.deepEqual(await readAiTopupProduct(f.env, t0), notReady('missing_from_catalog'));
    assert.deepEqual(await readAiTopupProduct(f.env, t0 + MIRROR_FETCH_WINDOW_MS - 1), notReady('missing_from_catalog'));
    assert.equal(s.calls.length, 1, 'a bad ID cannot hammer Stripe');
    answer = () => json({ error: { message: `No such price: '${ID}'; a similar object exists in test mode, but a live mode key was used to make this request.` } }, 404);
    assert.deepEqual(await readAiTopupProduct(f.env, t0 + MIRROR_FETCH_WINDOW_MS), notReady('mode_mismatch'));
    assert.equal(s.calls.length, 2);
    resetAiTopupMirrorWindow();
    answer = () => json({ ...PRICE, livemode: false, product: PRODUCT });
    assert.deepEqual(await readAiTopupProduct(f.env, t0), notReady('mode_mismatch'), 'a test-mode price under a live key');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stripe_products WHERE id='prod_topup'").get().n, 0, 'the other mode is never mirrored');
  } finally { s.restore(); f.db.close(); }
});

test('the route answers members the state only, and 503 only when D1 or Stripe cannot be read', async () => {
  const s = stripe(() => json({ error: { message: 'down' } }, 500));
  try {
    let f = fixture();
    try {
      await mirror(f, [{ ...PRICE, currency: 'eur' }]);
      const r = await budgetRoute.request('/top-up', { headers: await bearer(f, 2) }, f.env);
      assert.equal(r.status, 200); assert.deepEqual(await r.json(), { configured: true, state: 'not_ready' }, 'the member never sees the reason');
      assert.equal((await budgetRoute.request('/top-up', {}, f.env)).status, 401);
    } finally { f.db.close(); }
    f = fixture();
    try {
      await mirror(f);
      const r = await budgetRoute.request('/top-up', { headers: await bearer(f, 2) }, f.env);
      assert.equal(r.status, 503, 'Stripe unreadable'); assert.equal(((await r.json()) as any).error, 'ai_topup_unreadable');
    } finally { f.db.close(); }
    f = fixture();
    try {
      const headers = await bearer(f, 2);
      await ensureCatalogSchema(f.env);
      const prepare = f.env.DB.prepare.bind(f.env.DB);
      f.env.DB.prepare = (sql: string) => { if (/stripe_products/.test(sql)) throw new Error('D1 unavailable'); return prepare(sql); };
      const r = await budgetRoute.request('/top-up', { headers }, f.env);
      assert.equal(r.status, 503, 'D1 unreadable'); assert.equal(((await r.json()) as any).error, 'ai_topup_unreadable');
    } finally { f.db.close(); }
    assert.deepEqual(memberTopupReading(READY as any), READY);
    assert.deepEqual(memberTopupReading({ configured: false }), { configured: false });
  } finally { s.restore(); }
});

test('/top-up/status is Super Admin only and carries the reason, six characters of the ID and the mode, never a key', async () => {
  const s = stripe(() => json({ error: { message: 'No such price' } }, 404));
  try {
    const f = fixture();
    try {
      await mirror(f, [{ ...PRICE, type: 'recurring' }]);
      assert.equal((await budgetRoute.request('/top-up/status', {}, f.env)).status, 401);
      assert.equal((await budgetRoute.request('/top-up/status', { headers: await bearer(f, 2) }, f.env)).status, 403);
      f.db.prepare("UPDATE users SET role='admin' WHERE id=4").run();
      assert.equal((await budgetRoute.request('/top-up/status', { headers: await bearer(f, 4) }, f.env)).status, 403, 'an admin is not a Super Admin');
      const r = await budgetRoute.request('/top-up/status', { headers: await bearer(f, 1) }, f.env);
      assert.equal(r.status, 200);
      const text = await r.text();
      assert.deepEqual(JSON.parse(text), { state: 'not_ready', reason: 'not_one_time', price_id_suffix: '123abc', mode: 'live' });
      assert.doesNotMatch(text, /price_TopUp|sk_|rk_/);
    } finally { f.db.close(); }
    for (const [extra, want] of [
      [{ STRIPE_PRICE_AI_TOPUP: undefined }, { state: 'unset', reason: null, price_id_suffix: null, mode: 'live' }],
      [{ STRIPE_PRICE_AI_TOPUP: 'sk' + '_live_pastedIntoTheWrongSecret', STRIPE_SECRET_KEY: 'rk' + '_test_restricted000' }, { state: 'not_ready', reason: 'bad_config', price_id_suffix: null, mode: 'test' }],
    ] as const) {
      const g = fixture(extra as any);
      try {
        const status = await aiTopupStatus(g.env);
        assert.deepEqual(status, want);
        assert.doesNotMatch(JSON.stringify(status), /sk_|rk_/);
      } finally { g.db.close(); }
    }
    const g = fixture();
    try { await mirror(g, [PRICE]); assert.deepEqual(await aiTopupStatus(g.env), { state: 'ready', reason: null, price_id_suffix: '123abc', mode: 'live' }); } finally { g.db.close(); }
  } finally { s.restore(); }
});

test('end to end: a price created after the last sync is fetched, bought through the order route and credited once by the webhook', async () => {
  const f = fixture();
  const s = stripe((url, init) => {
    if (url.includes(`/v1/prices/${ID}`)) return json({ ...PRICE, livemode: true, product: PRODUCT });
    if (url.endsWith('/v1/customers')) return json({ id: 'cus_member2' });
    if (url.endsWith('/v1/payment_intents') && init?.method === 'POST') {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get('amount'), '2500'); assert.equal(form.get('metadata[kind]'), 'cart_order');
      return json({ id: 'pi_topupE2E', client_secret: 'pi_topupE2E_secret_fixture', status: 'requires_payment_method' });
    }
    return json({ error: { message: `unexpected ${url}` } }, 500);
  });
  try {
    await mirror(f);
    f.db.exec('ALTER TABLE users ADD COLUMN uid TEXT; ALTER TABLE users ADD COLUMN stripe_customer_id TEXT');
    f.db.prepare("UPDATE users SET uid='uid-member-2' WHERE id=2").run();
    const headers = await bearer(f, 2);
    const read = await budgetRoute.request('/top-up', { headers }, f.env);
    assert.deepEqual(await read.json(), READY);
    const order = await ordersRoute.request('/intent', { method: 'POST', headers, body: JSON.stringify({ items: [{ price_id: ID, quantity: 1 }], nonce: 'd750' }) }, f.env);
    assert.equal(order.status, 200, await order.clone().text());
    const placed = await order.json() as any;
    assert.equal(placed.total, 2500); assert.equal(placed.payment_intent_id, 'pi_topupE2E');
    assert.equal((await loadAiBudget(f.env, 2)).balance_microusd, 0, 'placing the order credits nothing');
    const pi = { id: 'pi_topupE2E', status: 'succeeded', currency: 'usd', amount_received: 2500, metadata: { kind: 'cart_order', order_ref: placed.order_ref, user_id: '2' } };
    const body = JSON.stringify({ id: 'evt_topupE2E', type: 'payment_intent.succeeded', data: { object: pi } });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
    const hook = { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' };
    for (let i = 0; i < 2; i++) assert.equal((await billingRoute.request('/stripe/webhook', { method: 'POST', headers: hook, body }, f.env)).status, 200);
    assert.equal((await loadAiBudget(f.env, 2)).balance_microusd, 25000000);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_topup_ledger').get().n, 1);
    assert.equal(s.calls.filter((c) => c.includes('/v1/prices/')).length, 1);
    assert.ok(!s.calls.some((c) => /checkout\/sessions|\/v1\/prices( |$)|\/v1\/products/.test(c)), 'no Checkout Session and nothing created in Stripe');
  } finally { s.restore(); f.db.close(); }
});
