// D755 CR2 (#1919) — the reads (token packs, top-up history, every plan's AI
// allowance) and the Super Admin's token-pack, member-account, adjustment and
// reconcile routes. Stripe is stubbed: a URL no stub answers fails the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { ledgerBalance } from '../src/services/aiCredits.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import publicRoutes from '../src/routes/public.ts';
import { adminCatalog } from '../src/routes/catalog.ts';

const PLAIN_ADMIN = 101;
const price = (id: string, product: string, unit_amount: number | null, extra: Record<string, unknown> = {}) =>
  ({ id, product, active: true, currency: 'usd', unit_amount, nickname: null, type: 'one_time', recurring: null, ...extra });
const monthly = (id: string, product: string, unit_amount: number) =>
  price(id, product, unit_amount, { type: 'recurring', recurring: { interval: 'month', interval_count: 1 } });

/** The app as index.ts mounts these routers, with its auth-error mapping. */
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  a.route('/api/admin/catalog', adminCatalog);
  a.route('/api/public', publicRoutes);
  return a;
}

/** Stripe, stubbed, as far as the catalog and pack routes use it. An Idempotency-Key replays its first answer. */
function stripeStub(seed: { products: any[]; prices: any[] }) {
  const before = globalThis.fetch;
  const calls: string[] = []; const replay = new Map<string, unknown>(); let n = 0;
  const products = [...seed.products], prices = [...seed.prices];
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input); const method = init?.method ?? 'GET'; calls.push(`${method} ${url}`);
    const form = new URLSearchParams(String(init?.body ?? ''));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const key = init?.headers?.['Idempotency-Key'];
    if (key && replay.has(key)) return json(replay.get(key));
    const answer = (body: any) => { if (key) replay.set(key, body); return json(body); };
    const path = new URL(url).pathname;
    if (method === 'GET' && path === '/v1/products') return json({ data: products, has_more: false });
    if (method === 'GET' && path === '/v1/prices') return json({ data: prices, has_more: false });
    if (method === 'POST' && path === '/v1/products') {
      const meta: Record<string, string> = {};
      for (const [k, v] of form) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) meta[m[1]] = v; }
      const p = { id: `prod_new${++n}`, name: form.get('name'), active: true, metadata: meta }; products.push(p); return answer(p);
    }
    if (method === 'POST' && path === '/v1/prices') {
      const p = price(`price_new${++n}`, String(form.get('product')), Number(form.get('unit_amount'))); prices.push(p); return answer(p);
    }
    const archive = /^\/v1\/prices\/(price_\w+)$/.exec(path);
    if (method === 'POST' && archive && form.get('active') === 'false') {
      const p = prices.find((x) => x.id === archive[1]); if (p) p.active = false; return answer(p ?? {});
    }
    if (method === 'GET' && archive) {
      const p = prices.find((x) => x.id === archive[1]);
      if (!p) return json({ error: { message: 'No such price' } }, 404);
      return json({ ...p, livemode: false, product: products.find((x) => x.id === p.product) });
    }
    if (method === 'POST' && /^\/v1\/products\/prod_\w+$/.test(path)) return answer({ id: path.split('/').pop() });
    throw new Error(`no Stripe stub answers ${method} ${url}`);
  }) as any;
  return { calls, products, prices, restore: () => { globalThis.fetch = before; } };
}

const SEED_PRODUCTS = [
  { id: 'prod_pack25', name: '$25 of tokens', active: true, metadata: { kind: 'token_pack', decision: 'D755', seller: 'management' } },
  { id: 'prod_pack10', name: '$10 of tokens', active: true, metadata: { kind: 'token_pack', decision: 'D755', seller: 'management' } },
  { id: 'prod_growth', name: 'Validate + Build', active: true, metadata: { tier: 'growth' } },
  { id: 'prod_studio', name: 'Raise + Grow', active: true, metadata: { tier: 'studio' } },
  { id: 'prod_pro', name: 'Investor Professional', active: true, metadata: { investor_tier: 'professional' } },
  { id: 'prod_advisor', name: 'Advisor', active: true, metadata: { plan_group: 'advisor' } },
  { id: 'prod_partner', name: 'Service Partner', active: true, metadata: { plan_group: 'partner' } },
  { id: 'prod_mi', name: 'Market Intelligence Pro', active: true, metadata: { plan: 'mi_pro' } },
  { id: 'prod_bare', name: 'Unmarked plan', active: true, metadata: {} },
  { id: 'prod_other', name: 'Other', active: true, metadata: { kind: 'alacarte', feature_key: 'x', unlock_days: '30' } },
  { id: 'prod_recurring', name: 'Recurring', active: true, metadata: {} },
  { id: 'prod_odd', name: 'Odd', active: true, metadata: {} },
];
const SEED_PRICES = [
  price('price_pack25', 'prod_pack25', 2500), price('price_pack10', 'prod_pack10', 1000),
  monthly('price_growth', 'prod_growth', 4900), monthly('price_studio', 'prod_studio', 19900), monthly('price_pro', 'prod_pro', 9900),
  monthly('price_advisor', 'prod_advisor', 2900), monthly('price_partner', 'prod_partner', 2900), monthly('price_mi', 'prod_mi', 1900),
  monthly('price_bare', 'prod_bare', 100), price('price_other', 'prod_other', 1000),
  monthly('price_recurring', 'prod_recurring', 2500), price('price_odd', 'prod_odd', 1250),
];

/** CR1's world: the AI fixture with 486, the catalog mirror, orders, and a plain admin. */
async function world(opts: { packs?: boolean; mirror?: boolean; env?: Record<string, unknown> } = {}) {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd755-reads-fixture-only-secret', STRIPE_WEBHOOK_SECRET: 'd755-reads-fixture-only-webhook',
    ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000', ...opts.env } as any;
  await ensureCatalogSchema(env); await ensureOrdersSchema(env);
  f.db.prepare("INSERT INTO users(id,email,name,role,is_super_admin) VALUES(?,?,?,?,0)").run(PLAIN_ADMIN, 'plain@example.test', 'Plain Admin', 'admin');
  if (opts.mirror !== false) {
    const kindOf = (p: any) => p.metadata.kind === 'token_pack' ? 'token_pack' : p.metadata.kind === 'alacarte' ? 'alacarte'
      : SEED_PRICES.some((x) => x.product === p.id && x.type === 'recurring') ? 'subscription' : 'alacarte';
    for (const p of SEED_PRODUCTS)
      f.db.prepare('INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,?,?,?,?)')
        .run(p.id, p.name, kindOf(p), 1, JSON.stringify(p.metadata), JSON.stringify(SEED_PRICES.filter((x) => x.product === p.id)
          .map((x) => ({ id: x.id, currency: x.currency, unit_amount: x.unit_amount, interval: x.recurring?.interval ?? null, interval_count: x.recurring?.interval_count ?? null, nickname: null, type: x.type, active: x.active }))));
  }
  if (opts.packs !== false) {
    f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,sort,origin) VALUES('pack25','price_pack25','prod_pack25',2500,2500000,1,2,'created')").run();
    f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,sort,origin) VALUES('pack10','price_pack10','prod_pack10',1000,0,1,1,'created')").run();
  }
  return { ...f, env };
}
async function auth(f: any, user: number) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
}
async function call(f: any, method: string, path: string, user: number | null, body?: unknown) {
  const headers = user === null ? { 'content-type': 'application/json' } : await auth(f, user);
  const r = await app().request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json, headers: r.headers, text };
}
/** Every key anywhere in a JSON value. */
const keysOf = (v: any): string[] => v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [Array.isArray(v) ? '' : k, ...keysOf(x)]).filter(Boolean) : [];
async function assertInvariant(f: any) {
  for (const { user_id } of f.db.prepare('SELECT user_id FROM ai_topup_accounts UNION SELECT user_id FROM ai_credit_ledger').all())
    assert.equal(await ledgerBalance(f.env, user_id), f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=?').get(user_id)?.b ?? 0, `invariant for ${user_id}`);
}
const purchase = (f: any, pi: string, extra: Record<string, unknown> = {}) => {
  const v = { order_ref: `MRD-${pi}`, user_id: 2, pack_uid: 'pack25', credit: 25000000, bonus: 0, credited_at: null, reversed: 0, dispute: null, created: "datetime('now','-10 minutes')", ...extra } as any;
  f.db.prepare(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,bonus_microusd,credited_at,reversed_microusd,dispute_state,created_at)
    VALUES(?,?,?,'price_pack25',?,2500,'usd',?,?,?,?,?,${v.created})`).run(pi, v.order_ref, v.user_id, v.credit, v.pack_uid, v.bonus, v.credited_at, v.reversed, v.dispute);
};
const order = (f: any, ref: string, status: string, paidAt: string | null) =>
  f.db.prepare(`INSERT INTO orders(id,order_ref,user_id,status,paid_at) VALUES(?,?,2,?,${paidAt ?? 'NULL'})`).run(`ord_${ref}`, ref, status);

test('GET /top-up: unset, not_ready, ready with two packs, on hold, and the latest purchase in each state; never a reason', async () => {
  const s = stripeStub({ products: [], prices: [] });
  try {
    let f = await world({ packs: false });
    try {
      const r = await call(f, 'GET', '/api/ai-budget/top-up', 2);
      assert.equal(r.status, 200); assert.deepEqual([r.body.state, r.body.packs, r.body.on_hold, r.body.latest], ['unset', [], false, null]);
      assert.equal(r.body.configured, false, "D750's field stays until CR4 and CR7");
    } finally { f.db.close(); }
    f = await world();
    try {
      f.db.prepare('UPDATE ai_token_packs SET on_sale=0').run();
      const r = await call(f, 'GET', '/api/ai-budget/top-up', 2);
      assert.deepEqual([r.body.state, r.body.packs], ['not_ready', []]);
      assert.ok(!keysOf(r.body).includes('reason'), 'a member is never told the reason');
      f.db.prepare('UPDATE ai_token_packs SET on_sale=1').run();
      const ready = await call(f, 'GET', '/api/ai-budget/top-up', 2);
      assert.equal(ready.body.state, 'ready');
      assert.deepEqual(ready.body.packs, [
        { uid: 'pack10', label: '$10 of tokens', price_id: 'price_pack10', unit_amount: 1000, currency: 'usd', credit_microusd: 10000000, bonus_microusd: 0 },
        { uid: 'pack25', label: '$25 of tokens', price_id: 'price_pack25', unit_amount: 2500, currency: 'usd', credit_microusd: 25000000, bonus_microusd: 2500000 },
      ], 'sorted by sort');
      // A mirrored price that no longer equals face_cents is not offered.
      f.db.prepare(`UPDATE stripe_products SET prices_json=REPLACE(prices_json,'"unit_amount":1000','"unit_amount":1100') WHERE id='prod_pack10'`).run();
      assert.deepEqual((await call(f, 'GET', '/api/ai-budget/top-up', 2)).body.packs.map((p: any) => p.uid), ['pack25']);
      // Each latest state, with the newest purchase in 24 hours.
      const states: [string, () => void][] = [
        ['waiting', () => { purchase(f, 'pi_w'); order(f, 'MRD-pi_w', 'pending', null); }],
        ['waiting', () => { purchase(f, 'pi_w2'); order(f, 'MRD-pi_w2', 'paid', "datetime('now','-30 minutes')"); }],
        ['overdue', () => { purchase(f, 'pi_o'); order(f, 'MRD-pi_o', 'paid', "datetime('now','-2 hours')"); }],
        ['credited', () => purchase(f, 'pi_c', { credited_at: '2026-10-18 00:00:00' })],
        ['refunded', () => purchase(f, 'pi_r', { credited_at: '2026-10-18 00:00:00', reversed: 5000000 })],
        ['disputed', () => purchase(f, 'pi_d', { credited_at: '2026-10-18 00:00:00', dispute: 'open' })],
      ];
      for (const [want, seed] of states) {
        f.db.exec('DELETE FROM ai_topup_purchases; DELETE FROM orders;'); seed();
        const r = await call(f, 'GET', '/api/ai-budget/top-up', 2);
        assert.equal(r.body.latest?.state, want, want);
        assert.deepEqual(Object.keys(r.body.latest).sort(), ['amount_microusd', 'at', 'order_ref', 'pack_label', 'state']);
        assert.equal(r.body.latest.pack_label, '$25 of tokens');
        assert.equal(r.body.on_hold, want === 'disputed');
      }
      // Older than 24 hours is not the latest; another member's purchase is never it.
      f.db.exec('DELETE FROM ai_topup_purchases;');
      purchase(f, 'pi_old', { created: "datetime('now','-25 hours')" }); purchase(f, 'pi_theirs', { user_id: 3 });
      assert.equal((await call(f, 'GET', '/api/ai-budget/top-up', 2)).body.latest, null);
      // A shortfall in the last 90 days holds packs too.
      f.db.prepare("INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,shortfall_microusd,actor,created_at) VALUES(2,'refund',0,'rf:ch:1',100,'t',datetime('now','-30 days'))").run();
      assert.equal((await call(f, 'GET', '/api/ai-budget/top-up', 2)).body.on_hold, true);
      assert.equal((await call(f, 'GET', '/api/ai-budget/top-up', null)).status, 401);
    } finally { f.db.close(); }
    assert.deepEqual(s.calls.filter((c) => !c.includes('/v1/prices/price_')), [], 'the pack list reads D1 only');
  } finally { s.restore(); }
});

test('GET /history pages newest first, adds runs on request, shows only the member and never a reason', async () => {
  const f = await world(); const s = stripeStub({ products: [], prices: [] });
  try {
    const add = (user: number, kind: string, delta: number, ref: string, at: string, extra: Record<string, unknown> = {}) =>
      f.db.prepare('INSERT INTO ai_credit_ledger(uid,user_id,kind,delta_microusd,source_ref,payment_intent_id,pack_uid,actor,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(`u_${kind}_${ref}`.replace(/[^A-Za-z0-9_-]/g, "_"), user, kind, delta, ref, extra.pi ?? null, extra.pack ?? null, 't', extra.reason ?? null, at);
    purchase(f, 'pi_h', { credited_at: '2026-10-01 00:00:01' });
    add(2, 'purchase', 25000000, 'pi:pi_h', '2026-10-01 00:00:01', { pi: 'pi_h', pack: 'pack25' });
    add(2, 'bonus', 2500000, 'pi:pi_h', '2026-10-01 00:00:01', { pi: 'pi_h', pack: 'pack25' });
    add(2, 'hold', -100, 'res:r1', '2026-10-02 00:00:00'); add(2, 'release', 100, 'res:r1', '2026-10-02 00:00:01'); add(2, 'spend', -50, 'res:r1', '2026-10-02 00:00:01');
    add(2, 'adjustment', 1000000, 'adj:k1', '2026-10-03 00:00:00', { reason: 'goodwill after outage' });
    add(3, 'purchase', 9000000, 'pi:pi_x', '2026-10-04 00:00:00');
    purchase(f, 'pi_wait'); order(f, 'MRD-pi_wait', 'paid', "datetime('now','-2 hours')");
    const first = await call(f, 'GET', '/api/ai-budget/history?limit=2', 2);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items.map((i: any) => i.kind), ['adjustment', 'purchase']);
    assert.equal(first.body.items[1].order_ref, 'MRD-pi_h'); assert.equal(first.body.items[1].pack_label, '$25 of tokens');
    assert.deepEqual(first.body.pending.map((p: any) => [p.order_ref, p.state]), [['MRD-pi_wait', 'overdue']]);
    const second = await call(f, 'GET', `/api/ai-budget/history?limit=2&before=${encodeURIComponent(first.body.next_before)}`, 2);
    assert.deepEqual(second.body.items.map((i: any) => i.kind), ['bonus']); assert.equal(second.body.next_before, null);
    assert.deepEqual(second.body.pending, [], 'pending purchases lead the first page only');
    const runs = await call(f, 'GET', '/api/ai-budget/history?runs=1&limit=50', 2);
    assert.deepEqual(runs.body.items.map((i: any) => i.kind).sort(), ['adjustment', 'bonus', 'hold', 'purchase', 'release', 'spend']);
    for (const r of [first, second, runs]) {
      assert.ok(!keysOf(r.body).includes('reason'), 'no adjustment reason'); assert.ok(!r.text.includes('goodwill'));
      assert.ok(!r.text.includes('pi_x') && !r.text.includes('9000000'), "another member's row never appears");
    }
    for (const bad of ['limit=0', 'limit=51', 'limit=2.5', 'before=nope', 'before=2026-10-01%2000%3A00%3A00%7C%27%20OR%201'])
      assert.equal((await call(f, 'GET', `/api/ai-budget/history?${bad}`, 2)).status, 400, bad);
    assert.equal((await call(f, 'GET', '/api/ai-budget/history', null)).status, 401);
    assert.deepEqual(s.calls, []);
  } finally { s.restore(); f.db.close(); }
});

test('the public read lists every family with its allowance, names no person, never calls Stripe and is cached', async () => {
  const f = await world(); const s = stripeStub({ products: [], prices: [] });
  try {
    // D783: a row typed for a member licence before D783 is not read; each plan gives 25% of its price.
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',1000000,5000000,1)").run();
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('advisor',0,0,1)").run();
    const r = await call(f, 'GET', '/api/public/plans-and-packs', null);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    const byKey = Object.fromEntries(r.body.plans.map((p: any) => [`${p.family}:${p.licence_key}:${p.product_id}`, p]));
    assert.deepEqual(Object.keys(byKey).sort(), [
      'advisor:advisor:prod_advisor', 'founder:founder:free:null', 'founder:founder:growth:prod_growth', 'founder:founder:studio:prod_studio',
      'investor:investor:free:null', 'investor:investor:professional:prod_pro', 'market_intelligence:null:prod_mi', 'other:other:null',
      'partner:partner:prod_partner',
    ], 'an unmarked product gets no card');
    assert.deepEqual(byKey['founder:founder:growth:prod_growth'].allowance, { share: 0.25, monthly_microusd: 12250000, source: 'plan' });
    assert.deepEqual(byKey['advisor:advisor:prod_advisor'].allowance, { share: 0.25, monthly_microusd: 7250000, source: 'plan' });
    assert.deepEqual(byKey['founder:founder:studio:prod_studio'].allowance, { share: 0.25, monthly_microusd: 49750000, source: 'plan' });
    assert.deepEqual(byKey['market_intelligence:null:prod_mi'].allowance, { share: 0.25, monthly_microusd: 4750000, source: 'plan' }, 'Market Intelligence Pro gives its share too');
    assert.deepEqual(byKey['founder:founder:growth:prod_growth'].prices, [{ price_id: 'price_growth', unit_amount: 4900, currency: 'usd', interval: 'month', interval_count: 1, allowance_microusd: 12250000 }]);
    assert.equal(byKey['founder:founder:free:null'].free, true);
    assert.deepEqual(byKey['founder:founder:free:null'].allowance, { share: 0.25, monthly_microusd: 0, source: 'none' }, 'no plan, no allowance');
    assert.deepEqual(r.body.packs.map((p: any) => p.label), ['$10 of tokens', '$25 of tokens']);
    assert.match(r.body.covers, /^Covers Eadwyn/); assert.equal(r.body.resets, 'Resets on the 1st of each month at 00:00 UTC.');
    const keys = keysOf(r.body);
    for (const k of ['recorded_by', 'recorded_by_name', 'recorded_at', 'user_id', 'member_id', 'name', 'email']) assert.ok(!keys.includes(k), `no ${k}`);
    for (const word of ['Owner', 'owner@example.test']) assert.ok(!r.text.includes(word), `no ${word}`);
    // An empty mirror with a Stripe key set still never reaches Stripe.
    f.db.exec('DELETE FROM stripe_products');
    const empty = await call(f, 'GET', '/api/public/plans-and-packs', null);
    assert.equal(empty.status, 200); assert.deepEqual(empty.body.packs, []);
    assert.deepEqual(s.calls, [], 'no Stripe call');
  } finally { s.restore(); f.db.close(); }
});

test('every Super Admin route answers 403 to a plain Admin and 401 signed out', async () => {
  const f = await world(); const s = stripeStub({ products: SEED_PRODUCTS, prices: SEED_PRICES });
  try {
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/ai-budget/top-up/status'], ['GET', '/api/ai-budget/members/2'],
      ['POST', '/api/ai-budget/members/2/adjustments', { amount_usd: 5, reason: 'a long enough reason', idempotency_key: 'key-00000001' }],
      ['GET', '/api/ai-budget/reconcile'],
      ['POST', '/api/admin/catalog/token-packs', { amount_usd: 25, idempotency_key: 'key-00000001' }],
      ['POST', '/api/admin/catalog/token-packs/adopt', { price_id: 'price_other' }],
      ['PATCH', '/api/admin/catalog/token-packs/pack25', { on_sale: false }],
      ['POST', '/api/admin/catalog/token-packs/pack25/archive'],
    ];
    for (const [method, path, body] of routes) {
      assert.equal((await call(f, method, path, PLAIN_ADMIN, body)).status, 403, `${method} ${path} plain admin`);
      assert.equal((await call(f, method, path, 2, body)).status, 403, `${method} ${path} member`);
      assert.equal((await call(f, method, path, null, body)).status, 401, `${method} ${path} signed out`);
    }
    assert.deepEqual(s.calls, []);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_credit_ledger').get().n, 0);
    assert.deepEqual(f.db.prepare('SELECT uid,on_sale,archived_at FROM ai_token_packs ORDER BY uid').all().map((r: any) => ({ ...r })),
      [{ uid: 'pack10', on_sale: 1, archived_at: null }, { uid: 'pack25', on_sale: 1, archived_at: null }]);
  } finally { s.restore(); f.db.close(); }
});

test('pack creation is idempotent; a bad amount reaches no Stripe; adopt judges the price; archive archives it', async () => {
  const f = await world(); const s = stripeStub({ products: SEED_PRODUCTS, prices: SEED_PRICES });
  try {
    for (const amount of [4, 501, 12.5, '25', 0, -10, null])
      assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs', 1, { amount_usd: amount, idempotency_key: 'key-00000001' })).status, 400, String(amount));
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs', 1, { amount_usd: 50, idempotency_key: 'short' })).status, 400);
    assert.deepEqual(s.calls, [], 'a refused amount reaches no Stripe');
    const one = await call(f, 'POST', '/api/admin/catalog/token-packs', 1, { amount_usd: 50, idempotency_key: 'key-pack-50-a' });
    const two = await call(f, 'POST', '/api/admin/catalog/token-packs', 1, { amount_usd: 50, idempotency_key: 'key-pack-50-a' });
    assert.equal(one.status, 200, one.text); assert.equal(two.status, 200, two.text);
    assert.deepEqual(one.body.pack, two.body.pack);
    assert.deepEqual([one.body.pack.label, one.body.pack.face_cents, one.body.pack.on_sale, one.body.pack.origin], ['$50 of tokens', 5000, false, 'created']);
    assert.equal(s.products.filter((p) => p.name === '$50 of tokens').length, 1, 'one Stripe product');
    assert.equal(s.prices.filter((p) => p.unit_amount === 5000).length, 1, 'one Stripe price');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_token_packs WHERE face_cents=5000').get().n, 1, 'one row');
    assert.deepEqual(s.products.find((p) => p.name === '$50 of tokens')?.metadata, { kind: 'token_pack', decision: 'D755', seller: 'management' });
    const creates = s.calls.filter((c) => c === 'POST https://api.stripe.com/v1/products' || c === 'POST https://api.stripe.com/v1/prices');
    assert.equal(creates.length, 4, 'each create sent twice, answered once by its Idempotency-Key');
    const audit = f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='token_pack_create'").get().n;
    assert.ok(audit >= 1);
    // Adopt: a recurring price, a $12.50 price and an unknown price are refused; a one-time whole-dollar price is recorded.
    assert.deepEqual((await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'price_recurring' })).body, { error: 'token_pack_not_adoptable', reason: 'not_one_time' });
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'price_odd' })).body.reason, 'bad_amount');
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'price_missing' })).body.reason, 'missing_from_catalog');
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'not a price' })).status, 400);
    const adopted = await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'price_other' });
    assert.equal(adopted.status, 200, adopted.text);
    assert.deepEqual([adopted.body.pack.origin, adopted.body.pack.face_cents, adopted.body.pack.on_sale], ['adopted', 1000, false]);
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs/adopt', 1, { price_id: 'price_other' })).body.already, true);
    // PATCH: the bonus within 10%, and the amount never changes.
    assert.equal((await call(f, 'PATCH', '/api/admin/catalog/token-packs/pack25', 1, { bonus_usd: 2.51 })).body.error, 'token_pack_bonus_invalid');
    assert.equal((await call(f, 'PATCH', '/api/admin/catalog/token-packs/pack25', 1, { amount_usd: 30 })).body.error, 'token_pack_amount_fixed');
    const patched = await call(f, 'PATCH', '/api/admin/catalog/token-packs/pack25', 1, { bonus_usd: 2.5, on_sale: false, sort: 7 });
    assert.deepEqual([patched.body.pack.bonus_microusd, patched.body.pack.on_sale, patched.body.pack.sort], [2500000, false, 7]);
    assert.equal((await call(f, 'PATCH', '/api/admin/catalog/token-packs/missing', 1, { sort: 1 })).status, 404);
    // Archive: the Stripe price is archived and the pack is off sale for good.
    const archived = await call(f, 'POST', '/api/admin/catalog/token-packs/pack10/archive', 1);
    assert.equal(archived.status, 200, archived.text);
    assert.ok(s.calls.includes('POST https://api.stripe.com/v1/prices/price_pack10'));
    assert.equal(s.prices.find((p) => p.id === 'price_pack10')?.active, false);
    assert.deepEqual({ ...f.db.prepare("SELECT on_sale, archived_at IS NOT NULL AS archived FROM ai_token_packs WHERE uid='pack10'").get() }, { on_sale: 0, archived: 1 });
    assert.equal((await call(f, 'PATCH', '/api/admin/catalog/token-packs/pack10', 1, { on_sale: true })).status, 409);
    assert.equal((await call(f, 'POST', '/api/admin/catalog/token-packs/pack10/archive', 1)).body.already, true);
    // HQ's readiness: one line per pack, with its reason and the fallback adoptable.
    f.env.STRIPE_PRICE_AI_TOPUP = 'price_recurring';
    const status = await call(f, 'GET', '/api/ai-budget/top-up/status', 1);
    const lines = Object.fromEntries(status.body.packs.map((l: any) => [l.uid ?? 'environment', l]));
    assert.deepEqual([lines.pack25.state, lines.pack25.reason, lines.pack25.price_id_suffix], ['not_ready', 'off_sale', 'pack25']);
    assert.ok(!('pack10' in lines), 'an archived pack has no line');
    assert.deepEqual([lines.environment.origin, lines.environment.reason, lines.environment.adoptable], ['environment', 'not_one_time', true]);
    assert.equal(status.body.mode, 'test');
    assert.doesNotMatch(status.text, /sk_test|price_recurring"/, 'no key and no full price ID');
  } finally { s.restore(); f.db.close(); }
});

test('the generic catalog writes refuse a pack, its product and its price', async () => {
  const f = await world(); const s = stripeStub({ products: SEED_PRODUCTS, prices: SEED_PRICES });
  try {
    const refused: [string, string, unknown?][] = [
      ['POST', '/api/admin/catalog/products', { name: '$5 of tokens', kind: 'token_pack', metadata: {} }],
      ['POST', '/api/admin/catalog/products', { name: 'Sneaky', kind: 'alacarte', metadata: { kind: 'token_pack', feature_key: 'x', unlock_days: '1' } }],
      ['PATCH', '/api/admin/catalog/products/prod_pack25', { name: '$250 of tokens' }],
      ['PATCH', '/api/admin/catalog/products/prod_other', { metadata: { kind: 'token_pack' } }],
      ['POST', '/api/admin/catalog/products/prod_pack25/archive'],
      ['POST', '/api/admin/catalog/products/prod_pack25/prices', { unit_amount: 100, type: 'one_time' }],
      ['PATCH', '/api/admin/catalog/prices/price_pack25', { nickname: 'cheap' }],
      ['POST', '/api/admin/catalog/prices/price_pack25/archive'],
    ];
    for (const [method, path, body] of refused) {
      const r = await call(f, method, path, PLAIN_ADMIN, body);
      assert.deepEqual([r.status, r.body?.error], [409, 'token_pack_managed_on_hq'], `${method} ${path}`);
    }
    assert.deepEqual(s.calls, [], 'refused before any Stripe call');
    // The same writes on an ordinary product still reach Stripe.
    assert.equal((await call(f, 'POST', '/api/admin/catalog/prices/price_other/archive', PLAIN_ADMIN)).status, 200);
  } finally { s.restore(); f.db.close(); }
});

test('adjustments stay within their bounds, are one row per key, and the notice gives no reason', async () => {
  const f = await world(); const s = stripeStub({ products: [], prices: [] });
  try {
    const adjust = (amount: unknown, key: string, reason = 'support credit after outage') =>
      call(f, 'POST', '/api/ai-budget/members/2/adjustments', 1, { amount_usd: amount, reason, idempotency_key: key });
    for (const [amount, reason] of [[100.01, undefined], [-100.01, undefined], [0, undefined], ['5', undefined], [5, 'too short'], [5, '         x']] as const) {
      const r = await adjust(amount, 'key-bound-0001', reason);
      assert.deepEqual([r.status, r.body.error], [400, 'ai_adjustment_out_of_bounds'], `${amount} ${reason}`);
      assert.match(r.body.message, reason ? /reason of 10 to 500/ : /at most \$100/, `${amount} ${reason}: the bound named`);
    }
    assert.equal((await adjust(5, 'bad key!')).status, 400);
    assert.equal((await call(f, 'POST', '/api/ai-budget/members/999/adjustments', 1, { amount_usd: 5, reason: 'support credit after outage', idempotency_key: 'key-nobody-01' })).status, 404);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_credit_ledger').get().n, 0);
    // Taking money that is not there never goes below zero.
    const below = await adjust(-1, 'key-below-0001');
    assert.deepEqual([below.status, below.body.error], [400, 'ai_adjustment_out_of_bounds']);
    const first = await adjust(100, 'key-add-000001');
    assert.equal(first.status, 200, first.text); assert.deepEqual([first.body.delta_microusd, first.body.balance_microusd, first.body.already_recorded], [100000000, 100000000, false]);
    const replay = await adjust(100, 'key-add-000001');
    assert.deepEqual([replay.status, replay.body.already_recorded, replay.body.uid], [200, true, first.body.uid]);
    assert.equal((await adjust(99, 'key-add-000001')).status, 409, 'the same key for a different amount');
    assert.equal((await adjust(100, 'key-add-000002')).status, 200);
    assert.equal((await adjust(50, 'key-add-000003')).status, 200);
    const over = await adjust(0.01, 'key-add-000004');
    assert.deepEqual([over.status, over.body.error], [400, 'ai_adjustment_out_of_bounds'], 'at most $250 added in 30 days');
    const take = await adjust(-100, 'key-take-00001');
    assert.equal(take.status, 200); assert.equal(take.body.balance_microusd, 150000000);
    assert.equal((await adjust(0.01, 'key-add-000005')).status, 400, 'a take-back does not reopen the $250');
    // An add older than 30 days no longer counts.
    f.db.exec("DROP TRIGGER ai_credit_ledger_no_update; UPDATE ai_credit_ledger SET created_at=datetime('now','-31 days') WHERE source_ref='adj:key-add-000001'; "
      + "CREATE TRIGGER ai_credit_ledger_no_update BEFORE UPDATE ON ai_credit_ledger BEGIN SELECT RAISE(ABORT, 'ai_credit_ledger is append-only (D755).'); END;");
    assert.equal((await adjust(100, 'key-add-000006')).status, 200);
    const rows = f.db.prepare("SELECT delta_microusd, reason, actor FROM ai_credit_ledger WHERE kind='adjustment' ORDER BY rowid").all().map((r: any) => ({ ...r }));
    assert.equal(rows.length, 5); assert.ok(rows.every((r: any) => r.reason === 'support credit after outage' && r.actor === '1'));
    const notices = f.db.prepare("SELECT title, body, payload FROM notifications_inbox WHERE type='ai_balance_adjusted' AND user_id=2").all().map((r: any) => ({ ...r }));
    assert.equal(notices.length, 5);
    assert.equal(notices[0].title, '$100.00 added to your AI top-up balance');
    assert.equal(notices[3].title, '$100.00 taken off your AI top-up balance');
    for (const n of notices) assert.ok(!JSON.stringify(n).includes('outage'), 'the notice never gives the reason');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='ai_balance_adjustment' AND viewed_user_id=2").get().n, 5);
    // The Super Admin's member read shows the reason; the member's own history never does.
    const account = await call(f, 'GET', '/api/ai-budget/members/2?limit=50', 1);
    assert.equal(account.status, 200, account.text);
    assert.ok(account.body.ledger.items.every((i: any) => i.reason === 'support credit after outage'));
    assert.deepEqual([account.body.balance_microusd, account.body.ledger_balance_microusd], [250000000, 250000000]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='ai_member_account_read' AND user_id=1").get().n, 1);
    assert.ok(!(await call(f, 'GET', '/api/ai-budget/history', 2)).text.includes('outage'));
    assert.equal((await call(f, 'GET', '/api/ai-budget/members/999', 1)).status, 404);
    await assertInvariant(f);
    assert.deepEqual(s.calls, []);
  } finally { s.restore(); f.db.close(); }
});

test('reconcile lists a hand-broken balance, an overdue purchase and an open dispute, and credits nothing', async () => {
  const f = await world(); const s = stripeStub({ products: [], prices: [] });
  try {
    assert.deepEqual((await call(f, 'GET', '/api/ai-budget/reconcile', 1)).body, { mismatched: [], overdue: [], open_disputes: [] });
    f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(3,777)').run();
    purchase(f, 'pi_late'); order(f, 'MRD-pi_late', 'paid', "datetime('now','-2 hours')");
    purchase(f, 'pi_fresh'); order(f, 'MRD-pi_fresh', 'paid', "datetime('now','-10 minutes')");
    purchase(f, 'pi_disp', { credited_at: '2026-10-01 00:00:00', dispute: 'open' });
    const r = await call(f, 'GET', '/api/ai-budget/reconcile', 1);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.mismatched, [{ member_id: 3, balance_microusd: 777, ledger_microusd: 0, difference_microusd: 777 }]);
    assert.deepEqual(r.body.overdue.map((p: any) => [p.payment_intent_id, p.state, p.instruction]), [['pi_late', 'overdue', 'Resend payment_intent.succeeded from Stripe › Developers › Events']]);
    assert.deepEqual(r.body.open_disputes.map((p: any) => p.payment_intent_id), ['pi_disp']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_credit_ledger').get().n, 0, 'HQ never credits');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_topup_purchases WHERE credited_at IS NOT NULL').get().n, 1);
    assert.deepEqual(s.calls, []);
  } finally { s.restore(); f.db.close(); }
});

test('a pack is labelled by its face value, cents only when it has them', async () => {
  const { packLabel } = await import('../src/services/aiCredits.ts');
  assert.deepEqual([packLabel(500), packLabel(2500), packLabel(50000), packLabel(1250), packLabel(999)],
    ['$5 of tokens', '$25 of tokens', '$500 of tokens', '$12.50 of tokens', '$9.99 of tokens']);
});

test('the catalog knows the token_pack kind, and no D755 read prints a markup or reads another ledger', async () => {
  const { isProductKind, validateProductMetadata } = await import('../src/services/catalog.ts');
  assert.equal(isProductKind('token_pack'), true);
  assert.deepEqual(validateProductMetadata('token_pack' as any, {}), []);
  const { readFileSync } = await import('node:fs');
  const markup = ['1', '.25'].join(''), word = ['mark', 'up'].join('');
  const perk = ['perk', 'credit', 'ledger'].join('_'), intro = ['intro', 'credit', 'ledger'].join('_');
  for (const rel of ['../src/services/aiCredits.ts', '../src/routes/ai_budget.ts', '../../frontend/src/lib/api/tokenPacks.js', '../../frontend/src/lib/api/publicPricing.js']) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8').toLowerCase();
    for (const needle of [markup, word, perk, intro]) assert.equal(text.includes(needle), false, `${rel} contains ${needle}`);
  }
});
