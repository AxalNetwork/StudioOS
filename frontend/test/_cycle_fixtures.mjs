/**
 * D661 (#1474) — fixtures shaped exactly like #1469's shared cycle read
 * (D656): `{ cycle, question, figures: [Figure ×4], cards: [Card] }` and
 * `{ module, card, records }`. The 26 modules are the canvas's, in tab order;
 * every chart kind the page draws appears in at least one card. The figures
 * are invented for the test and appear nowhere in the app.
 */

export const MODULES = {
  validate: ['Problem discovery', 'Customer research', 'Ideal customer profile', 'Market intelligence', 'Demand and urgency signals', 'Experiments and evidence'],
  build: ['Solution design', 'Prototype / MVP', 'Product roadmap', 'Founding team', 'Company creation', 'Operating systems'],
  raise: ['Fundraising readiness', 'Investor narrative', 'Pitch deck', 'Data room', 'Cap table', 'Use of funds', 'Capital relationships'],
  grow: ['Product improvement', 'Distribution', 'Revenue and traction', 'Team expansion', 'Partner network', 'Market expansion', 'Durable company-building'],
};

export const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const SPECS = [
  { kind: 'hbar', items: [{ label: 'Onboarding takes weeks', value: 11, tone: 'v1' }, { label: 'Reports by hand', value: 6, tone: 'v2' }, { label: 'No audit trail', value: 2, tone: 'v3' }], more: '+2 more', legend: [{ label: 'Severe', tone: 'v1' }, { label: 'Real', tone: 'v2' }] },
  { kind: 'vbars', values: [2, 3, 1, 4, 3, 5], labels: [{ at: 0, label: 'W35' }, { at: 5, label: 'W40' }] },
  { kind: 'funnel', steps: [{ label: 'Lead', value: 48 }, { label: 'Invited', value: 31 }, { label: 'Booked', value: 19 }, { label: 'Done', value: 14 }] },
  { kind: 'stack', rows: [{ label: 'Segment A', parts: [9, 4, 1] }, { label: 'Segment B', parts: [3, 5, 4] }], tones: ['v1', 'v2', 'grey'], legend: [{ label: 'Strong', tone: 'v1' }, { label: 'Partial', tone: 'v2' }, { label: 'Weak', tone: 'grey' }] },
  { kind: 'bands', items: [{ label: 'Total addressable', value: '$4.2B', source: 'Gartner 2026' }, { label: 'Serviceable', value: '$610M' }, { label: 'Obtainable', value: null }] },
  { kind: 'line', values: [12, 20, 31, 45, 60, 78], target: 100, target_label: 'bar · 100', labels: [{ at: 0, label: 'Aug' }, { at: 5, label: 'Oct' }] },
  { kind: 'vstack', rows: [[1, 0, 0], [1, 1, 0], [2, 1, 1]], tones: ['v3', 'v2', 'v1'] },
  { kind: 'timeline', steps: [{ label: 'Formed', date: '12 Oct', done: true }, { label: 'EIN', date: '20 Oct', done: true }, { label: 'Bank', date: null, done: false }] },
  { kind: 'tiles', items: [{ label: 'Bank', state: 'connected' }, { label: 'Payroll', state: 'failing' }, { label: 'Accounting', state: 'not_connected' }] },
  { kind: 'dots', values: [true, true, false, true], label: 'last 4 weeks' },
  { kind: 'rows', items: [{ label: 'v3 · Seed fund', value: '12 Oct' }, { label: 'Mismatches', value: 2, tone: 'warn' }] },
  { kind: 'progress', items: [{ label: 'Financials', pct: 80 }, { label: 'Legal', pct: null }] },
  { kind: 'big', value: '57%', label: 'called it a need-to-have · 8 of 14' },
  { kind: 'heat', rows: [{ label: 'M1', cells: [1, 0.9, 0.8] }, { label: 'M2', cells: [1, 0.85] }], axis: 'months since signup →' },
];

export const card = (cycle, name, i, extra = {}) => ({
  slug: slugOf(name),
  name,
  state: 'ok',
  range: 'Last 30 days',
  caption: `What ${name} shows.`,
  series: [SPECS[i % SPECS.length], SPECS[(i + 5) % SPECS.length]],
  next: { text: `Next step for ${name}.`, href: `/${cycle}/${slugOf(name)}?focus=next` },
  reason: null,
  ...extra,
});

export const figure = (key, label, value, unit, extra = {}) => ({
  key, label, value, unit, delta_30d: 4, spark: [3, 4, 4, 6, 5, 7, 8, 9], state: value == null ? 'not_recorded' : 'ok', source: 'Interviews', as_of: '2026-10-09', ...extra,
});

let offset = 0;
export const OVERVIEWS = Object.fromEntries(Object.entries(MODULES).map(([cycle, names]) => {
  const start = offset;
  offset += names.length;
  return [cycle, {
    cycle,
    question: 'From the read',
    figures: [
      figure('f1', 'Interviews this month', 14, 'count'),
      figure('f2', 'MRR', 38400, 'usd', { delta_30d: 2300 }),
      figure('f3', 'Hypotheses supported', [3, 7], 'of', { delta_30d: 0 }),
      figure('f4', 'Churn', null, 'pct', { delta_30d: null, spark: [] }),
    ],
    cards: names.map((n, i) => card(cycle, n, start + i)),
  }];
}));

export const records = (name, extra = {}) => ({
  cols: [{ key: 'name', label: 'Name' }, { key: 'state', label: 'State' }, { key: 'date', label: 'Date' }],
  rows: [
    { id: 1, cells: { name: `${name} one`, state: { text: 'Supported', tone: 'ok' }, date: '12 Oct' } },
    { id: 2, cells: { name: `${name} two`, state: null, date: { text: 'Open', href: '/validate/experiments' } } },
  ],
  total: 52,
  page: 1,
  page_size: 25,
  filters: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }] }],
  sorts: [{ key: 'updated', label: 'Updated' }, { key: 'name', label: 'Name' }],
  add: { text: `Add to ${name}`, href: `/${'validate'}/new` },
  ...extra,
});
