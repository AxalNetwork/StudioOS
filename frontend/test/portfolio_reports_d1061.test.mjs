// D1061 (#2931, part 5 of #2427) — Portfolio › Reports (RPT9), the company
// page's Figures, Reports and Terms (RPT10), the reader with Ask and Waive
// (RPT11), the holding variants (RPT13) and the dark colours (RPT12).
// Never another investor's name, duty or state; no score, rank or red for
// lateness; no alert or confirm; a missing value is never drawn as 0.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_reports_d1061.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PortfolioReports, { PILL_TONE } from '../src/pages/investor/PortfolioReports.jsx';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import {
  FIGURE_KEYS, HOLDING_NOTES, companyRows, filterRows, formatValue, periodPill, periodWord, readerModules, reportTiles, sentLate, seriesLine,
  seriesOf, sourceWords, stripMark, termsRows, timelineRows, whatChanged,
} from '../src/pages/investor/portfolioReportsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (/disposition/i.test(k) ? 'attachment; filename="q2.pdf"' : 'application/json') }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['%PDF-1.4']) });

/* ------------------------------------------------------------------ *
 * Fixtures: what the Worker answers this investor, and nothing of anyone else
 * ------------------------------------------------------------------ */

const period = (uid, duty, label, due, state, extra = {}) => ({ uid, duty_uid: duty, label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, asked: false, report_uid: null, state, ...extra });
const ACME = {
  uid: 'p-abc', name: 'Acme Robotics',
  duties: [
    { uid: 'd-kpi', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: ['mrr', 'customers'], source: { document: 'voting_rights', clause: '§1.1(b)', signed: true }, defaulted: ['due_days'], holding: { route: 'direct' } },
    { uid: 'd-mon', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, required_figures: [], source: { document: 'term_sheet', clause: '§2.2', signed: false }, defaulted: [], holding: { route: 'direct' } },
  ],
  periods: [
    period('pq1', 'd-kpi', '2026-Q1', '2026-05-15', 'sent', { sent_at: '2026-05-10 10:00:00', report_uid: 'r1' }),
    period('pq2', 'd-kpi', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-18 10:00:00', report_uid: 'r2' }),
    period('pm8', 'd-mon', '2026-08', '2026-09-30', 'waived', { waived_at: '2026-09-02 10:00:00' }),
    period('pm9', 'd-mon', '2026-09', '2026-10-30', 'late', { days_late: 6, expected_on: '2026-11-14', expected_note: 'Waiting on our accountant’s close' }),
    period('pq3', 'd-kpi', '2026-Q3', '2026-11-14', 'due', { days_left: 9 }),
  ],
};
const BLUE = { uid: 'p-blue', name: 'Bluefern Health', duties: [{ uid: 'd-b', kind: 'quarterly_update', title: 'Quarterly investor update', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: [], source: { document: 'deal_pack_side_letter', clause: 'Information rights', signed: true }, defaulted: [], holding: { route: 'syndicate' } }],
  periods: [period('pb1', 'd-b', '2026-Q2', '2026-08-14', 'missing', { days_late: 70 })] };
const COPPER = { uid: 'p-cu', name: 'Copperleaf', duties: [{ uid: 'd-c', kind: 'quarterly_kpi', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: [], source: {}, defaulted: [], holding: { route: 'axal_fund' } }], periods: [] };
const POSITIONS = { items: [{ project_id: 4, project: { uid: 'p-abc', name: 'Acme Robotics', stage: 'Seed' }, total_invested: 250000, latest_round: 'Seed', first_date: '2026-03-12' }] };

const fig = (key, label, module, unit, value, extra = {}) => ({ key, label, module, unit, value, source: value == null ? null : { word: 'Connector', provider: 'stripe', computed: false }, as_of: value == null ? null : '2026-06-30', shared_from_mercury: false, typed: false, left_out: false, left_out_reason: null, ...extra });
const REPORTS = [
  { uid: 'r0', period: { label: '2025-Q2', start: '2025-04-01', end: '2025-06-30' }, sent_at: '2025-08-01', revision: 1, corrected: false, figures: [fig('mrr', 'MRR', 'revenue-and-traction', 'usd', 18000)] },
  { uid: 'r1', period: { label: '2026-Q1', start: '2026-01-01', end: '2026-03-31' }, sent_at: '2026-05-10', revision: 1, corrected: false,
    figures: [fig('mrr', 'MRR', 'revenue-and-traction', 'usd', 31200), fig('customers', 'Customers', 'revenue-and-traction', 'count', 141), fig('headcount', 'Headcount', 'team-expansion', 'count', 11, { source: { word: 'Typed', provider: 'manual', computed: false } })] },
  { uid: 'r2b', period: { label: '2026-Q2', start: '2026-04-01', end: '2026-06-30' }, sent_at: '2026-08-25', revision: 2, corrected: true,
    figures: [fig('mrr', 'MRR', 'revenue-and-traction', 'usd', 44100), fig('customers', 'Customers', 'revenue-and-traction', 'count', null, { left_out: true, left_out_reason: 'Moving billing systems' }), fig('headcount', 'Headcount', 'team-expansion', 'count', 17)] },
];
const READER = { uid: 'r2', title: 'Q2 2026 report', period: { label: '2026-Q2' }, sent_at: '2026-08-18T10:00:00Z', revision: 1, corrected_by: { uid: 'r2b', revision: 2, corrected_on: '2026-08-25', reason: 'MRR restated' }, correction_reason: null,
  body: 'A steady quarter.', meets: [{ label: '2026-Q2', title: 'Quarterly KPI report' }],
  figures: [fig('mrr', 'MRR', 'revenue-and-traction', 'usd', 44100), fig('net_burn', 'Net burn', 'revenue-and-traction', 'usd', 63000, { source: { word: 'Connector', provider: 'mercury', computed: false }, shared_from_mercury: true }), fig('gross_margin', 'Gross margin', 'revenue-and-traction', 'pct', null, { left_out: true, left_out_reason: 'Not tracked until the audit' })],
  documents: [{ uid: 'doc1', filename: 'q2.pdf', label: 'Q2 statements' }] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a period’s pill and strip mark: sent on time or late, waived, late, missing, due; never red', () => {
  const [q1, q2, m8, m9, q3] = ACME.periods;
  assert.deepEqual([q1, q2, m8, m9, q3, BLUE.periods[0]].map((p) => periodPill(p).text), ['Sent · on time', 'Sent · 4 days late', 'Waived · 2 Sep 2026', 'Late · 6 days', 'Due in 9 days', 'Missing']);
  assert.deepEqual([q1, q2, m8, m9, BLUE.periods[0], q3].map(stripMark), ['✓', '✓●', '–', '◷', '⌀', '○']);
  assert.equal(sentLate(q2), 4);
  assert.deepEqual([...new Set([q1, q2, m8, m9, q3, BLUE.periods[0]].map((p) => periodPill(p).tone))].sort(), ['late', 'neutral', 'ok']);
  for (const cls of Object.values(PILL_TONE)) assert.doesNotMatch(cls, /\b(bg|text|border)-red-/, 'lateness is never red');
  assert.equal(periodWord('2026-09'), 'Sep 2026');
  assert.equal(periodWord('2026-Q3'), 'Q3 2026');
  assert.equal(periodWord('B2027'), '2027 budget');
});

test('RPT9’s rows and tiles: the holding, next due, last received, the state needing most attention, eight periods; filters and sort', () => {
  const rows = companyRows([ACME, BLUE, COPPER], POSITIONS.items);
  const acme = rows.find((r) => r.uid === 'p-abc');
  assert.equal(acme.holding, 'Direct · $250,000 invested');
  assert.deepEqual(acme.next, { label: 'Sep 2026', kind: 'Monthly financial statements', due: '30 Oct 2026', due_on: '2026-10-30' });
  assert.equal(acme.last.on, '18 Aug 2026', 'the latest sent');
  assert.deepEqual([acme.state.key, acme.state.text, acme.state.expected], ['late', 'Late · 6 days', '14 Nov 2026']);
  assert.equal(acme.strip.map((s) => s.mark).join(''), '✓✓●–◷○');
  assert.equal(rows.find((r) => r.uid === 'p-blue').holding, 'Via a syndicate (SPV)', 'no position: the route only, never $0');
  assert.equal(rows.find((r) => r.uid === 'p-cu').state.text, 'No period yet');
  const tiles = reportTiles([ACME, BLUE], new Date('2026-11-05T12:00:00Z'));
  assert.deepEqual(tiles.map((t) => [t.key, t.value]), [['due', '1'], ['received', '0 of 1'], ['late', '1'], ['missing', '1']]);
  assert.match(tiles[2].sub, /Acme Robotics · expected 14 Nov/);
  // A quarterly period late since 1 Sep against a monthly one missing since 30 Sep: missing needs more attention.
  const mixed = companyRows([{ uid: 'p-m', name: 'Mixed', duties: [{ uid: 'q', kind: 'quarterly_kpi' }, { uid: 'm', kind: 'monthly_financials' }],
    periods: [period('a', 'q', '2026-Q2', '2026-09-01', 'late', { days_late: 65 }), period('b', 'm', '2026-08', '2026-09-30', 'missing', { days_late: 36 })] }]);
  assert.equal(mixed[0].state.key, 'missing');
  assert.equal(companyRows([BLUE], [{ project: { uid: 'p-blue' }, total_invested: 0 }])[0].holding, 'Via a syndicate (SPV)', 'a zero position is not written as $0 invested');
  const sentThisMonth = { ...ACME, periods: [period('s', 'd-mon', '2026-10', '2026-11-30', 'sent', { sent_at: '2026-11-02' })] };
  assert.equal(reportTiles([sentThisMonth], new Date('2026-11-05T12:00:00Z'))[0].value, '0', 'a sent period is not due');
  assert.deepEqual(filterRows(rows, { state: 'missing' }).map((r) => r.uid), ['p-blue']);
  assert.deepEqual(filterRows(rows, { route: 'axal_fund' }).map((r) => r.uid), ['p-cu']);
  assert.deepEqual(filterRows(rows, { kind: 'quarterly_update' }).map((r) => r.uid), ['p-blue']);
  assert.deepEqual(filterRows(rows, { q: 'acme' }).map((r) => r.uid), ['p-abc']);
  assert.deepEqual(filterRows(rows, { sort: 'due' }).map((r) => r.uid), ['p-blue', 'p-abc', 'p-cu'], 'due soonest; no next due sorts last');
  assert.deepEqual(filterRows(rows, { sort: 'company' }).map((r) => r.name), ['Acme Robotics', 'Bluefern Health', 'Copperleaf']);
});

test('Figures: each report’s frozen value, a gap kept with its reason, the year before, a corrected ring; the words and what changed', () => {
  const mrr = seriesOf(REPORTS, 'mrr');
  assert.deepEqual(mrr.points.map((p) => p.value), [18000, 31200, 44100]);
  assert.deepEqual(mrr.prior, [null, null, 18000], 'Q2 2025 is the dotted year before Q2 2026');
  assert.deepEqual(mrr.points.map((p) => p.corrected), [false, false, true]);
  const cust = seriesOf(REPORTS, 'customers');
  assert.deepEqual(cust.points.map((p) => [p.value, p.reason]), [[null, 'Not in this report'], [141, null], [null, 'Moving billing systems']]);
  assert.equal(seriesLine(cust), 'Customers was 141 in Q1 2026. Q2 2025, Q2 2026: not recorded.');
  assert.equal(seriesLine(seriesOf(REPORTS, 'runway')), 'Runway is not recorded in any report you received.');
  assert.equal(formatValue(null, 'usd'), null, 'a missing value is never "$0"');
  assert.equal(formatValue(0, 'usd'), '$0', 'a reported zero is a zero');
  assert.equal(sourceWords({ word: 'Connector', provider: 'mercury', computed: true }), 'Connector · Mercury · computed');
  const changes = whatChanged(REPORTS, ACME.periods);
  assert.deepEqual(changes.map((c) => c.text), ['MRR $31,200 → $44,100', 'Headcount 11 → 17', 'The Sep 2026 report has not arrived']);
  assert.match(changes[0].sub, /Connector · Stripe · Q1 2026 → Q2 2026/);
  assert.deepEqual(FIGURE_KEYS, ['mrr', 'customers', 'net_burn', 'runway', 'headcount']);
});

test('the timeline, Terms and the reader’s words', () => {
  const rows = timelineRows(ACME);
  assert.deepEqual(rows.map((r) => r.uid), ['pq3', 'pm9', 'pm8', 'pq2', 'pq1'], 'newest first');
  const late = rows.find((r) => r.uid === 'pm9');
  assert.equal(late.sub, 'Due 30 Oct 2026 · expected 14 Nov 2026: ‘Waiting on our accountant’s close’');
  assert.deepEqual([late.canAsk, late.canWaive, late.reportUid], [true, true, null]);
  assert.deepEqual([rows.find((r) => r.uid === 'pq2').reportUid, rows.find((r) => r.uid === 'pq2').canWaive], ['r2', false]);
  assert.equal(rows.find((r) => r.uid === 'pq3').canAsk, false, 'only a late or missing period is asked for');
  assert.equal(timelineRows({ ...ACME, periods: [{ ...ACME.periods[3], asked: true }] })[0].canAsk, false, 'once per period');
  const terms = termsRows(ACME, (k) => ({ mrr: 'MRR', customers: 'Customers' })[k]);
  assert.deepEqual(terms[0], { uid: 'd-kpi', title: 'Quarterly KPI report', rule: '45 days after quarter end', figures: 'MRR, Customers', document: 'Investors’ Rights Agreement', clause: '§1.1(b)', signed: true, defaulted: true, route: 'Direct' });
  assert.equal(terms[1].signed, false);
  const mods = readerModules(READER);
  assert.deepEqual(mods.groups.map((g) => [g.title, g.figures.map((f) => [f.label, f.value, f.source])]), [['Revenue and traction', [['MRR', '$44,100', 'Connector · Stripe'], ['Net burn', '$63,000', 'Connector · Mercury · shared by the founder']]]]);
  assert.deepEqual(mods.leftOut, [{ key: 'gross_margin', label: 'Gross margin', reason: 'Not tracked until the audit' }]);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(element, routes, url = '/') {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, URL: globalThis.URL };
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method });
    const hit = routes[`${method} ${path}`] ?? routes[path];
    const out = typeof hit === 'function' ? await hit(path, opts) : hit;
    if (out && out.__status) return response({ detail: out.detail || 'refused', message: out.detail }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, element)));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    writes: () => asked.filter((a) => a.method !== 'GET'),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, prev); localStorage.removeItem('user'); restore(); },
  };
}
const companyAt = (url, routes) => mount(h(Routes, null,
  h(Route, { path: '/portfolio/companies/:uid', element: h(PortfolioCompanyPage) }),
  h(Route, { path: '/portfolio/companies/:uid/reports', element: h(PortfolioCompanyPage) }),
  h(Route, { path: '/portfolio/companies/:uid/terms', element: h(PortfolioCompanyPage) })), routes, url);
const COMPANY_ROUTES = (over = {}) => ({
  '/positions': POSITIONS,
  '/reporting/companies/p-abc': { ok: true, company: ACME },
  '/reporting/companies/p-abc/figures': { ok: true, reports: REPORTS },
  '/portfolio-updates?project_id=4': { items: [{ uid: 'u9', project_id: 4, title: 'September note', submitted_at: '2026-10-02 10:00:00' }] },
  '/reporting/reports/r2': READER,
  ...over,
});

test('mounted RPT9: the tiles and one row per company, from the portfolio read; filters work; a failed read says so', async () => {
  const v = await mount(h(PortfolioReports), { '/reporting/portfolio': { ok: true, companies: [ACME, BLUE, COPPER] }, '/positions': POSITIONS });
  try {
    assert.ok(v.has('portfolio-tile-due') && v.has('portfolio-tile-missing'));
    assert.match(v.text('portfolio-report-row-p-abc'), /Acme Robotics.*Direct · \$250,000 invested.*30 Oct 2026.*Sep 2026 · Monthly financial statements.*Q2 2026 · Quarterly KPI report.*Received 18 Aug 2026.*Late · 6 days.*Expected 14 Nov 2026.*✓.*✓●.*–.*◷.*○/);
    assert.match(v.text('portfolio-report-row-p-cu'), /Feeds the fund’s quarterly LP report/, 'RPT13: the GP’s line');
    assert.match(v.props('portfolio-report-state-p-abc').className, /amber/);
    await v.change('portfolio-reports-state', 'missing');
    assert.ok(v.has('portfolio-report-row-p-blue') && !v.has('portfolio-report-row-p-abc'));
    assert.deepEqual(v.writes(), [], 'reading writes nothing');
  } finally { await v.close(); }
  const down = await mount(h(PortfolioReports), { '/reporting/portfolio': { __status: 503 }, '/positions': POSITIONS });
  try { assert.match(down.text('portfolio-reports'), /could not be read.*not a claim that nothing is due or late/); } finally { await down.close(); }
  const empty = await mount(h(PortfolioReports), { '/reporting/portfolio': { ok: true, companies: [] }, '/positions': { items: [] } });
  try {
    assert.match(empty.text('portfolio-reports-none'), /No company owes you reports/);
    assert.match(empty.text('portfolio-reports-lp'), /company reports go to the fund.*Axal VC Fund/, 'RPT13c: the LP’s note');
  } finally { await empty.close(); }
});

test('mounted RPT10 Figures: five small multiples from the frozen figures, a dashed gap, a ring, the dotted year before, View as table; it opens no report', async () => {
  const v = await companyAt('/portfolio/companies/p-abc', COMPANY_ROUTES());
  try {
    for (const k of FIGURE_KEYS) assert.ok(v.has(`company-figure-${k}`), k);
    assert.ok(v.has('company-figure-ring-mrr'), 'Q2 2026 was corrected');
    assert.ok(v.has('company-figure-prior-mrr'), 'the year before, dotted');
    assert.ok(v.has('company-figure-tail-customers'), 'the last report left customers out: dashed, never a drop to 0');
    assert.match(v.props('company-figure-chart-customers')['aria-label'], /Q2 2026: not recorded/);
    assert.match(v.text('company-figure-runway'), /not recorded in any report/);
    await v.click('company-figure-toggle-customers');
    assert.match(v.text('company-figure-table-customers'), /Q2 2026 Not recorded · Moving billing systems/);
    assert.match(v.text('company-what-changed'), /MRR \$31,200 → \$44,100.*Headcount 11 → 17.*The Sep 2026 report has not arrived/);
    assert.match(v.text('company-what-changed-note'), /nothing here is saved or sent/);
    assert.ok(!v.asked.some((a) => a.path.startsWith('/reporting/reports/')), 'Figures never opens a report, so no open is recorded');
    assert.match(v.text('company-holding'), /Seed · Your holding: Seed · \$250,000 invested · since 12 Mar 2026 · Direct/);
  } finally { await v.close(); }
});

test('mounted RPT10r and RPT11: the timeline; Read opens the reader with each figure’s source, what was left out and why, and the statements', async () => {
  const saved = [];
  const v = await companyAt('/portfolio/companies/p-abc/reports', COMPANY_ROUTES());
  globalThis.URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  globalThis.URL.revokeObjectURL = () => {};
  try {
    assert.match(v.text('company-period-pm9'), /Sep 2026 · Monthly financial statements.*Due 30 Oct 2026 · expected 14 Nov 2026.*Late · 6 days/);
    assert.ok(!v.has('company-period-read-pm9') && v.has('company-period-ask-pm9') && v.has('company-period-waive-pm9'));
    assert.ok(v.has('company-period-read-pq2') && !v.has('company-period-waive-pq2'));
    assert.ok(!v.has('company-period-ask-pq3') && !v.has('company-period-ask-pq2'), 'only a late or missing period is asked for');
    assert.match(v.text('company-reports'), /Updates you received.*September note/);
    await v.click('company-period-read-pq2');
    assert.ok(v.has('company-reader'));
    assert.match(v.text('company-reader-meta'), /Sent 18 Aug 2026 · corrected by revision 2 on 25 Aug 2026/);
    assert.match(v.text('company-reader-figure-net_burn'), /Net burn.*\$63,000.*Connector · Mercury · shared by the founder/);
    assert.match(v.text('company-reader-left-out'), /Gross margin · ‘ ?Not tracked until the audit ?’/);
    assert.ok(v.asked.some((a) => a.path === '/reporting/reports/r2'));
    await v.click('company-reader-document-doc1');
    assert.ok(v.asked.some((a) => a.path === '/reporting/documents/doc1'), 'a statement is read only when tapped');
    assert.equal(saved.length, 1, 'and handed to the reader to save');
    assert.deepEqual(v.writes(), [], 'reading writes nothing from here; the Worker records the open');
  } finally { await v.close(); }
});

test('mounted RPT11: Ask and Waive each open an in-page dialog that says what it changes; nothing is posted before the press; a refusal is drawn', async () => {
  const posted = [];
  const routes = COMPANY_ROUTES({
    'POST /reporting/periods/pm9/ask': (p) => { posted.push(p); return { ok: true, asked: true }; },
    'POST /reporting/periods/pm9/waive': (p) => { posted.push(p); return { ok: true, waived: true }; },
  });
  const v = await companyAt('/portfolio/companies/p-abc/reports', routes);
  try {
    await v.click('company-period-ask-pm9');
    assert.match(v.text('company-ask-dialog'), /Ask Acme Robotics for the Sep 2026 · Monthly financial statements\?.*The company is told.*Nobody else sees your request.*once per period/);
    assert.deepEqual(v.writes(), []);
    await v.click('company-ask-confirm');
    assert.deepEqual(posted, ['/reporting/periods/pm9/ask']);
    await v.click('company-period-waive-pm9');
    assert.match(v.text('company-waive-dialog'), /Waive Sep 2026 for Acme Robotics\?.*waived by you/);
    await v.click('company-waive-confirm');
    assert.deepEqual(posted, ['/reporting/periods/pm9/ask', '/reporting/periods/pm9/waive']);
  } finally { await v.close(); }
  const refused = await companyAt('/portfolio/companies/p-abc/reports', COMPANY_ROUTES({ 'POST /reporting/periods/pm9/ask': { __status: 409, detail: 'You already asked for this period’s report.' } }));
  try {
    await refused.click('company-period-ask-pm9');
    await refused.click('company-ask-confirm');
    assert.match(refused.text('company-ask-error'), /already asked/);
  } finally { await refused.close(); }
});

test('mounted RPT10t and RPT13: Terms read only from the documents signed; a syndicate holding says only the lead waives', async () => {
  const v = await companyAt('/portfolio/companies/p-abc/terms', COMPANY_ROUTES());
  try {
    assert.match(v.text('company-term-d-kpi'), /Quarterly KPI report.*45 days after quarter end.*Signed document.*Investors’ Rights Agreement §1\.1\(b\).*Default, not in the paper.*Direct/);
    assert.match(v.text('company-term-d-mon'), /From the closing’s template.*Term Sheet §2\.2/);
    assert.ok(!v.has('company-holding-note-direct'), 'a direct holding needs no note');
  } finally { await v.close(); }
  const spv = await companyAt('/portfolio/companies/p-blue/reports', { '/positions': { items: [] }, '/reporting/companies/p-blue': { ok: true, company: BLUE } });
  try {
    assert.ok(spv.text('company-holding-note-syndicate').includes(HOLDING_NOTES.syndicate.slice(0, 40)));
    assert.match(spv.text('company-holding-note-syndicate'), /only the SPV’s lead can waive/);
    assert.match(spv.text('company-period-pb1'), /Missing/);
    assert.ok(!spv.has('company-not-held'), 'owed reports with no position: the page still draws');
  } finally { await spv.close(); }
  const stranger = await companyAt('/portfolio/companies/p-zzz', { '/positions': POSITIONS, '/reporting/companies/p-zzz': { __status: 404 } });
  try { assert.ok(stranger.has('company-not-held')); assert.ok(!stranger.asked.some((a) => a.path.startsWith('/reporting/reports'))); } finally { await stranger.close(); }
});

test('mounted: one failed read never blanks the page', async () => {
  const v = await companyAt('/portfolio/companies/p-abc', COMPANY_ROUTES({ '/reporting/companies/p-abc/figures': { __status: 503 } }));
  try {
    assert.match(v.text('company-figures'), /could not be read.*not a claim that it reported none/);
    assert.ok(v.has('company-tabs') && v.has('company-holding'));
  } finally { await v.close(); }
  const w = await companyAt('/portfolio/companies/p-abc/reports', COMPANY_ROUTES({ '/reporting/companies/p-abc': { __status: 503 } }));
  try {
    assert.match(w.text(), /could not be read.*not a claim that nothing is owed to you/);
    assert.ok(w.has('company-reports'), 'the updates still draw');
  } finally { await w.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: no alert or confirm, the dark colours (RPT12), the Worker routes, Portfolio › Reports mounts RPT9, and the docs', () => {
  const files = ['PortfolioReports.jsx', 'CompanyReports.jsx', 'PortfolioCompanyPage.jsx', 'portfolioReportsModel.js'].map((f) => read(`frontend/src/pages/investor/${f}`));
  for (const src of files) assert.doesNotMatch(src, /\b(window\.)?(alert|confirm)\(/, 'never a browser pop-up');
  for (const src of files.slice(0, 3)) {
    for (const m of src.matchAll(/(?:className|const \w+)\s*=\s*['"`{]([^'"`]*\b(?:bg-white|bg-violet-50|bg-amber-50|bg-emerald-50|border-axal-hairline|text-axal-ink|text-axal-muted)\b[^'"`]*)/g)) {
      assert.match(m[1], /\bdark:/, `no dark pair: ${m[1].slice(0, 80)}`);
    }
  }
  assert.match(read('frontend/src/pages/investor/InvestorPortfolioUpdates.jsx'), /<PortfolioReports \/>/);
  assert.match(read('cloudflare-worker/src/routes/reporting_reports.ts'), /r\.get\('\/companies\/:projectUid\/figures'/);
  assert.match(read('cloudflare-worker/src/routes/reporting.ts'), /report_uid/);
  assert.match(read('frontend/src/lib/api/reporting.js'), /companyFigures:/);
  assert.match(read('documentation/architecture/decisions/D1061.md'), /UNVERIFIED/);
});
