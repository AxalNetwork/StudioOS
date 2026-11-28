/**
 * D4818 (#4818) — what the built Portfolio boards read, for the browser pass in
 * `portfolio.a11y.spec.mjs`: Overview, Positions and Performance, as the Worker
 * answers them (the shapes the node suites already hold:
 * portfolio_overview_d4817, portfolio_positions_d4817 and
 * portfolio_performance_d4817). Part 3 adds Reports, Value-add, one company's
 * workspace and the admin's money sheet, in the shapes of
 * portfolio_reports_d4817, portfolio_value_add_d4817,
 * portfolio_report_ask_d4817 and portfolio_write_flow_d4817. Every /api read on
 * 127.0.0.1 is answered here; a read with no fixture (the shell's own) answers
 * {}. `over` replaces one path's answer (`over[path](searchParams, request)`,
 * any method); `log` lists each Portfolio read in order, with its method when it
 * is not a GET. `as` signs in as 'investor' (the default), 'admin' (an
 * administrator in their own shell) or 'preview' (an administrator previewing
 * the Investor shell, D4817 part 8). Part 4 (D4818-p4) adds a second company,
 * Lumen, to the investor's workspace and the admin's book, so a check can
 * change company while the first company's answer is still on its way; a
 * delay is an `over` that awaits before it answers. Every name is made up.
 *
 * From frontend/tests/visual/README.md (moved by #6472): The reads those boards make, answered for
 * that spec as the Worker answers them, signed in as an investor; made-up names
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
const entry = (o) => ({
  fund_id: null, hours: null, promised_at: null, delivered_at: null, withdrawn_at: null, outcome: null, due_date: null,
  recorded_by: 7, updated_at: o.created_at, revision: 1, updated_by: 7, ...o,
});
/** The support ledger (`GET /api/portfolio-support`): one open intro, one open review, one delivered entry amended once. */
export const SUPPORT = {
  entries: [
    entry({ uid: 'nw-intro', project_id: 2, project_uid: 'northwind', project_name: 'Northwind Labs with a long registered company name', kind: 'intro', state: 'promised', summary: 'Intro to two climate-fund partners', promised_at: '2026-10-14', created_at: '2026-10-14T09:00:00Z' }),
    entry({ uid: 'lu-review', project_id: 1, project_uid: 'lumen', project_name: 'Lumen Robotics', kind: 'customer', state: 'in_progress', hours: 2, summary: 'Review pricing model', created_at: '2026-10-02T10:00:00Z' }),
    entry({ uid: 'pp-intro', project_id: 3, project_uid: 'pelican', project_name: 'Pelican Pay', kind: 'intro', state: 'delivered', hours: 1.5, summary: 'Intro to Head of Payments, Nordbank', outcome: 'Intro made', delivered_at: '2026-10-19', created_at: '2026-10-05T09:00:00Z', revision: 2 }),
  ],
  page: { offset: 0, limit: 400, total: 3, matching_total: 3, next_offset: null },
  page_state: 'recorded', filter: { state: null },
  companies: [
    { project_id: 1, project_uid: 'lumen', name: 'Lumen Robotics', entries: 1, delivered: 0, promised: 0, withdrawn: 0, hours: 2, entries_without_hours: 0 },
    { project_id: 2, project_uid: 'northwind', name: 'Northwind Labs with a long registered company name', entries: 1, delivered: 0, promised: 1, withdrawn: 0, hours: 0, entries_without_hours: 1 },
    { project_id: 3, project_uid: 'pelican', name: 'Pelican Pay', entries: 1, delivered: 1, promised: 0, withdrawn: 0, hours: 1.5, entries_without_hours: 0 },
    { project_id: 4, project_uid: 'kite', name: 'Kite Systems', entries: 0, delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 },
  ],
  untouched: [{ project_id: 4, project_uid: 'kite', name: 'Kite Systems' }],
  totals_basis: 'all_entries_in_scope', totals_reason: null,
  totals: {
    delivered: 1, promised: 1, withdrawn: 0, in_progress: 1, cancelled: 0, outstanding: 2, overdue: 0,
    overdue_basis: "open entries whose due date is before the Worker's date (UTC)", entries: 3, hours_recorded: 3.5, entries_without_hours: 1,
    companies_in_book: 4, companies_supported: 3,
    by_kind: { intro: { entries: 2, delivered: 1, outstanding: 1, meetings_held: 0 }, customer: { entries: 1, delivered: 0, outstanding: 1, meetings_held: 0 } },
  },
};
export const SUPPORT_HISTORY = { items: [{ uid: 'e1', revision: 2, action: 'amended', actor: { name: 'Priya Example' }, created_at: '2026-10-20T08:00:00Z', changed: ['outcome'] }] };
/** The chase log (`GET /api/portfolio/chases`): nobody chased yet. */
export const CHASES = { items: [] };
const period = (uid, duty, label, due, state, extra = {}) => ({
  uid, duty_uid: duty, label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null,
  days_late: null, days_left: null, asked: false, asked_at: null, waived_by_you: null, report_uid: null, state, ...extra,
});
/** What Northwind owes this investor under a signed document (`GET /api/reporting/companies/northwind`): one late month. */
export const OWED = {
  ok: true, today: '2026-11-05', can_act: true, act_refusal: null,
  company: {
    uid: 'northwind', name: 'Northwind Labs with a long registered company name',
    duties: [{ uid: 'd-mon', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, required_figures: ['cash', 'revenue', 'net_burn'], required_documents: ['statements'], source: { document: 'voting_rights', clause: '§7.2', signed: true }, defaulted: [], holding: { route: 'direct' } }],
    periods: [
      period('pm8', 'd-mon', '2026-08', '2026-09-30', 'sent', { start: '2026-08-01', end: '2026-08-31', sent_at: '2026-09-28 10:00:00', report_uid: 'r8' }),
      period('pm9', 'd-mon', '2026-09', '2026-10-30', 'late', { start: '2026-09-01', end: '2026-09-30', days_late: 6 }),
    ],
  },
};
export const ASK_ANSWER = { ok: true, asked: true, chase_uid: 'c0ffee00c0ffee00c0ffee00c0ffee00', period: { uid: 'pm9', label: '2026-09' }, asked_at: '2026-11-05 09:15:00', by_you: true, told: { team: 2, in_app: 1 } };
/** One company's book for the admin's position sheet (PF-07). */
export const DETAIL = {
  project: { id: 2, uid: 'northwind', name: 'Northwind Labs' },
  rounds: [{ uid: 'r1', round_name: 'Seed', invested_amount: 1500000, ownership_pct: 6.2 }],
  cap_table_snapshot: [],
  marks: [{ uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price', event: 'Priced round' }],
  distributions: [],
};
/** Part 4: a second company's book, so a sheet can change company while the first company's read is late. */
export const LUMEN_DETAIL = {
  project: { id: 1, uid: 'lumen', name: 'Lumen Robotics' },
  rounds: [{ uid: 'r2', round_name: 'Series A', invested_amount: 2000000, ownership_pct: 8.5 }],
  cap_table_snapshot: [],
  marks: [{ uid: 'm9', as_of_date: '2026-09-30', fmv: 5200000, basis: 'round_price', event: 'Series A' }],
  distributions: [],
};
export const ADMIN_POSITIONS = { items: [
  { project_id: 2, project: DETAIL.project, total_invested: 1500000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed' },
  { project_id: 1, project: LUMEN_DETAIL.project, total_invested: 2000000, rounds: 1, latest_ownership_pct: 8.5, latest_round: 'Series A' },
] };
export const STORED_MARK = {
  id: 41, uid: 'mk-7f3a', fund_id: null, project_id: 2, as_of_date: '2026-09-30', fmv: 2100000, post_money: null,
  event: 'Down round', basis: 'gp_estimate', source: 'Q3 board pack', note: null, created_by: 1, created_at: '2026-11-14T14:44:09.120Z',
};
export const NORTHWIND = {
  project: { uid: 'northwind', name: 'Northwind Labs with a long registered company name' },
  marks: [
    { uid: 'mk-2', as_of_date: '2025-06-15', fmv: 1000000, post_money: 24200000, event: 'Investment', basis: 'cost', source: 'closing docs' },
    { uid: 'mk-1', as_of_date: '2026-03-31', fmv: 2400000, post_money: 38700000, event: 'Priced round', basis: 'round_price', source: 'term sheet' },
  ],
  rounds: [], distributions: [],
};
export const LUMEN = {
  project: { uid: 'lumen', name: 'Lumen Robotics' },
  marks: [{ uid: 'mk-9', as_of_date: '2026-09-30', fmv: 5200000, post_money: 61000000, event: 'Series A', basis: 'round_price', source: 'term sheet' }],
  rounds: [], distributions: [],
};
/** What Lumen owes this investor: one duty, its only period received. */
export const LUMEN_OWED = {
  ok: true, today: '2026-11-05', can_act: true, act_refusal: null,
  company: {
    uid: 'lumen', name: 'Lumen Robotics',
    duties: [{ ...OWED.company.duties[0], uid: 'd-lu' }],
    periods: [period('pl9', 'd-lu', '2026-09', '2026-10-30', 'sent', { start: '2026-09-01', end: '2026-09-30', sent_at: '2026-10-02 10:00:00', report_uid: 'r9' })],
  },
};

/** A quarter-end's book: the latest quarters have one, the oldest has none recorded. */
const quarter = (asOf) => (asOf < '2025-12-31' ? { ...ANALYTICS, nav: 0, paid_in: 0, position_count: 0, as_of: asOf, returns: {} } : { ...ANALYTICS, as_of: asOf, nav: asOf < '2026-06-30' ? 6100000 : ANALYTICS.nav });

/** Signs in as an investor and answers every /api read. Returns the user. */
export async function install(page, request, { over = {}, log = [], theme = 'light', as = 'investor' } = {}) {
  const m = await prepare(page, request, { as: 'security' });
  const admin = as !== 'investor';
  const user = { ...m.security.user, role: admin ? 'admin' : 'investor', is_superadmin: admin, is_super_admin: admin, kyc_status: 'approved' };
  const viewMode = as === 'admin' ? 'admin' : 'investor';
  await page.addInitScript(({ u, theme: t, mode }) => {
    try {
      localStorage.setItem('user', JSON.stringify(u));
      localStorage.setItem('viewMode', mode);
      localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    } catch { /* storage off: the spec fails on sign-in, loudly */ }
  }, { u: user, theme, mode: viewMode });
  await page.route((u) => u.hostname === '127.0.0.1' && u.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/^\/api\/(positions|portfolio|reporting)/.test(path)) log.push(`${req.method() === 'GET' ? '' : `${req.method()} `}${path}${url.search}`);
    if (over[path]) {
      const out = await over[path](url.searchParams, req);
      if (out !== undefined) return json(...[].concat(out));
    }
    if (path === '/api/auth/me') return json(user);
    if (path === '/api/settings/appearance') return json({ theme });
    if (path === '/api/onboarding/progress') return json({ flow: 'investor', completed_at: '2026-10-01' });
    if (path === '/api/dashboard') return json({ user, role_view: viewMode });
    if (path === '/api/positions') return json(as === 'admin' ? ADMIN_POSITIONS : POSITIONS);
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
    if (path === '/api/positions/northwind') return json(as === 'admin' ? DETAIL : NORTHWIND);
    if (path === '/api/positions/lumen') return json(as === 'admin' ? LUMEN_DETAIL : LUMEN);
    if (/^\/api\/positions\/(northwind|lumen)\/activity$/.test(path)) return json({ items: [], sources: [], next_cursor: null });
    if (path === '/api/portfolio/chases') return json(CHASES);
    if (/^\/api\/portfolio-support\/[^/]+\/history$/.test(path)) return json(SUPPORT_HISTORY);
    if (path === '/api/reporting/companies/northwind') return json(OWED);
    if (path === '/api/reporting/companies/lumen') return json(LUMEN_OWED);
    if (/^\/api\/reporting\/companies\/(northwind|lumen)\/figures$/.test(path)) return json({ ok: true, reports: [] });
    if (/^\/api\/portfolio\/health\/(northwind|lumen)$/.test(path)) return json({ latest: null, history: [] });
    if (path === '/api/portfolio-updates') return json({ items: [] });
    if (/^\/api\/portfolio-notes\/companies\/(northwind|lumen)$/.test(path)) return json({ items: [], can_write: true, write_refusal: null });
    if (/^\/api\/portfolio-rights\/(northwind|lumen)$/.test(path)) return json({ rights: [], requests: [] });
    if (/^\/api\/portfolio-pro-rata\/(northwind|lumen)$/.test(path)) return json({ live_round: null, offer: null });
    return json({});
  });
  return user;
}
