/**
 * D222 — a promo product list that cannot be read does not mean every product.
 *
 * '[]' is the migration-099 allow-all. Anything that is not a JSON array of
 * strings is unreadable: checkout refuses it before a Stripe call, the admin
 * list says so, and Platform's product_count is null. Creating a code with a
 * malformed list is a 400, not a silent allow-all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  readProductIds, rowToView, listPromos, validatePromoForProduct,
} from '../src/services/promos.ts';
import adminPromos from '../src/routes/admin_promos.ts';
import platform from '../src/routes/admin_platform.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 801;
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');

function db() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'user_sessions', 'promo_codes']) {
    d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  d.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)')
    .run(ADMIN, 'admin', 'The Holder', 'holder@example.test');
  d.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  d.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))")
    .run(ADMIN, 'totp-holder');
  return d;
}

function envOf(d: DatabaseSync, extra: Record<string, unknown> = {}) {
  return { DB: d1Over(d), JWT_SECRET, ENVIRONMENT: 'development', ...extra } as any;
}

function insertPromo(d: DatabaseSync, code: string, productIdsJson: string) {
  d.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, product_ids_json, active, max_redemptions)
     VALUES (?, ?, ?, 'coupon', ?, 1, NULL)`,
  ).run(`id-${code}`, code, code, productIdsJson);
}

test('a list that is not a JSON array of strings does not parse', () => {
  for (const raw of ['not json', '{}', '[123]', '["prod_x", 7]', 'null', '"prod_x"']) {
    assert.deepEqual(readProductIds(raw), { ok: false }, raw);
  }
  assert.deepEqual(readProductIds('[]'), { ok: true, ids: [] });
  assert.deepEqual(readProductIds('["prod_x"]'), { ok: true, ids: ['prod_x'] });
});

test('an unreadable product list is refused before any redemption count', async () => {
  const d = db();
  let fetches = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { fetches += 1; throw new Error('stripe was called'); }) as typeof fetch;
  try {
    for (const raw of ['not json', '{}', '[123]', '["prod_x", 7]']) {
      const code = `BAD${raw.length}${raw.charCodeAt(0)}`;
      insertPromo(d, code, raw);
      const r = await validatePromoForProduct(envOf(d), code, 'prod_x', 1000, 'usd');
      assert.equal(r.ok, false, raw);
      assert.equal(r.reason, 'product_list_unreadable', raw);
    }
    assert.equal(fetches, 0, 'an unreadable list still asked Stripe');
  } finally {
    globalThis.fetch = orig;
  }
});

test('[] applies to any product, and a named list only to those products', async () => {
  const d = db();
  insertPromo(d, 'ALL', '[]');
  insertPromo(d, 'ONE', '["prod_x"]');
  const all = await validatePromoForProduct(envOf(d), 'ALL', 'prod_y', 1000);
  assert.equal(all.ok, true);
  assert.equal(all.reason, undefined);
  const wrong = await validatePromoForProduct(envOf(d), 'ONE', 'prod_y', 1000);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'product_not_eligible');
  const right = await validatePromoForProduct(envOf(d), 'ONE', 'prod_x', 1000);
  assert.equal(right.ok, true);
});

test('the admin list carries an unreadable list as empty ids plus readable false', async () => {
  const d = db();
  insertPromo(d, 'BAD', '[123]');
  insertPromo(d, 'ALL', '[]');
  const rows = await listPromos(envOf(d));
  const bad = rows.find((r) => r.code === 'BAD');
  const all = rows.find((r) => r.code === 'ALL');
  assert.ok(bad && all);
  assert.equal(bad.product_ids_readable, false);
  assert.deepEqual(bad.product_ids, []);
  assert.equal(all.product_ids_readable, true);
  assert.deepEqual(all.product_ids, []);
  const view = rowToView({
    id: 'x', code: 'X', code_normalized: 'X', coupon_id: 'c',
    percent_off: null, amount_off: null, currency: null, duration: 'once',
    product_ids_json: '{}', max_redemptions: null, times_redeemed: 0, active: 1,
    expires_at: null, created_by: null, created_at: '', synced_at: '',
  });
  assert.equal(view.product_ids_readable, false);
  assert.deepEqual(view.product_ids, []);
});

test("Platform counts a mixed list as did-not-parse, and [] as every product", async () => {
  const d = db();
  const ins = d.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, product_ids_json)
     VALUES (?, ?, ?, 'c', ?)`,
  );
  ins.run('p1', 'ALL', 'all', '[]');
  ins.run('p2', 'NUM', 'num', '[123]');
  ins.run('p3', 'ONE', 'one', '["prod_x"]');
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await platform.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    envOf(d),
  );
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const items = Object.fromEntries(JSON.parse(text).promo_codes.items.map((i: any) => [i.code, i.product_count]));
  assert.equal(items.ALL, 0);
  assert.equal(items.NUM, null);
  assert.equal(items.ONE, 1);
});

test('creating a code with a malformed product list is a 400 and does not call Stripe', async () => {
  const d = db();
  let fetches = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { fetches += 1; throw new Error('stripe was called'); }) as typeof fetch;
  const app = new Hono<any>();
  app.route('/', adminPromos);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin', jti: 'totp-holder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  try {
    for (const product_ids of ['{}', [123], ['prod_x', 7], { id: 'prod_x' }]) {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'percent', code: 'SAVE10', percent_off: 10, product_ids }),
      }, envOf(d, { STRIPE_SECRET_KEY: 'sk_test_fixture' }));
      const body = await res.json() as any;
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(body.code, 'invalid_product_ids');
    }
    assert.equal(fetches, 0);
    const count = d.prepare('SELECT COUNT(*) AS n FROM promo_codes').get() as { n: number };
    assert.equal(count.n, 0);
  } finally {
    globalThis.fetch = orig;
  }
});
