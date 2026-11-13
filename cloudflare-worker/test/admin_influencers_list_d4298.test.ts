/**
 * D4298 (#4298, D4289 P9) — `GET /api/admin/influencers`, the Influencers
 * table's read: each membership with its person, handle and both uids,
 * sign-ups, and commission per currency for the Super Admin only. An admin
 * reads `hq_reads` in the money columns; visits, paid and revenue read
 * `not_recorded` until a store holds them. Every person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_influencers_list_d4298.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminInfluencers from '../src/routes/admin_influencers.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4298-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADMIN = 2, JANE = 10, SAM = 11, LEE = 12, MEMBER = 20, MEMBER2 = 21, STRANGER = 30;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'u-sue', 'admin', 'Sue Super', 'sue@example.test');
  u.run(ADMIN, 'u-pat', 'admin', 'Pat Plain', 'pat@example.test');
  u.run(JANE, 'u-jane', 'investor', 'Jane Rivera', 'jane@example.test');
  u.run(SAM, 'u-sam', 'founder', 'Sam Okafor', 'sam@example.test');
  u.run(LEE, 'u-lee', 'advisor', 'Lee Marsh', 'lee@example.test');
  u.run(MEMBER, 'u-m1', 'founder', 'Max Member', 'max@example.test');
  u.run(MEMBER2, 'u-m2', 'founder', 'Mia Member', 'mia@example.test');
  u.run(STRANGER, 'u-sid', 'founder', 'Sid Stranger', 'sid@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN, STRANGER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  const m = db.prepare('INSERT INTO influencers (uid, user_id, tier, status, handle, admitted_by, admitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  m.run('inf-jane', JANE, 'verified_influencer', 'active', 'jane', SUPER, '2026-10-20 10:00:00');
  m.run('inf-sam', SAM, 'affiliate_creator', 'active', null, SUPER, '2026-10-22 10:00:00');
  m.run('inf-lee', LEE, 'affiliate_creator', 'paused', 'leem', SUPER, '2026-10-01 10:00:00');
  const ref = db.prepare("INSERT INTO referrals (referrer_id, referred_id, referral_code, status) VALUES (?, ?, 'h:jane', 'pending')");
  ref.run(JANE, MEMBER); ref.run(JANE, MEMBER2); ref.run(SAM, STRANGER);
  const c = db.prepare('INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status, reversed_amount_cents) VALUES (?, ?, ?, ?, ?, ?, ?)');
  c.run(JANE, 2500, 'USD', 'subscription_invoice', 'in_1', 'accrued', 0);
  c.run(JANE, 2000, 'USD', 'subscription_invoice', 'in_2', 'pending', 500);
  c.run(JANE, 1600, 'EUR', 'subscription_invoice', 'in_3', 'paid', 0);
  c.run(JANE, 9999, 'USD', 'subscription_invoice', 'in_4', 'reversed', 0); // an older reversal recorded by status alone
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/influencers', adminInfluencers);
app.onError((err) => {
  const msg = String((err as Error)?.message || '');
  if (msg === 'Unauthorized') return new Response(JSON.stringify({ error: msg }), { status: 401 });
  if (/required|step_up|factor|HQ only/i.test(msg)) return new Response(JSON.stringify({ error: msg }), { status: 403 });
  throw err;
});

async function get(db: DatabaseSync, who: number, path = '/api/admin/influencers') {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: who, role, jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    const text = await res.text();
    return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
  } finally { [console.warn, console.error] = saved; }
}

test('the Super Admin reads every influencer with both uids, sign-ups and commission per currency, net of reversals', async () => {
  const db = fixture();
  const r = await get(db, SUPER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.influencers.map((i: any) => i.uid), ['inf-sam', 'inf-jane', 'inf-lee'], 'active first, newest admitted first, then paused');
  const jane = r.body.influencers.find((i: any) => i.uid === 'inf-jane');
  assert.deepEqual({ user_uid: jane.user_uid, handle: jane.handle, tier: jane.tier, tier_label: jane.tier_label, status: jane.status, person: jane.person, signups: jane.signups },
    { user_uid: 'u-jane', handle: 'jane', tier: 'verified_influencer', tier_label: 'Verified Influencer', status: 'active', person: { name: 'Jane Rivera', role: 'investor' }, signups: 2 });
  assert.deepEqual(jane.commission, { by_currency: [{ currency: 'EUR', earned_cents: 1600 }, { currency: 'USD', earned_cents: 4000 }] }, 'each currency on its own line; a reversed row and the reversed part leave');
  assert.deepEqual(jane.visits, { available: false, reason: 'not_recorded', source: 'handle_visits' });
  assert.deepEqual(jane.revenue, { available: false, reason: 'not_recorded', source: 'subscription_commissions' });
  assert.deepEqual(r.body.influencers.find((i: any) => i.uid === 'inf-sam').commission, { by_currency: [] });
  assert.equal(r.body.influencers.find((i: any) => i.uid === 'inf-sam').signups, 1, 'each member counts their own referrals');
  assert.deepEqual(r.body.counts, { active: 2, paused: 1, ended: 0 });
  assert.ok(!/@example\.test/.test(r.text), 'never an email');
});

test('an admin reads "hq_reads" in every money column; the filter and the HQ gate hold', async () => {
  const db = fixture();
  const r = await get(db, ADMIN);
  assert.equal(r.status, 200, r.text);
  for (const i of r.body.influencers) {
    assert.deepEqual(i.commission, { available: false, reason: 'hq_reads' });
    assert.deepEqual(i.revenue, { available: false, reason: 'hq_reads' });
  }
  assert.equal(r.body.influencers.find((i: any) => i.uid === 'inf-jane').signups, 2, 'counts are not money');
  assert.deepEqual((await get(db, ADMIN, '/api/admin/influencers?status=paused')).body.influencers.map((i: any) => i.uid), ['inf-lee']);
  assert.equal((await get(db, ADMIN, '/api/admin/influencers?status=nope')).body.error, 'invalid_status');
  assert.equal((await get(db, STRANGER)).status, 403, 'a member is refused');
});
