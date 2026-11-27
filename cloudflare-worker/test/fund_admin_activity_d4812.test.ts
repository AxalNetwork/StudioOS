/**
 * D4812 (#4812) — `GET /api/fund-admin/activity`, the Overview's Recent
 * activity, read from the `fund_admin.<act>` rows of `admin_audit_log`.
 *
 *   · an Admin and the Super Admin read it; a founder, a partner, an investor,
 *     a support session and a branch Worker do not;
 *   · reads and previews are not activity;
 *   · `?fund=` keeps one fund; `?before=` pages; a bad parameter is a 400;
 *   · a reason, a route or an email in the details never reaches the answer;
 *     the actor and the LP are named, never by email;
 *   · a store that cannot be read is a 503, never an empty list.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_activity_d4812.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import fundAdmin from '../src/routes/fund_admin.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ADMIN, SUPER, FOUNDER, PARTNER, INVESTOR, JTI, envFor, freshDb, tokenFor } from './_mercury_fixture.ts';

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.onError((err: any, c) => c.json({ detail: err?.message }, AUTH_ERROR_STATUSES[err?.message ?? ''] ?? 500));

const SECRET_REASON = 'fixture reason that must not leak';

function seeded() {
  const db = freshDb();
  db.exec(`
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Spin-Out Fund I', NULL), (2, 'Scout Fund', NULL);
INSERT INTO limited_partners (id, fund_id, name, email, commitment_amount, invested_amount, status) VALUES
  (10, 1, 'K. Osei', 'osei@example.invalid', 250000, 0, 'active');
INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date) VALUES (100, 10, 250, 25000, 'pending', '2026-11-01');
INSERT INTO admin_audit_log (id, admin_user_id, action, filters_json, exported_at) VALUES
  (1, ${SUPER}, 'fund_admin.fund.create', '{"act":"fund.create","fund_id":2}', '2026-11-05 09:30:00'),
  (2, ${ADMIN}, 'fund_admin.capital_call.preview', '{"act":"capital_call.preview","fund_id":1,"amount_cents":45000000}', '2026-11-06 10:00:00'),
  (3, ${SUPER}, 'fund_admin.capital_call.issue', '{"act":"capital_call.issue","fund_id":1,"call_number":3,"amount_cents":120000000,"lines":28}', '2026-11-06 11:00:00'),
  (4, ${ADMIN}, 'fund_admin.fund_booklet.read', '{"act":"fund_booklet.read","booklet_uid":"b-1"}', '2026-11-06 12:00:00'),
  (5, ${ADMIN}, 'fund_admin.capital_call.receipt', '{"act":"capital_call.receipt","fund_id":1,"line_id":100,"amount_cents":1000000}', '2026-11-07 14:12:00'),
  (6, ${SUPER}, 'fund_admin.fund.economics', '{"act":"fund.economics","fund_id":1,"reason":"${SECRET_REASON}","route":"PUT /api/funds/1"}', '2026-11-07 15:00:00'),
  (7, ${ADMIN}, 'mercury_accounts_read', '{"surface":"fund_admin.overview"}', '2026-11-07 15:01:00');
`);
  return db;
}

async function get(db: any, as: number, path = '', opts: { jti?: string; impersonated?: boolean; env?: Record<string, unknown> } = {}) {
  const res: Response = await (app.request(`/api/fund-admin/activity${path}`, {
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}` },
  }, envFor(db, opts.env)) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

test('roles: only an HQ admin in their own session reads the activity', async () => {
  const db = seeded();
  for (const user of [FOUNDER, PARTNER, INVESTOR]) assert.equal((await get(db, user)).status, 403, `user ${user}`);
  const support = await get(db, SUPER, '', { jti: JTI.superFresh, impersonated: true });
  assert.deepEqual([support.status, support.body?.code], [403, 'support_session_refused']);
  assert.equal((await get(db, ADMIN, '', { jti: JTI.adminTotp, env: { BRANCH_CODE: 'fr' } })).status, 403, 'a branch');
  for (const [user, jti] of [[ADMIN, JTI.adminTotp], [SUPER, JTI.superFresh]] as const) {
    assert.equal((await get(db, user, '', { jti })).status, 200, `user ${user}`);
  }
});

test('newest first; reads, previews and other audit rows are not activity', async () => {
  const r = await get(seeded(), ADMIN, '', { jti: JTI.adminTotp });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items.map((i: any) => i.id), [6, 5, 3, 1]);
  assert.equal(r.body.next_before, null);
});

test('each row names its fund, LP, amount, call and actor, by name only', async () => {
  const r = await get(seeded(), ADMIN, '', { jti: JTI.adminTotp });
  const receipt = r.body.items.find((i: any) => i.id === 5);
  assert.deepEqual(
    { act: receipt.act, label: receipt.label, fund: receipt.fund_name, lp: receipt.lp_name, cents: receipt.amount_cents, at: receipt.at },
    { act: 'capital_call.receipt', label: 'Record a receipt', fund: 'Spin-Out Fund I', lp: 'K. Osei', cents: 1000000, at: '2026-11-07 14:12:00' },
  );
  assert.equal(typeof receipt.actor_name, 'string');
  const call = r.body.items.find((i: any) => i.id === 3);
  assert.deepEqual([call.call_number, call.amount_cents, call.lp_name], [3, 120000000, null]);
  const created = r.body.items.find((i: any) => i.id === 1);
  assert.deepEqual([created.fund_name, created.amount_cents], ['Scout Fund', null], 'no amount is null, never 0');
});

test('the details never leak: no reason, no route, no email', async () => {
  const r = await get(seeded(), ADMIN, '', { jti: JTI.adminTotp });
  assert.ok(!r.text.includes(SECRET_REASON), 'reason leaked');
  assert.ok(!r.text.includes('PUT /api/funds'), 'route leaked');
  assert.ok(!r.text.includes('@'), 'an email leaked');
  assert.ok(!r.text.includes('filters_json'), 'raw details leaked');
});

test('?fund= keeps one fund; ?before= and ?limit= page back', async () => {
  const db = seeded();
  const scout = await get(db, ADMIN, '?fund=2', { jti: JTI.adminTotp });
  assert.deepEqual(scout.body.items.map((i: any) => i.id), [1]);
  const first = await get(db, ADMIN, '?limit=2', { jti: JTI.adminTotp });
  assert.deepEqual([first.body.items.map((i: any) => i.id), first.body.next_before], [[6, 5], 5]);
  const next = await get(db, ADMIN, '?limit=2&before=5', { jti: JTI.adminTotp });
  assert.deepEqual([next.body.items.map((i: any) => i.id), next.body.next_before], [[3, 1], null]);
});

test('a parameter that is not a positive id is refused', async () => {
  const db = seeded();
  for (const q of ['?fund=1;DROP', '?fund=0', '?before=-1', '?limit=0', '?limit=101', '?limit=x']) {
    const r = await get(db, ADMIN, q, { jti: JTI.adminTotp });
    assert.deepEqual([r.status, r.body?.code], [400, 'invalid_activity_query'], q);
  }
});

test('a store that cannot be read is a 503, never an empty list', async () => {
  const db = seeded();
  db.exec('DROP TABLE admin_audit_log');
  const r = await get(db, ADMIN, '', { jti: JTI.adminTotp });
  assert.deepEqual([r.status, r.body?.code], [503, 'fund_activity_unreadable']);
  assert.equal(r.body.items, undefined);
});
