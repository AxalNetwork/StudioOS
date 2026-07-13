// Deterministic demo data for the Fund Performance & Fund Accounting surfaces.
// No backend calls, no Date.now()/Math.random()/zero-arg new Date(). A fixed
// TODAY anchors every derived date so the pages render identically every run.
const TODAY = new Date('2026-07-11');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function daysAgo(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return iso(d);
}
export function daysFromNow(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return iso(d);
}

// ── Funds ────────────────────────────────────────────────────────────────
export const FUNDS = [
  {
    id: 'fund-1', name: 'Axal Seed Fund I', vintage: 2019, size: 45_000_000,
    called: 42_750_000, deployed: 40_100_000, nav: 118_400_000,
    dpi: 1.42, rvpi: 1.35, tvpi: 2.77, irr: 0.281, status: 'Harvesting',
  },
  {
    id: 'fund-2', name: 'Axal Seed Fund II', vintage: 2021, size: 85_000_000,
    called: 68_000_000, deployed: 61_200_000, nav: 132_600_000,
    dpi: 0.38, rvpi: 1.57, tvpi: 1.95, irr: 0.223, status: 'Active',
  },
  {
    id: 'fund-3', name: 'Axal Opportunity Fund', vintage: 2022, size: 120_000_000,
    called: 72_000_000, deployed: 64_800_000, nav: 96_300_000,
    dpi: 0.11, rvpi: 1.24, tvpi: 1.35, irr: 0.164, status: 'Active',
  },
  {
    id: 'fund-4', name: 'Axal Growth Fund II', vintage: 2024, size: 200_000_000,
    called: 60_000_000, deployed: 52_500_000, nav: 63_900_000,
    dpi: 0.02, rvpi: 1.05, tvpi: 1.07, irr: 0.092, status: 'Investing',
  },
];

// ── Blended fund-family summary ──────────────────────────────────────────
export const FUND_SUMMARY = {
  aum: 411_200_000,
  called: 242_750_000,
  deployed: 218_600_000,
  nav: 411_200_000,
  blendedTVPI: 1.82,
  blendedIRR: 0.201,
  blendedDPI: 0.44,
  blendedRVPI: 1.38,
};

// ── NAV over time (contributions vs distributions vs NAV) ────────────────
export const NAV_HISTORY = [
  { date: '2023-03-31', nav: 168_400_000, contributions: 14_200_000, distributions: 2_100_000 },
  { date: '2023-06-30', nav: 182_900_000, contributions: 12_800_000, distributions: 3_400_000 },
  { date: '2023-09-30', nav: 201_300_000, contributions: 16_500_000, distributions: 4_900_000 },
  { date: '2023-12-31', nav: 224_700_000, contributions: 18_100_000, distributions: 6_200_000 },
  { date: '2024-03-31', nav: 251_600_000, contributions: 21_400_000, distributions: 8_800_000 },
  { date: '2024-06-30', nav: 279_100_000, contributions: 19_700_000, distributions: 11_300_000 },
  { date: '2024-09-30', nav: 308_500_000, contributions: 23_600_000, distributions: 9_700_000 },
  { date: '2024-12-31', nav: 334_800_000, contributions: 17_200_000, distributions: 14_600_000 },
  { date: '2025-03-31', nav: 356_200_000, contributions: 20_900_000, distributions: 12_400_000 },
  { date: '2025-06-30', nav: 372_500_000, contributions: 15_800_000, distributions: 18_900_000 },
  { date: '2025-09-30', nav: 391_700_000, contributions: 22_300_000, distributions: 10_500_000 },
  { date: '2025-12-31', nav: 402_600_000, contributions: 13_400_000, distributions: 21_700_000 },
  { date: '2026-03-31', nav: 411_200_000, contributions: 11_900_000, distributions: 16_800_000 },
];

// ── Classic J-curve (quarterly net cashflow + cumulative) ────────────────
export const JCURVE = [
  { quarter: 'Q1 2023', netCashflow: -12_100_000, cumulative: -12_100_000 },
  { quarter: 'Q2 2023', netCashflow: -9_400_000, cumulative: -21_500_000 },
  { quarter: 'Q3 2023', netCashflow: -11_600_000, cumulative: -33_100_000 },
  { quarter: 'Q4 2023', netCashflow: -11_900_000, cumulative: -45_000_000 },
  { quarter: 'Q1 2024', netCashflow: -12_600_000, cumulative: -57_600_000 },
  { quarter: 'Q2 2024', netCashflow: -8_400_000, cumulative: -66_000_000 },
  { quarter: 'Q3 2024', netCashflow: -13_900_000, cumulative: -79_900_000 },
  { quarter: 'Q4 2024', netCashflow: -2_600_000, cumulative: -82_500_000 },
  { quarter: 'Q1 2025', netCashflow: 8_500_000, cumulative: -74_000_000 },
  { quarter: 'Q2 2025', netCashflow: 3_100_000, cumulative: -70_900_000 },
  { quarter: 'Q3 2025', netCashflow: 11_800_000, cumulative: -59_100_000 },
  { quarter: 'Q4 2025', netCashflow: 8_300_000, cumulative: -50_800_000 },
  { quarter: 'Q1 2026', netCashflow: 4_900_000, cumulative: -45_900_000 },
  { quarter: 'Q2 2026', netCashflow: 14_600_000, cumulative: -31_300_000 },
];

// ── Deployment pacing (deployed vs target per period) ────────────────────
export const DEPLOYMENT_PACING = [
  { period: 'H1 2023', deployed: 21_500_000, target: 24_000_000 },
  { period: 'H2 2023', deployed: 23_500_000, target: 24_000_000 },
  { period: 'H1 2024', deployed: 21_000_000, target: 22_000_000 },
  { period: 'H2 2024', deployed: 26_800_000, target: 22_000_000 },
  { period: 'H1 2025', deployed: 28_400_000, target: 30_000_000 },
  { period: 'H2 2025', deployed: 31_200_000, target: 30_000_000 },
  { period: 'H1 2026', deployed: 26_400_000, target: 28_000_000 },
];

// ── LP capital accounts ──────────────────────────────────────────────────
export const CAPITAL_ACCOUNTS = [
  {
    id: 'ca-1', lp: 'Meridian University Endowment', commitment: 40_000_000,
    contributed: 33_600_000, distributed: 15_400_000, unfunded: 6_400_000,
    nav: 68_200_000, ownershipPct: 16.6,
  },
  {
    id: 'ca-2', lp: 'Cascade Foundation', commitment: 30_000_000,
    contributed: 25_200_000, distributed: 11_100_000, unfunded: 4_800_000,
    nav: 51_100_000, ownershipPct: 12.4,
  },
  {
    id: 'ca-3', lp: 'Northbridge Family Office', commitment: 25_000_000,
    contributed: 20_500_000, distributed: 8_900_000, unfunded: 4_500_000,
    nav: 41_600_000, ownershipPct: 10.1,
  },
  {
    id: 'ca-4', lp: 'Pinewood Pension Trust', commitment: 50_000_000,
    contributed: 42_000_000, distributed: 18_600_000, unfunded: 8_000_000,
    nav: 85_300_000, ownershipPct: 20.7,
  },
  {
    id: 'ca-5', lp: 'Halcyon Capital Partners', commitment: 20_000_000,
    contributed: 16_800_000, distributed: 6_200_000, unfunded: 3_200_000,
    nav: 33_800_000, ownershipPct: 8.2,
  },
  {
    id: 'ca-6', lp: 'Sable Insurance Group', commitment: 35_000_000,
    contributed: 28_700_000, distributed: 9_800_000, unfunded: 6_300_000,
    nav: 57_400_000, ownershipPct: 14.0,
  },
  {
    id: 'ca-7', lp: 'Vantage Sovereign Fund', commitment: 45_000_000,
    contributed: 38_250_000, distributed: 13_500_000, unfunded: 6_750_000,
    nav: 73_800_000, ownershipPct: 18.0,
  },
];

// ── Management fees & carry ──────────────────────────────────────────────
export const FEES = [
  { period: 'FY 2022', managementFee: 4_200_000, carry: 0, basis: 210_000_000 },
  { period: 'FY 2023', managementFee: 5_100_000, carry: 1_400_000, basis: 255_000_000 },
  { period: 'FY 2024', managementFee: 5_600_000, carry: 3_800_000, basis: 280_000_000 },
  { period: 'FY 2025', managementFee: 6_050_000, carry: 6_900_000, basis: 302_500_000 },
  { period: 'FY 2026 (YTD)', managementFee: 3_180_000, carry: 4_200_000, basis: 318_000_000 },
];

// ── Fund-level expenses ──────────────────────────────────────────────────
export const EXPENSES = [
  { id: 'ex-1', category: 'Legal', vendor: 'Harrow & Vance LLP', amount: 184_500, date: daysAgo(12), status: 'Paid' },
  { id: 'ex-2', category: 'Audit', vendor: 'Delphi Assurance', amount: 96_000, date: daysAgo(28), status: 'Paid' },
  { id: 'ex-3', category: 'Fund Admin', vendor: 'Ledgerline Services', amount: 62_400, date: daysAgo(6), status: 'Pending' },
  { id: 'ex-4', category: 'Tax', vendor: 'Corwin Tax Advisors', amount: 41_800, date: daysAgo(41), status: 'Paid' },
  { id: 'ex-5', category: 'Technology', vendor: 'Carta', amount: 28_900, date: daysAgo(3), status: 'Pending' },
  { id: 'ex-6', category: 'Travel', vendor: 'Corporate Travel Co.', amount: 17_350, date: daysAgo(19), status: 'Approved' },
  { id: 'ex-7', category: 'Legal', vendor: 'Harrow & Vance LLP', amount: 73_200, date: daysAgo(55), status: 'Paid' },
  { id: 'ex-8', category: 'Fund Admin', vendor: 'Ledgerline Services', amount: 58_100, date: daysAgo(67), status: 'Paid' },
  { id: 'ex-9', category: 'Insurance', vendor: 'Sable Insurance Group', amount: 34_600, date: daysAgo(9), status: 'Approved' },
  { id: 'ex-10', category: 'Technology', vendor: 'AngelList', amount: 22_400, date: daysAgo(33), status: 'Paid' },
];

// ── Financial statements / reconciliation ────────────────────────────────
export const STATEMENTS = [
  { id: 'st-1', period: 'Q1 2026', type: 'Capital Account Statement', status: 'Finalized', date: daysAgo(88) },
  { id: 'st-2', period: 'Q1 2026', type: 'Bank Reconciliation', status: 'Reconciled', date: daysAgo(84) },
  { id: 'st-3', period: 'Q4 2025', type: 'Audited Financials', status: 'Finalized', date: daysAgo(120) },
  { id: 'st-4', period: 'Q4 2025', type: 'Capital Account Statement', status: 'Finalized', date: daysAgo(150) },
  { id: 'st-5', period: 'Q2 2026', type: 'Capital Account Statement', status: 'In Review', date: daysAgo(4) },
  { id: 'st-6', period: 'Q2 2026', type: 'Bank Reconciliation', status: 'In Progress', date: daysAgo(2) },
  { id: 'st-7', period: 'Q2 2026', type: 'Schedule of Investments', status: 'Draft', date: daysFromNow(9) },
  { id: 'st-8', period: 'Q1 2026', type: 'Schedule of Investments', status: 'Finalized', date: daysAgo(80) },
];
