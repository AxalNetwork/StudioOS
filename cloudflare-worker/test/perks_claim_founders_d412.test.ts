/**
 * D412 — the Perks server: who may claim, a claim that cannot overrun its cap
 * or its balance, what a claim says about its expiry, who marks it redeemed,
 * a cap that can be raised without a second review, and ratings.
 *
 * The schema is not copied here. It is BUILT from the migrations that ship —
 * 186, 198, 228 and 322, read off disk — so a test that passes is a test of
 * the tables production has, and a migration that stops matching the route
 * fails here first.
 *
 * Concurrency cannot be staged with one synchronous SQLite connection, so the
 * two atomicity tests do what a concurrent request would: a batch hook lands a
 * competing write between the route's read and its INSERT. The pre-check the
 * route makes is then stale, exactly as it would be in production, and only
 * the conditions inside the INSERT stand between the claim and an overrun.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PERK_CLAIMANT_ROLES, claimState } from '../src/routes/perks.ts';
import { userMeetsTier } from '../src/middleware/requireTier.ts';
import {
  FOUNDER, FOUNDER_B, FREE_FOUNDER, PARTNER, OTHER_PARTNER, INVESTOR, ADVISOR, ADMIN, EXPLORING,
  ROLE, day, addPerk, grant, balance, claims, harness,
} from './_perks_harness.ts';

// ---------- who may claim ----------

test('only founders claim: investor, advisor, partner, admin and exploring are refused, and nothing is written', async () => {
  const { db, call } = harness();
  addPerk(db, 'p1');
  for (const who of [INVESTOR, ADVISOR, PARTNER, ADMIN, EXPLORING]) {
    const r = await call('POST', '/p1/claim', who);
    assert.equal(r.status, 403, `${ROLE[who]} got ${r.status}`);
    assert.equal(r.body.error, 'founders_only');
    assert.equal(typeof r.body.message, 'string');
  }
  assert.equal(claims(db).length, 0);
  // The gate runs before the listing is read, so a non-founder cannot use a
  // refusal to learn which listings exist: a real one and a made-up one answer
  // alike.
  assert.deepEqual(await call('POST', '/no-such-perk/claim', INVESTOR), await call('POST', '/p1/claim', INVESTOR));
  assert.equal((await call('POST', '/p1/claim', FOUNDER)).status, 201);
});

test('no role takes a tier perk through the tier bypass', async () => {
  const { db, call } = harness();
  addPerk(db, 'studio-perk', { kind: 'tier', required_tier: 'studio' });
  // The four BYPASS_ROLES of requireTier.ts — each used to walk through.
  for (const who of [ADMIN, PARTNER, INVESTOR, ADVISOR]) {
    assert.equal((await call('POST', '/studio-perk/claim', who)).status, 403, ROLE[who]);
  }
  // A founder on growth is refused a studio perk; the gate reads their plan.
  const r = await call('POST', '/studio-perk/claim', FOUNDER);
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'tier_required');
  assert.equal(claims(db).length, 0);
});

test('a free founder is held to the tier, a growth founder is not', async () => {
  const { db, call } = harness();
  addPerk(db, 'growth-perk', { kind: 'tier', required_tier: 'growth' });
  assert.equal((await call('POST', '/growth-perk/claim', FREE_FOUNDER)).status, 402);
  assert.equal((await call('POST', '/growth-perk/claim', FOUNDER)).status, 201);
});

test('no claimant role is a tier-bypass role', () => {
  // The structural half of the rule: if a role added to PERK_CLAIMANT_ROLES
  // were one requireTier.ts waves through, its accounts would get tier perks
  // free again. A free-plan account of each claimant role must fail a studio gate.
  assert.ok(PERK_CLAIMANT_ROLES.size >= 1);
  for (const role of PERK_CLAIMANT_ROLES) {
    assert.equal(userMeetsTier({ id: 1, role, subscription_tier: 'free' } as any, 'studio'), false, `${role} bypasses the tier gate`);
  }
  // The owner's open question, and today's conservative answer.
  assert.equal(PERK_CLAIMANT_ROLES.has('exploring'), false);
});

test('the catalogue tells a non-founder they cannot claim, before any price', async () => {
  const { db, call } = harness();
  addPerk(db, 'p1', { credits: 50 });
  const r = await call('GET', '/', INVESTOR);
  assert.equal(r.body.claimant, false);
  assert.ok(r.body.claimant_reason.length > 20);
  assert.equal(r.body.items[0].claimable, false);
  assert.equal(r.body.items[0].reason, 'founders_only');
  const f = await call('GET', '/', FOUNDER);
  assert.equal(f.body.claimant, true);
  assert.equal(f.body.claimant_reason, null);
});

// ---------- the atomic cap and balance ----------

test('the cap holds when a concurrent claim lands between the read and the insert', async () => {
  const { db, hooks, call } = harness();
  addPerk(db, 'capped', { claim_cap: 1 });
  // FOUNDER_B's claim commits just after our route read "0 of 1 used".
  hooks.beforeBatch = (d) => d.prepare(
    `INSERT INTO perk_claims (uid, perk_id, user_id, status) VALUES ('rival', (SELECT id FROM perks WHERE uid = 'capped'), ?, 'issued')`,
  ).run(FOUNDER_B);
  const r = await call('POST', '/capped/claim', FOUNDER);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'cap_reached');
  assert.equal(claims(db).length, 1, 'the cap of 1 was overrun');
});

test('one balance cannot be spent twice across two perks', async () => {
  const { db, hooks, call } = harness();
  grant(db, FOUNDER, 100);
  addPerk(db, 'a', { credits: 80 });
  addPerk(db, 'b', { credits: 80 });
  // The claim of `a` commits between our read of "balance 100" and our insert.
  hooks.beforeBatch = (d) => {
    d.prepare(`INSERT INTO perk_claims (uid, perk_id, user_id, credits_spent, status) VALUES ('ca', (SELECT id FROM perks WHERE uid='a'), ?, 80, 'issued')`).run(FOUNDER);
    d.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref) VALUES (?, -80, 'spend', 'perk:ca')`).run(FOUNDER);
  };
  const r = await call('POST', '/b/claim', FOUNDER);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'insufficient_credits');
  assert.equal(balance(db, FOUNDER), 20, 'the balance went negative');
  assert.equal(claims(db).length, 1, 'an unpaid claim row was left behind');
});

test('a paid claim lands with exactly its debit', async () => {
  const { db, call } = harness();
  grant(db, FOUNDER, 100);
  addPerk(db, 'a', { credits: 30 });
  const r = await call('POST', '/a/claim', FOUNDER);
  assert.equal(r.status, 201);
  assert.equal(r.body.balance, 70);
  assert.equal(balance(db, FOUNDER), 70);
  assert.equal(claims(db).length, 1);
});

// ---------- expiry ----------

test('a claim carries the offer’s end date as its expiry, and an open offer gives an open claim', async () => {
  const { db, call } = harness();
  addPerk(db, 'ends', { ends_at: day(20) });
  addPerk(db, 'open');
  const a = await call('POST', '/ends/claim', FOUNDER);
  const b = await call('POST', '/open/claim', FOUNDER);
  assert.equal(a.body.expires_at, day(20));
  assert.equal(b.body.expires_at, null);
  const rows = claims(db);
  assert.equal(rows[0].expires_at, day(20));
  assert.equal(rows[1].expires_at, null);
  // A later edit to the listing does not move a claim already made.
  db.prepare(`UPDATE perks SET ends_at = ? WHERE uid = 'ends'`).run(day(5));
  assert.equal(claims(db)[0].expires_at, day(20));
});

test('an ended offer is off the shelf and cannot be claimed', async () => {
  const { db, call } = harness();
  addPerk(db, 'gone', { ends_at: day(-1) });
  const list = await call('GET', '/', FOUNDER);
  assert.equal(list.body.items.length, 0);
  const r = await call('POST', '/gone/claim', FOUNDER);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'perk_ended');
});

test('my perks derive "expired" for an issued claim past its date, and name the missing reminder', async () => {
  const { db, call } = harness();
  addPerk(db, 'p', { ends_at: day(10) });
  await call('POST', '/p/claim', FOUNDER);
  db.prepare(`UPDATE perk_claims SET expires_at = ?`).run(day(-2));
  const r = await call('GET', '/mine', FOUNDER);
  assert.equal(r.body.items[0].state, 'expired');
  assert.equal(r.body.items[0].status, 'issued', 'the stored status is not rewritten on read');
  assert.ok(r.body.absent.expiry_reminder.length > 20);
  assert.equal(claimState({ status: 'redeemed', expires_at: day(-2) }), 'redeemed');
});

// ---------- mark redeemed ----------

test('the partner marks a claim redeemed by its code; the actor is recorded', async () => {
  const { db, call } = harness();
  addPerk(db, 'p');
  const claim = await call('POST', '/p/claim', FOUNDER);
  const r = await call('POST', '/partner/p/redeem', PARTNER, { code: claim.body.code.toLowerCase() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [row] = claims(db);
  assert.equal(row.status, 'redeemed');
  assert.equal(row.redeemed_by_user_id, PARTNER);
  assert.ok(row.redeemed_at);
  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'perk_claim_redeemed'`).get() as any;
  assert.equal(log.user_id, PARTNER);
  assert.equal(JSON.parse(log.details).claim_uid, row.uid);
  const twice = await call('POST', '/partner/p/redeem', PARTNER, { code: claim.body.code });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_redeemed');
});

test('a link or intro claim is redeemed by its claim id', async () => {
  const { db, call } = harness();
  addPerk(db, 'intro', { fulfilment: 'intro' });
  const claim = await call('POST', '/intro/claim', FOUNDER);
  assert.equal(claim.body.code, null);
  const r = await call('POST', '/partner/intro/redeem', PARTNER, { claim_uid: claim.body.uid });
  assert.equal(r.status, 200);
});

test('another partner, or a code from another listing, finds nothing', async () => {
  const { db, call } = harness();
  addPerk(db, 'p');
  addPerk(db, 'q', { partner_user_id: OTHER_PARTNER });
  const onP = await call('POST', '/p/claim', FOUNDER);
  const theirs = await call('POST', '/partner/p/redeem', OTHER_PARTNER, { code: onP.body.code });
  assert.equal(theirs.status, 404);
  // OTHER_PARTNER owns q, but p's code is not a claim on q.
  const crossed = await call('POST', '/partner/q/redeem', OTHER_PARTNER, { code: onP.body.code });
  assert.equal(crossed.status, 404);
  assert.equal(crossed.body.error, 'claim_not_found');
  assert.equal(claims(db)[0].status, 'issued');
  // A founder is not a partner.
  assert.equal((await call('POST', '/partner/p/redeem', FOUNDER, { code: onP.body.code })).status, 403);
});

test('an expired claim cannot be marked redeemed', async () => {
  const { db, call } = harness();
  addPerk(db, 'p', { ends_at: day(3) });
  const c1 = await call('POST', '/p/claim', FOUNDER);
  db.prepare(`UPDATE perk_claims SET expires_at = ?`).run(day(-1));
  const r = await call('POST', '/partner/p/redeem', PARTNER, { code: c1.body.code });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'claim_not_redeemable');
});

test('the partner’s claims list and stats say what happened, never who', async () => {
  const { db, call } = harness();
  addPerk(db, 'p', { value_cents: 240000 });
  const a = await call('POST', '/p/claim', FOUNDER);
  await call('POST', '/p/claim', FOUNDER_B);
  await call('POST', '/partner/p/redeem', PARTNER, { code: a.body.code });
  const list = await call('GET', '/partner/p/claims', PARTNER);
  assert.equal(list.body.items.length, 2);
  for (const item of list.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['created_at', 'expires_at', 'redeemed_at', 'state', 'status', 'uid']);
  }
  assert.ok(list.body.absent.founder.length > 20);
  const stats = await call('GET', '/partner/p/stats', PARTNER);
  assert.equal(stats.body.redeemed, 1);
  assert.equal(stats.body.redemption_rate, 0.5);
  assert.equal(stats.body.founders_reached, 2);
  assert.equal(stats.body.value_cents, 240000);
  assert.ok(stats.body.absent.founders_list.length > 20);
});

// ---------- raising the cap ----------

test('raising the cap keeps a live listing live; anything else sends it back to review', async () => {
  const { db, call } = harness();
  const status = (uid: string) => (db.prepare('SELECT status FROM perks WHERE uid = ?').get(uid) as any).status;
  addPerk(db, 'raise', { claim_cap: 10 });
  const r = await call('PATCH', '/partner/raise', PARTNER, { claim_cap: 25 });
  assert.equal(r.body.status, 'live');
  assert.equal(r.body.reviewed_again, false);
  assert.equal(status('raise'), 'live');

  addPerk(db, 'uncap', { claim_cap: 10 });
  await call('PATCH', '/partner/uncap', PARTNER, { claim_cap: null });
  assert.equal(status('uncap'), 'live', 'removing a cap is a raise');

  addPerk(db, 'lower', { claim_cap: 10 });
  await call('PATCH', '/partner/lower', PARTNER, { claim_cap: 5 });
  assert.equal(status('lower'), 'in_review', 'a lowered cap is a change of terms');

  addPerk(db, 'both', { claim_cap: 10 });
  await call('PATCH', '/partner/both', PARTNER, { claim_cap: 25, offer: 'A better offer' });
  assert.equal(status('both'), 'in_review', 'a raise rides no other change past review');

  addPerk(db, 'newcap');
  await call('PATCH', '/partner/newcap', PARTNER, { claim_cap: 50 });
  assert.equal(status('newcap'), 'in_review', 'capping an uncapped listing lowers it');
});

// ---------- ratings ----------

test('a founder rates only once their claim is redeemed; the catalogue says "not yet rated" until then', async () => {
  const { db, call } = harness();
  addPerk(db, 'p');
  const c1 = await call('POST', '/p/claim', FOUNDER);
  const before = await call('GET', '/', FOUNDER);
  assert.deepEqual(before.body.items[0].rating, { count: 0, average: null });
  const early = await call('POST', '/p/rating', FOUNDER, { stars: 5 });
  assert.equal(early.status, 403);
  assert.equal(early.body.error, 'rating_requires_redemption');
  await call('POST', '/partner/p/redeem', PARTNER, { code: c1.body.code });
  assert.equal((await call('POST', '/p/rating', FOUNDER, { stars: 4 })).status, 200);
  assert.equal((await call('POST', '/p/rating', FOUNDER, { stars: 2 })).status, 200, 'rating again replaces');
  const after = await call('GET', '/', FOUNDER);
  assert.deepEqual(after.body.items[0].rating, { count: 1, average: 2 });
  assert.equal((await call('POST', '/p/rating', FOUNDER, { stars: 6 })).status, 400);
  assert.equal((await call('POST', '/p/rating', INVESTOR, { stars: 3 })).status, 403);
});

// ---------- value and the editorial note ----------

test('the partner states a cash value; only an admin writes the editorial note, and it shows only when featured', async () => {
  const { db, call } = harness();
  const sub = await call('POST', '/partner', PARTNER, { offer: 'Free month', partner_name: 'Acme', value_cents: 50000 });
  assert.equal(sub.status, 201);
  assert.equal((db.prepare('SELECT value_cents FROM perks WHERE uid = ?').get(sub.body.uid) as any).value_cents, 50000);
  // Our sentence, not the database's: migration 322's CHECK would also refuse,
  // but as a constraint error the partner cannot act on.
  const neg = await call('POST', '/partner', PARTNER, { offer: 'x', partner_name: 'y', value_cents: -1 });
  assert.equal(neg.status, 400);
  assert.equal(neg.body.error, 'value_cents must be zero or more');
  // The partner cannot write an endorsement of their own listing.
  const self = await call('PATCH', `/partner/${sub.body.uid}`, PARTNER, { editorial_note: 'Best perk ever' });
  assert.equal(self.status, 400, 'editorial_note is not a partner field');
  await call('POST', `/admin/${sub.body.uid}/review`, ADMIN, { action: 'approve', featured: true, editorial_note: 'Our pick this month.' });
  const list = await call('GET', '/', FOUNDER);
  assert.equal(list.body.items[0].editorial_note, 'Our pick this month.');
  assert.equal(list.body.items[0].value_cents, 50000);
  db.prepare('UPDATE perks SET featured = 0').run();
  assert.equal((await call('GET', '/', FOUNDER)).body.items[0].editorial_note, null);
});
