/**
 * D4818 (#4818) — what the built Portfolio boards read, for the browser pass in
 * `portfolio.a11y.spec.mjs`: Overview, Positions and Performance, as the Worker
 * answers them (the shapes the node suites already hold:
 * portfolio_overview_d4817, portfolio_positions_d4817 and
 * portfolio_performance_d4817). Every /api read on 127.0.0.1 is answered here;
 * a read with no fixture (the shell's own) answers {}. `over` replaces one path's
 * answer; `log` lists each Portfolio read in order. Every name is made up.
 */
import { prepare } from './_editor.mjs';

const NO_MARK = 'No valuation is recorded for this position as of this date; invested cost is not its value.';
export const POSITIONS = { items: [
  { project_id: 1, project: { uid: 'lumen', name: 'Lumen Robotics', sector: 'robotics', stage: 'series_a' }, total_invested: 2000000, latest_ownership_pct: 8.5, latest_round: 'Series A', fmv: 5200000, multiple: 2.6, marked_down: false, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-09-30', mark_basis: 'round_price' },
  { project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs with a long registered company name', sector: 'climate', stage: 'seed' }, total_invested: 1500000, latest_ownership_pct: 6.2, latest_round: 'Seed', fmv: 2400000, multiple: 1.6, marked_down: false, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-03-31', mark_basis: 'round_price' },
  { project_id: 3, project: { uid: 'pelican', name: 'Pelican Pay', sector: 'fintech', stage: 'series_a' }, total_invested: 1250000, latest_ownership_pct: 5, fmv: 1100000, multiple: 0.88, marked_down: true, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: '2026-09-30', mark_basis: 'secondary' },
  { project_id: 4, project: { uid: 'kite', name: 'Kite Systems', sector: 'chips', stage: 'seed' }, total_invested: 1000000, latest_ownership_pct: 4, fmv: 1000000, multiple: 1, marked_down: false, unmarked: true, mark_unavailable_reason: 'no_mark', mark_unavailable: NO_MARK, mark_as_of: null, mark_basis: null },
] };
const returns = (v) => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value, state: 'computed', reason: null }]));
export const ANALYTICS = {
  paid_in: 5750000, distributed: 900000, nav: 9700000, total_value: 10600000, tvpi: 1.84, dpi: 0.16, rvpi: 1.69, moic: 1.84, irr: 0.213, basis: 'gross',
  returns: returns({ tvpi: 1.84, dpi: 0.16, rvpi: 1.69, moic: 1.84, irr: 0.213 }),
  as_of: null, position_count: 4, unmarked_position_count: 1, unusable_mark_count: 0, mark_coverage: 0.75,
};
export const HEALTH = {
  items: [
    { project_id: 1, badge: 'green', intervention: false, snapshot_date: '2026-10-15', stale: false, age_days: 5 },
    { project_id: 2, badge: 'red', intervention: true, snapshot_date: '2026-10-15', stale: false, age_days: 5, previous_status: 'yellow', status_changed_at: '2026-10-10' },
    { project_id: 3, badge: 'yellow', intervention: false, snapshot_date: '2026-10-15', stale: false, age_days: 5 },
  ],
  totals: { green: 1, yellow: 1, red: 1, intervention: 1, stale: 0, not_measured: 1 },
  not_measured: [{ uid: 'kite', name: 'Kite Systems', state: 'not_recorded', reason: 'Not recorded — this company has no health snapshot yet' }],
};
export const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-10-20', period_until: '2026-09-30', period_complete: true, period_in_progress: false,
  population: { basis: 'companies_held_in_book', period: '2026-Q3' }, reported_count: 2, total_count: 4,
  companies: [
    { project_id: 1, reported: true, last_reported_at: '2026-10-02', days_since_report: 18 },
    { project_id: 2, reported: false, last_reported_at: '2026-07-12', days_since_report: 100 },
    { project_id: 3, reported: true, last_reported_at: '2026-10-08', days_since_report: 12 },
    { project_id: 4, reported: false, last_reported_at: null, days_since_report: null },
  ],
};
export const UPDATES = { items: [
  { uid: 'u1', project_id: 1, project: { name: 'Lumen Robotics' }, period: '2026-Q3', submitted_at: '2026-10-02T10:00:00Z', kpis: { runway_months: 30 } },
  { uid: 'u2', project_id: 2, project: { name: 'Northwind Labs with a long registered company name' }, period: '2026-Q2', submitted_at: '2026-07-12T10:00:00Z', kpis: { runway_months: 4.8 } },
] };
export const SUPPORT = { entries: [], untouched: [{ project_id: 4 }],
  totals: { delivered: 7, promised: 4, withdrawn: 0, in_progress: 1, outstanding: 5, overdue: 0, companies_in_book: 4, companies_supported: 3, by_kind: { intro: { entries: 4, delivered: 3, outstanding: 1, meetings_held: 2 } } } };
export const NORTHWIND = {
  project: { uid: 'northwind', name: 'Northwind Labs with a long registered company name' },
  marks: [
    { uid: 'mk-2', as_of_date: '2025-06-15', fmv: 1000000, post_money: 24200000, event: 'Investment', basis: 'cost', source: 'closing docs' },
    { uid: 'mk-1', as_of_date: '2026-03-31', fmv: 2400000, post_money: 38700000, event: 'Priced round', basis: 'round_price', source: 'term sheet' },
  ],
  rounds: [], distributions: [],
};
/** A quarter-end's book: the latest quarters have one, the oldest has none recorded. */
const quarter = (asOf) => (asOf < '2025-12-31' ? { ...ANALYTICS, nav: 0, paid_in: 0, position_count: 0, as_of: asOf, returns: {} } : { ...ANALYTICS, as_of: asOf, nav: asOf < '2026-06-30' ? 6100000 : ANALYTICS.nav });

/** Signs in as an investor and answers every /api read. Returns the user. */
export async function install(page, request, { over = {}, log = [], theme = 'light' } = {}) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, is_super_admin: false, kyc_status: 'approved' };
  await page.addInitScript(({ u, theme: t }) => {
    try {
      localStorage.setItem('user', JSON.stringify(u));
      localStorage.setItem('viewMode', 'investor');
      localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    } catch { /* storage off: the spec fails on sign-in, loudly */ }
  }, { u: user, theme });
  await page.route((u) => u.hostname === '127.0.0.1' && u.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/^\/api\/(positions|portfolio)/.test(path)) log.push(`${path}${url.search}`);
    if (over[path]) return json(...[].concat(over[path](url.searchParams, req)));
    if (path === '/api/auth/me') return json(user);
    if (path === '/api/settings/appearance') return json({ theme });
    if (path === '/api/onboarding/progress') return json({ flow: 'investor', completed_at: '2026-10-01' });
    if (path === '/api/positions') return json(POSITIONS);
    if (path === '/api/positions/analytics') {
      const asOf = url.searchParams.get('as_of');
      return json(asOf ? quarter(asOf) : ANALYTICS);
    }
    if (path === '/api/portfolio/health') return json(HEALTH);
    if (path === '/api/positions/kpi-compliance') return json(COMPLIANCE);
    if (path === '/api/portfolio-updates/latest') return json(UPDATES);
    if (path === '/api/portfolio-support') return json(SUPPORT);
    if (path === '/api/positions/marks') return json({ items: [] });
    if (path === '/api/mark-requests') return json({ items: [] });
    if (path === '/api/positions/northwind') return json(NORTHWIND);
    return json({});
  });
  return user;
}
