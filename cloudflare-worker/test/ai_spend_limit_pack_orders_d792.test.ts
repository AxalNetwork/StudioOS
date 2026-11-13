// D792 part 2 (#2270) — `GET /api/ai-budget/limit` reads D805's pack-order
// count on its own: a count that cannot be read answers `pack_orders: null`
// with its reason, and the limit and allowance still read. A limit that cannot
// be read still answers 503.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/ai_spend_limit_pack_orders_d792.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';

const ME = 2;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  return a;
}

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd792-fixture-only-secret', ENVIRONMENT: 'development' } as any;
  f.db.prepare(`INSERT INTO member_ai_spend_limits(user_id,monthly_limit_microusd,notify_50,notify_80,notify_100,updated_at)
      VALUES(?,?,1,1,1,datetime('now'))`).run(ME, 50_000_000);
  return { f, env };
}

async function limit(w: any) {
  const jwt = await new SignJWT({ user_id: ME }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request('/api/ai-budget/limit', { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('the count reads: pack_orders beside the limit, with no reason', async () => {
  const w = world();
  const r = await limit(w);
  assert.equal(r.status, 200);
  assert.equal(r.body.limit_microusd, 50_000_000);
  assert.equal(r.body.pack_orders.today, 0);
  assert.equal('pack_orders_reason' in r.body, false);
});

test('a pack-order count that cannot be read leaves the limit and allowance standing', async () => {
  const w = world();
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    w.f.db.exec('DROP TABLE ai_topup_purchases');
    const r = await limit(w);
    assert.equal(r.status, 200);
    assert.equal(r.body.limit_microusd, 50_000_000, 'the limit still reads');
    assert.ok(r.body.allowance && 'monthly_microusd' in r.body.allowance, 'the allowance still reads');
    assert.equal(r.body.pack_orders, null);
    assert.equal(r.body.pack_orders_reason, 'pack_orders_unreadable');
    assert.equal(errors.length, 1, 'logged once');
  } finally { console.error = log; }
});

test('a limit that cannot be read still answers 503, with no figures', async () => {
  const w = world();
  w.f.db.exec('DROP TABLE member_ai_spend_limits');
  const log = console.error;
  console.error = () => {};
  let r;
  try { r = await limit(w); } finally { console.error = log; }
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'ai_spend_limit_unreadable');
  assert.equal('pack_orders' in r.body, false);
  assert.equal('limit_microusd' in r.body, false);
});
