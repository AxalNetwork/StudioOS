// Quarterly LP report — view model.
//
// Port of the Claude Design export `Quarterly Report.dc.html`, whose
// `renderVals()` opened with `const meta = { …, lp: 'Helena Kaur' }` and derived
// the entire capital account from `FUND.lpCommitK = 250`. That is a mock LP.
// This module builds the same document from the REAL limited partner: their row
// in `limited_partners`, their `capital_calls`, their `fund_distributions`, and
// the fund's GP of record — everything `GET /api/funds/lp-portal` returns for
// the caller, or `GET /api/funds/:id/lp-report/:lpId` returns for a GP producing
// a named LP's statement. Both endpoints answer in the same shape, so this is
// one code path either way.
//
// TWO KINDS OF NUMBER, NEVER MIXED SILENTLY
// =========================================
// Every line in the capital account is tagged `source`:
//   'record'    — the LP's own rows in D1. Commitment, capital called,
//                 contributions, distributions. These are facts about this LP.
//   'allocated' — the LP's pro-rata share of fund-level figures that come from
//                 the operator-maintained model in spinoutFundModel.js. Portfolio
//                 value, undeployed cash, fees, NAV.
// The report prints that distinction, because an LP reading "Net asset value"
// deserves to know it is an allocation of a GP mark, not a custodian balance.
//
// WHAT IS AUTHORED, NOT GENERATED
// ===============================
// The GP letter, material developments, outlook and subsequent events are
// commentary. A system must not invent them: they are statements of fact and
// judgement attributed to a named fiduciary. When no narrative has been written
// for the period, those sections render an explicit "not yet written" state and
// `meta.draft` is true — the renderer stamps the document DRAFT. A report with
// no GP letter is not a report anyone has stood behind.
import {
  fundModel, FUND, FUND_COSTS, FUND_PROGRESSION, COHORT_HISTORY,
  SECTOR_EXPOSURE, DEPLOYMENT_BY_QUARTER,
} from './spinoutFundModel.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** ISO-ish date string → 'Jul 15, 2026'. Returns '—' for anything unparseable. */
export function fmtDate(value) {
  const m = DAY.exec(String(value || ''));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The calendar quarter containing `date`.
 * @returns {{ label, start, end, range, quarter, year }} dates as ISO days.
 */
export function quarterOf(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  const year = d.getFullYear();
  const start = new Date(year, (q - 1) * 3, 1);
  const end = new Date(year, q * 3, 0); // day 0 of the next month = last of this
  return {
    label: `Q${q} ${year}`,
    quarter: q,
    year,
    start: iso(start),
    end: iso(end),
    range: `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${year}`,
  };
}

/** The most recently COMPLETED quarter as of `date` — what a report covers. */
export function lastClosedQuarter(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const q = quarterOf(d);
  return quarterOf(new Date(q.year, (q.quarter - 1) * 3 - 1, 15));
}

/* ------------------------------------------------------------------- money */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Dollars → `$250,000`. Negative amounts render in accounting parentheses. */
export const usd = (dollars) => {
  const n = Math.round(num(dollars));
  const s = `$${Math.abs(n).toLocaleString('en-US')}`;
  return n < 0 ? `(${s})` : s;
};

const m2 = (millions) => `$${num(millions).toFixed(2)}M`;
const k0 = (thousands) => `$${Math.round(num(thousands))}K`;

/* -------------------------------------------------------------- LP records */

/** The date a capital call is EFFECTIVE for "called to date": its due date if
 *  it has one, else when the notice was raised. */
const callDate = (c) => String(c?.due_date || c?.created_at || '');
const paidDate = (c) => String(c?.paid_date || '');
const distDate = (d) => String(d?.distributed_at || d?.created_at || '');

const onOrBefore = (a, b) => !!a && a.slice(0, 10) <= b;
const within = (a, start, end) => !!a && a.slice(0, 10) >= start && a.slice(0, 10) <= end;

/**
 * Select the holding this report covers.
 * Prefers the fund slug (stable), then the fund id, then the single holding.
 * Returns null when the viewer holds nothing in the named fund — the caller
 * must not fall back to "any fund", which would issue a statement under the
 * wrong letterhead.
 */
export function selectHolding(payload, { fundSlug, fundId } = {}) {
  const rows = Array.isArray(payload?.performance) ? payload.performance : [];
  if (!rows.length) return null;
  if (fundSlug) return rows.find((r) => r.fund_slug === fundSlug) || null;
  if (fundId != null) return rows.find((r) => num(r.fund_id) === num(fundId)) || null;
  return rows.length === 1 ? rows[0] : null;
}

/* ---------------------------------------------------------------- document */

/**
 * Build the quarterly report.
 *
 * @param {object}  opts
 * @param {object}  opts.payload    lp-portal / lp-report DTO
 * @param {string}  [opts.fundSlug] which holding to report on
 * @param {number}  [opts.fundId]
 * @param {object}  [opts.period]   from quarterOf()/lastClosedQuarter(); defaults to the last closed quarter
 * @param {Date}    [opts.issuedAt] issue stamp; defaults to now
 * @param {object}  [opts.narrative] GP-authored { letter[], developments[], outlook[], subsequent[] }
 * @param {boolean} [opts.issued]   true when the GP has issued this period
 * @returns {{ ok: boolean, reason?: string } & object}
 */
export function quarterlyReportModel({
  payload, fundSlug, fundId, period, issuedAt, narrative, issued = false,
} = {}) {
  const holding = selectHolding(payload, { fundSlug, fundId });
  if (!holding) {
    return { ok: false, reason: 'no-holding' };
  }

  const p = period || lastClosedQuarter(issuedAt);
  const stamp = issuedAt instanceof Date && !Number.isNaN(issuedAt.getTime()) ? issuedAt : new Date();
  const facts = (payload?.funds || {})[holding.fund_id] || {};
  const gp = facts.gp || {};
  const providers = facts.providers || {};
  const M = fundModel();

  const nar = narrative || {};
  const hasLetter = Array.isArray(nar.letter) && nar.letter.filter(Boolean).length > 0;
  const draft = !issued || !hasLetter;

  /* ---- the LP's own record ---- */
  const allCalls = (Array.isArray(payload?.capital_calls) ? payload.capital_calls : [])
    .filter((c) => num(c?.limited_partner_id) === num(holding.lp_id) || c?.limited_partner_id == null);
  const allDists = (Array.isArray(payload?.distributions) ? payload.distributions : [])
    .filter((d) => num(d?.fund_id) === num(holding.fund_id));

  const commitment = num(holding.commitment);
  const calledToDate = allCalls
    .filter((c) => onOrBefore(callDate(c), p.end))
    .reduce((s, c) => s + num(c.amount), 0);
  const calledThisPeriod = allCalls
    .filter((c) => within(callDate(c), p.start, p.end))
    .reduce((s, c) => s + num(c.amount), 0);
  const paidToDate = allCalls
    .filter((c) => onOrBefore(paidDate(c), p.end))
    .reduce((s, c) => s + num(c.amount), 0);
  const contributedThisPeriod = allCalls
    .filter((c) => within(paidDate(c), p.start, p.end))
    .reduce((s, c) => s + num(c.amount), 0);
  const distributionsToDate = allDists
    .filter((d) => onOrBefore(distDate(d), p.end))
    .reduce((s, d) => s + num(d.amount_cents) / 100, 0);

  // `invested_amount` is the paid-in balance the portal's own TVPI uses; the
  // call rows are the audit trail behind it. When they disagree the statement
  // says so rather than quietly preferring one — a capital account that does
  // not tie to its own call history is a data problem the GP needs to see.
  const investedAmount = num(holding.invested_amount);
  const reconciliation = {
    paidCallsTotal: paidToDate,
    investedAmount,
    // Tolerance of one dollar: these are float columns.
    ties: Math.abs(paidToDate - investedAmount) < 1,
  };
  const unfunded = Math.max(0, commitment - calledToDate);

  /* ---- fund-level allocation ---- */
  // The LP's share of the fund is their paid-in capital over the fund's called
  // capital. Both are dollars; the model states `called` in $M.
  const fundCalled = num(FUND.called) * 1_000_000;
  const share = fundCalled > 0 ? investedAmount / fundCalled : 0;
  const portfolioValue = M.heldK * 1000;
  const undeployedCash = Math.max(0, fundCalled - M.investedK * 1000);
  const feesInception = (FUND_COSTS.mgmtFeeInceptM + FUND_COSTS.opexInceptM) * 1_000_000;
  const feesPeriod = (FUND_COSTS.mgmtFeePeriodM + FUND_COSTS.opexPeriodM) * 1_000_000;

  const allocPortfolio = portfolioValue * share;
  const allocCash = undeployedCash * share;
  const allocFees = feesInception * share;
  const allocFeesPeriod = feesPeriod * share;
  const nav = allocPortfolio + allocCash - allocFees;

  const netTvpi = investedAmount > 0 ? (nav + distributionsToDate) / investedAmount : 0;
  const netDpi = investedAmount > 0 ? distributionsToDate / investedAmount : 0;

  const row = (k, v, source, opts = {}) => ({ k, v, source, ...opts });
  const capitalAccount = [
    row('Commitment', usd(commitment), 'record', { strong: true }),
    row('Capital called to date', usd(calledToDate), 'record'),
    row('Unfunded commitment', usd(unfunded), 'record'),
    row('Contributed this quarter', usd(contributedThisPeriod), 'record'),
    row('Paid-in capital', usd(investedAmount), 'record'),
    row('Allocated portfolio value', usd(allocPortfolio), 'allocated'),
    row('Share of undeployed cash', usd(allocCash), 'allocated'),
    row('Less: fees and expenses since inception', usd(-allocFees), 'allocated', { negative: true }),
    row('Distributions to date', usd(distributionsToDate), 'record'),
    row('Net asset value', usd(nav), 'allocated', { strong: true, accent: true }),
  ];

  /* ---- capital call history (the LP's real rows) ---- */
  const calls = allCalls
    .filter((c) => onOrBefore(callDate(c), p.end))
    .sort((a, b) => callDate(a).localeCompare(callDate(b)))
    .map((c) => ({
      k: `${fmtDate(callDate(c))}${c.status ? ` · ${c.status}` : ''}`,
      v: usd(c.amount),
      paid: !!c.paid_date,
    }));
  calls.push({ k: 'Total called to date', v: usd(calledToDate), strong: true });

  /* ---- fund-level sections ---- */
  const headline = [
    { k: 'Committed capital', v: m2(FUND.committed), note: `${FUND.lpCount} accepted LPs`, tone: '#18181b' },
    { k: 'Called to date', v: m2(FUND.called), note: `${Math.round((FUND.called / FUND.committed) * 100)}% of commitments`, tone: '#18181b' },
    { k: 'Deployed', v: m2(M.investedK / 1000), note: `${M.positions.length} positions`, tone: '#6d28d9' },
    { k: 'Reserve held', v: m2(M.reserveCloseM), note: 'For follow-ons', tone: '#18181b' },
    { k: 'Portfolio value', v: m2(M.heldK / 1000), note: `${M.grossMoic.toFixed(2)}× gross MOIC`, tone: '#15803d' },
  ];

  const fundSummary = [
    { k: 'Target / hard cap', v: `$${FUND.target}M / $${FUND.hardCap}M` },
    { k: 'Committed / capacity', v: `${m2(FUND.committed)} / $${M.capacityRemainingM}M` },
    { k: 'Soft-circled', v: m2(FUND.softCircled) },
    { k: 'Positions held', v: String(M.positions.length) },
    { k: 'Follow-ons completed', v: String(M.followOnCount) },
    { k: 'Gross MOIC', v: `${M.grossMoic.toFixed(2)}×` },
    { k: 'Your net TVPI', v: `${netTvpi.toFixed(2)}×` },
    { k: 'Your DPI', v: `${netDpi.toFixed(2)}×` },
  ];

  const statusTone = {
    'On plan': { bg: '#dcfce7', fg: '#15803d' },
    Outperforming: { bg: '#dcfce7', fg: '#15803d' },
    Monitor: { bg: '#fef3c7', fg: '#92400e' },
    Early: { bg: '#f4f4f5', fg: '#52525b' },
  };
  const portfolio = M.positions.map((q) => {
    const moic = q.held / q.invested;
    return {
      company: q.company, sector: q.sector, cohort: q.cohort,
      invested: k0(q.invested), held: k0(q.held),
      moic: `${moic.toFixed(2)}×`,
      moicTone: moic >= 1.3 ? '#15803d' : moic > 1 ? '#3f3f46' : '#71717a',
      status: q.status, pill: statusTone[q.status] || statusTone.Early,
    };
  });
  const portfolioTotals = {
    count: String(M.positions.length),
    invested: m2(M.investedK / 1000),
    held: m2(M.heldK / 1000),
    moic: `${M.grossMoic.toFixed(2)}×`,
  };

  // Deployment: the stated later quarters plus an opening bar that absorbs the
  // residual, so the series always sums to the position list's total.
  const later = [
    ...DEPLOYMENT_BY_QUARTER,
    { q: `Q${p.quarter} ${String(p.year).slice(2)}`, m: (M.byCohort('C3', 'invested') + M.followOnK) / 1000 },
  ];
  const opening = Math.round((M.investedK / 1000 - later.reduce((a, d) => a + d.m, 0)) * 100) / 100;
  const dep = [{ q: 'Q3 25', m: opening }, ...later];
  const depMax = Math.max(...dep.map((d) => d.m), 0.01);
  const deployBars = dep.map((d, i) => ({
    q: d.q,
    label: m2(d.m),
    frac: Math.max(0, d.m) / depMax,
    accent: i === dep.length - 1,
  }));

  const cohorts = COHORT_HISTORY.map((c) => ({
    name: c.name, started: c.started, graduated: c.graduated,
    readiness: c.inProgram ? `${c.readiness} →` : String(c.readiness),
    readyTone: c.inProgram ? '#a1a1aa' : (c.readiness >= 60 ? '#15803d' : '#b45309'),
    invested: M.byCohort(c.code, 'invested') ? k0(M.byCohort(c.code, 'invested')) : '—',
    followOn: M.byCohort(c.code, 'followOn') ? k0(M.byCohort(c.code, 'followOn')) : '—',
    current: !!c.inProgram,
  }));

  const exposure = SECTOR_EXPOSURE.map((e, i) => ({
    label: e.label,
    pct: `${e.pct}%`,
    frac: e.pct / 100,
    bar: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'][i % 5],
  }));

  const reserve = [
    { k: 'Reserve at period open', v: m2(M.reserveOpenM) },
    { k: 'Deployed from reserve', v: `(${m2(M.reserveDrawM)})` },
    { k: 'Reserve at period close', v: m2(M.reserveCloseM) },
    { k: 'Reserve ratio (policy)', v: `${Math.round((M.reserveCloseM / FUND.committed) * 100)}% held · ${FUND.reserveLowPct}–${FUND.reserveHighPct}% policy` },
  ];

  // Service providers come from the fund record. An unset one says so — the
  // report never names a firm the database has not been told about.
  const NOT_SET = 'Not recorded';
  const admin = [
    { k: 'Fund administrator', v: providers.fund_admin || NOT_SET, missing: !providers.fund_admin },
    { k: 'Legal counsel', v: providers.legal_counsel || NOT_SET, missing: !providers.legal_counsel },
    { k: 'Auditor', v: providers.auditor || NOT_SET, missing: !providers.auditor },
    { k: 'Banking / custody', v: providers.custodian || NOT_SET, missing: !providers.custodian },
    { k: 'Valuation policy', v: providers.valuation_policy || NOT_SET, missing: !providers.valuation_policy },
    { k: 'Management fee / carry', v: `${((facts.management_fee ?? FUND.mgmtFeePct / 100) * 100).toFixed(2).replace(/\.?0+$/, '')}% · ${((facts.carried_interest ?? FUND.carryPct / 100) * 100).toFixed(0)}%` },
  ];

  /* ---- performance progression; the current row ties to the portfolio ---- */
  const fundNav = portfolioValue + undeployedCash - feesInception;
  const progression = FUND_PROGRESSION.map((r) => {
    const navM = r.current ? fundNav / 1_000_000 : r.navM;
    const tv = r.calledM > 0 ? navM / r.calledM : 0;
    return {
      q: r.current ? `${r.q} · current` : r.q,
      called: m2(r.calledM),
      nav: m2(navM),
      tvpi: `${tv.toFixed(2)}×`,
      dpi: r.dpi,
      rvpi: `${tv.toFixed(2)}×`,
      irr: r.irr,
      tone: r.irr && r.irr.startsWith('+') ? '#15803d' : '#71717a',
    };
  });

  const fees = [
    { k: 'Management fee · this period', v: m2(FUND_COSTS.mgmtFeePeriodM) },
    { k: 'Management fee · since inception', v: m2(FUND_COSTS.mgmtFeeInceptM) },
    { k: 'Fund operating expenses · period', v: m2(FUND_COSTS.opexPeriodM) },
    { k: 'Fund operating expenses · inception', v: m2(FUND_COSTS.opexInceptM) },
    { k: 'Carried interest accrued', v: m2(FUND_COSTS.carryAccruedM) },
    { k: 'Fee offsets / rebates', v: m2(FUND_COSTS.feeOffsetsM) },
    { k: 'Total fees & expenses to date', v: m2(FUND_COSTS.mgmtFeeInceptM + FUND_COSTS.opexInceptM), strong: true },
    { k: 'Allocated to your account (period)', v: usd(allocFeesPeriod), strong: true },
  ];

  const held = M.positions.map((q) => q.held);
  const largest = held.length ? Math.max(...held) : 0;
  const top3 = [...held].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const cohortCount = new Set(M.positions.map((q) => q.cohort)).size;
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const concentration = [
    { k: 'Largest single position, as % of portfolio value', v: pct(largest, M.heldK), tone: '#18181b' },
    { k: 'Top three positions, as % of portfolio value', v: pct(top3, M.heldK), tone: '#18181b' },
    { k: 'Positions marked above cost', v: `${M.positions.filter((q) => q.held > q.invested).length} of ${M.positions.length}`, tone: '#15803d' },
    { k: 'Cohort vintages represented', v: String(cohortCount), tone: '#18181b' },
  ];

  const notes = [
    { title: 'Valuation methodology', body: providers.valuation_policy
      ? `Positions are carried at fair value under the fund's stated policy (${providers.valuation_policy}) — marked to a priced round where one closed in-period, otherwise held at cost absent an impairment indicator.`
      : 'Positions are carried at fair value — marked to a priced round where one closed in-period, otherwise held at cost absent an impairment indicator. The fund has no valuation policy recorded on its record in the platform.' },
    { title: 'Basis of your capital account', body: 'Commitment, capital called, contributions and distributions are taken from your own records. Portfolio value, undeployed cash, fees and net asset value are your pro-rata share of fund-level figures maintained by the General Partner.' },
    { title: 'Concentration', body: `The largest single position is ${pct(Math.max(...M.positions.map((q) => q.invested)), M.investedK)} of deployed capital. The ${FUND.reserveLowPct}–${FUND.reserveHighPct}% reserve policy constrains initial position size and caps portfolio-level concentration.` },
  ];

  const keyDates = [
    { date: FUND.demoDay, label: 'Cohort demo day · allocation window' },
    { date: FUND.firstClose, label: `First close · $${FUND.minCloseM}M minimum` },
    { date: `Annual audit · ${FUND.auditDate}`, label: 'Audited statements issued' },
    { date: `K-1 · ${FUND.k1Date}`, label: 'Schedule K-1 issued' },
  ];

  /* ---- signature block ---- */
  const signer = {
    name: gp.name || null,
    title: gp.title || 'General Partner',
    email: gp.email || null,
    entity: gp.entity || null,
    // The single most important honesty check in this document: it is signed by
    // a fiduciary, and if the fund has no GP of record the report says so
    // instead of printing a name from a design mock.
    recorded: !!gp.name,
  };

  return {
    ok: true,
    meta: {
      period: p.label,
      range: p.range,
      periodEnd: p.end,
      issued: fmtDate(iso(stamp)),
      status: draft ? 'Draft · not issued' : 'Unaudited · GP-reviewed',
      draft,
      lp: payload?.recipient?.name || payload?.recipient?.email || 'Limited partner',
      lpEmail: payload?.recipient?.email || null,
      fundName: facts.name || holding.fund_name || 'Fund',
      vintage: facts.vintage_year || null,
      // Marks have no history, so a report for a closed quarter carries the
      // CURRENT portfolio marks. Saying so is the difference between a dated
      // statement and a misleading one.
      marksNote: p.end < iso(stamp)
        ? `Portfolio marks are as of ${fmtDate(iso(stamp))}; the fund does not retain period-end mark snapshots.`
        : null,
    },
    signer,
    letter: {
      authored: hasLetter,
      paragraphs: hasLetter ? nar.letter.filter(Boolean) : [],
      placeholder: 'No General Partner letter has been written for this period. '
        + 'The figures below are generated from platform records; the commentary that '
        + 'accompanies them is authored by the GP before the report is issued.',
    },
    headline,
    capitalAccount,
    reconciliation,
    fundSummary,
    deployBars,
    portfolio,
    portfolioTotals,
    developments: Array.isArray(nar.developments) ? nar.developments : [],
    exposure,
    cohorts,
    outlook: Array.isArray(nar.outlook) ? nar.outlook : [],
    admin,
    reserve,
    notes,
    keyDates,
    progression,
    fees,
    calls,
    concentration,
    subsequent: Array.isArray(nar.subsequent) ? nar.subsequent : [],
  };
}

/** `axal-spin-out-fund-i-q2-2026-a-partner.pdf` */
export function quarterlyReportFilename(vm) {
  const slug = (s) => String(s || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const parts = [
    slug(vm?.meta?.fundName) || 'fund',
    slug(vm?.meta?.period) || 'period',
    slug(vm?.meta?.lp),
  ].filter(Boolean);
  return `${parts.join('-')}${vm?.meta?.draft ? '-draft' : ''}.pdf`;
}
