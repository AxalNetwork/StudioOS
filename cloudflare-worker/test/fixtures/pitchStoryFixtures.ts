/**
 * D897 §9 (#3659) — what a venture's records could hold, for the composer's
 * tests and for rendering a generated deck for review: full, sparse and
 * conflicting. SYNTHETIC: every figure, date and name is made up; none is a
 * real venture's.
 *
 * The shapes are `readSources` items (D896) and `readAllSeries` series
 * (D898 group C), so the composer reads them exactly as it reads the stores.
 */
const HASH = 'f00dfacecafebeef01234567';
const recorded = (source_key: string, label: string, value: number | string, unit: string, grade = 'Measured', of: number | null = null) =>
  ({ source_key, area: source_key.split('.')[0], module: 'Synthetic', label, value, unit, of, as_of: '2026-10-01', grade, source: 'Recorded', href: '/', record_ref: `fixture:${source_key}`, snapshot_hash: HASH, state: 'recorded' });
const missing = (source_key: string, label: string, unit: string) =>
  ({ source_key, area: source_key.split('.')[0], module: 'Synthetic', label, value: null, unit, of: null, as_of: null, grade: 'Not recorded', source: null, href: '/', record_ref: null, snapshot_hash: null, state: 'not_recorded' });

const series = (key: string, label: string, points: Array<[string, number]>, grade = 'Measured', source = 'Connector') =>
  ({ key, label, unit: 'usd', cadence: 'monthly', module: 'Grow', href: '/', state: 'recorded', points: points.map(([x, y]) => ({ x, y })), as_of: `${points.at(-1)![0]}-28`, source, grade, record_ref: `fixture:${key}`, snapshot_hash: HASH });

export function fullRecords() {
  return {
    items: [
      recorded('validate.top_pain', 'Top pain theme', 18, 'count'),
      recorded('validate.interviews', 'Interviews', 46, 'count'),
      recorded('validate.strong_fit', 'Strong fit', 21, 'count'),
      recorded('validate.lois', 'Letters of intent', 4, 'count', 'Sourced'),
      recorded('validate.claims_validated', 'Claims validated', 7, 'count'),
      recorded('validate.competitors', 'Competitors tracked', 3, 'count'),
      recorded('validate.demand', 'Other demand signals', 9, 'count'),
      recorded('build.must_haves', 'Must-haves done', 9, 'count', 'Measured', 12),
      recorded('build.releases_90d', 'Releases in 90 days', 14, 'count'),
      recorded('build.commits_90d', 'Commits in 90 days', 412, 'count'),
      recorded('build.roadmap', 'Roadmap objectives', 4, 'count'),
      recorded('grow.mrr', 'MRR', 15100, 'usd'),
      recorded('grow.arr', 'ARR', 181200, 'usd'),
      recorded('grow.paying_customers', 'Paying customers', 38, 'count'),
      recorded('grow.mercury_growth', 'Growth · m/m', 17.1, 'percent'),
      recorded('grow.churn', 'Churn, monthly', 1.8, 'percent'),
      recorded('grow.runway', 'Runway', 19, 'months'),
      recorded('grow.net_burn', 'Net burn', 4100000, 'cents'),
      recorded('grow.mercury_revenue', 'Revenue last month', 1510000, 'cents'),
      recorded('team.founders', 'Founders on the cap table', 3, 'count'),
      recorded('team.archetypes', 'Archetypes', 'Operator, Builder, Seller', 'text', 'Stated'),
      recorded('team.skills', 'Skills', 'Finance operations, payments infrastructure', 'text', 'Stated'),
      recorded('raise.round_target', 'Round', 1500000, 'usd', 'Reviewed'),
      recorded('raise.round_terms', 'Instrument', 'SAFE', 'text', 'Reviewed'),
      recorded('raise.round_close', 'Close', '2027-01-15', 'date', 'Reviewed'),
      recorded('raise.use_of_funds', 'Use of funds', 'Engineering, go to market, security review', 'text', 'Stated'),
      recorded('raise.cap_table', 'Cap table holders', 5, 'count', 'Reviewed'),
      recorded('raise.vesting', 'Vesting schedules', 3, 'count', 'Reviewed'),
    ],
    series: [series('grow.mrr.monthly', 'MRR, monthly', [['2026-03', 4100], ['2026-04', 5200], ['2026-05', 6900], ['2026-06', 8300], ['2026-07', 10400], ['2026-08', 12900], ['2026-09', 15100]])],
  };
}

export function sparseRecords() {
  return {
    items: [
      missing('validate.top_pain', 'Top pain theme', 'count'),
      missing('validate.interviews', 'Interviews', 'count'),
      missing('validate.strong_fit', 'Strong fit', 'count'),
      recorded('build.must_haves', 'Must-haves done', 3, 'count', 'Measured', 12),
      missing('build.releases_90d', 'Releases in 90 days', 'count'),
      missing('grow.mrr', 'MRR', 'usd'),
      recorded('grow.paying_customers', 'Paying customers', 3, 'count', 'Stated'),
      missing('grow.arr', 'ARR', 'usd'),
      missing('grow.mercury_growth', 'Growth · m/m', 'percent'),
      recorded('team.founders', 'Founders on the cap table', 2, 'count'),
      missing('raise.round_target', 'Round', 'usd'),
      recorded('raise.round_terms', 'Instrument', 'SAFE', 'text', 'Stated'),
      missing('raise.round_close', 'Close', 'date'),
    ],
    series: [],
  };
}

/**
 * Two sources that disagree: Stripe's MRR series and the founder's typed one.
 * They stay two series (D898 group C), never blended; the composer plots the
 * connector's and leaves the typed one in the library.
 */
export function conflictingRecords() {
  const full = fullRecords();
  return {
    items: full.items,
    series: [
      series('grow.mrr.typed', 'Typed MRR', [['2026-05', 9000], ['2026-06', 11000], ['2026-07', 14000], ['2026-08', 18000], ['2026-09', 21000]], 'Stated', 'Typed'),
      ...full.series,
    ],
  };
}

/** Eadwyn's words per card, as a run might answer: words only, never a figure. */
export const CARD_WORDS: Record<string, { headline: string; body: string }> = {
  title: { headline: 'Month-end close in a day, not a fortnight', body: 'One ledger that reconciles itself.' },
  problem: { headline: 'Finance teams copy rows between spreadsheets', body: 'It was the top pain across the interviews.' },
  why_now: { headline: 'Nothing joins the bank, invoices and payroll', body: 'So the books are still closed by hand.' },
  solution: { headline: 'One book that reconciles itself', body: 'Matches are proposed and a person approves them.' },
  traction: { headline: 'Revenue has grown every month since launch', body: 'Recorded from Stripe, month by month.' },
  validation: { headline: 'Customers asked for it before it existed', body: 'Interviews, letters of intent and validated claims.' },
  product: { headline: 'Shipped, and shipping weekly', body: 'Most must-haves are done.' },
  market: { headline: 'Tracked against named competitors', body: 'Demand shows up outside the interviews too.' },
  unit_economics: { headline: 'Runway to the next milestone', body: 'Burn and churn as the bank and Grow record them.' },
  team: { headline: 'Founders who have closed the books before', body: 'Operators, builders and a seller.' },
  round: { headline: 'Raising a seed round to reach multi-entity', body: 'Terms as recorded in Raise.' },
  use_of_funds: { headline: 'Where the round goes', body: 'Engineering first, then go to market.' },
};
export const wordsFor = (rows: Array<{ card: string }>) => rows.map((r) => CARD_WORDS[r.card] ?? { headline: null, body: null });
