/**
 * The approvals read model, and the two readers that must not drift (D130).
 *
 * WHAT THIS FILE IS FOR. The board and H1's backlog count answer the same
 * question — what is open across the four local queues — from what used to be
 * two separately-written lists. `backlogOf`'s own comment records what that
 * risk costs: *"Two of the four table names in the first draft of this
 * function were wrong, which would not have failed — it would have reported
 * the backlog as permanently unreadable, a plausible-looking answer that is
 * never right."* A wrong table in ONE of two lists is worse still: both
 * surfaces render, and they quietly disagree.
 *
 * So the first test is the one that matters: the board's rows and the backlog's
 * count come from the same predicate, asserted by seeding rows that sit on
 * either side of every status boundary and checking the two agree on the
 * number. It fails if either reader is changed alone.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_approvals_d130.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

import {
  APPROVAL_SOURCES,
  approvalBoard,
  ageHours,
  slaFor,
  REFERRAL_OPEN_STATUSES,
  SLA_DUE_SOON_HOURS,
  SLA_PAST_HOURS,
} from '../src/services/approvalSources.ts';

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

/**
 * The four source tables in the shapes production has, plus `users` for the
 * joins. Column sets are trimmed to what the read model touches — a fixture
 * that invented columns would pass against a query production cannot run.
 */
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
`;

/** `datetime('now')`'s own format — the one every one of the four writes. */
function sqlStamp(hoursAgo: number, nowMs: number): string {
  return new Date(nowMs - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

const NOW = Date.parse('2026-09-16T12:00:00Z');

function db(seed = '') {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  d.exec(`INSERT INTO users (id, name, email) VALUES
    (1, 'Aurélie Chen', 'a@x.test'), (2, '', 'blank@x.test'), (3, 'Ben', 'b@x.test');`);
  if (seed) d.exec(seed);
  return d;
}

/** One open row in each lane, at four different ages. */
function seedAllFour() {
  return `
    INSERT INTO lp_applications (id, user_id, fund_slug, status, created_at)
      VALUES (10, 1, 'spinout-fund-i', 'pending', '${sqlStamp(80, NOW)}'),
             (11, 3, 'spinout-fund-i', 'approved', '${sqlStamp(200, NOW)}');
    INSERT INTO referral_submissions (id, referrer_user_id, referred_name, status, created_at)
      VALUES (20, 3, 'Acme', 'submitted', '${sqlStamp(30, NOW)}'),
             (21, 3, 'Drafted', 'draft',   '${sqlStamp(500, NOW)}'),
             (22, 3, 'Closed',  'closed',  '${sqlStamp(500, NOW)}');
    INSERT INTO cohort_applicants (id, user_id, status, created_at)
      VALUES (30, 2, 'pending', '${sqlStamp(10, NOW)}'),
             (31, 3, 'accepted', '${sqlStamp(400, NOW)}');
    INSERT INTO spinout_moderation_cases (id, user_id, status, reason_code, created_at)
      VALUES (40, 3, 'under_review', 'spam',  '${sqlStamp(100, NOW)}'),
             (41, 3, 'active',       'other', '${sqlStamp(400, NOW)}'),
             -- TWO resolved rows, not one, and that is the whole reason this
             -- line exists. With one open and one resolved, swapping the
             -- predicate from 'under_review' to 'active' leaves the count at 1
             -- and every assertion here passes — the mutation check found
             -- exactly that. A fixture that cannot tell the two predicates
             -- apart is not testing the predicate.
             (42, 3, 'active',       'other', '${sqlStamp(300, NOW)}');
  `;
}

test('the board reads every lane, and only what is actually open', async () => {
  const env = { DB: makeD1(db(seedAllFour())) } as any;
  const board = await approvalBoard(env, 100, NOW);

  assert.equal(board.unreadable.length, 0, 'every fixture table exists, so nothing is unreadable');
  assert.equal(board.items.length, 4, 'exactly one row per lane is open');

  // THE EXCLUSIONS ARE THE POINT, and each is a different rule:
  //   · `approved` LP — a decided row is not backlog;
  //   · `draft` referral — belongs to the member still writing it;
  //   · `closed` referral — past the verdict;
  //   · `accepted` cohort applicant — decided;
  //   · `active` moderation — RESOLVED, despite the hopeful-sounding word.
  const ids = board.items.map((i) => `${i.lane}:${i.id}`).sort();
  assert.deepEqual(ids, ['cohort:30', 'lp:10', 'moderation:40', 'referrals:20']);
});

test('oldest first, because that is the board\'s one claim', async () => {
  const env = { DB: makeD1(db(seedAllFour())) } as any;
  const board = await approvalBoard(env, 100, NOW);
  assert.deepEqual(
    board.items.map((i) => i.lane),
    ['moderation', 'lp', 'referrals', 'cohort'],
    'S3 exists so an admin can ask "what is oldest anywhere"; any other order defeats it',
  );
  // And the ages are real rather than a rank.
  assert.ok(board.items[0].age_hours! > board.items[3].age_hours!);
});

test('a name-less account still shows a person, never a blank cell', async () => {
  const env = { DB: makeD1(db(seedAllFour())) } as any;
  const board = await approvalBoard(env, 100, NOW);
  const cohort = board.items.find((i) => i.lane === 'cohort')!;
  assert.equal(cohort.who, 'blank@x.test',
    'a row whose user has an empty name must fall back to the email — an empty cell reads as a row with nobody attached');
});

test('one unreadable lane keeps the others and names the gap', async () => {
  // The board's honesty rule DIFFERS from the backlog count's, deliberately.
  // A missing lane does not blank the board: the rows that could be read are
  // real work somebody should see. What it must not do is pretend the lane
  // was empty.
  const broken = db(seedAllFour());
  broken.exec('DROP TABLE cohort_applicants;');
  const board = await approvalBoard({ DB: makeD1(broken) } as any, 100, NOW);

  assert.deepEqual(board.unreadable, ['Cohort applications']);
  assert.equal(board.items.length, 3, 'the other three lanes still answered');
  const cohortLane = board.lanes.find((l) => l.key === 'cohort')!;
  assert.equal(cohortLane.count, null, 'an unreadable lane must not report 0');
  assert.match(String(board.reason), /Cohort applications/, 'the reason must name the lane');
  assert.match(String(board.reason), /rather than a zero/);
});

test('the SLA bands are the canvas\'s, and the boundary is inclusive', () => {
  assert.equal(SLA_DUE_SOON_HOURS, 24);
  assert.equal(SLA_PAST_HOURS, 72);
  // Asserted AT the boundary in both directions. A band tested only at 0 and
  // 1000 hours passes however the comparison is written.
  assert.equal(slaFor(SLA_DUE_SOON_HOURS - 0.01), 'ok');
  assert.equal(slaFor(SLA_DUE_SOON_HOURS), 'due_soon');
  assert.equal(slaFor(SLA_PAST_HOURS - 0.01), 'due_soon');
  assert.equal(slaFor(SLA_PAST_HOURS), 'past');
  assert.equal(slaFor(null), 'unknown', 'an unparseable stamp is unknown, never ok');
});

test('a SQL stamp is read as UTC even when the machine is not', () => {
  // THIS RUNS IN A CHILD PROCESS WITH A NON-UTC TZ, AND THAT IS THE WHOLE
  // POINT. The in-process version of this assertion CANNOT FAIL here: CI and
  // this container both run TZ=UTC, so `Date.parse('… 09:00:00')` (local) and
  // `Date.parse('… 09:00:00Z')` agree exactly, and dropping the `Z` changes
  // nothing any assertion can see. The mutation check found that — an
  // assertion that cannot fail on the machines that run it is not a guard,
  // which this repo has now re-learned three times.
  //
  // Under Asia/Tokyo (+9) the two readings differ by nine hours, so a stamp
  // three hours old reads as six hours in the FUTURE and clamps to 0.
  const script =
    "import { ageHours } from './cloudflare-worker/src/services/approvalSources.ts';"
    + "const now = Date.parse('2026-09-16T12:00:00Z');"
    + "process.stdout.write(String(ageHours('2026-09-16 09:00:00', now)));";
  // `--import ./cloudflare-worker/test/_ts-loader.mjs` is not optional: the
  // module under test imports `./referralSubmissions` with no extension, which
  // only resolves through that hook. The same flag every worker test runs with.
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types', '--no-warnings',
      '--import', './cloudflare-worker/test/_ts-loader.mjs',
      '--input-type=module', '--eval', script,
    ],
    { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8', cwd: process.cwd() },
  );
  assert.equal(out.trim(), '3',
    'a SQL stamp was read as local time: on a machine east of UTC the row reads hours younger '
    + 'or older than it is, and a board ordered by age cannot survive that');
});

test('the stamp formats each source actually writes are all handled', () => {
  // THE TRAP THIS EXISTS FOR. `created_at` is `datetime('now')` — no zone —
  // and `Date.parse` reads that as LOCAL. On a Worker local IS UTC so the bug
  // hides; on a developer's machine every row would be hours out, and a board
  // ordered by age cannot survive that. Same ISO-vs-SQL class as D122 and D125.
  const nowMs = Date.parse('2026-09-16T12:00:00Z');
  assert.equal(ageHours('2026-09-16 09:00:00', nowMs), 3);
  // An explicit zone is honoured rather than double-stamped.
  assert.equal(ageHours('2026-09-16T09:00:00Z', nowMs), 3);
  assert.equal(ageHours('', nowMs), null);
  assert.equal(ageHours('not a date', nowMs), null);
  // A stamp in the future clamps at 0 rather than going negative and sorting
  // above genuinely old work.
  assert.equal(ageHours('2026-09-16 13:00:00', nowMs), 0);
});

test('an unknown age sorts LAST, never first', async () => {
  const seeded = db(`
    INSERT INTO lp_applications (id, user_id, fund_slug, status, created_at)
      VALUES (10, 1, 'f', 'pending', 'not a date'),
             (11, 1, 'f', 'pending', '${sqlStamp(5, NOW)}');
  `);
  const board = await approvalBoard({ DB: makeD1(seeded) } as any, 100, NOW);
  assert.equal(board.items[0].id, 11, 'the row with a real age comes first');
  assert.equal(board.items[1].age_hours, null);
  assert.equal(board.items[1].sla, 'unknown',
    'a row whose age is unknown must not be presented as the most urgent thing on the screen');
});

test('the board and the backlog count agree, because they read one list', async () => {
  // THE DRIFT TEST. `backlogOf` in `rpc/branchOps.ts` used to declare its own
  // four sources. Both now read `APPROVAL_SOURCES`, and this asserts the
  // consequence rather than the refactor: the number above the board equals
  // the rows in it, on a fixture built to span every status boundary.
  const shared = db(seedAllFour());
  const env = { DB: makeD1(shared) } as any;
  const board = await approvalBoard(env, 100, NOW);

  // The COUNT query `backlogOf` runs, assembled the same way from the same list.
  let counted = 0;
  for (const s of APPROVAL_SOURCES) {
    const row = await env.DB.prepare(s.countSql).first();
    counted += Number(row?.n) || 0;
  }
  assert.equal(counted, board.items.length,
    'the backlog count and the board disagree, which means they are no longer one definition of open');
  assert.equal(counted, 4);
});

test('a row whose account is gone is still counted and still shown', async () => {
  // THE DEFECT THIS REPRODUCES IS ONE THIS PR ALREADY SHIPPED ONCE. The first
  // draft of the shared source list had ONE `from` clause serving both queries,
  // and it joined `users` — so the backlog TOTAL depended on the join, and an
  // application whose account row had been deleted silently left the number.
  // `branch_rpc_fanout.test.ts` caught it. The fix separated the predicate from
  // the projection: the count joins nothing, the rows join LEFT.
  //
  // Two mutations have to fail here and neither is lexical:
  //   · a JOIN in `countSql` — the orphan stops being counted;
  //   · `LEFT JOIN` → `JOIN` in `rowsSql` — the orphan stops being SHOWN,
  //     which is the half the interpolation test cannot see at all.
  const seeded = db(`
    INSERT INTO lp_applications (id, user_id, fund_slug, status, created_at)
      VALUES (50, 99, 'spinout-fund-i', 'pending', '${sqlStamp(12, NOW)}');
  `);
  const env = { DB: makeD1(seeded) } as any;
  const board = await approvalBoard(env, 100, NOW);

  assert.equal(board.items.length, 1,
    'the application is open work whether or not the account behind it still exists');
  assert.equal(board.items[0].who, 'account 99',
    'with no user row to read a name from, the row names the account id rather than rendering blank');

  const row = await env.DB.prepare(APPROVAL_SOURCES.find((s) => s.key === 'lp')!.countSql).first();
  assert.equal(Number(row?.n), 1,
    'the backlog count dropped a row because its account is gone — the total now depends on a join');
});

test('the limit bounds each lane, not the board', async () => {
  // A flooded queue must not crowd the other three off a screen whose whole
  // purpose is "what is oldest anywhere".
  const rows = Array.from({ length: 6 }, (_, i) =>
    `(${100 + i}, 1, 'f', 'pending', '${sqlStamp(50 + i, NOW)}')`).join(',');
  const seeded = db(`
    INSERT INTO lp_applications (id, user_id, fund_slug, status, created_at) VALUES ${rows};
    INSERT INTO cohort_applicants (id, user_id, status, created_at)
      VALUES (30, 1, 'pending', '${sqlStamp(1, NOW)}');
  `);
  const board = await approvalBoard({ DB: makeD1(seeded) } as any, 2, NOW);
  assert.equal(board.items.filter((i) => i.lane === 'lp').length, 2, 'the LP lane is capped');
  assert.equal(board.items.filter((i) => i.lane === 'cohort').length, 1,
    'the cohort lane still appears — the cap is per lane, not a global slice');
});

test('the referral statuses written into the SQL are the route\'s own set', () => {
  // THE PAIRING THAT MAKES A LITERAL SAFE. `check-sql-prepare` refuses a `${}`
  // inside a prepare template, so the status list is spelled out in the SQL —
  // and a spelled-out list drifts silently from `PRE_VERDICT_STATUSES` the day
  // somebody adds a status to the referral route. This is what stops that: the
  // same shape D127 used, where `branch_seats_from_role.test.ts` parses
  // migration 187's CHECK and asserts `SEAT_ROLES` equals it.
  //
  // Both sources are parsed rather than typed here. Asserting against a
  // hardcoded array would just move the drift into this file.
  const src = APPROVAL_SOURCES.find((s) => s.key === 'referrals')!;
  const fromSql = [...src.countSql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    fromSql,
    [...REFERRAL_OPEN_STATUSES].sort(),
    'the referral statuses in the SQL no longer match PRE_VERDICT_STATUSES minus draft — '
    + 'a status was added to the route and the board stopped seeing it, or vice versa',
  );
  // And the rows query must agree with the count query, or the board would
  // show rows the number above it does not count.
  const rowsSql = [...src.rowsSql.matchAll(/'(submitted|under_review|more_info_needed|draft|closed|qualified)'/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual(rowsSql, fromSql, 'the referral count and rows queries use different status sets');
  // `draft` is excluded on purpose, and this is the assertion that says so.
  assert.ok(!fromSql.includes('draft'),
    'a draft referral belongs to the member still writing it and is not reviewer backlog');
});

test('no source SQL carries an interpolation', () => {
  // `check-sql-prepare` enforces this at build time; this asserts the PROPERTY
  // rather than the guard, so the rule survives somebody running the guard's
  // `--write` escape hatch. A `${` surviving into a query string means a value
  // reached the query TEXT.
  for (const s of APPROVAL_SOURCES) {
    assert.ok(!s.countSql.includes('${'), `${s.key}: the count query carries an interpolation`);
    assert.ok(!s.rowsSql.includes('${'), `${s.key}: the rows query carries an interpolation`);
    // The cap is BOUND, not spliced.
    assert.match(s.rowsSql, /LIMIT \?$/, `${s.key}: the row limit must be a bound parameter`);
    assert.doesNotMatch(s.countSql, /JOIN/, `${s.key}: a join in the count makes the total depend on it`);
  }
});
