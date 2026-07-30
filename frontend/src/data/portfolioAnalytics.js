// Deterministic demo data for the investor Portfolio Performance & Growth pages.
// NO backend calls — everything here is static/derived. Determinism is mandatory:
// a fixed TODAY plus daysAgo/daysFromNow helpers, so builds/snapshots never drift.
// Dates are plain 'YYYY-MM-DD' strings or produced via the helpers below.

export const TODAY = new Date('2026-07-11');

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

// ---------------------------------------------------------------------------
// Companies with quarterly valuation history + markup labels.
// ---------------------------------------------------------------------------
export const COMPANIES = [
  {
    id: 'c-nimbus',
    name: 'Nimbus Data',
    sector: 'Infrastructure',
    stage: 'Series B',
    invested: 4_000_000,
    currentValue: 18_600_000,
    moic: 4.65,
    irr: 61.2,
    ownershipPct: 7.4,
    vintage: 2021,
    status: 'active',
    valuationHistory: [
      { date: '2021-03-31', valuation: 4_000_000, markup: 'Series A entry' },
      { date: '2021-12-31', valuation: 6_200_000, markup: null },
      { date: '2022-09-30', valuation: 9_800_000, markup: 'Series B' },
      { date: '2023-06-30', valuation: 12_400_000, markup: null },
      { date: '2024-03-31', valuation: 15_100_000, markup: 'Secondary bid' },
      { date: '2025-06-30', valuation: 17_300_000, markup: null },
      { date: '2026-06-30', valuation: 18_600_000, markup: 'Series C prep' },
    ],
  },
  {
    id: 'c-vela',
    name: 'Vela Health',
    sector: 'Healthcare',
    stage: 'Series A',
    invested: 3_000_000,
    currentValue: 8_100_000,
    moic: 2.7,
    irr: 34.8,
    ownershipPct: 9.1,
    vintage: 2022,
    status: 'active',
    valuationHistory: [
      { date: '2022-06-30', valuation: 3_000_000, markup: 'Seed extension' },
      { date: '2022-12-31', valuation: 3_600_000, markup: null },
      { date: '2023-09-30', valuation: 5_400_000, markup: 'Series A' },
      { date: '2024-06-30', valuation: 6_700_000, markup: null },
      { date: '2025-06-30', valuation: 7_500_000, markup: null },
      { date: '2026-06-30', valuation: 8_100_000, markup: null },
    ],
  },
  {
    id: 'c-orbit',
    name: 'Orbit Robotics',
    sector: 'Hardware',
    stage: 'Series A',
    invested: 5_000_000,
    currentValue: 6_200_000,
    moic: 1.24,
    irr: 8.9,
    ownershipPct: 11.0,
    vintage: 2022,
    status: 'active',
    valuationHistory: [
      { date: '2022-03-31', valuation: 5_000_000, markup: 'Series A entry' },
      { date: '2022-12-31', valuation: 5_500_000, markup: null },
      { date: '2023-09-30', valuation: 6_400_000, markup: 'Bridge' },
      { date: '2024-06-30', valuation: 6_000_000, markup: 'Down-round risk' },
      { date: '2025-06-30', valuation: 6_100_000, markup: null },
      { date: '2026-06-30', valuation: 6_200_000, markup: null },
    ],
  },
  {
    id: 'c-quill',
    name: 'Quill AI',
    sector: 'AI / ML',
    stage: 'Seed',
    invested: 1_500_000,
    currentValue: 11_250_000,
    moic: 7.5,
    irr: 118.4,
    ownershipPct: 6.2,
    vintage: 2023,
    status: 'active',
    valuationHistory: [
      { date: '2023-06-30', valuation: 1_500_000, markup: 'Seed entry' },
      { date: '2023-12-31', valuation: 2_800_000, markup: null },
      { date: '2024-09-30', valuation: 5_600_000, markup: 'Series A' },
      { date: '2025-06-30', valuation: 8_900_000, markup: 'Secondary bid' },
      { date: '2026-06-30', valuation: 11_250_000, markup: 'Series B term sheet' },
    ],
  },
  {
    id: 'c-harbor',
    name: 'Harbor Fintech',
    sector: 'Fintech',
    stage: 'Series B',
    invested: 6_000_000,
    currentValue: 14_400_000,
    moic: 2.4,
    irr: 22.1,
    ownershipPct: 5.5,
    vintage: 2020,
    status: 'active',
    valuationHistory: [
      { date: '2020-09-30', valuation: 6_000_000, markup: 'Series A entry' },
      { date: '2021-06-30', valuation: 8_100_000, markup: 'Series B' },
      { date: '2022-06-30', valuation: 11_200_000, markup: null },
      { date: '2023-06-30', valuation: 12_600_000, markup: null },
      { date: '2024-06-30', valuation: 13_500_000, markup: null },
      { date: '2025-06-30', valuation: 14_000_000, markup: null },
      { date: '2026-06-30', valuation: 14_400_000, markup: null },
    ],
  },
  {
    id: 'c-meridian',
    name: 'Meridian Bio',
    sector: 'Biotech',
    stage: 'Series A',
    invested: 3_500_000,
    currentValue: 0,
    moic: 0,
    irr: -100,
    ownershipPct: 0,
    vintage: 2021,
    status: 'written_off',
    valuationHistory: [
      { date: '2021-06-30', valuation: 3_500_000, markup: 'Series A entry' },
      { date: '2022-06-30', valuation: 4_200_000, markup: null },
      { date: '2023-06-30', valuation: 2_100_000, markup: 'Trial setback' },
      { date: '2024-06-30', valuation: 600_000, markup: 'Impairment' },
      { date: '2025-06-30', valuation: 0, markup: 'Written off' },
    ],
  },
  {
    id: 'c-summit',
    name: 'Summit Logistics',
    sector: 'Logistics',
    stage: 'Series C',
    invested: 4_500_000,
    currentValue: 13_500_000,
    moic: 3.0,
    irr: 41.6,
    ownershipPct: 4.8,
    vintage: 2023,
    status: 'exited',
    valuationHistory: [
      { date: '2023-03-31', valuation: 4_500_000, markup: 'Series C entry' },
      { date: '2023-12-31', valuation: 6_300_000, markup: null },
      { date: '2024-09-30', valuation: 9_000_000, markup: 'Strategic round' },
      { date: '2025-06-30', valuation: 11_800_000, markup: null },
      { date: '2026-03-31', valuation: 13_500_000, markup: 'Acquired (exit)' },
    ],
  },
  {
    id: 'c-pixel',
    name: 'Pixel Forge',
    sector: 'Consumer',
    stage: 'Seed',
    invested: 1_200_000,
    currentValue: 3_360_000,
    moic: 2.8,
    irr: 46.3,
    ownershipPct: 8.0,
    vintage: 2024,
    status: 'active',
    valuationHistory: [
      { date: '2024-03-31', valuation: 1_200_000, markup: 'Seed entry' },
      { date: '2024-12-31', valuation: 1_900_000, markup: null },
      { date: '2025-09-30', valuation: 2_700_000, markup: 'Series A' },
      { date: '2026-06-30', valuation: 3_360_000, markup: null },
    ],
  },
];

// ---------------------------------------------------------------------------
// Portfolio-level summary (blended metrics).
// ---------------------------------------------------------------------------
export const PORTFOLIO_SUMMARY = {
  totalInvested: 28_700_000,
  totalValue: 75_410_000,
  blendedMOIC: 2.63,
  blendedIRR: 31.7,
  tvpi: 2.63,
  dpi: 0.47,
};

// ---------------------------------------------------------------------------
// Vintage cohorts (year-of-first-investment comparison).
// ---------------------------------------------------------------------------
export const COHORTS = [
  { vintage: 2020, invested: 6_000_000, value: 14_400_000, moic: 2.4, irr: 22.1 },
  { vintage: 2021, invested: 7_500_000, value: 18_600_000, moic: 2.48, irr: 28.4 },
  { vintage: 2022, invested: 8_000_000, value: 14_300_000, moic: 1.79, irr: 18.6 },
  { vintage: 2023, invested: 6_000_000, value: 24_750_000, moic: 4.13, irr: 74.2 },
  { vintage: 2024, invested: 1_200_000, value: 3_360_000, moic: 2.8, irr: 46.3 },
];

// ---------------------------------------------------------------------------
// Benchmarks — fund IRR vs external references.
// ---------------------------------------------------------------------------
export const BENCHMARKS = [
  { name: 'Axal Fund', irr: 31.7 },
  { name: 'Cambridge Median', irr: 18.4 },
  { name: 'Cambridge Top Quartile', irr: 27.9 },
  { name: 'Public Market Equiv.', irr: 12.3 },
];

// ---------------------------------------------------------------------------
// Growth / value-creation initiatives.
// ---------------------------------------------------------------------------
export const GROWTH_INITIATIVES = [
  {
    id: 'g-1',
    company: 'Nimbus Data',
    title: 'Hire VP of Engineering',
    type: 'talent',
    owner: 'Dana Kim',
    status: 'in_progress',
    progress: 65,
    dueDate: daysFromNow(24),
    kpis: [
      { name: 'Candidates in pipeline', current: 6, target: 8, unit: '' },
      { name: 'Final-round interviews', current: 2, target: 3, unit: '' },
      { name: 'Time to close', current: 41, target: 30, unit: ' days' },
    ],
  },
  {
    id: 'g-2',
    company: 'Quill AI',
    title: 'Enterprise design-partner rollout',
    type: 'customer',
    owner: 'Marcus Lee',
    status: 'in_progress',
    progress: 48,
    dueDate: daysFromNow(52),
    kpis: [
      { name: 'Design partners signed', current: 5, target: 10, unit: '' },
      { name: 'Pilot ARR', current: 320, target: 750, unit: 'k' },
      { name: 'Activation rate', current: 62, target: 80, unit: '%' },
    ],
  },
  {
    id: 'g-3',
    company: 'Harbor Fintech',
    title: 'Series C fundraise support',
    type: 'capital',
    owner: 'Priya Nair',
    status: 'planned',
    progress: 15,
    dueDate: daysFromNow(96),
    kpis: [
      { name: 'Target raise', current: 0, target: 40, unit: 'M' },
      { name: 'Warm intros made', current: 4, target: 12, unit: '' },
      { name: 'Data room readiness', current: 30, target: 100, unit: '%' },
    ],
  },
  {
    id: 'g-4',
    company: 'Orbit Robotics',
    title: 'Unit-economics turnaround plan',
    type: 'product',
    owner: 'Sam Ortiz',
    status: 'blocked',
    progress: 22,
    dueDate: daysFromNow(-6),
    kpis: [
      { name: 'Gross margin', current: 18, target: 45, unit: '%' },
      { name: 'CAC payback', current: 22, target: 14, unit: ' mo' },
      { name: 'Burn multiple', current: 3.4, target: 1.5, unit: 'x' },
    ],
  },
  {
    id: 'g-5',
    company: 'Vela Health',
    title: 'Payer contract expansion',
    type: 'customer',
    owner: 'Marcus Lee',
    status: 'in_progress',
    progress: 71,
    dueDate: daysFromNow(18),
    kpis: [
      { name: 'Payer contracts', current: 7, target: 9, unit: '' },
      { name: 'Covered lives', current: 1.2, target: 2.0, unit: 'M' },
      { name: 'Net revenue retention', current: 118, target: 125, unit: '%' },
    ],
  },
  {
    id: 'g-6',
    company: 'Pixel Forge',
    title: 'Growth marketing playbook',
    type: 'product',
    owner: 'Dana Kim',
    status: 'done',
    progress: 100,
    dueDate: daysAgo(12),
    kpis: [
      { name: 'CAC', current: 14, target: 18, unit: '$' },
      { name: 'Viral coefficient', current: 1.3, target: 1.1, unit: '' },
      { name: 'D30 retention', current: 41, target: 35, unit: '%' },
    ],
  },
  {
    id: 'g-7',
    company: 'Summit Logistics',
    title: 'Recruit two board members',
    type: 'talent',
    owner: 'Priya Nair',
    status: 'done',
    progress: 100,
    dueDate: daysAgo(40),
    kpis: [
      { name: 'Independent directors', current: 2, target: 2, unit: '' },
      { name: 'Committee coverage', current: 100, target: 100, unit: '%' },
    ],
  },
  {
    id: 'g-8',
    company: 'Quill AI',
    title: 'Bridge round to extend runway',
    type: 'capital',
    owner: 'Priya Nair',
    status: 'in_progress',
    progress: 55,
    dueDate: daysFromNow(33),
    kpis: [
      { name: 'Commitments', current: 3.2, target: 5.0, unit: 'M' },
      { name: 'Runway added', current: 8, target: 14, unit: ' mo' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Introductions facilitated (talent / customer / capital).
// ---------------------------------------------------------------------------
export const INTRODUCTIONS = [
  { id: 'i-1', company: 'Nimbus Data', type: 'talent', counterparty: 'Ex-Datadog VP Eng', status: 'accepted', date: daysAgo(9) },
  { id: 'i-2', company: 'Quill AI', type: 'customer', counterparty: 'Fortune 500 CIO', status: 'meeting_set', date: daysAgo(4) },
  { id: 'i-3', company: 'Harbor Fintech', type: 'capital', counterparty: 'Growth-stage fund (Series C lead)', status: 'in_progress', date: daysAgo(15) },
  { id: 'i-4', company: 'Vela Health', type: 'customer', counterparty: 'Regional payer network', status: 'accepted', date: daysAgo(21) },
  { id: 'i-5', company: 'Pixel Forge', type: 'talent', counterparty: 'Head of Growth candidate', status: 'declined', date: daysAgo(30) },
  { id: 'i-6', company: 'Orbit Robotics', type: 'capital', counterparty: 'Strategic corporate investor', status: 'in_progress', date: daysAgo(6) },
  { id: 'i-7', company: 'Summit Logistics', type: 'talent', counterparty: 'Independent board director', status: 'accepted', date: daysAgo(48) },
  { id: 'i-8', company: 'Quill AI', type: 'talent', counterparty: 'Staff ML engineer', status: 'meeting_set', date: daysAgo(2) },
];

// ---------------------------------------------------------------------------
// Portfolio vs industry growth benchmarks.
// ---------------------------------------------------------------------------
export const GROWTH_BENCHMARKS = [
  { metric: 'ARR growth (YoY %)', portfolioMedian: 142, industryMedian: 98 },
  { metric: 'Net revenue retention (%)', portfolioMedian: 118, industryMedian: 106 },
  { metric: 'Gross margin (%)', portfolioMedian: 71, industryMedian: 64 },
  { metric: 'Burn multiple (x)', portfolioMedian: 1.4, industryMedian: 2.1 },
  { metric: 'Rule of 40 (%)', portfolioMedian: 52, industryMedian: 38 },
];
