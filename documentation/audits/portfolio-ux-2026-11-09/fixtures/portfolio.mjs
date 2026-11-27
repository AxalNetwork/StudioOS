/**
 * Synthetic API answers for the #4816 Portfolio UX audit capture
 * (`../capture.mjs`). Not a test fixture and not read by any test.
 *
 * Every company, figure and person here is invented. The shapes follow what
 * the SPA reads and what the Worker routes return on 2026-11-09:
 * `cloudflare-worker/src/routes/positions.ts` (list, analytics, kpi-compliance,
 * marks), `portfolio.ts` (health, chases), `portfolio_updates.ts`,
 * `portfolio_support.ts` (`/api/portfolio-support`), `introductions.ts` and the reporting reads behind
 * `frontend/src/lib/api/reporting.js`.
 *
 * One deliberate fidelity point: `/api/positions/analytics` answers with
 * `as_of: null`, because the Worker echoes `as_of` only when the caller passed
 * `?as_of=` (positions.ts, the analytics handler), and the Portfolio pages
 * never pass it.
 */

export const TODAY = '2026-11-09T10:00:00Z';

export const INVESTOR = {
  id: 990001, uid: 'synthetic-investor', email: 'investor@example.test', name: 'Sample Investor',
  first_name: 'Sample', last_name: 'Investor', role: 'investor', licences: ['investor'],
  kyc_status: 'approved', access_level: 'full', onboarding_completed: true, terms_acceptance_pending: false,
};

// An admin previewing the Investor view (viewMode=investor), for the #4849 re-check.
export const ADMIN = {
  id: 990002, uid: 'synthetic-admin', email: 'admin@example.test', name: 'Sample Admin',
  first_name: 'Sample', last_name: 'Admin', role: 'admin', licences: ['admin'],
  kyc_status: 'approved', access_level: 'full', onboarding_completed: true, terms_acceptance_pending: false,
};

const company = (id, uid, name, sector, stage) => ({ id, uid, name, sector, stage, status: 'active' });
const C = {
  101: company(101, 'tst-alpha', 'Test Alpha Robotics', 'Robotics', 'Seed'),
  102: company(102, 'tst-bravo', 'Test Bravo Health', 'Healthtech', 'Series A'),
  103: company(103, 'tst-charlie', 'Test Charlie Fintech', 'Fintech', 'Seed'),
  104: company(104, 'tst-delta', 'Test Delta Climate', 'Climate', 'Pre-seed'),
  105: company(105, 'tst-echo', 'Test Echo Data', 'Data infrastructure', 'Seed'),
};

const position = (pid, invested, own, fmv, extra = {}) => ({
  project_id: pid, project: C[pid], total_invested: invested, rounds: 1,
  latest_ownership_pct: own, latest_round: C[pid].stage, latest_date: '2025-06-01', vintage: 2025,
  fmv, multiple: Math.round((fmv / invested) * 100) / 100, marked_down: fmv < invested, unmarked: false,
  mark_as_of: '2026-06-30', mark_basis: 'priced_round', ...extra,
});

export const positions = {
  items: [
    position(101, 1500000, 6.2, 3600000, { rounds: 2, vintage: 2024 }),
    position(102, 2000000, 4.1, 2600000, { mark_as_of: '2026-03-31', mark_basis: 'gp_estimate' }),
    position(103, 1000000, 3.5, 400000, { mark_as_of: '2025-12-31', mark_basis: 'gp_estimate' }),
    position(104, 750000, 7.8, 900000, { mark_as_of: '2026-09-30' }),
    // Unmarked: the Worker carries it at cost (fmv = invested) and flags it.
    position(105, 1750000, 5.0, 1750000, { unmarked: true, mark_as_of: null, mark_basis: null, multiple: 1 }),
  ],
  scope: { rule: 'held', text: 'Companies you hold a confirmed commitment in.' },
};

export const analytics = {
  paid_in: 7000000, distributed: 900000, nav: 9250000, total_value: 10150000,
  dpi: 0.13, rvpi: 1.32, tvpi: 1.45, moic: 1.45, irr: 0.181, basis: 'gross',
  flow_count: 7, first_flow_date: '2024-03-12',
  as_of: null, position_count: 5, unmarked_position_count: 1, mark_coverage: 0.8,
};

export const marks = {
  items: [
    { uid: 'mk-1', project_id: 104, project_uid: 'tst-delta', project_name: C[104].name, as_of_date: '2026-09-30', fmv: 900000, post_money: 11500000, event: 'priced_round', basis: 'priced_round', source: 'Round documents', note: null },
    { uid: 'mk-2', project_id: 101, project_uid: 'tst-alpha', project_name: C[101].name, as_of_date: '2026-06-30', fmv: 3600000, post_money: 58000000, event: 'priced_round', basis: 'priced_round', source: 'Round documents', note: null },
    { uid: 'mk-3', project_id: 102, project_uid: 'tst-bravo', project_name: C[102].name, as_of_date: '2026-03-31', fmv: 2600000, post_money: null, event: 'revaluation', basis: 'gp_estimate', source: null, note: null },
    { uid: 'mk-4', project_id: 103, project_uid: 'tst-charlie', project_name: C[103].name, as_of_date: '2025-12-31', fmv: 400000, post_money: null, event: 'markdown', basis: 'gp_estimate', source: null, note: 'Runway concern' },
  ],
  projects: 4,
  basis_counts: { priced_round: 2, gp_estimate: 2 },
};

const health = (pid, badge, score, intervention = false) => ({
  project_id: pid, project_uid: C[pid].uid, project_name: C[pid].name, badge, score, intervention,
  reasons: intervention ? ['Runway under six months in the latest update'] : [], computed_at: '2026-11-08T03:00:00Z',
});
export const healthList = {
  items: [health(101, 'green', 82), health(102, 'yellow', 61), health(103, 'red', 34, true), health(104, 'green', 77)],
  totals: { green: 2, yellow: 1, red: 1, intervention: 1 },
};

const update = (uid, pid, title, period, at, kpis) => ({
  uid, id: uid, project_id: pid, project: C[pid], title, period, status: 'submitted',
  submitted_at: at, updated_at: at, created_at: at, kpis,
});
export const updates = {
  items: [
    update('upd-a3', 101, 'Q3 2026 investor update', '2026-Q3', '2026-10-14T09:00:00Z', { mrr: 182000, customers: 41, runway_months: 22, headcount: 31 }),
    update('upd-d9', 104, 'September 2026 update', '2026-09', '2026-10-08T09:00:00Z', { mrr: 21000, customers: 6, runway_months: 14, headcount: 9 }),
    update('upd-b2', 102, 'Q2 2026 investor update', '2026-Q2', '2026-07-20T09:00:00Z', { mrr: 96000, customers: 18, runway_months: 16, headcount: 24 }),
    update('upd-c2', 103, 'Q2 2026 investor update', '2026-Q2', '2026-07-02T09:00:00Z', { mrr: 12000, customers: 30, runway_months: 5, headcount: 11 }),
  ],
};

export const compliance = {
  cadence: 'quarterly', period: '2026-Q4', as_of: '2026-11-09', kpi_set: [],
  companies: [
    { project_id: 101, project_uid: 'tst-alpha', name: C[101].name, reported: true, last_reported_at: '2026-10-14', days_since_report: 26 },
    { project_id: 102, project_uid: 'tst-bravo', name: C[102].name, reported: false, last_reported_at: '2026-07-20', days_since_report: 112 },
    { project_id: 103, project_uid: 'tst-charlie', name: C[103].name, reported: false, last_reported_at: '2026-07-02', days_since_report: 130 },
    { project_id: 104, project_uid: 'tst-delta', name: C[104].name, reported: true, last_reported_at: '2026-10-08', days_since_report: 32 },
    { project_id: 105, project_uid: 'tst-echo', name: C[105].name, reported: false, last_reported_at: null, days_since_report: null },
  ],
  reported_count: 2, total_count: 5, compliance_pct: 40,
};

export const introductions = {
  introductions: [
    { id: 1, uid: 'in-1', status: 'accepted', project_id: 101, created_at: '2026-09-02' },
    { id: 2, uid: 'in-2', status: 'requested', project_id: 103, created_at: '2026-10-21' },
    { id: 3, uid: 'in-3', status: 'meeting_set', project_id: 104, created_at: '2026-10-02' },
  ],
};

export const chases = { items: [{ uid: 'ch-1', project_id: 102, created_at: '2026-10-20T12:00:00Z' }] };

export const support = {
  entries: [
    { uid: 'sp-1', project_id: 101, project_uid: 'tst-alpha', project_name: C[101].name, kind: 'intro', state: 'delivered', hours: 2, summary: 'Introduced the team to a synthetic design partner', outcome: 'Pilot scoped', created_at: '2026-09-03T10:00:00Z', promised_at: '2026-09-01T10:00:00Z', delivered_at: '2026-09-03T10:00:00Z' },
    { uid: 'sp-2', project_id: 103, project_uid: 'tst-charlie', project_name: C[103].name, kind: 'fundraising', state: 'promised', hours: null, summary: 'Review the bridge round materials', outcome: null, created_at: '2026-10-22T10:00:00Z', promised_at: '2026-10-22T10:00:00Z', delivered_at: null },
    { uid: 'sp-3', project_id: 104, project_uid: 'tst-delta', project_name: C[104].name, kind: 'hiring', state: 'delivered', hours: 1.5, summary: 'Shared a shortlist of synthetic engineering candidates', outcome: null, created_at: '2026-10-05T10:00:00Z', promised_at: '2026-10-01T10:00:00Z', delivered_at: '2026-10-05T10:00:00Z' },
  ],
  companies: [
    { project_id: 101, project_uid: 'tst-alpha', name: C[101].name, entries: 1, delivered: 1, promised: 0, withdrawn: 0, hours: 2, entries_without_hours: 0 },
    { project_id: 102, project_uid: 'tst-bravo', name: C[102].name, entries: 0, delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 },
    { project_id: 103, project_uid: 'tst-charlie', name: C[103].name, entries: 1, delivered: 0, promised: 1, withdrawn: 0, hours: 0, entries_without_hours: 1 },
    { project_id: 104, project_uid: 'tst-delta', name: C[104].name, entries: 1, delivered: 1, promised: 0, withdrawn: 0, hours: 1.5, entries_without_hours: 0 },
    { project_id: 105, project_uid: 'tst-echo', name: C[105].name, entries: 0, delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 },
  ],
  untouched: [
    { project_id: 102, project_uid: 'tst-bravo', name: C[102].name },
    { project_id: 105, project_uid: 'tst-echo', name: C[105].name },
  ],
  totals: { delivered: 2, promised: 1, withdrawn: 0, hours_recorded: 3.5, entries_without_hours: 1, companies_in_book: 5, companies_supported: 3 },
};

const duty = (uid, kind, route = 'direct') => ({ uid, kind, holding: { route }, title: kind === 'quarterly' ? 'Quarterly report' : 'Annual accounts', rule: 'Within 45 days of quarter end', clause: 'Information rights, clause 7.2', document: { title: 'Synthetic side letter' }, signed: '2025-06-01', defaulted: false });
const period = (uid, dutyUid, label, due, state, extra = {}) => ({ uid, duty_uid: dutyUid, label, due_on: due, state, ...extra });
const reportingCompany = (pid, periods, route = 'direct') => ({
  uid: C[pid].uid, name: C[pid].name, duties: [duty(`du-${pid}`, 'quarterly', route)],
  periods: periods.map((p) => ({ ...p, duty_uid: `du-${pid}` })),
});
export const reportingPortfolio = {
  companies: [
    reportingCompany(101, [
      period('pe-101-2', '', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-10', report_uid: 'rp-101-2' }),
      period('pe-101-3', '', '2026-Q3', '2026-11-14', 'sent', { sent_at: '2026-10-14', report_uid: 'rp-101-3' }),
    ]),
    reportingCompany(102, [
      period('pe-102-2', '', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-07-20', report_uid: 'rp-102-2' }),
      period('pe-102-3', '', '2026-Q3', '2026-11-14', 'due', { days_left: 5 }),
    ]),
    reportingCompany(103, [
      period('pe-103-2', '', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-20', report_uid: 'rp-103-2' }),
      period('pe-103-3', '', '2026-Q3', '2026-10-31', 'late', { days_late: 9, expected_on: '2026-11-20' }),
    ], 'syndicate'),
    reportingCompany(105, [
      period('pe-105-2', '', '2026-Q2', '2026-08-14', 'missing'),
      period('pe-105-3', '', '2026-Q3', '2026-11-14', 'due', { days_left: 5 }),
    ]),
  ],
};
export const reportingCompanyOf = (uid) => {
  const c = reportingPortfolio.companies.find((x) => x.uid === uid);
  return c ? { company: c } : null;
};

const figures = (uid, label, start, mrr, customers, burn, runway, headcount) => ({
  uid, period: { label, start }, corrected: false,
  figures: [
    { key: 'mrr', label: 'MRR', value: mrr, unit: 'USD', source: 'company' },
    { key: 'customers', label: 'Customers', value: customers, unit: null, source: 'company' },
    { key: 'net_burn', label: 'Net burn', value: burn, unit: 'USD', source: 'company' },
    { key: 'runway', label: 'Runway', value: runway, unit: 'months', source: 'company' },
    { key: 'headcount', label: 'Headcount', value: headcount, unit: null, source: 'company' },
  ],
});
export const companyFigures = {
  'tst-alpha': { reports: [
    figures('rp-101-1', '2026-Q1', '2026-01-01', 131000, 33, 240000, 25, 26),
    figures('rp-101-2', '2026-Q2', '2026-04-01', 158000, 37, 255000, 23, 29),
    figures('rp-101-3', '2026-Q3', '2026-07-01', 182000, 41, 262000, 22, 31),
  ] },
};
