/**
 * Unit tests for services/spinoutFundMetrics.ts — the pure aggregation logic
 * behind GET /api/spinout-lab/fund-metrics (LP & Investor Workspace live
 * program + raise figures).
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/spinout_fund_metrics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  median,
  summarizeGraduates,
  summarizeLpRows,
} from '../src/services/spinoutFundMetrics.ts';

// ---------------------------------------------------------------- median

test('median: empty list is null', () => {
  assert.equal(median([]), null);
});

test('median: odd and even lengths, unsorted input', () => {
  assert.equal(median([300_000, 50_000, 150_000]), 150_000);
  assert.equal(median([100_000, 400_000]), 250_000);
});

// ---------------------------------------------------- summarizeGraduates

const grad = (
  user_id: number,
  started: string | null,
  completed: string | null,
  funding: number | null = null,
) => ({ user_id, started_at: started, completed_at: completed, total_funding: funding });

test('summarizeGraduates: an empty set is a live zero, still available', () => {
  // `available: false` is reserved for the wire handler's catch (query
  // failed) — a genuine zero-graduate program is a fact, not an outage.
  const s = summarizeGraduates([]);
  assert.equal(s.available, true);
  assert.equal(s.graduates, 0);
  // Every derived figure is null, never 0: "no graduates yet" is not "0% of
  // graduates incorporated on time", and an LP page must not read it that way.
  for (const k of [
    'on_time_pct', 'alumni_raised', 'entrants', 'incorporation_pct',
    'verified_discovery_pct', 'revenue_proof_pct', 'formation_velocity_days',
    'graduation_to_investment_pct',
  ] as const) {
    assert.equal(s[k], null, `${k} must be null for an empty program`);
  }
});

test('summarizeGraduates: dedupes users, counts on-time within the sprint window', () => {
  const s = summarizeGraduates([
    grad(1, '2026-01-01 00:00:00', '2026-01-20 00:00:00', 500_000), // on time (day 20)
    grad(1, '2026-01-01 00:00:00', '2026-01-20 00:00:00', 999_999), // dup project row — ignored
    grad(2, '2026-01-01 00:00:00', '2026-02-15 00:00:00'),          // late (day 45)
  ], 28);
  assert.equal(s.available, true);
  assert.equal(s.graduates, 2);
  assert.equal(s.on_time_pct, 50);
  assert.equal(s.alumni_raised, 500_000);
});

test('summarizeGraduates: missing start dates are excluded from the pct, not counted late', () => {
  const s = summarizeGraduates([
    grad(1, null, '2026-01-20 00:00:00'),
    grad(2, '2026-01-01 00:00:00', '2026-01-10 00:00:00'),
  ], 28);
  assert.equal(s.graduates, 2);
  assert.equal(s.on_time_pct, 100); // only user 2 is measurable

  // No measurable graduate at all → null, never 0 (a data gap is not a 0% program).
  const none = summarizeGraduates([grad(1, null, '2026-01-20 00:00:00')], 28);
  assert.equal(none.on_time_pct, null);
});

test('summarizeGraduates: the 28-day boundary itself is on time', () => {
  const s = summarizeGraduates([
    grad(1, '2026-01-01 00:00:00', '2026-01-29 00:00:00'), // exactly 28 days
  ], 28);
  assert.equal(s.on_time_pct, 100);
});

// ------------------------------------------------------- summarizeLpRows

test('summarizeLpRows: splits committed (lpa_signed) from soft-circled', () => {
  const s = summarizeLpRows([
    { commitment_amount: 250_000, lpa_signed: 1 },
    { commitment_amount: 100_000, lpa_signed: 1 },
    { commitment_amount: 150_000, lpa_signed: 0 },
    { commitment_amount: 0, lpa_signed: 1 },      // no ticket — counted as an LP row only
    { commitment_amount: null, lpa_signed: null },
  ]);
  assert.equal(s.committed, 350_000);
  assert.equal(s.soft_circled, 150_000);
  assert.equal(s.lp_count, 5);
  assert.equal(s.median_commitment, 150_000);
});

test('summarizeLpRows: empty fund yields zeros and a null median', () => {
  assert.deepEqual(summarizeLpRows([]), {
    committed: 0, soft_circled: 0, lp_count: 0, median_commitment: null,
  });
});

// ------------------------------------------- studio-throughput tiles (#3)
//
// Five figures on the LP sales page's proof strip. Each is null unless its
// evidence column AND its denominator are present, because the page renders
// null as its operator-maintained fallback with a provenance caption — and a
// missing column rendering as 0% would be a false claim in front of an LP.

const rich = (user_id: number, extra: Record<string, unknown> = {}) => ({
  user_id,
  started_at: '2026-01-01 00:00:00',
  completed_at: '2026-01-20 00:00:00',
  total_funding: null,
  ...extra,
});

test('incorporation rate is graduates over ENTRANTS, not over graduates', () => {
  // Graduates are *defined* by the incorporation milestone, so graduates ÷
  // graduates is 100% by construction — a meaningless number to show an LP.
  const s = summarizeGraduates([rich(1), rich(2)], 28, 8);
  assert.equal(s.entrants, 8);
  assert.equal(s.incorporation_pct, 25);
});

test('incorporation rate is null when the entrant count is unknown or impossible', () => {
  assert.equal(summarizeGraduates([rich(1)], 28, null).incorporation_pct, null);
  assert.equal(summarizeGraduates([rich(1)], 28, 0).incorporation_pct, null);
  // More graduates than entrants means the entrant query is wrong; reporting
  // >100% would be worse than reporting nothing.
  assert.equal(summarizeGraduates([rich(1), rich(2)], 28, 1).incorporation_pct, null);
});

test('verified discovery counts graduates at or above the week-1 interview bar', () => {
  const s = summarizeGraduates([
    rich(1, { interview_count: 5 }),   // exactly the bar — counts
    rich(2, { interview_count: 18 }),
    rich(3, { interview_count: 4 }),   // under
    rich(4, { interview_count: 0 }),   // logged none, still measured
  ], 28);
  assert.equal(s.verified_discovery_pct, 50);
});

test('an unselected evidence column leaves its percentage null, not zero', () => {
  // The query that does not select interview_count / backed must not make the
  // program look like 0% discovery and 0% backed.
  const s = summarizeGraduates([rich(1), rich(2)], 28, 4);
  assert.equal(s.verified_discovery_pct, null);
  assert.equal(s.graduation_to_investment_pct, null);
  assert.equal(s.revenue_proof_pct, null);
});

test('revenue proof reads any of the four ways the product records it', () => {
  const s = summarizeGraduates([
    rich(1, { revenue: 12_800 }),                    // Stripe/total
    rich(2, { mrr: 800 }),                           // MRR
    rich(3, { paying_customers: 2 }),                // paying customers
    rich(4, { paid_pilot_status: 'pilot_paid' }),    // explicit status
    rich(5, { paid_pilot_status: 'pre_revenue' }),   // answered "no" — denominator
    rich(6, { revenue: 0, mrr: 0 }),                 // recorded zeros — denominator
  ], 28);
  // 4 proven of 6 measured.
  assert.equal(s.revenue_proof_pct, 67);
});

test('a founder who answered "pre_revenue" counts in the denominator', () => {
  // Otherwise the percentage only ever surveys companies that already have
  // revenue, and reads 100% for a program with one paying company.
  const only = summarizeGraduates([rich(1, { paid_pilot_status: 'pre_revenue' })], 28);
  assert.equal(only.revenue_proof_pct, 0);
});

test('formation velocity is the MEDIAN days from Lab start to incorporation', () => {
  const s = summarizeGraduates([
    { user_id: 1, started_at: '2026-01-01 00:00:00', completed_at: '2026-01-21 00:00:00', total_funding: null }, // 20
    { user_id: 2, started_at: '2026-01-01 00:00:00', completed_at: '2026-01-25 00:00:00', total_funding: null }, // 24
    { user_id: 3, started_at: '2026-01-01 00:00:00', completed_at: '2026-02-10 00:00:00', total_funding: null }, // 40
  ], 28);
  assert.equal(s.formation_velocity_days, 24);
  // Unmeasurable starts contribute nothing rather than a zero-day formation.
  const gap = summarizeGraduates([{ user_id: 1, started_at: null, completed_at: '2026-01-21 00:00:00', total_funding: null }], 28);
  assert.equal(gap.formation_velocity_days, null);
});

test('graduation to investment counts graduates the fund actually holds', () => {
  const s = summarizeGraduates([
    rich(1, { backed: 1 }),
    rich(2, { backed: 2 }),   // several positions in one company is still one company
    rich(3, { backed: 0 }),
    rich(4, { backed: 0 }),
  ], 28);
  assert.equal(s.graduation_to_investment_pct, 50);
});

test('duplicate project rows never inflate an evidence percentage', () => {
  // The graduate query LEFT JOINs projects; a user with two project rows must
  // still be one graduate with one set of evidence.
  const s = summarizeGraduates([
    rich(1, { interview_count: 9, backed: 1 }),
    rich(1, { interview_count: 0, backed: 0 }),   // dup — ignored
    rich(2, { interview_count: 0, backed: 0 }),
  ], 28, 2);
  assert.equal(s.graduates, 2);
  assert.equal(s.verified_discovery_pct, 50);
  assert.equal(s.graduation_to_investment_pct, 50);
  assert.equal(s.incorporation_pct, 100);
});
