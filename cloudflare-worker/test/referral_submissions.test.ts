/**
 * Referral submissions — pipeline logic + the Stripe Connect removal guard.
 *
 * Two things are pinned here.
 *
 * 1. The pipeline rules that are easy to get subtly wrong: the CSV parser's
 *    tolerance, the invite-only gate on strategic introductions, and the
 *    "converted" tally. That tally is the interesting one — counting only
 *    `status = 'converted'` would make the number go DOWN when a referral
 *    succeeds further and moves to a reward state, which reads to a user as
 *    the platform losing their conversion.
 *
 * 2. That Stripe Connect stays gone. The payouts backend was removed
 *    deliberately (rewards are milestone labels settled off-platform), and the
 *    failure mode of a partial revert is severe and quiet: a reintroduced
 *    import would resurrect a payout ledger that nothing pays out. The
 *    source-level assertions below are cheap and catch that immediately.
 *
 * Run via the strip-types loader (see package.json test:worker).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  parseCsv,
  countsForReferrer,
  createSubmission,
  isCategory,
  isStatus,
  toWire,
  STATUS_LABELS,
  CATEGORY_META,
  ReferralError,
  CSV_IMPORT_LIMIT,
  avgReviewDaysForReferrer,
  PRE_VERDICT_STATUSES,
  VERDICT_STATUSES,
  STATUSES,
} from '../src/services/referralSubmissions.ts';

const root = resolve(import.meta.dirname, '..');

/** Minimal D1 stub: enough to drive the gate + counts paths. */
function stubEnv(opts: { strategic?: string | null; counts?: Array<{ status: string; n: number }> } = {}) {
  const inserted: Array<{ sql: string; binds: unknown[] }> = [];
  return {
    env: {
      // Production short-circuits the schema bootstrap, which is what we want:
      // the tests exercise logic, not DDL.
      ENVIRONMENT: 'production',
      DB: {
        prepare(sql: string) {
          return {
            bind(...binds: unknown[]) {
              return {
                async first() {
                  if (/FROM referral_strategic_access/.test(sql)) {
                    return opts.strategic ? { status: opts.strategic } : null;
                  }
                  if (/FROM referral_submissions WHERE uid/.test(sql)) {
                    return {
                      id: 1, uid: String(binds[0]), referrer_user_id: 7,
                      category: 'startup', referred_name: 'Elena Voss',
                      referred_org: null, referred_contact: null, your_role: null,
                      context: null, status: 'submitted', reward_label: null,
                      next_step: null, fit_notes: null, source: 'form',
                      created_at: 'now', updated_at: 'now',
                    };
                  }
                  return null;
                },
                async all() {
                  if (/GROUP BY status/.test(sql)) return { results: opts.counts || [] };
                  return { results: [] };
                },
                async run() { inserted.push({ sql, binds }); return { success: true }; },
              };
            },
          };
        },
      },
    } as never,
    inserted,
  };
}

test('parseCsv tolerates headers, quotes, CRLF and blank lines', () => {
  const rows = parseCsv(
    'name,org,context\r\n' +
    '"Elena Voss","Fractional CPO","Strong GTM complement"\r\n' +
    '\r\n' +
    'Marcus Reyes,Halyard,Solo technical founder\r\n',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    name: 'Elena Voss', org: 'Fractional CPO', context: 'Strong GTM complement',
  });
  assert.equal(rows[1].name, 'Marcus Reyes');
});

test('parseCsv keeps a first row that is not a header', () => {
  const rows = parseCsv('Elena Voss,Fractional CPO,Context here');
  assert.equal(rows.length, 1, 'a data-only CSV must not lose its first row');
  assert.equal(rows[0].name, 'Elena Voss');
});

test('parseCsv drops rows with no name', () => {
  assert.equal(parseCsv('name,org\n,Acme\n,Beta').length, 0);
});

test('parseCsv returns [] for empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('   \n  \n'), []);
});

test('strategic introductions are refused without granted access', async () => {
  for (const state of [null, 'requested', 'declined']) {
    const { env } = stubEnv({ strategic: state });
    await assert.rejects(
      () => createSubmission(env, 7, { category: 'strategic', referredName: 'Arcline Capital' }),
      (e: unknown) => e instanceof ReferralError && e.code === 'invite_only' && e.httpStatus === 403,
      `strategic must be refused when access is ${state ?? 'absent'}`,
    );
  }
});

test('strategic introductions are allowed once access is granted', async () => {
  const { env, inserted } = stubEnv({ strategic: 'granted' });
  const row = await createSubmission(env, 7, {
    category: 'strategic', referredName: 'Arcline Capital',
  });
  assert.equal(row.uid.startsWith('rs_'), true);
  assert.equal(
    inserted.some((i) => /INSERT INTO referral_submissions/.test(i.sql)), true,
  );
});

test('open categories need no access grant', async () => {
  const { env } = stubEnv({ strategic: null });
  const row = await createSubmission(env, 7, { category: 'startup', referredName: 'Kelp Bio' });
  assert.ok(row.uid);
});

test('a referral with no name is refused', async () => {
  const { env } = stubEnv();
  await assert.rejects(
    () => createSubmission(env, 7, { category: 'startup', referredName: '   ' }),
    (e: unknown) => e instanceof ReferralError && e.code === 'missing_name',
  );
});

test('an unknown category is refused', async () => {
  const { env } = stubEnv();
  await assert.rejects(
    () => createSubmission(env, 7, { category: 'nonsense' as never, referredName: 'X' }),
    (e: unknown) => e instanceof ReferralError && e.code === 'bad_category',
  );
});

test('creating a submission appends an opening timeline event', async () => {
  const { env, inserted } = stubEnv();
  await createSubmission(env, 7, { category: 'startup', referredName: 'Kelp Bio' });
  const event = inserted.find((i) => /INSERT INTO referral_submission_events/.test(i.sql));
  assert.ok(event, 'a submission must open its own history');
  assert.equal(event!.binds[1], 'Submitted', 'the event carries the display label');
});

test('converted count is cumulative across downstream reward states', async () => {
  const { env } = stubEnv({
    counts: [
      { status: 'submitted', n: 3 },
      { status: 'converted', n: 1 },
      { status: 'reward_eligible', n: 2 },
      { status: 'reward_issued', n: 4 },
    ],
  });
  const c = await countsForReferrer(env, 7);
  assert.equal(c.total, 10);
  // Not 1: a referral that progressed past 'converted' is still converted.
  assert.equal(c.converted, 7);
  assert.equal(c.rewardIssued, 4);
});

test('counts are zero-safe for a referrer with no submissions', async () => {
  const { env } = stubEnv({ counts: [] });
  const c = await countsForReferrer(env, 7);
  assert.deepEqual(
    { total: c.total, converted: c.converted, rewardIssued: c.rewardIssued },
    { total: 0, converted: 0, rewardIssued: 0 },
  );
});

test('every status has a display label and every category has metadata', () => {
  for (const s of Object.keys(STATUS_LABELS)) assert.equal(isStatus(s), true);
  for (const k of Object.keys(CATEGORY_META)) assert.equal(isCategory(k), true);
  assert.equal(isStatus('paid'), false, 'retired payout statuses are not pipeline statuses');
  assert.equal(isCategory('payout'), false);
});

test('toWire exposes display labels and hides internal ids', () => {
  const wire = toWire({
    id: 99, uid: 'rs_abc', referrer_user_id: 7, category: 'startup',
    referred_name: 'Elena Voss', referred_org: null, referred_contact: null,
    your_role: null, context: null, status: 'under_review', reward_label: null,
    next_step: null, fit_notes: null, source: 'form',
    created_at: 'now', updated_at: 'now',
  } as never);
  assert.equal(wire.status_label, 'Under review');
  assert.equal(wire.category_name, CATEGORY_META.startup.name);
  assert.equal('id' in wire, false, 'the numeric id must not reach the client');
  assert.equal('referrer_user_id' in wire, false);
});

test('the CSV import cap is a real bound', () => {
  assert.ok(CSV_IMPORT_LIMIT > 0 && CSV_IMPORT_LIMIT <= 500);
});

// ---------------------------------------------------------------------------
// Stripe Connect removal guards
// ---------------------------------------------------------------------------

test('the Stripe Connect payouts service stays deleted', async () => {
  await assert.rejects(
    () => readFile(resolve(root, 'src/services/referralPayouts.ts'), 'utf8'),
    'referralPayouts.ts was removed with the payouts backend and must not return',
  );
});

test('no worker source imports the removed payouts service', async () => {
  const files = [
    'src/index.ts',
    'src/routes/billing.ts',
    'src/routes/admin_billing.ts',
    'src/routes/network.ts',
    'src/routes/refer_earn.ts',
  ];
  for (const f of files) {
    const src = await readFile(resolve(root, f), 'utf8');
    assert.doesNotMatch(
      src,
      /from '\.\.?\/(services\/)?referralPayouts'/,
      `${f} must not import the removed payouts service`,
    );
  }
});

test('refunds still reverse the referral commission', async () => {
  // The clawback moved off the Connect ledger onto `commissions` directly.
  // Losing it entirely would let a referrer keep credit for refunded revenue.
  const src = await readFile(resolve(root, 'src/routes/admin_billing.ts'), 'utf8');
  assert.match(src, /clawbackReferralCommissionForRefund/);
  assert.match(src, /from '\.\.\/services\/referralCommissions'/);
});

// ---------------------------------------------------------------------------
// Avg. review time
// ---------------------------------------------------------------------------

/**
 * A D1 stub that answers the review-time join with whatever rows are handed in.
 *
 * `avgReviewDaysForReferrer` filters and aggregates in TypeScript rather than in
 * SQL (see its docblock — building an `IN (…)` list means interpolating into
 * `DB.prepare`, which `check-sql-prepare.mjs` rejects). That is exactly why it
 * is worth testing here: the selection rules ARE the implementation, and none of
 * them would be exercised by a query the database evaluates.
 */
function reviewEnv(rows: Array<{
  submission_id: number; submitted_at: string | null;
  event_status: string | null; event_at: string | null;
}>) {
  return {
    ENVIRONMENT: 'production',
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (/JOIN referral_submission_events/.test(sql)) return { results: rows };
                return { results: [] };
              },
              async first() { return null; },
              async run() { return { success: true }; },
            };
          },
        };
      },
    },
  } as never;
}

const DAY = (n: number) => `2026-01-${String(n).padStart(2, '0')} 00:00:00`;

test('avg review time: null when nothing has reached a verdict', async () => {
  // The honest answer to "how long does review take" before any review has
  // finished is not zero — it is that nothing has been measured. The page turns
  // this null into "Not recorded"; returning 0 would print "0 days".
  assert.equal(await avgReviewDaysForReferrer(reviewEnv([]), 7), null);
  assert.equal(
    await avgReviewDaysForReferrer(reviewEnv([
      { submission_id: 1, submitted_at: DAY(1), event_status: 'under_review', event_at: DAY(3) },
      { submission_id: 1, submitted_at: DAY(1), event_status: 'more_info_needed', event_at: DAY(9) },
    ]), 7),
    null,
    'a referral still in review must not count as decided',
  );
});

test('avg review time: measures to the EARLIEST verdict, not the latest event', async () => {
  // A submission qualifies on day 3 and converts on day 30. Review took two
  // days; the pipeline took twenty-nine. Taking the last event would report the
  // second number under the first name.
  const days = await avgReviewDaysForReferrer(reviewEnv([
    { submission_id: 1, submitted_at: DAY(1), event_status: 'submitted', event_at: DAY(1) },
    { submission_id: 1, submitted_at: DAY(1), event_status: 'converted', event_at: DAY(30) },
    { submission_id: 1, submitted_at: DAY(1), event_status: 'qualified', event_at: DAY(3) },
  ]), 7);
  assert.equal(days, 2);
});

test('avg review time: averages over submissions, not over events', async () => {
  // One submission with four verdict events and one with a single event must
  // weigh the same. Averaging rows would let a chatty referral dominate.
  const days = await avgReviewDaysForReferrer(reviewEnv([
    { submission_id: 1, submitted_at: DAY(1), event_status: 'qualified', event_at: DAY(3) },
    { submission_id: 1, submitted_at: DAY(1), event_status: 'in_conversation', event_at: DAY(4) },
    { submission_id: 1, submitted_at: DAY(1), event_status: 'converted', event_at: DAY(5) },
    { submission_id: 1, submitted_at: DAY(1), event_status: 'reward_issued', event_at: DAY(6) },
    { submission_id: 2, submitted_at: DAY(1), event_status: 'rejected', event_at: DAY(9) },
  ]), 7);
  // (2 + 8) / 2 = 5, not the row-weighted 3.2.
  assert.equal(days, 5);
});

test('avg review time: skips rows that cannot be believed', async () => {
  // A verdict stamped before its own submission is impossible in the write path,
  // so it is corrupt rather than fast — averaging -6 days in would drag a real
  // figure toward a lie. An unparseable timestamp is dropped for the same
  // reason. What survives here is the one good pair: day 1 → day 5.
  const days = await avgReviewDaysForReferrer(reviewEnv([
    { submission_id: 1, submitted_at: DAY(10), event_status: 'rejected', event_at: DAY(4) },
    { submission_id: 2, submitted_at: 'not a date', event_status: 'converted', event_at: DAY(4) },
    { submission_id: 3, submitted_at: DAY(1), event_status: null, event_at: DAY(4) },
    { submission_id: 4, submitted_at: DAY(1), event_status: 'qualified', event_at: DAY(5) },
  ]), 7);
  assert.equal(days, 4);
});

test('avg review time: sub-day spans survive as fractions', async () => {
  // A same-day verdict is a real measurement, not a zero. The page renders
  // anything under a day to one decimal for exactly this reason.
  const days = await avgReviewDaysForReferrer(reviewEnv([
    { submission_id: 1, submitted_at: '2026-01-01 00:00:00', event_status: 'qualified', event_at: '2026-01-01 06:00:00' },
  ]), 7);
  assert.equal(days, 0.25);
});

test('every pre-verdict status is a real status, and some status is not pre-verdict', () => {
  for (const s of PRE_VERDICT_STATUSES) {
    assert.ok((STATUSES as readonly string[]).includes(s),
      `PRE_VERDICT_STATUSES names '${s}', which is not a status — the real one would then count as a verdict`);
  }
  assert.ok(VERDICT_STATUSES.length > 0, 'no status can ever end review');
  assert.equal(VERDICT_STATUSES.length + PRE_VERDICT_STATUSES.size, STATUSES.length);
});
