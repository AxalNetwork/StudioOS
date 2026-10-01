/**
 * D413 — what the rebuilt Perks & Products page reads that the Worker did not
 * serve before: a redeemed count beside the claim count, a claim's days left
 * and whether it is expiring, the My perks tiles, the partner's cost per
 * founder, and the Worker's own sentence for every absence the page prints.
 *
 * Run against the migrations that ship (see _perks_harness.ts), through the
 * route itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { claimDaysLeft, PERK_EXPIRING_WITHIN_DAYS } from '../src/routes/perks.ts';
import { FOUNDER, FOUNDER_B, FREE_FOUNDER, PARTNER, OTHER_PARTNER, INVESTOR, TODAY, day, addPerk, grant, harness } from './_perks_harness.ts';

const redeem = (db: any, uid: string, userId: number) =>
  db.prepare(`UPDATE perk_claims SET status = 'redeemed', redeemed_at = datetime('now')
               WHERE user_id = ? AND perk_id = (SELECT id FROM perks WHERE uid = ?)`).run(userId, uid);

test('GET /partner serves redeemed_count beside claim_count, and they differ', async () => {
  const { db, call } = harness();
  addPerk(db, 'bank');
  for (const who of [FOUNDER, FOUNDER_B, FREE_FOUNDER]) {
    assert.equal((await call('POST', '/bank/claim', who)).status, 201);
  }
  redeem(db, 'bank', FOUNDER);
  const r = await call('GET', '/partner', PARTNER);
  assert.equal(r.status, 200);
  const row = r.body.items.find((p: any) => p.uid === 'bank');
  assert.equal(row.claim_count, 3);
  assert.equal(row.redeemed_count, 1, 'a redeemed count that equals the claim count is the old mislabel');
  assert.match(r.body.absent.review_criteria, /not written down/);
});

test('/mine serves days_left and expiring per claim, counted in the Worker against its one window', async () => {
  const { db, call } = harness();
  addPerk(db, 'soon', { ends_at: day(10) });
  addPerk(db, 'later', { ends_at: day(PERK_EXPIRING_WITHIN_DAYS + 30) });
  addPerk(db, 'open', { ends_at: null });
  addPerk(db, 'used', { ends_at: day(5) });
  addPerk(db, 'paid', { kind: 'credits', credits: 40 });
  grant(db, FOUNDER, 100);
  for (const uid of ['soon', 'later', 'open', 'used', 'paid']) {
    assert.equal((await call('POST', `/${uid}/claim`, FOUNDER)).status, 201, uid);
  }
  redeem(db, 'used', FOUNDER);
  const r = await call('GET', '/mine', FOUNDER);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.items.map((c: any) => [c.perk_uid, c]));
  assert.equal(by.soon.days_left, 10);
  assert.equal(by.soon.expiring, true);
  assert.equal(by.later.days_left, PERK_EXPIRING_WITHIN_DAYS + 30);
  assert.equal(by.later.expiring, false);
  assert.equal(by.open.days_left, null, 'an open-ended claim has no days left, not zero');
  assert.equal(by.open.expiring, false);
  assert.equal(by.used.days_left, null, 'a redeemed claim has nothing left to lapse');
  assert.equal(by.used.expiring, false);
  assert.deepEqual(r.body.stats, {
    claimed: 5, credits_spent: 40, expiring: 1, expiring_within_days: PERK_EXPIRING_WITHIN_DAYS,
  });
  assert.match(r.body.absent.expiry_reminder, /No reminder is sent/);
});

test('claimDaysLeft: the window edge counts, an expired or undated claim does not', () => {
  assert.equal(claimDaysLeft({ status: 'issued', expires_at: day(PERK_EXPIRING_WITHIN_DAYS) }, TODAY), PERK_EXPIRING_WITHIN_DAYS);
  assert.equal(claimDaysLeft({ status: 'issued', expires_at: TODAY }, TODAY), 0);
  assert.equal(claimDaysLeft({ status: 'issued', expires_at: day(-1) }, TODAY), null, 'expired is not negative days left');
  assert.equal(claimDaysLeft({ status: 'issued', expires_at: 'soon' }, TODAY), null);
  assert.equal(claimDaysLeft({ status: 'redeemed', expires_at: day(3) }, TODAY), null);
});

test('a listing whose partner must reach the founder says the partner is not told who claimed', async () => {
  const { db, call } = harness();
  addPerk(db, 'intro', { fulfilment: 'intro' });
  addPerk(db, 'paid', { kind: 'money', fulfilment: 'code' });
  addPerk(db, 'code', { fulfilment: 'code' });
  const intro = await call('GET', '/intro', FOUNDER);
  const paid = await call('GET', '/paid', FOUNDER);
  const code = await call('GET', '/code', FOUNDER);
  assert.match(intro.body.absent.partner_contact, /not told who claimed/);
  assert.equal(paid.body.absent.partner_contact, intro.body.absent.partner_contact);
  assert.deepEqual(code.body.absent, {}, 'a self-serve code needs nothing from the partner');
  // And the sentence is true: the partner's own read of the claims withholds who.
  await call('POST', '/intro/claim', FOUNDER);
  const seen = await call('GET', '/partner/intro/claims', PARTNER);
  assert.equal(seen.status, 200);
  assert.ok(!('user_id' in seen.body.items[0]), 'the partner can see who claimed, so the sentence is false');
});

test('stats: cost per founder is value × redeemed ÷ claims, in integer cents', async () => {
  const { db, call } = harness();
  addPerk(db, 'bank', { value_cents: 165_000 });
  for (const who of [FOUNDER, FOUNDER_B, FREE_FOUNDER]) await call('POST', '/bank/claim', who);
  redeem(db, 'bank', FOUNDER);
  redeem(db, 'bank', FOUNDER_B);
  const r = await call('GET', '/partner/bank/stats', PARTNER);
  assert.equal(r.status, 200);
  assert.equal(r.body.cost_per_founder_cents, 110_000);
  assert.ok(Number.isInteger(r.body.cost_per_founder_cents));
  assert.equal(r.body.redemption_rate, 2 / 3);
  assert.ok(!('cost_per_founder' in r.body.absent));
  assert.ok(!('redemption_rate' in r.body.absent));
  assert.match(r.body.absent.bd_console, /no BD console/);
  assert.match(r.body.absent.card_views, /not counted/);
});

test('stats: with no stated value, or no claims, the figure is null and the Worker says why', async () => {
  const { db, call } = harness();
  addPerk(db, 'novalue', { value_cents: null });
  addPerk(db, 'noclaims', { value_cents: 5_000 });
  await call('POST', '/novalue/claim', FOUNDER);
  const a = await call('GET', '/partner/novalue/stats', PARTNER);
  assert.equal(a.body.cost_per_founder_cents, null);
  assert.match(a.body.absent.cost_per_founder, /states no cash value/);
  const b = await call('GET', '/partner/noclaims/stats', PARTNER);
  assert.equal(b.body.cost_per_founder_cents, null);
  assert.equal(b.body.redemption_rate, null);
  assert.match(b.body.absent.cost_per_founder, /No claims yet/);
  assert.match(b.body.absent.redemption_rate, /No claims yet/);
});

test('Performance reads are the owner’s: a non-partner is refused, another partner gets a 404', async () => {
  const { db, call } = harness();
  addPerk(db, 'bank', { value_cents: 1_000 });
  for (const who of [INVESTOR, FOUNDER]) {
    assert.equal((await call('GET', '/partner/bank/stats', who)).status, 403);
    assert.equal((await call('GET', '/partner/bank/claims', who)).status, 403);
  }
  assert.equal((await call('GET', '/partner/bank/stats', OTHER_PARTNER)).status, 404);
  assert.equal((await call('GET', '/partner/bank/claims', OTHER_PARTNER)).status, 404);
});
