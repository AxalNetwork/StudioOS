/**
 * D4295 (#4295, D4289 P6) — the influencer analytics read.
 *
 *   1. each figure from its source: sign-ups by week from `referrals`; commission
 *      by status per currency (paid only through a completed payout; a commission
 *      a failed payout gave back and a later one claimed counted once); the
 *      audience by plan family, region and month joined; another influencer's
 *      rows and rows outside the range left out;
 *   2. "Fewer than 5" for any group of 1 to 4 members, and a counted 0 as 0;
 *   3. unreadable for a read that fails, never 0, and the other figures still read;
 *   4. no referred member's name, email or id in the reply;
 *   5. HQ's read: money for the Super Admin only (`hq_reads` for an admin), and
 *      the member's read for influencers only; the range, grain and the line;
 *   6. visits from `handle_visits`, the channels ranked, and a channel narrowing
 *      every figure (P2);
 *   7. paid members from the first paid invoice, revenue per currency, bonuses
 *      and the next milestone (P3);
 *   8. retention as a cohort grid and the median days from visit to paid.
 *
 * Real SQLite with the whole schema. The `influencers` segment of
 * `referral_partners` is written with CHECKs off, standing in for P1's
 * rebuild of that CHECK (#4290). Every person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_analytics_d4295.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { mount } from '../src/routes/influencer_analytics.ts';
import { influencerAnalytics, masked, median, nextMilestone, rangeOf, weekOf } from '../src/services/influencer/analytics.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'influencer-analytics-4295-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-4295-only-not-a-real-credential'.repeat(2);
let n = 0;

const INF = 2, OTHER = 3, ADMIN = 4, SUPER = 5, MEMBER = 6;
// The range: 12 weeks, Monday 2026-08-03 to Sunday 2026-10-25.
const RANGE = '?from=2026-08-03&to=2026-10-25';
const W1 = '2026-08-03', W2 = '2026-08-10', W12 = '2026-10-19';

function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const user = db.prepare('INSERT INTO users(id, uid, role, name, email, is_active, country) VALUES (?, ?, ?, ?, ?, 1, ?)');
  user.run(INF, 'u-inf', 'investor', 'Ina Influencer', 'ina@example.invalid', 'GB');
  user.run(OTHER, 'u-other', 'investor', 'Oto Other', 'oto@example.invalid', 'US');
  user.run(ADMIN, 'u-admin', 'admin', 'Ada Admin', 'ada@example.invalid', 'US');
  user.run(SUPER, 'u-super', 'admin', 'Sam Super', 'sam@example.invalid', 'US');
  user.run(MEMBER, 'u-member', 'founder', 'Mo Member', 'mo@example.invalid', 'US');
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  db.exec('PRAGMA ignore_check_constraints = ON');
  for (const id of [INF, OTHER]) db.prepare("INSERT INTO referral_partners(user_id, segment, added_by) VALUES (?, 'influencers', ?)").run(id, SUPER);
  db.exec('PRAGMA ignore_check_constraints = OFF');
  // Seven people Ina referred: five in week 1 (four in DE, one with no country), two in week 2 (FR); one before the range.
  const ref = db.prepare("INSERT INTO referrals(referrer_id, referred_id, referral_code, status, created_at) VALUES (?, ?, 'INA', 'converted', ?)");
  const joined: [number, string, string | null][] = [
    [101, '2026-08-03 09:00:00', 'DE'], [102, '2026-08-04 09:00:00', 'DE'], [103, '2026-08-05 09:00:00', 'DE'],
    [104, '2026-08-06 09:00:00', 'DE'], [105, '2026-08-09 23:00:00', null], [106, '2026-08-10 09:00:00', 'FR'], [107, '2026-08-12 09:00:00', 'FR'],
  ];
  for (const [id, at, country] of joined) {
    user.run(id, `u-ref-${id}`, 'investor', `Referred Person ${id}`, `referred${id}@example.invalid`, country);
    ref.run(INF, id, at);
  }
  user.run(108, 'u-ref-108', 'investor', 'Early Bird', 'early@example.invalid', 'DE');
  ref.run(INF, 108, '2026-07-01 09:00:00');
  // Oto's referral is not Ina's.
  user.run(109, 'u-ref-109', 'investor', 'Other Pick', 'pick@example.invalid', 'DE');
  db.prepare("INSERT INTO referrals(referrer_id, referred_id, referral_code, status, created_at) VALUES (?, 109, 'OTO', 'converted', '2026-08-05 09:00:00')").run(OTHER);
  // Five of them hold an investor plan, one a founder plan.
  const sub = db.prepare("INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, status) VALUES (?, ?, ?, 2900, 'usd', 'month', ?)");
  for (const id of [101, 102, 103, 104, 106]) sub.run(`sub_${id}`, id, 'investor', 'active');
  sub.run('sub_107', 107, 'founder', 'active');
  sub.run('sub_105', 105, 'investor', 'canceled');
  // Commissions: USD and EUR, each status; one claimed by a failed payout and then by a completed one.
  const com = db.prepare("INSERT INTO commissions(id, user_id, amount_cents, currency, source_type, status, created_at, reversed_amount_cents) VALUES (?, ?, ?, ?, 'subscription_invoice', ?, ?, ?)");
  com.run(1, INF, 1000, 'USD', 'pending', '2026-08-04 10:00:00', 0);
  com.run(2, INF, 2000, 'USD', 'accrued', '2026-08-04 10:00:00', 0);
  com.run(3, INF, 3000, 'USD', 'paid', '2026-08-11 10:00:00', 0);
  com.run(4, INF, 4000, 'USD', 'paid', '2026-08-11 10:00:00', 0);
  com.run(5, INF, 500, 'USD', 'reversed', '2026-08-11 10:00:00', 0);
  com.run(6, INF, 800, 'USD', 'accrued', '2026-08-11 10:00:00', 300);
  com.run(7, INF, 7000, 'EUR', 'accrued', '2026-10-20 10:00:00', 0);
  com.run(8, OTHER, 99999, 'USD', 'accrued', '2026-08-04 10:00:00', 0);
  com.run(9, INF, 55555, 'USD', 'accrued', '2026-07-01 10:00:00', 0);
  const pay = db.prepare("INSERT INTO payouts(id, user_id, amount_cents, currency, status, payout_method) VALUES (?, ?, ?, 'USD', ?, 'wire')");
  pay.run(1, INF, 3000, 'failed');
  pay.run(2, INF, 3000, 'completed');
  pay.run(3, INF, 4000, 'requested');
  const link = db.prepare('INSERT INTO payout_commissions(payout_id, commission_id) VALUES (?, ?)');
  link.run(1, 3); link.run(2, 3); link.run(3, 4);
  // P1–P3's stores (D4295 §5). Ina is influencer 10 with the handle `ina`; Oto is 11.
  const inf = db.prepare("INSERT INTO influencers(id, uid, user_id, tier, handle, admitted_by) VALUES (?, ?, ?, 'affiliate_creator', ?, ?)");
  inf.run(10, 'inf-ina', INF, 'ina', SUPER);
  inf.run(11, 'inf-oto', OTHER, 'oto', SUPER);
  // Visits: six to the handle itself (three a day in weeks 1 and 2), five to @ina/yt in week 1; one in July and Oto's two are not Ina's range.
  const visit = db.prepare('INSERT INTO handle_visits(influencer_id, handle, channel, day, visitor_hash) VALUES (?, ?, ?, ?, ?)');
  let v = 0;
  const hash = () => String(++v).padStart(64, '0');
  for (const day of ['2026-08-03', '2026-08-03', '2026-08-03', '2026-08-11', '2026-08-11', '2026-08-11']) visit.run(10, 'ina', '', day, hash());
  for (let i = 0; i < 5; i++) visit.run(10, 'ina', 'yt', '2026-08-04', hash());
  visit.run(10, 'ina', '', '2026-07-01', hash());
  visit.run(11, 'oto', '', '2026-08-04', hash()); visit.run(11, 'oto', 'yt', '2026-08-04', hash());
  // How five of the seven came: 101–103 through @ina/yt, 104 through the handle itself, 106 through @ina/newsletter. 105 used the code.
  const attr = db.prepare("INSERT INTO referral_attributions(user_id, referral_code, referrer_user_id, first_touch_at, expires_at, source, handle, channel) VALUES (?, ?, ?, ?, '2027-01-01 00:00:00', ?, ?, ?)");
  attr.run(101, 'h:ina:yt', INF, '2026-08-01 09:00:00', 'handle', 'ina', 'yt');
  attr.run(102, 'h:ina:yt', INF, '2026-08-02 09:00:00', 'handle', 'ina', 'yt');
  attr.run(103, 'h:ina:yt', INF, '2026-08-03 09:00:00', 'handle', 'ina', 'yt');
  attr.run(104, 'h:ina', INF, '2026-08-06 09:00:00', 'handle', 'ina', null);
  attr.run(106, 'h:ina:newsletter', INF, '2026-08-10 09:00:00', 'handle', 'ina', 'newsletter');
  attr.run(105, 'INA', INF, '2026-08-09 23:00:00', 'code', null, null);
  attr.run(109, 'OTO', OTHER, '2026-08-01 09:00:00', 'code', null, null);
  // The paid invoices behind Ina's commissions (P3). 101 paid twice; 102's subscription ended mid-September;
  // 107's first invoice was refunded inside the hold (cancelled); 105 first paid before the range; 109 is Oto's.
  const inv = db.prepare(`INSERT INTO influencer_commission_invoices(commission_id, referrer_user_id, member_user_id, subscription_id, invoice_id,
    invoice_number, net_cents, currency, plan_key, handle, channel, paid_at, payable_at, cancelled_at, cancel_reason, subscription_ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'investor_pro', ?, ?, ?, '2026-12-01 00:00:00', ?, ?, ?)`);
  inv.run(2, INF, 101, 'sub_101', 'in_101_1', 1, 2900, 'USD', 'ina', 'yt', '2026-08-05 09:00:00', null, null, null);
  inv.run(1, INF, 101, 'sub_101', 'in_101_2', 2, 2900, 'USD', 'ina', 'yt', '2026-09-05 09:00:00', null, null, null);
  inv.run(3, INF, 102, 'sub_102', 'in_102_1', 1, 2900, 'USD', 'ina', 'yt', '2026-08-06 09:00:00', null, null, '2026-09-15 00:00:00');
  inv.run(4, INF, 103, 'sub_103', 'in_103_1', 1, 2900, 'USD', 'ina', 'yt', '2026-08-07 09:00:00', null, null, null);
  inv.run(6, INF, 104, 'sub_104', 'in_104_1', 1, 2900, 'USD', 'ina', null, '2026-08-08 09:00:00', null, null, null);
  inv.run(7, INF, 106, 'sub_106', 'in_106_1', 1, 4000, 'EUR', 'ina', 'newsletter', '2026-08-20 09:00:00', null, null, null);
  inv.run(5, INF, 107, 'sub_107', 'in_107_1', 1, 9900, 'USD', null, null, '2026-08-21 09:00:00', '2026-08-25 00:00:00', 'refund', null);
  inv.run(9, INF, 105, 'sub_105', 'in_105_1', 1, 2900, 'USD', null, null, '2026-07-10 09:00:00', null, null, null);
  inv.run(8, OTHER, 109, 'sub_109', 'in_109_1', 1, 2900, 'USD', null, null, '2026-08-05 09:00:00', null, null, null);
  // A bonus Ina was paid in June (its commission is outside the range, so the range's money is unchanged).
  com.run(13, INF, 5000, 'USD', 'accrued', '2026-06-01 10:00:00', 0);
  db.prepare("UPDATE commissions SET source_type = 'influencer_bonus', source_id = '10' WHERE id = 13").run();
  db.prepare("INSERT INTO influencer_milestones(referrer_user_id, milestone, kind, commission_id, customers_counted, achieved_at) VALUES (?, 10, 'bonus', 13, 10, '2026-06-01 10:00:00')").run(INF);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  for (const m of mount) app.route(m.path, m.router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;
async function get(f: F, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}
const FEW = { fewer_than: 5 };

test('1. each figure from its source, per currency, and nothing from another influencer or outside the range', async () => {
  // Mutation checked: the referrer filter dropped → Oto's sign-up counts; paid read from the status alone → the requested
  // payout counts as paid; the latest-payout subquery replaced by a join → commission 3 counts twice; the currency
  // grouping dropped → EUR is summed into USD; the range ignored → July's rows count.
  const f = fixture();
  try {
    const r = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.range, { from: '2026-08-03', to: '2026-10-25', grain: 'week', channel: null });
    assert.equal(r.body.signups.total, 7);
    assert.equal(r.body.signups.series.length, 12);
    assert.deepEqual(r.body.signups.series.slice(0, 2), [{ week: W1, value: 5 }, { week: W2, value: FEW }]);
    assert.deepEqual(r.body.funnel.signups, 7);
    assert.deepEqual(r.body.commission.by_currency, [
      { currency: 'EUR', pending_cents: 0, payable_cents: 7000, in_payout_cents: 0, paid_cents: 0, reversed_cents: 0 },
      { currency: 'USD', pending_cents: 1000, payable_cents: 2800, in_payout_cents: 4000, paid_cents: 3000, reversed_cents: 800 },
    ]);
    const week = (w: string, cur: string) => r.body.commission.series.find((s: any) => s.week === w && s.currency === cur).earned_cents;
    assert.equal(week(W1, 'USD'), 3000);
    assert.equal(week(W2, 'USD'), 7800, 'the reversed commission is not earned');
    assert.equal(week(W12, 'EUR'), 7000);
    assert.equal(week(W12, 'USD'), 0, 'a counted week with nothing earned is 0');
    assert.deepEqual(r.body.audience.by_plan_family, [{ plan_family: 'investor', members: 5 }, { plan_family: 'founder', members: FEW }]);
    assert.deepEqual(r.body.audience.by_month_joined, [{ month: '2026-08', members: 7 }]);
  } finally { f.close(); }
});

test('2. a group of 1 to 4 reads "Fewer than 5"; a counted 0 is 0', async () => {
  // Mutation checked: masked returning the count → the fewer_than checks fail; masking 0 → the zero weeks fail.
  const f = fixture();
  try {
    const r = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.deepEqual(r.body.audience.by_region, [{ country: 'DE', members: FEW }, { country: 'FR', members: FEW }, { country: null, members: FEW }]);
    assert.ok(r.body.signups.series.slice(2).every((s: any) => s.value === 0), 'the weeks with no sign-up are a counted 0');
    assert.deepEqual([masked(0), masked(1), masked(4), masked(5)], [0, FEW, FEW, 5]);
    const narrow = await get(f, INF, '/api/influencer/me/analytics?from=2026-08-10&to=2026-08-16');
    assert.deepEqual(narrow.body.signups.total, FEW);
    assert.ok(narrow.body.line.includes('fewer than 5 sign-ups'), narrow.body.line);
  } finally { f.close(); }
});

test('3. a failed read is unreadable and leaves the others; never 0', async () => {
  // Mutation checked: guarded() rethrowing → the 500 replaces the unreadable figure; an absent store read as an empty list → 0s.
  const f = fixture();
  try {
    f.db.exec('DROP TABLE member_subscription_amounts');
    f.db.exec('DROP TABLE influencer_commission_invoices');
    f.db.exec('DROP TABLE handle_visits');
    const broken = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.equal(broken.status, 200);
    const U = { available: false, reason: 'unreadable' };
    assert.deepEqual(broken.body.audience.by_plan_family, U);
    for (const k of ['visits', 'paid_members', 'revenue', 'channels']) assert.deepEqual(broken.body[k], U, k);
    assert.deepEqual([broken.body.funnel.visits, broken.body.funnel.paid], [U, U]);
    assert.deepEqual([broken.body.audience.retention, broken.body.audience.visit_to_paid_median_days], [U, U]);
    assert.equal(broken.body.signups.total, 7, 'one failed figure leaves the others');
    assert.doesNotMatch(broken.text, /not_recorded/, 'every store is on main now: nothing reads Not recorded');
  } finally { f.close(); }
});

test('6. visits from handle_visits by week; the channels ranked; a channel narrows every figure', async () => {
  // Mutation checked: the influencer filter dropped → Oto's visits count; the range dropped → July's visit counts;
  // code sign-ups counted on the handle's row; the channel filter ignored on sign-ups, commission or audience.
  const f = fixture();
  try {
    const r = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.equal(r.body.visits.total, 11);
    assert.deepEqual(r.body.visits.series.slice(0, 2), [{ week: W1, value: 8 }, { week: W2, value: FEW }]);
    assert.equal(r.body.funnel.visits, 11);
    assert.deepEqual(r.body.channels, [
      { channel: null, visits: 6, signups: FEW, paid: FEW },
      { channel: 'yt', visits: 5, signups: FEW, paid: FEW },
      { channel: 'newsletter', visits: 0, signups: FEW, paid: FEW },
    ]);
    const yt = await get(f, INF, `/api/influencer/me/analytics${RANGE}&channel=yt`);
    assert.equal(yt.status, 200, yt.text);
    assert.equal(yt.body.range.channel, 'yt');
    assert.equal(yt.body.visits.total, 5);
    assert.deepEqual(yt.body.signups.total, FEW, '101–103 came through @ina/yt');
    assert.deepEqual(yt.body.channels.map((c: any) => c.channel), ['yt']);
    assert.deepEqual(yt.body.commission.by_currency, [
      { currency: 'USD', pending_cents: 1000, payable_cents: 2000, in_payout_cents: 4000, paid_cents: 3000, reversed_cents: 0 },
    ], 'only the commissions on invoices through @ina/yt');
    assert.deepEqual(yt.body.audience.by_region, [{ country: 'DE', members: FEW }]);
    // Oto's one sign-up and his one paid member came by code: the handle's own row has his visit and no sign-up.
    const oto = await get(f, SUPER, `/api/admin/influencers/u-other/analytics${RANGE}`);
    assert.deepEqual(oto.body.channels, [
      { channel: null, visits: FEW, signups: 0, paid: 0 },
      { channel: 'yt', visits: FEW, signups: 0, paid: 0 },
    ], 'a sign-up or a paid invoice by code is on no channel');
    assert.deepEqual(yt.body.revenue.by_currency, [{ currency: 'USD', net_cents: 11600 }], '101 twice, 102 and 103');
  } finally { f.close(); }
});

test('7. paid members from the first paid invoice; revenue per currency; bonuses and the next milestone', async () => {
  // Mutation checked: invoice_number ignored → 101's second invoice counts a second paid member; a cancelled invoice
  // counted → 107 is paid and its 99.00 is revenue; the currencies summed; the bonus read without its commission.
  const f = fixture();
  try {
    const r = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.equal(r.body.paid_members.total, 5, '101, 102, 103, 104 and 106; not 107 (refunded) or 105 (July)');
    assert.deepEqual(r.body.paid_members.series[0], { week: W1, value: FEW });
    assert.equal(r.body.funnel.paid, 5);
    assert.deepEqual(r.body.revenue.by_currency, [{ currency: 'EUR', net_cents: 4000 }, { currency: 'USD', net_cents: 14500 }]);
    assert.deepEqual(r.body.bonuses.earned, [{ milestone: 10, currency: 'USD', amount_cents: 5000, achieved_at: '2026-06-01 10:00:00' }]);
    // Five count toward a bonus (101, 103, 104, 106 and 105): 102's subscription ended and 107's commission was reversed.
    assert.deepEqual(r.body.bonuses.next, { milestone: 10, kind: 'bonus', needs: 5 });
    assert.deepEqual(nextMilestone(3), { milestone: 10, kind: 'bonus', needs: { more_than: 5 } }, 'an exact distance would give away 3');
    assert.deepEqual([nextMilestone(0)?.needs, nextMilestone(100)?.milestone, nextMilestone(100)?.kind, nextMilestone(250)], [10, 250, 'custom', null]);
    const admin = await get(f, ADMIN, `/api/admin/influencers/u-inf/analytics${RANGE}`);
    assert.equal(admin.body.paid_members.total, 5, 'counts are any admin’s');
  } finally { f.close(); }
});

test('8. retention by month as a cohort grid, and the median days from visit to paid', async () => {
  // Mutation checked: the subscription's end ignored → September keeps 102; a month that has not ended drawn;
  // the median read under five members; the first touch taken from a code attribution.
  const f = fixture();
  try {
    const now = new Date('2026-11-03T12:00:00Z');
    const a = await influencerAnalytics(f.env, INF, rangeOf('2026-08-03', '2026-10-25', now)!, { money: true, now });
    assert.deepEqual(a.audience.retention, [{ cohort: '2026-08', members: 5, months: [5, FEW, FEW] }], 'August, September, October; November has not ended');
    assert.deepEqual(a.audience.visit_to_paid_median_days, { days: 4, members: 5 }, '4, 4, 4, 2 and 10 days');
    const early = await influencerAnalytics(f.env, INF, rangeOf('2026-08-03', '2026-10-25', now)!, { money: true, now: new Date('2026-09-10T00:00:00Z') });
    assert.deepEqual((early.audience.retention as any)[0].months, [5], 'only August has ended');
    const yt = await influencerAnalytics(f.env, INF, rangeOf('2026-08-03', '2026-10-25', now)!, { money: true, now, channel: 'yt' });
    assert.deepEqual(yt.audience.visit_to_paid_median_days, { days: null, members: FEW }, 'three members: no median');
    const oto = await influencerAnalytics(f.env, OTHER, rangeOf('2026-08-03', '2026-10-25', now)!, { money: true, now });
    assert.deepEqual(oto.audience.visit_to_paid_median_days, { days: null, members: 0 }, 'a code sign-up has no visit to start from');
    assert.deepEqual(median([2, 4, 6, 8]), 5);
    assert.equal(median([]), null);
  } finally { f.close(); }
});

test('4. no referred member’s name, email or id in the reply', async () => {
  // Mutation checked: the region read selecting u.email → the email check fails.
  const f = fixture();
  try {
    for (const path of [`/api/influencer/me/analytics${RANGE}`]) {
      const r = await get(f, INF, path);
      const admin = await get(f, SUPER, `/api/admin/influencers/u-inf/analytics${RANGE}`);
      for (const text of [r.text, admin.text]) {
        assert.doesNotMatch(text, /Referred Person|referred\d+@|u-ref-|Early Bird|Other Pick/);
        assert.doesNotMatch(text, /"(referred_id|user_id|email|name|uid)"/);
      }
    }
  } finally { f.close(); }
});

test('5. HQ: money for the Super Admin only; the member read is an influencer’s; the range, grain and line', async () => {
  // Mutation checked: the Super Admin check dropped → the admin sees the amounts; isInfluencer skipped → a member gets figures.
  const f = fixture();
  try {
    const admin = await get(f, ADMIN, `/api/admin/influencers/u-inf/analytics${RANGE}`);
    assert.equal(admin.status, 200);
    for (const k of ['commission', 'revenue', 'bonuses']) assert.deepEqual(admin.body[k], { available: false, reason: 'hq_reads' }, k);
    assert.equal(admin.body.signups.total, 7, 'the counts are HQ’s to read');
    const sup = await get(f, SUPER, `/api/admin/influencers/u-inf/analytics${RANGE}`);
    assert.equal(sup.body.commission.by_currency.length, 2);
    assert.equal((await get(f, INF, `/api/admin/influencers/u-inf/analytics${RANGE}`)).status, 403, 'not an admin');
    assert.equal((await get(f, SUPER, '/api/admin/influencers/u-member/analytics')).body.error, 'not_an_influencer');
    assert.equal((await get(f, MEMBER, '/api/influencer/me/analytics')).body.error, 'not_an_influencer');
    assert.equal((await get(f, INF, '/api/influencer/me/analytics?from=2026-10-01&to=2026-08-01')).body.error, 'invalid_range');
    assert.equal((await get(f, INF, '/api/influencer/me/analytics?from=2025-01-01&to=2026-10-01')).body.error, 'invalid_range');
    assert.equal((await get(f, INF, '/api/influencer/me/analytics?grain=day')).body.error, 'unsupported_grain');
    assert.equal((await get(f, INF, '/api/influencer/me/analytics?channel=../x')).body.error, 'invalid_channel');
    const r = await get(f, INF, `/api/influencer/me/analytics${RANGE}`);
    assert.match(r.body.line, /^From your link records, as of \d{4}-\d{2}-\d{2}: from 2026-08-03 to 2026-10-25, 7 sign-ups came through you, and 70\.00 EUR is payable, and 28\.00 USD is payable\.$/);
    assert.doesNotMatch(r.body.line, /will|expect|guarantee/i, 'it restates, never promises');
    const d = rangeOf(undefined, '2026-10-25', new Date())!;
    assert.deepEqual([d.from, d.weeks.length, d.weeks[0]], ['2026-08-03', 12, weekOf(new Date('2026-08-05T00:00:00Z'))]);
  } finally { f.close(); }
});
