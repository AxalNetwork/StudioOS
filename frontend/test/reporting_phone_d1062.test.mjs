/**
 * D1062 (#2932, part 6 of #2427) — Reporting at 390: the founder's desk,
 * builder and Send (RPT20) and the investor's figures, reports and reader
 * (RPT21), mounted at phone width; 44px targets, the keyboard path and the
 * dark pairs.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reporting_phone_d1062.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ReportingDesk from '../src/pages/cycles/ReportingDesk.jsx';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import { reportingApi } from '../src/lib/api/reporting.js';
import { cyclesApi } from '../src/lib/api/cycles.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const UID = 'a'.repeat(32);
const SHA = 'f'.repeat(64);

/** A screen `width` wide: every `(max-width: N)` query answers as a browser would. */
function screen(width) {
  const was = globalThis.matchMedia;
  globalThis.matchMedia = (query) => {
    const m = /max-width:\s*(\d+)/.exec(query);
    return { matches: m ? width <= Number(m[1]) : false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  return () => { globalThis.matchMedia = was; };
}

// ---------------------------------------------------------------- fixtures (fake)

const duty = (o) => ({
  uid: 'd1', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30,
  required_figures: [], required_documents: [], defaulted: [], starts_on: '2026-03-12', status: 'active',
  source: { document: 'voting_rights', clause: '§1.1(a)', kind: 'signed_envelope', signed: true, body_sha256: 'ab' },
  holder: { name: 'Northwind Capital' }, record: { sent: 1, late: 1, missing: 0, waived: 0 }, ...o,
});
const period = (o) => ({ uid: 'p', duty_uid: 'd1', label: 'x', start: '2026-09-01', end: '2026-09-30', due_on: '2026-10-30', expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, ...o });
const DESK = (o = {}) => ({
  ok: true, today: '2026-11-05', project: { id: 7, uid: 'p-acme', name: 'Acme Robotics' }, can_write: true,
  duties: [duty({}), duty({ uid: 'd2', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', holder: { name: 'Bluefern Angels' } })],
  periods: [
    period({ uid: 'p1', label: 'Sep 2026', state: 'late', days_late: 6 }),
    period({ uid: 'p2', label: 'Aug 2026', start: '2026-08-01', end: '2026-08-31', due_on: '2026-09-30', state: 'sent', sent_at: '2026-09-29 10:00:00' }),
    period({ uid: 'p3', duty_uid: 'd2', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30', due_on: '2026-11-14', state: 'due', days_left: 9 }),
  ],
  asks: [], reminders: { offsets: [14], channels: ['in_app'], recipient_user_ids: [5], saved: false, team: [{ id: 5, name: 'Ada' }] },
  ...o,
});
const fig = (o) => ({ module: 'revenue-and-traction', unit: 'usd', source: null, as_of: null, reason: null, team_only: false, included: false, shared: false, typed: false, left_out_reason: null, required: false, value: null, ...o });
const DRAFT = () => ({
  ok: true, view: 'team', uid: UID, kind: 'report', status: 'draft', period: { label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
  title: 'Q3 2026 report', body: null, highlights: [], lowlights: [], include_team: true,
  figures: [fig({ key: 'mrr', label: 'MRR', value: 48200, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-10-31', included: true })],
  figures_sha256: SHA, meets: [{ period_uid: 'p3', label: 'Q3 2026', due_on: '2026-11-14', duty_uid: 'd2', kind: 'quarterly_kpi', title: 'Quarterly KPI report', holder: { name: 'Bluefern Angels' }, without: [] }],
  revision: 1, correction_reason: null, corrected_by: null, documents: [], sent_at: null, recipients: [],
});

// ---------------------------------------------------------------- the founder's harness

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const click = async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { root, byId, text: (id) => text(byId(id)), props: (id) => props(byId(id)), has: (id) => !!byId(id), settle, click, close };
}
function Probe() { const l = useLocation(); return h('span', { 'data-testid': 'probe' }, `${l.pathname}${l.search}`); }
const page = (url, props) => h(MemoryRouter, { initialEntries: [url] },
  h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, h(ReportingDesk, { projectId: 7, search: '?project_id=7', cards: [], ...props }), h(Probe)) })));

function stubs(over = {}) {
  const was = { ...reportingApi };
  const wasModule = cyclesApi.module;
  const calls = [];
  const rec = (name, out) => async (...a) => { calls.push([name, ...a]); return typeof out === 'function' ? out(...a) : out; };
  Object.assign(reportingApi, {
    desk: rec('desk', DESK()), draftReport: rec('draftReport', { uid: UID }), report: rec('report', DRAFT()),
    saveReport: rec('saveReport', () => ({ ...DRAFT(), unreadable: [] })),
    previewReport: rec('previewReport', { ...DRAFT(), as: 'investor', figures_sha256: SHA, stale: false, stale_reason: null, figures: [] }),
    sendReport: rec('sendReport', { ok: true, uid: UID }),
    ...over,
  });
  cyclesApi.module = rec('module', { parts: { updates: [] } });
  return { calls, restore: () => { Object.assign(reportingApi, was); cyclesApi.module = wasModule; } };
}

// ---------------------------------------------------------------- RPT20a: the desk

test('RPT20a at 390: Due next, the periods as a list of 44px rows with their pills, and Prepare pinned above the tab bar', async () => {
  const t = harness();
  const back = screen(390);
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk', phone: true })));
    await t.settle();
    assert.match(t.text('reporting-due-next'), /Q3 2026 · due 14 Nov/);
    assert.ok(!t.has('reporting-due-next-prepare'), 'the primary is in the bar, not twice');
    assert.ok(!t.has('reporting-calendar-grid'), 'no twelve-column grid at 390');
    assert.ok(t.has('reporting-periods'));
    // By due date; each row a button with the period, its duty, its holder and its pill.
    assert.match(t.text('reporting-period-p2'), /Aug 2026 · Monthly financial statements.*Northwind Capital · due 30 Sep 2026.*✓ Sent/s);
    assert.match(t.text('reporting-period-p1'), /Sep 2026.*◷ Late · 6 days/s);
    assert.match(t.text('reporting-period-p3'), /Q3 2026 · Quarterly KPI report.*Due in 9 days/s);
    for (const id of ['reporting-period-p1', 'reporting-tab-desk', 'reporting-tab-duties']) assert.match(t.props(id).className, /\bmin-h-11\b/, `${id} is a 44px target`);
    assert.match(t.props('reporting-period-p1').className, /focus-visible:ring-2/, 'a keyboard press is seen');
    // A row selects its period, said in the panel, with Prepare and the expected date.
    await t.click('reporting-period-p1');
    assert.equal(t.props('reporting-period-p1')['aria-pressed'], true);
    assert.match(t.text('reporting-selected'), /Sep 2026 monthly financial statements to Northwind Capital.*6 days late/s);
    assert.match(t.props('reporting-selected-prepare').className, /\bmin-h-11\b/);
    assert.match(t.props('reporting-selected-expect').className, /\bmin-h-11\b/);
    // The pinned bar: above the phone tab bar, full width, the period named.
    assert.match(t.props('reporting-prepare-bar').className, /\bsticky\b.*bottom-\[var\(--mobile-tabbar-h,0px\)\]/);
    assert.equal(t.text('reporting-prepare-pinned'), 'Prepare Q3 2026 report');
    assert.match(t.props('reporting-prepare-pinned').className, /\bmin-h-11\b.*\bflex-1\b/);
    await t.click('reporting-prepare-pinned');
    assert.deepEqual(s.calls.find((c) => c[0] === 'draftReport'), ['draftReport', 'p3']);
    assert.equal(t.text('probe'), `/grow/reporting/${UID}/edit?project_id=7`);
  } finally { s.restore(); back(); await t.close(); }
});

test('the desk: no bar for a reader or with nothing open, and the desktop keeps its calendar and header primary', async () => {
  for (const [desk, why] of [[DESK({ can_write: false }), 'a reader prepares nothing'], [DESK({ periods: [period({ uid: 'p2', state: 'sent', sent_at: '2026-09-29' })] }), 'nothing open']]) {
    const t = harness(); const back = screen(390); const s = stubs({ desk: async () => desk });
    try {
      await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk', phone: true })));
      await t.settle();
      assert.ok(t.has('reporting-periods'), why);
      assert.ok(!t.has('reporting-prepare-bar'), why);
    } finally { s.restore(); back(); await t.close(); }
  }
  const t = harness(); const back = screen(1280); const s = stubs();
  try {
    await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk' })));
    await t.settle();
    assert.ok(t.has('reporting-calendar-grid') && !t.has('reporting-periods'));
    assert.ok(t.has('reporting-due-next-prepare') && !t.has('reporting-prepare-bar'));
    assert.match(t.props('reporting-due-next-prepare').className, /lg:min-h-0/, 'the desktop keeps its compact buttons');
  } finally { s.restore(); back(); await t.close(); }
});

// ---------------------------------------------------------------- RPT20b, RPT20c: the builder and Send

test('RPT20b at 390: one step to the screen, Save draft and Next pinned, the step before one press back; Send is a bottom sheet (RPT20c)', async () => {
  const t = harness();
  const back = screen(390);
  const s = stubs();
  try {
    await act(async () => t.root.render(page(`/grow/reporting/${UID}/edit?project_id=7`, { tab: 'edit', reportUid: UID, phone: true })));
    await t.settle();
    assert.equal(t.text('reporting-step-count'), 'Step 1 of 4 · Figures');
    assert.ok(!t.has('reporting-step-figures-tab'), 'no row of step pills at 390');
    assert.ok(!t.has('reporting-back'), 'nothing before the first step');
    assert.match(t.props('reporting-builder-bar').className, /\bsticky\b.*bottom-\[var\(--mobile-tabbar-h,0px\)\]/);
    for (const id of ['reporting-save-draft', 'reporting-next']) assert.match(t.props(id).className, /\bmin-h-11\b.*\bflex-1\b/, id);
    // Save draft saves with no change, which re-reads the stores, and says so.
    const saves = s.calls.filter((c) => c[0] === 'saveReport').length;
    await t.click('reporting-save-draft');
    assert.equal(s.calls.filter((c) => c[0] === 'saveReport').length, saves + 1);
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1), ['saveReport', UID, {}]);
    assert.match(t.text('reporting-saved'), /^Draft saved \d\d:\d\d$/);
    await t.click('reporting-next');
    assert.equal(t.text('reporting-step-count'), 'Step 2 of 4 · Narrative and documents');
    assert.equal(t.text('reporting-back'), '‹ Figures');
    assert.match(t.props('reporting-back').className, /\bmin-h-11\b/);
    await t.click('reporting-back');
    assert.equal(t.text('reporting-step-count'), 'Step 1 of 4 · Figures');
    await t.click('reporting-next'); await t.click('reporting-next'); await t.click('reporting-next');
    assert.equal(t.text('reporting-step-count'), 'Step 4 of 4 · Preview');
    assert.ok(!t.has('reporting-next'), 'the last step has no Next; Send is its press');
    assert.ok(t.has('reporting-save-draft'));
    await t.click('reporting-send-open');
    assert.equal(t.props('reporting-send-layer')['data-phone'], 'sheet', 'Send is a bottom sheet');
    assert.match(t.props('reporting-send-go').className, /max-sm:min-h-11/);
    await t.click('reporting-send-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'sendReport'), ['sendReport', UID, SHA]);
  } finally { s.restore(); back(); await t.close(); }
});

test('the builder on a desktop keeps the step pills and the Back and Next row, with no pinned bar', async () => {
  const t = harness(); const back = screen(1280); const s = stubs();
  try {
    await act(async () => t.root.render(page(`/grow/reporting/${UID}/edit?project_id=7`, { tab: 'edit', reportUid: UID })));
    await t.settle();
    assert.ok(t.has('reporting-step-figures-tab') && t.has('reporting-back'));
    assert.ok(!t.has('reporting-builder-bar') && !t.has('reporting-step-count') && !t.has('reporting-save-draft'));
  } finally { s.restore(); back(); await t.close(); }
});

// ---------------------------------------------------------------- RPT21: the investor

const iperiod = (uid, duty, label, due, state, extra = {}) => ({ uid, duty_uid: duty, label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, asked: false, report_uid: null, state, ...extra });
const ACME = {
  uid: 'p-abc', name: 'Acme Robotics',
  duties: [
    { uid: 'd-kpi', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: [], source: { document: 'voting_rights', clause: '§1.1(b)', signed: true }, defaulted: [], holding: { route: 'direct' } },
    { uid: 'd-mon', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, required_figures: [], source: { document: 'term_sheet', clause: '§2.2', signed: false }, defaulted: [], holding: { route: 'direct' } },
  ],
  periods: [
    iperiod('pq2', 'd-kpi', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-12 10:00:00', report_uid: 'r2' }),
    iperiod('pm9', 'd-mon', '2026-09', '2026-10-30', 'late', { days_late: 6, expected_on: '2026-11-14', expected_note: 'Waiting on our accountant’s close' }),
    iperiod('pq3', 'd-kpi', '2026-Q3', '2026-11-14', 'due', { days_left: 9 }),
  ],
};
const READER = { ok: true, view: 'investor', uid: 'r2', status: 'sent', period: { label: '2026-Q2' }, title: null, sent_at: '2026-08-12 10:00:00', revision: 1, body: 'A steady quarter.', meets: [], figures: [], documents: [] };
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function investorAt(url, width, over = {}) {
  const restore = installDocument();
  const back = screen(width);
  const prev = { fetch: globalThis.fetch };
  const routes = {
    '/positions': { items: [{ project_id: 4, project: { uid: 'p-abc', name: 'Acme Robotics', stage: 'Seed' }, total_invested: 250000 }] },
    '/reporting/companies/p-abc': { ok: true, company: ACME },
    '/reporting/companies/p-abc/figures': { ok: true, reports: [] },
    '/portfolio-updates?project_id=4': { items: [] },
    '/reporting/reports/r2': READER,
    ...over,
  };
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method });
    if (path.includes('client-error')) return response({});
    const hit = routes[`${method} ${path}`] ?? routes[path];
    const out = typeof hit === 'function' ? await hit(path, opts) : hit;
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/portfolio/companies/:uid', element: h(PortfolioCompanyPage) }),
    h(Route, { path: '/portfolio/companies/:uid/reports', element: h(PortfolioCompanyPage) })))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev.fetch; localStorage.removeItem('user'); back(); restore(); },
  };
}

test('RPT21a at 390: the figures one chart per screen width, and the company tabs are 44px targets', async () => {
  const reports = [{ uid: 'r2', period: { label: '2026-Q2', start: '2026-04-01', end: '2026-06-30' }, sent_at: '2026-08-12', revision: 1, corrected: false,
    figures: [{ key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', value: 44100, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-06-30', left_out: false }] }];
  const v = await investorAt('/portfolio/companies/p-abc', 390, { '/reporting/companies/p-abc/figures': { ok: true, reports } });
  try {
    assert.match(v.props('company-figure-mrr').className, /\bflex-col\b/);
    assert.match(v.props('company-figure-toggle-mrr').className, /\bmin-h-11\b.*\bsm:min-h-0\b/);
    assert.match(v.props('company-figure-grid').className, /\bgrid-cols-1\b.*\bmd:grid-cols-2\b/);
    assert.match(v.props('company-tab-reports').className, /\bmin-h-11\b/);
  } finally { await v.close(); }
});

test('RPT21b, RPT21c at 390: Reports as a list; a late period opens full screen with ‹ Reports, its Late pill and Ask pinned; a sent one opens the reader the same way', async () => {
  const posted = [];
  const v = await investorAt('/portfolio/companies/p-abc/reports', 390, { 'POST /reporting/periods/pm9/ask': (p) => { posted.push(p); return { ok: true, asked: true }; } });
  try {
    assert.ok(v.has('company-timeline-list'));
    assert.ok(!v.has('company-period-ask-pm9') && !v.has('company-period-read-pq2'), 'no row of buttons at 390: the row is the press');
    assert.match(v.text('company-period-pm9'), /Sep 2026 · Monthly financial statements.*Due 30 Oct 2026 · expected 14 Nov 2026.*Late · 6 days/);
    assert.match(v.props('company-period-pm9').className, /\bmin-h-11\b.*focus-visible:ring-2/);
    await v.click('company-period-pm9');
    assert.notEqual(v.props('company-period-sheet-layer')['data-phone'], 'sheet', 'full screen, not a bottom sheet');
    assert.ok(!v.has('company-period-sheet-close'), 'the crumb is the way back, not the dialog’s ×');
    assert.equal(v.text('company-sheet-back'), '‹ Reports');
    assert.match(v.props('company-sheet-back').className, /\bmin-h-11\b/);
    assert.match(v.text('company-sheet-head'), /‹ Reports Sep 2026 update Late · 6 days Monthly financial statements from Acme Robotics/);
    assert.match(v.props('company-sheet-pill').className, /amber/, 'late is amber, never red');
    assert.match(v.text('company-sheet-due'), /Due 30 Oct 2026 · expected 14 Nov 2026: ‘Waiting on our accountant’s close’/);
    assert.equal(v.text('company-sheet-ask'), 'Ask for this report');
    assert.match(v.props('company-sheet-ask').className, /max-sm:min-h-11.*max-sm:flex-1/);
    assert.deepEqual(posted, [], 'opening asks nothing');
    await v.click('company-sheet-ask');
    assert.ok(v.has('company-ask-dialog') && !v.has('company-period-sheet'));
    await v.click('company-ask-confirm');
    assert.deepEqual(posted, ['/reporting/periods/pm9/ask']);
    // A due period: nothing to ask yet, so Waive alone.
    await v.click('company-period-pq3');
    assert.ok(!v.has('company-sheet-ask') && v.has('company-sheet-waive'));
    await v.click('company-sheet-back');
    assert.ok(!v.has('company-period-sheet'), '‹ Reports closes the sheet');
    // A sent period opens the reader, full screen, with the same head.
    await v.click('company-period-pq2');
    assert.ok(v.has('company-reader'));
    assert.notEqual(v.props('company-reader-layer')['data-phone'], 'sheet', 'full screen, not a bottom sheet');
    assert.ok(!v.has('company-reader-close'));
    assert.match(v.text('company-sheet-head'), /‹ Reports Q2 2026 report Sent · on time Quarterly KPI report from Acme Robotics/);
    await v.click('company-sheet-back');
    assert.ok(!v.has('company-reader'));
  } finally { await v.close(); }
});

test('the investor on a desktop keeps the timeline’s buttons and the reader’s own head', async () => {
  const v = await investorAt('/portfolio/companies/p-abc/reports', 1280);
  try {
    assert.ok(!v.has('company-timeline-list') && v.has('company-period-ask-pm9'));
    await v.click('company-period-read-pq2');
    assert.ok(v.has('company-reader-close') && !v.has('company-sheet-head'));
  } finally { await v.close(); }
});

test('source: every light hover has its dark pair; lateness stays amber; no pop-up', () => {
  const files = [
    'frontend/src/pages/cycles/ReportingDesk.jsx', 'frontend/src/pages/cycles/reporting/DeskBlocks.jsx', 'frontend/src/pages/cycles/reporting/ReportPage.jsx',
    'frontend/src/pages/cycles/reporting/ReportingDialogs.jsx', 'frontend/src/pages/investor/CompanyReports.jsx', 'frontend/src/pages/investor/PortfolioCompanyPage.jsx',
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(|\bprompt\(/, f);
    for (const m of src.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) assert.match(m[1], /dark:hover:/, `${f}: ${m[1].slice(0, 90)}`);
  }
  assert.doesNotMatch(read('frontend/src/pages/investor/CompanyReports.jsx'), /\b(bg|text|border)-red-/);
  // The reminder dialog's checkboxes: each row a 44px target below 640px.
  assert.match(read('frontend/src/pages/cycles/reporting/ReportingDialogs.jsx'), /<label className="flex min-h-11 items-center gap-2 sm:min-h-0" key=\{testId\}>/);
});
