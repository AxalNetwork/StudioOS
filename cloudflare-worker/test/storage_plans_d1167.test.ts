/** D1167: owner's table, real entitlement SQL, and the mounted public projection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { STORAGE_PLANS, STORAGE_GB, storagePlan, storageFields, storagePlanKey } from '../src/services/storagePlans.ts';
import { PLAN_CATALOGUE } from '../src/services/planCatalogue.ts';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import publicRoutes from '../src/routes/public.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const admission = readFileSync(new URL('../sql/migrations/473_fund_management_fees.sql', import.meta.url), 'utf8');
const account = readFileSync(new URL('../sql/migrations/134_account_subscriptions.sql', import.meta.url), 'utf8');
const member = (fields: Record<string, unknown> = {}) => ({ id: 7, role: 'exploring', email: 'member@example.test', ...fields } as any);
function world() {
  const f = makeD1(account + ['vc_funds', 'limited_partners'].map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
    + stripForeignKeys(tableFromBaseline(admission, 'fund_lp_admissions')));
  f.db.exec("INSERT INTO vc_funds(id,name) VALUES(1,'Fixture fund'),(2,'Other fixture fund')");
  const env = { DB: f.DB } as any;
  const sub = (group = 'advisor', status = 'active', period = '2999-01-01', userId = 7, plan = `${group}_pro`) =>
    f.db.prepare('INSERT OR REPLACE INTO account_subscriptions(user_id,plan_group,plan,status,period_end) VALUES(?,?,?,?,?)')
      .run(userId, group, plan, status, period);
  const lp = (userId: number | null = 7, email = 'member@example.test', admitted = true, date = '2000-01-01', fundId = 1) => {
    const id = Number(f.db.prepare('INSERT INTO limited_partners(user_id,fund_id,email) VALUES(?,?,?)').run(userId, 1, email).lastInsertRowid);
    if (admitted) f.db.prepare('INSERT INTO fund_lp_admissions(uid,fund_id,limited_partner_id,admitted_on,source) VALUES(?,?,?,?,?)')
      .run(`admission-${id}`, fundId, id, date, 'Synthetic recorded admission');
  };
  return { ...f, env, sub, lp };
}

// This is the independent oracle quoted from the owner's #2449 table, not a
// fixture/public allowance source. A decimal-unit mutation must fail it too.
const OWNER_GB = {
  'founder:free': 1, 'founder:growth': 10, 'founder:studio': 100,
  'investor:free': 1, 'investor:plus': 50, 'investor:professional': 250, 'investor:institutional': null,
  'advisor:free': 1, 'advisor:pro': 10, 'partner:free': 1, 'partner:pro': 10, other: 1, lp_access: 10, admin: null,
};
test('every key is the owner’s binary-GB figure; negotiated/staff are null with reasons, never zero', () => {
  assert.equal(STORAGE_GB, 1024 ** 3);
  assert.ok(Object.isFrozen(STORAGE_PLANS));
  assert.deepEqual(Object.keys(STORAGE_PLANS), Object.keys(OWNER_GB));
  for (const [key, gb] of Object.entries(OWNER_GB)) {
    const plan = storagePlan(key)!;
    assert.equal(plan.allowance_bytes, gb === null ? null : gb * 1024 ** 3, key);
    assert.equal(plan.allowance_reason === null, gb !== null, key);
    assert.ok(Object.isFrozen(plan), key);
  }
  assert.equal(storagePlan('investor:institutional')!.allowance_reason, 'Negotiated');
  assert.equal(storagePlan('missing'), null);
  assert.equal(storagePlan('__proto__'), null);
});

test('the Best suited for words are the owner’s exact lines, shared by plans at each price', () => {
  const rows = [
    [['founder:free','investor:free','advisor:free','partner:free','other'], 'Exploring Axal and basic documents'],
    [['founder:growth','advisor:pro','partner:pro'], 'Individual founders and investors getting started'],
    [['investor:plus'], 'Active founders and investors managing multiple projects'],
    [['founder:studio'], 'Power users with substantial research and documentation'],
    [['investor:professional'], 'Professional investors and intensive company-building workflows'],
    [['lp_access'], 'Verified Axal VC fund investors; fund documents excluded'],
  ] as const;
  for (const [keys, words] of rows) for (const key of keys) assert.equal(storagePlan(key)!.best_suited, words, key);
  for (const key of ['admin', 'investor:institutional']) {
    assert.equal(storagePlan(key)!.best_suited, null);
    assert.ok(storagePlan(key)!.best_suited_reason);
  }
});

for (const [fields, expected] of [
  [{ role: 'founder' }, 'founder:free'],
  [{ role: 'founder', subscription_tier: 'growth', subscription_status: 'active' }, 'founder:growth'],
  [{ role: 'founder', subscription_tier: 'studio', subscription_status: 'active' }, 'founder:studio'],
  [{ role: 'founder', subscription_tier: 'studio', subscription_status: 'cancelled' }, 'founder:free'],
  [{ role: 'investor' }, 'investor:free'],
  [{ role: 'investor', investor_tier: 'professional', investor_subscription_status: 'active' }, 'investor:professional'],
  [{ role: 'investor', investor_tier: 'institutional', investor_subscription_status: 'active' }, 'investor:institutional'],
  [{ role: 'investor', investor_tier: 'professional', investor_subscription_status: 'unpaid' }, 'investor:free'],
  [{ role: 'investor', investor_tier: 'plus', investor_subscription_status: 'active' }, 'investor:free'],
  [{ role: 'advisor' }, 'advisor:free'], [{ role: 'partner' }, 'partner:free'], [{ role: 'exploring' }, 'other'],
] as const) test(`effective licence → ${expected}: ${JSON.stringify(fields)}`, async () => {
  const f = world();
  try { assert.equal(await storagePlanKey(f.env, member(fields)), expected); } finally { f.db.close(); }
});

test('persona Pro is a recorded matching subscription, not the role or another member’s row', async () => {
  const f = world();
  try {
    f.sub('advisor', 'active', '2999-01-01', 8);
    assert.equal(await storagePlanKey(f.env, member({ role: 'advisor' })), 'advisor:free');
    for (const group of ['advisor', 'partner']) {
      f.sub(group);
      assert.equal(await storagePlanKey(f.env, member({ role: group })), `${group}:pro`);
      f.sub(group, 'active', '2999-01-01', 7, 'wrong_plan');
      assert.equal(await storagePlanKey(f.env, member({ role: group })), `${group}:free`);
    }
  } finally { f.db.close(); }
});

test('persona renewal grace matches access, cancellation and expired grace return Basic', async () => {
  const f = world();
  try {
    for (const [status, end, key] of [
      ['active','2000-01-01','advisor:pro'], ['trialing','2999-01-01','advisor:pro'],
      ['past_due', new Date().toISOString(), 'advisor:pro'], ['past_due','2000-01-01','advisor:free'],
      ['past_due','unreadable','advisor:free'], ['cancelled','2999-01-01','advisor:free'],
      ['unpaid','2999-01-01','advisor:free'], ['incomplete','2999-01-01','advisor:free'],
    ]) {
      f.sub('advisor', status, end);
      assert.equal(await storagePlanKey(f.env, member({ role: 'advisor' })), key, `${status}/${end}`);
    }
  } finally { f.db.close(); }
});

test('LP admission raises Free, never adds to Pro; negotiated stays unknown and a tie keeps the profile', async () => {
  const f = world();
  try {
    f.lp();
    assert.equal(await storagePlanKey(f.env, member()), 'lp_access');
    const pro = member({ role: 'investor', investor_tier: 'professional', investor_subscription_status: 'active' });
    const key = await storagePlanKey(f.env, pro);
    assert.equal(key, 'investor:professional');
    assert.equal(storagePlan(key)!.allowance_bytes, OWNER_GB['investor:professional']! * 1024 ** 3);
    assert.equal(await storagePlanKey(f.env, member({ ...pro, investor_tier: 'institutional' })), 'investor:institutional');
    assert.equal(await storagePlanKey(f.env, member({ role: 'founder', subscription_tier: 'growth', subscription_status: 'active' })), 'founder:growth');
    f.sub('advisor');
    assert.equal(await storagePlanKey(f.env, member({ role: 'founder', subscription_tier: 'studio', subscription_status: 'active' })), 'founder:studio');
  } finally { f.db.close(); }
});

test('LP eligibility uses only a dated admission in the same fund and the caller’s membership', async () => {
  for (const [linked, email, admitted, date, fund, expected] of [
    [7,'different@example.test',true,'2000-01-01',1,'lp_access'],
    [8,'member@example.test',true,'2000-01-01',1,'other'],
    [null,'MEMBER@example.test',true,'2000-01-01',1,'lp_access'],
    [null,'other@example.test',true,'2000-01-01',1,'other'],
    [7,'member@example.test',false,'2000-01-01',1,'other'],
    [7,'member@example.test',true,'2999-01-01',1,'other'],
    [7,'member@example.test',true,'2000-01-01',2,'other'],
  ] as const) {
    const f = world();
    try { f.lp(linked, email, admitted, date, fund); assert.equal(await storagePlanKey(f.env, member()), expected); }
    finally { f.db.close(); }
  }
  const f = world();
  try { f.lp(null, ''); assert.equal(await storagePlanKey(f.env, member({ email: '' })), 'other'); }
  finally { f.db.close(); }
  const legacy = world();
  try { legacy.lp(null); assert.equal(await storagePlanKey(legacy.env, member({ email: ' MEMBER@example.test ' })), 'lp_access'); }
  finally { legacy.db.close(); }
});

test('staff (including HQ) have null allowance without reading anyone’s subscriptions or funds', async () => {
  const env = { DB: { prepare() { throw new Error('must not read'); } } } as any;
  for (const is_super_admin of [0, 1]) {
    const key = await storagePlanKey(env, member({ role: 'admin', is_super_admin }));
    assert.equal(key, 'admin'); assert.equal(storagePlan(key)!.allowance_bytes, null);
  }
  const f = world();
  try {
    for (const id of [null, 0, -1, 1.5, '7']) await assert.rejects(storagePlanKey(f.env, member({ id })), /^Error: Storage plan unreadable$/);
    await assert.rejects(storagePlanKey(f.env, null as any), /^Error: Storage plan unreadable$/);
  } finally { f.db.close(); }
});

test('unreadable entitlement tables refuse with fixed words, never Free or raw database detail', async () => {
  for (const drop of ['DROP TABLE account_subscriptions', 'DROP TABLE fund_lp_admissions', 'DROP TABLE limited_partners']) {
    const f = world();
    try { f.db.exec(drop); await assert.rejects(storagePlanKey(f.env, member()), /^Error: Storage plan unreadable$/); }
    finally { f.db.close(); }
  }
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ success: false, results: [] }) }) }) } } as any;
  await assert.rejects(storagePlanKey(env, member()), /^Error: Storage plan unreadable$/);
  for (const table of ['account_subscriptions', 'fund_lp_admissions']) {
    const f = world();
    try {
      const prepare = f.DB.prepare.bind(f.DB);
      f.DB.prepare = (sql: string) => sql.includes(table)
        ? { bind: () => ({ all: async () => ({ success: false, results: [] }) }) } : prepare(sql);
      await assert.rejects(storagePlanKey(f.env, member()), /^Error: Storage plan unreadable$/);
    } finally { f.db.close(); }
  }
});

async function publicWorld() {
  const f = world(); await ensureCatalogSchema(f.env);
  const products = [
    ['growth', { tier: 'growth' }], ['studio', { tier: 'studio' }],
    ['professional', { investor_tier: 'professional' }], ['institutional', { investor_tier: 'institutional' }],
    ['advisor', { plan_group: 'advisor' }], ['partner', { plan_group: 'partner' }], ['mi', { plan: 'mi_pro' }],
    ['plus-not-sold', { investor_tier: 'plus' }],
  ] as const;
  for (const [id, meta] of products) f.db.prepare('INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES(?,?,?,?,?,?)')
    .run(id, id, 'subscription', 1, JSON.stringify(meta), JSON.stringify([{ id: `price_${id}`, active: true, unit_amount: 2000, currency: 'usd', interval: 'month', interval_count: 1 }]));
  const app = new Hono(); app.route('/api/public', publicRoutes);
  return { ...f, app, read: () => app.request('/api/public/plans-and-packs', {}, f.env) };
}

test('mounted public read, existing catalogue and resolver accessor agree; no price determines storage', async () => {
  const f = await publicWorld(); const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('No external calls'); }) as any;
  try {
    const before = f.db.prepare('SELECT total_changes() AS n').get()!.n;
    const response = await f.read(); const body: any = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300, s-maxage=300');
    for (const row of body.plans) {
      const key = row.catalogue?.key;
      assert.deepEqual(Object.fromEntries(Object.keys(storageFields(key)).map((k) => [k, row[k]])), storageFields(key));
      if (key) {
        assert.equal(row.storage_plan_key, key, key);
        assert.equal(row.storage_bytes, row.catalogue.storage.bytes, key);
        assert.equal(row.storage_reason, row.catalogue.storage.reason, key);
        assert.equal(row.best_suited, row.catalogue.best_suited_for, key);
        assert.equal(row.best_suited_reason, row.catalogue.best_suited_for_reason, key);
      }
    }
    assert.deepEqual(body.catalogue.map((x: any) => x.key), Object.keys(STORAGE_PLANS));
    for (const entry of PLAN_CATALOGUE) assert.deepEqual(entry.storage, { bytes: storagePlan(entry.key)!.allowance_bytes, reason: storagePlan(entry.key)!.allowance_reason });
    for (const key of ['advisor:free','partner:free','lp_access']) {
      const row = body.plans.find((p: any) => p.licence_key === key);
      assert.ok(row, `${key} has a public row`);
      assert.equal(row.free, true, key); assert.equal(row.product_id, null); assert.deepEqual(row.prices, []);
    }
    const plus = body.plans.filter((p: any) => p.licence_key === 'investor:plus');
    assert.equal(plus.length, 1); assert.equal(plus[0].catalogue.sellable, false);
    assert.match(plus[0].catalogue.sellable_reason, /not sold yet/); assert.deepEqual(plus[0].prices, []); assert.equal(plus[0].free, false);
    assert.equal(body.plans.some((p: any) => p.product_id === 'plus-not-sold'), false);
    const mi = body.plans.find((p: any) => p.product_id === 'mi');
    assert.equal(mi.storage_bytes, null); assert.equal(mi.storage_plan_key, null); assert.match(mi.storage_reason, /profile plan/);
    assert.equal(body.plans.find((p: any) => p.product_id === 'studio').storage_bytes, storagePlan('founder:studio')!.allowance_bytes);
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /"(?:name|user_id|email|recorded_by)":/);
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, before, 'a public read writes nothing');
    assert.equal(await storagePlanKey(f.env, member()), 'other');
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, before, 'a plan resolution writes nothing');
  } finally { globalThis.fetch = fetchBefore; f.db.close(); }
});

test('an empty mirror still publishes free/LP/unsold-Plus allowances; a failed mirror is Unreadable', async () => {
  const f = await publicWorld();
  try {
    f.db.exec('DELETE FROM stripe_products');
    const r = await f.read(); const body: any = await r.json();
    assert.equal(r.status, 200); assert.equal(body.plans.length, 7);
    assert.equal(body.plans.find((p: any) => p.licence_key === 'lp_access').storage_bytes, storagePlan('lp_access')!.allowance_bytes);
    // Malformed store, not an absent mirror: it must not appear empty/free.
    f.db.exec('ALTER TABLE stripe_products RENAME COLUMN metadata_json TO unavailable_metadata');
    const failed = await f.read(); assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /unavailable_metadata|no such column/);
  } finally { f.db.close(); }
});
