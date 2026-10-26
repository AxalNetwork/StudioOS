/** D1271: the promo mirror and its writes belong to HQ's Super Admin. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminPromos from '../src/routes/admin_promos.ts';
import { recoveryCoolOff } from '../src/middleware/recoveryCoolOff.ts';
import { AUTH_ERROR_STATUSES, stepUpRefusalBody } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901, PLAIN = 902;
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const methods = ['GET', 'POST', 'PATCH', 'DELETE'];
const writes = methods.slice(1);

function fixture(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins', 'user_sessions', 'mi_pro_subscriptions',
    'promo_codes', 'admin_audit_log', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  }
  db.exec(read('../sql/migrations/277_user_recovery_state.sql'));
  db.exec(read('../sql/migrations/264_admin_notices.sql'));
  db.exec(read('../sql/migrations/282_security_events.sql'));
  const user = db.prepare('INSERT INTO users (id,role,name,email) VALUES (?, ?, ?, ?)');
  user.run(HOLDER, 'admin', 'Test Holder', 'holder@example.test');
  user.run(PLAIN, 'admin', 'Test Admin', 'admin@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const session = db.prepare("INSERT INTO user_sessions (user_id,jti,factor,created_at) VALUES (?, ?, ?, datetime('now', ?))");
  session.run(HOLDER, 'fresh', 'totp', '+0 seconds');
  session.run(PLAIN, 'plain', 'totp', '+0 seconds');
  session.run(HOLDER, 'stale', 'totp', '-2 days');
  session.run(HOLDER, 'google', 'google', '+0 seconds');
  db.prepare("INSERT INTO promo_codes (id,code,code_normalized,coupon_id,active) VALUES ('promo_seed','SEED','SEED','coupon_seed',1)").run();
  const d1 = d1Over(db);
  let promoAccesses = 0;
  const env = { DB: { ...d1, prepare(sql: string) {
    if (/\bpromo_codes\b/.test(sql)) promoAccesses++;
    return d1.prepare(sql);
  } }, JWT_SECRET: SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', ...extra } as any;
  const app = new Hono<any>();
  // Use the production prefix list, so removing the promo entry also fails
  // the cool-off test, rather than leaving a separately wired fixture green.
  const prefixBody = codeOnly(read('../src/index.ts')).match(/const COOL_OFF_PREFIXES = \[([\s\S]*?)\];/)?.[1] ?? '';
  for (const match of prefixBody.matchAll(/'([^']+)'/g)) {
    app.use(match[1], recoveryCoolOff);
    app.use(`${match[1]}/*`, recoveryCoolOff);
  }
  app.route('/api/admin/promos', adminPromos);
  app.onError((err, c) => {
    const status = AUTH_ERROR_STATUSES[err.message];
    if (!status) throw err;
    return c.json(err.message === 'step_up_required' ? stepUpRefusalBody(err) : { detail: err.message }, status);
  });
  async function call(method: string, id = HOLDER, jti?: string) {
    const token = await new SignJWT({ user_id: id, ...(jti ? { jti } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const path = '/api/admin/promos' + (['PATCH', 'DELETE'].includes(method) ? '/promo_seed' : '');
    const response = await app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ type: 'percent', code: 'TEST10', percent_off: 10 }) } : {}),
      ...(method === 'PATCH' ? { body: JSON.stringify({ active: false }) } : {}),
    }, env);
    return { status: response.status, body: await response.json() };
  }
  const snapshot = () => ({
    promos: db.prepare('SELECT id,active,created_by FROM promo_codes ORDER BY id').all().map(r => [r.id, r.active, r.created_by]),
    audit: db.prepare('SELECT admin_user_id,action,report_type FROM admin_audit_log ORDER BY id').all().map(r => [r.admin_user_id, r.action, r.report_type]),
    promoAccesses,
  });
  return { db, call, snapshot };
}

async function withStripe(run: (calls: any[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== 'https://api.stripe.com') throw new Error('Unexpected provider in promo test');
    const form = new URLSearchParams(init.body);
    calls.push([init.method, url.pathname, Object.fromEntries(form)]);
    if (url.pathname === '/v1/coupons' && init.method === 'POST') return Response.json({ id: 'coupon_created' });
    if (url.pathname === '/v1/promotion_codes') return Response.json({ id: 'promo_created', code: 'TEST10', active: true });
    return Response.json({ id: 'promo_seed', active: false });
  }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = original; }
}

for (const [name, id, jti, extra, detail] of [
  ['plain HQ Admin', PLAIN, 'plain', {}, 'Super admin required'],
  ['branch with an elevation row', HOLDER, 'fresh', { BRANCH_CODE: 'test-studio' }, 'HQ only'],
] as const) {
  test(`D1271: all four routes refuse a ${name} before promo/Stripe access`, async () => withStripe(async calls => {
    const f = fixture(extra);
    try {
      const results = [];
      for (const method of methods) results.push(await f.call(method, id, jti));
      assert.deepEqual(results, methods.map(() => ({ status: 403, body: { detail } })));
      assert.deepEqual({ ...f.snapshot(), calls }, {
        promos: [['promo_seed', 1, null]], audit: [], promoAccesses: 0, calls: [],
      });
    } finally { f.db.close(); }
  }));
}

test('D1271: the HQ holder reads without a TOTP session or recent step-up', async () => withStripe(async calls => {
  const f = fixture();
  try {
    const result = await f.call('GET');
    const body = result.body as any;
    assert.deepEqual({ status: result.status, promos: body.promos?.map((p: any) => [p.id, p.active]), calls }, {
      status: 200, promos: [['promo_seed', true]], calls: [],
    });
  } finally { f.db.close(); }
}));

test('D1271: a fresh TOTP holder creates, disables and deletes with the existing billing audits', async () => withStripe(async calls => {
  const f = fixture();
  try {
    const results = [];
    for (const method of writes) results.push(await f.call(method, HOLDER, 'fresh'));
    assert.deepEqual(results, [
      { status: 200, body: { ok: true, promo_id: 'promo_created', code: 'TEST10' } },
      { status: 200, body: { ok: true, promo_id: 'promo_seed', active: false } },
      { status: 200, body: { ok: true, promo_id: 'promo_seed' } },
    ]);
    assert.deepEqual(f.snapshot().promos, [['promo_created', 1, HOLDER], ['promo_seed', 0, null]]);
    assert.deepEqual(f.snapshot().audit, ['promo_create', 'promo_update', 'promo_delete'].map(action => [HOLDER, action, 'billing']));
    assert.deepEqual(calls, [
      ['POST', '/v1/coupons', { percent_off: '10', duration: 'once', 'metadata[product_ids]': '[]', 'metadata[created_by]': String(HOLDER), name: 'TEST10' }],
      // D1273: the scope and limits ride on the promotion code; a code is monthly only by default.
      ['POST', '/v1/promotion_codes', {
        coupon: 'coupon_created', code: 'TEST10', 'metadata[product_ids]': '[]',
        'metadata[plan_keys]': '[]', 'metadata[intervals]': '["month"]', 'metadata[once_per_member]': 'false',
      }],
      ['POST', '/v1/promotion_codes/promo_seed', { active: 'false' }],
      ['POST', '/v1/promotion_codes/promo_seed', { active: 'false' }],
      ['DELETE', '/v1/coupons/coupon_seed', {}],
    ]);
  } finally { f.db.close(); }
}));

for (const [jti, body] of [
  ['stale', { detail: 'Recent re-authentication required', code: 'step_up_required', ttl_minutes: 15 }],
  ['google', { detail: 'TOTP required' }],
] as const) {
  test(`D1271: all three holder writes retain the ${jti} session refusal`, async () => withStripe(async calls => {
    const f = fixture();
    try {
      const results = [];
      for (const method of writes) results.push(await f.call(method, HOLDER, jti));
      assert.deepEqual(results, writes.map(() => ({ status: 403, body })));
      assert.deepEqual({ ...f.snapshot(), calls }, {
        promos: [['promo_seed', 1, null]], audit: [], promoAccesses: 0, calls: [],
      });
    } finally { f.db.close(); }
  }));
}

test('D1271: the production cool-off prefix still pauses all four routes for the holder', async () => withStripe(async calls => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO user_recovery_state (user_id,cooling_off_until) VALUES (?, ?)")
      .run(HOLDER, new Date(Date.now() + 3600000).toISOString());
    const results = [];
    for (const method of methods) {
      const result = await f.call(method, HOLDER, 'fresh');
      results.push([result.status, (result.body as any).error]);
    }
    assert.deepEqual(results, methods.map(() => [423, 'recovery_cool_off_active']));
    assert.deepEqual({ ...f.snapshot(), calls }, {
      promos: [['promo_seed', 1, null]], audit: [], promoAccesses: 0, calls: [],
    });
  } finally { f.db.close(); }
}));
