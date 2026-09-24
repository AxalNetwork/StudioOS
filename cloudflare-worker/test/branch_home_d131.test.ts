/**
 * The branch's operating digest, and the two figures it must not invent (D131).
 *
 * WHAT THIS FILE IS FOR. S1 draws six blocks and three of them have no source,
 * so the risk on this page is not a wrong number — it is a *plausible* one. The
 * three assertions that matter are therefore about refusals as much as reads:
 *
 *   1. Queue pressure is ordered by the OLDEST ITEM, not by count. Those are
 *      different orders and the canvas asks for the second; a fixture where
 *      they disagree is the only way to tell which one shipped.
 *   2. Every deadline carries the zone it is enforced in. The programme runs on
 *      America/New_York and the reader does not, so a deadline without its zone
 *      is the wrong hour rather than a missing detail.
 *   3. The revenue block shows a RATE and never an amount. The rate is a
 *      licence term HQ pushed; the base is not totalled anywhere on a branch.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_home_d131.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { addS16Stores } from './_approval_s16_stores.mjs';

import { branchHome, openWeekAt } from '../src/services/branchHome.ts';
import { approvalBoard, APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { COHORT_TZ } from '../src/services/cohortTiming.ts';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

/** The four queue tables, the cohort pair, and the licence copy. */
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT NOT NULL);
  CREATE TABLE lp_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    fund_slug TEXT NOT NULL DEFAULT 'spinout-fund-i',
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
  CREATE TABLE referral_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_user_id INTEGER NOT NULL,
    referred_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted',
    created_at TEXT NOT NULL);
  CREATE TABLE cohort_applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
  CREATE TABLE spinout_moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    status TEXT NOT NULL, reason_code TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE cohort_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL,
    start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled');
  CREATE TABLE company_week_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending');
  CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL,
    revenue_share_bps INTEGER, pushed_at TEXT);
`;

/** `datetime('now')`'s own format — the one every queue table writes. */
function sqlStamp(hoursAgo: number, nowMs: number): string {
  return new Date(nowMs - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** Mid-week-3 of the September 2026 cycle, verified against `openWeekAt`. */
const NOW = Date.parse('2026-09-16T12:00:00Z');

function db(seed = '') {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  addS16Stores(d);
  d.exec("INSERT INTO users (id, name, email) VALUES (1, 'A', 'a@x.test'), (2, 'B', 'b@x.test');");
  d.exec("INSERT INTO branch_licence (id, licence_uid, revenue_share_bps, pushed_at) "
    + "VALUES (1, 'lic_fr', 3500, '2026-09-10T08:00:00Z');");
  if (seed) d.exec(seed);
  return d;
}

/**
 * THE FIXTURE THAT SEPARATES THE TWO ORDERS. Referrals hold FOUR items whose
 * oldest is 5 hours old; moderation holds ONE, 200 hours old. Ordered by count
 * referrals lead; ordered by the oldest item moderation does. Any fixture where
 * the busiest lane is also the oldest cannot tell the two apart, and ordering
 * by count is the mistake this block exists to avoid.
 */
function seedPressure() {
  return `
    INSERT INTO referral_submissions (id, referrer_user_id, referred_name, status, created_at) VALUES
      (20, 1, 'a', 'submitted', '${sqlStamp(5, NOW)}'),
      (21, 1, 'b', 'submitted', '${sqlStamp(4, NOW)}'),
      (22, 1, 'c', 'submitted', '${sqlStamp(3, NOW)}'),
      (23, 1, 'd', 'submitted', '${sqlStamp(2, NOW)}');
    INSERT INTO spinout_moderation_cases (id, user_id, status, reason_code, created_at)
      VALUES (40, 1, 'under_review', 'spam', '${sqlStamp(200, NOW)}');
    INSERT INTO lp_applications (id, user_id, fund_slug, status, created_at)
      VALUES (10, 1, 'f', 'pending', '${sqlStamp(30, NOW)}');
  `;
}

test('queue pressure is ordered by the OLDEST item, never by count', async () => {
  const home = await branchHome({ DB: makeD1(db(seedPressure())) } as any, NOW);
  const order = home.queue_pressure.map((l) => l.key);

  // Moderation holds ONE item and leads; referrals hold FOUR and do not.
  assert.equal(order[0], 'moderation',
    'the lane with the oldest waiting item must come first — ordering by count puts the busiest '
    + 'lane on top, which is the opposite of what the canvas asks for');
  assert.equal(order[1], 'lp');
  assert.equal(order[2], 'referrals');
  // And the counts prove the two orders really do disagree in this fixture,
  // so the assertion above is not passing by coincidence.
  const byKey = Object.fromEntries(home.queue_pressure.map((l) => [l.key, l]));
  assert.equal(byKey.referrals.count, 4);
  assert.equal(byKey.moderation.count, 1);
  assert.ok(byKey.moderation.oldest_age_hours! > byKey.referrals.oldest_age_hours!);
});

test('an unreadable lane sorts FIRST and reports null, never zero', async () => {
  const broken = db(seedPressure());
  broken.exec('DROP TABLE cohort_applicants;');
  const home = await branchHome({ DB: makeD1(broken) } as any, NOW);

  assert.equal(home.queue_pressure[0].key, 'cohort',
    '"I could not look" is the thing an admin most needs to act on, so it outranks every measured lane');
  assert.equal(home.queue_pressure[0].count, null, 'an unreadable lane must not report 0');
  assert.equal(home.queue_pressure[0].sla, 'unknown',
    'calling an unreadable lane ok is the one reading that turns a gap into reassurance');
  assert.deepEqual(home.unreadable, ['Cohort applications'], 'the gap is named, not averaged away');
  // Every other lane still answered — a failure isolates rather than blanking.
  assert.equal(home.queue_pressure.filter((l) => l.count !== null).length, APPROVAL_SOURCES.length - 1);
});

test('a measured EMPTY lane sorts last and is not confused with an unreadable one', async () => {
  const home = await branchHome({ DB: makeD1(db(seedPressure())) } as any, NOW);
  // SEVERAL LANES ARE EMPTY SINCE S16 (D215), so the check is that the empty
  // ones are the tail — every measured zero after every lane with work in it —
  // and that cohort's zero is a measurement, not a gap.
  const firstEmpty = home.queue_pressure.findIndex((l) => l.count === 0);
  assert.ok(firstEmpty > 0, 'the lanes with work in them come first');
  assert.ok(home.queue_pressure.slice(firstEmpty).every((l) => l.count === 0),
    'no lane with work in it sorts after an empty one');
  const cohort = home.queue_pressure.find((l) => l.key === 'cohort')!;
  assert.equal(cohort.count, 0, 'a lane that answered nothing is a measured zero');
  assert.equal(cohort.oldest_age_hours, null, 'with nothing waiting there is no oldest item');
  assert.equal(home.unreadable.length, 0, 'an empty lane is not an unreadable one');
});

test('queue pressure counts what is OPEN, not what the board returned', async () => {
  // THE MISTAKE THIS CATCHES IS THE OBVIOUS WIRING. `approvalBoard` already
  // returns a per-lane figure, so reading it would look right — but that one
  // counts the rows a lane RETURNED, which is `min(open, limit)`. A flooded
  // lane would then report exactly the cap, every time, looking like a
  // measurement. `laneCounts` runs the unbounded `countSql` instead.
  const env = { DB: makeD1(db(seedPressure())) } as any;
  const board = await approvalBoard(env, 2);       // a cap BELOW the referral lane
  const home = await branchHome(env, NOW);

  const boardReferrals = board.lanes.find((l) => l.key === 'referrals')!;
  const pressureReferrals = home.queue_pressure.find((l) => l.key === 'referrals')!;
  assert.equal(boardReferrals.count, 2, 'the board is capped, which is correct for the board');
  assert.equal(pressureReferrals.count, 4,
    'queue pressure must report what is waiting, not what a paginated read happened to return');

  // And the total is the sum of lanes that ANSWERED — 4 referrals + 1
  // moderation + 1 LP, with the empty cohort lane contributing its measured 0.
  assert.equal(home.queue_pressure.reduce((n, l) => n + (l.count ?? 0), 0), 6);
});

test('the programme deadline carries the zone it is enforced in', async () => {
  const home = await branchHome({ DB: makeD1(db()) } as any, NOW);
  assert.equal(home.programme.zone, COHORT_TZ,
    'the zone must be the programme\'s own constant, not a literal that can drift from it');
  assert.equal(home.programme.zone, 'America/New_York');
  assert.equal(home.programme.open_week, 3, 'mid-September 2026 is week 3 of that cycle');
  assert.deepEqual(home.programme.cycle, { year: 2026, month: 9 });
  assert.equal(home.programme.week_closes_at, '2026-09-22T04:00:00.000Z');
  assert.ok(home.programme.hours_to_close! > 0);
});

test('a week boundary belongs to the week that is OPENING, not the one closing', () => {
  // HALF-OPEN, because week N's deadline IS week N+1's unlock. A closed test
  // reports two weeks open for one instant a month, and the page names
  // whichever it happened to find first.
  const close1 = Date.parse('2026-09-08T04:00:00.000Z');
  assert.equal(openWeekAt(close1 - 1).week, 1, 'one millisecond before, week 1 is still open');
  assert.equal(openWeekAt(close1).week, 2, 'at the instant itself, week 2 has opened');
});

test('the days after the fourth deadline belong to no week, and say so', async () => {
  const after = Date.parse('2026-09-30T12:00:00Z');
  const home = await branchHome({ DB: makeD1(db()) } as any, after);
  assert.equal(home.programme.open_week, null);
  assert.equal(home.programme.week_closes_at, null, 'no week open means no deadline to print');
  assert.match(String(home.programme.reason), /no week/i,
    'a null week must carry its reason — a blank would read as the programme having stopped');
  assert.match(String(home.programme.reason), /America\/New_York/,
    'the reason names the zone the windows are cut in, since that is why the days do not line up');
});

test('accounts pending count THIS cycle and THIS week, not every row in the table', async () => {
  const seeded = db(`
    INSERT INTO cohort_cycles (id, year, month, start_at, end_at)
      VALUES (7, 2026, 9, 'x', 'y'), (8, 2026, 8, 'x', 'y');
    INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES
      (1, 7, 3, 'pending'),
      (2, 7, 3, 'pending'),
      (1, 7, 2, 'pending'),   -- an EARLIER week of the same cycle
      (1, 8, 3, 'pending'),   -- the same week of an EARLIER cycle
      (2, 7, 3, 'passed');    -- decided, so not pending
  `);
  const home = await branchHome({ DB: makeD1(seeded) } as any, NOW);
  assert.equal(home.programme.pending_accounts, 2,
    'only rows for cycle 2026-09 week 3 with status pending count — the other three are a different '
    + 'week, a different cycle, or already decided');
});

test('a missing cohort table leaves the count unknown, not zero', async () => {
  const broken = db();
  broken.exec('DROP TABLE company_week_status;');
  const home = await branchHome({ DB: makeD1(broken) } as any, NOW);
  assert.equal(home.programme.open_week, 3, 'the week itself is arithmetic and still known');
  assert.equal(home.programme.pending_accounts, null);
  assert.match(String(home.programme.reason), /unknown rather than zero/);
});

test('the revenue block gives the RATE and refuses an amount', async () => {
  const home = await branchHome({ DB: makeD1(db()) } as any, NOW);
  assert.equal(home.revenue.share_bps, 3500, 'the rate is a licence term HQ pushed, in basis points');
  assert.equal(home.revenue.as_of, '2026-09-10T08:00:00Z', 'a pushed copy is dated or it is not a copy');
  assert.equal(home.revenue.amount_cents, null,
    'no base is totalled on a branch, so an amount here would be invented');
  // The reason must say WHY, naming the streams, or the null reads as a bug.
  assert.match(home.revenue.reason, /Stripe/);
  assert.match(home.revenue.reason, /no onward licence fee/);
  assert.match(home.revenue.reason, /cost rather than revenue/);
});

test('an unreadable licence leaves the rate null and still explains the amount', async () => {
  const broken = db();
  broken.exec('DROP TABLE branch_licence;');
  const home = await branchHome({ DB: makeD1(broken) } as any, NOW);
  assert.equal(home.revenue.share_bps, null, 'an unreadable licence has no rate — not a rate of zero');
  assert.equal(home.revenue.as_of, null);
  assert.equal(home.revenue.amount_cents, null);
  assert.ok(home.revenue.reason.length > 0, 'the amount is still absent for its own reason');
});

test('the SLA bands travel with the digest', async () => {
  const home = await branchHome({ DB: makeD1(db(seedPressure())) } as any, NOW);
  assert.deepEqual(home.sla_bands, { due_soon_hours: 24, past_hours: 72 });
  // 200 hours is past; 5 hours is not. Read from the lanes, so the bands and
  // the rendering cannot disagree.
  const byKey = Object.fromEntries(home.queue_pressure.map((l) => [l.key, l]));
  assert.equal(byKey.moderation.sla, 'past');
  assert.equal(byKey.referrals.sla, 'ok');
  assert.equal(byKey.lp.sla, 'due_soon', '30 hours is past 24 and short of 72');
});
