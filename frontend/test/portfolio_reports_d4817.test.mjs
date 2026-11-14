/**
 * D4817 part 4 (#5311, canvas PF-04): Reports, the reporting obligations inbox
 * and the report detail, in the shared Portfolio frame, mounted against
 * stubbed Worker reads in its populated, Not recorded and Unreadable states,
 * with the detail open, plus the pure model it adds. The two company Reports
 * actions (Ask for this report, Waive this period) wait for #4817's addendum
 * and are checked unchanged, as are the page's chase actions.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_reports_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - the Due cell computing days overdue from `days_since_report` → tests 1 and 3;
 *   - `obligationRowsOf` dropping the sort that puts unreported companies
 *     first → tests 1, 5 and 6;
 *   - `missingFor` measuring the required set against an update for another
 *     period → tests 3 and 6;
 *   - `requiredAgainst` counting a blank value as carried → tests 1, 2 and 6;
 *   - `requiredKpisOf` reading an unrecorded `required` (NULL) as required → test 6;
 *   - `lastChaseOf` keeping the oldest chase instead of the newest → tests 1, 2, 4 and 6;
 *   - a failed chase log reading as "Not chased" → tests 4 and 6;
 *   - the inbox drawing an empty book for a failed reporting read → test 4;
 *   - a per-source Retry calling `reload` (every source) → test 4;
 *   - the detail drawing "no update" for a failed updates read → test 4;
 *   - `reportFieldsOf` dropping a figure's source → tests 2 and 6;
 *   - `reportFieldsOf` drawing a blank typed value as 0 → tests 2 and 6;
 *   - the detail's link going to the company Overview, not its Reports → test 5;
 *   - the per-row Chase sending every unreported company → test 5.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioUpdates from '../src/pages/investor/InvestorPortfolioUpdates.jsx';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import {
  figureValue, lastChaseOf, missingFor, obligationRowsOf, periodCovers, periodName, reportFieldsOf, requiredAgainst, requiredKpisOf,
} from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(answer, { element = h(InvestorPortfolioUpdates), url = '/portfolio/updates' } = {}) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ path: u.pathname, query: u.search, method, body: init.body ? JSON.parse(init.body) : null });
    return answer({ path: u.pathname, query: u.search, method }) ?? json({});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, element)));
  await settle();
  const press = async (node, what) => {
    if (!node) throw new Error(`no ${what}`);
    await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
    await settle();
  };
  return {
    calls,
    reads: (path) => calls.filter((c) => c.path === path && c.method === 'GET').length,
    has: (id) => Boolean(byTestId(id)),
    node: byTestId,
    prop: (node, name) => props(node)[name],
    text: (id) => (id ? (byTestId(id) ? squash(textOf(byTestId(id))) : null) : squash(textOf(box))),
    hrefs: () => nodes().filter((n) => n.tagName === 'A').map((n) => props(n).href),
    click: (id) => press(byTestId(id), id),
    clickText: (label) => press(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label),
    buttons: () => nodes().filter((n) => n.tagName === 'BUTTON').map((n) => squash(textOf(n))),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------- the book */

const KPI_SET = [
  { kpi_key: 'mrr', name: 'MRR', unit: 'USD', required: 1, applies_to: 'all', definition: 'Monthly recurring revenue at period end' },
  { kpi_key: 'runway_months', name: 'Runway', unit: 'months', required: 1, applies_to: 'all', definition: null },
  { kpi_key: 'headcount', name: 'Headcount', unit: 'count', required: 0, applies_to: 'all', definition: null },
];
const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-10', period_from: '2026-07-01', period_until: '2026-09-30',
  period_complete: true, period_in_progress: false, population: { basis: 'companies_held_in_book', period: '2026-Q3' },
  kpi_set: KPI_SET,
  companies: [
    { project_id: 2, project_uid: 'pelican', name: 'Pelican Pay', reported: true, last_reported_at: '2026-10-28', days_since_report: 13 },
    { project_id: 1, project_uid: 'northwind', name: 'Northwind Labs', reported: false, last_reported_at: '2026-06-28', days_since_report: 135 },
    { project_id: 3, project_uid: 'fjord', name: 'Fjord Data', reported: false, last_reported_at: null, days_since_report: null },
  ],
  reported_count: 1, total_count: 3,
};
const PELICAN_UPDATE = {
  id: 22, uid: 'u2', project_id: 2, project: { uid: 'pelican', name: 'Pelican Pay' }, period: '2026-Q3', title: 'Q3 update',
  body: 'Q3 was slower than planned: two pilots slipped to December.', status: 'submitted', submitted_at: '2026-10-28T09:00:00Z', version: 2,
  kpis: { mrr: 184000, headcount: 12, runway_months: '' },
  figures: [
    { key: 'mrr', label: 'MRR', value: 184000, unit: 'usd', source: 'stripe', as_of: '2026-09-30', reason: null },
    { key: 'net_burn', label: 'Net burn', value: null, unit: 'usd', source: null, as_of: null, reason: 'Moving banks' },
  ],
};
const NORTHWIND_UPDATE = {
  id: 11, uid: 'u1', project_id: 1, project: { uid: 'northwind', name: 'Northwind Labs' }, period: '2026-Q2', title: 'Q2 update',
  body: null, status: 'submitted', submitted_at: '2026-06-28T09:00:00Z', version: 1, kpis: { mrr: 90000 }, figures: [],
};
const CHASES = { items: [
  { uid: 'c0', project_id: 1, created_at: '2026-10-20T10:00:00Z', chased_by_name: null },
  { uid: 'c1', project_id: 1, created_at: '2026-11-02T10:00:00Z', chased_by_name: 'Morgan' },
] };
const POSITIONS = { items: [
  { project_id: 1, project: { uid: 'northwind', name: 'Northwind Labs' }, total_invested: 500000 },
  { project_id: 2, project: { uid: 'pelican', name: 'Pelican Pay' }, total_invested: 750000 },
  { project_id: 3, project: { uid: 'fjord', name: 'Fjord Data' }, total_invested: 250000 },
] };
const HEALTH = { items: [{ project_id: 2, badge: 'yellow', snapshot_date: '2026-11-01' }], not_measured: [] };
const SIGNED = { ok: true, companies: [{ uid: 'pelican', name: 'Pelican Pay', duties: [{ uid: 'd1', kind: 'quarterly_kpi', holding: { route: 'direct' } }],
  periods: [{ uid: 'pq3', duty_uid: 'd1', label: '2026-Q3', due_on: '2026-11-14', state: 'due', days_left: 4 }] }] };

/** The Worker as it answers today; `over` replaces one path. */
const worker = (over = {}) => ({ path, method }) => {
  if (method !== 'GET') return over[`${method} ${path}`] ? over[`${method} ${path}`]() : json({ chased: [] });
  if (path in over) return typeof over[path] === 'function' ? over[path]() : over[path];
  if (path === '/api/positions/kpi-compliance') return json(COMPLIANCE);
  if (path === '/api/portfolio-updates/latest') return json({ items: [PELICAN_UPDATE, NORTHWIND_UPDATE], companies: 2, complete: true });
  if (path === '/api/positions') return json(POSITIONS);
  if (path === '/api/portfolio/chases') return json(CHASES);
  if (path === '/api/portfolio/health') return json(HEALTH);
  if (path === '/api/reporting/portfolio') return json(SIGNED);
  return json({});
};
const down = () => json({ detail: 'D1_SECRET_INTERNAL_DETAIL' }, 500);

/* -------------------------------------------------------------- mounted */

test('1. populated: one obligation per company, its period, no due date recorded, last received, state as icon and word, missing, last chase', async () => {
  const view = await mount(worker());
  try {
    assert.equal(document.title, 'Reports · Portfolio · Axal VC');
    assert.ok(view.has('investor-portfolio-updates'), 'the page draws in the Portfolio frame');
    for (const to of ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add']) {
      assert.ok(view.hrefs().includes(to), `the local nav lost ${to}`);
    }
    const north = view.text('row-investor-update-1');
    assert.match(north, /Northwind Labs.*Q3 2026.*No due date recorded.*28 Jun 2026.*Not received.*The Q3 2026 update.*2 Nov 2026.*2 chases.*Report detail.*Chase/);
    assert.match(view.text('row-investor-update-2'), /Pelican Pay.*Q3 2026.*No due date recorded.*28 Oct 2026.*Q3 update · Mrr \$184,000 · Headcount 12 · Runway Months Not recorded.*Received.*Runway.*Not chased.*Report detail/);
    assert.match(view.text('row-investor-update-3'), /Fjord Data.*Never reported.*Not received.*Not chased/);
    assert.ok(!view.has('button-chase-2'), 'a company that reported is not chased');
    // State is an icon and a word, never colour alone.
    const state = view.node('status-obligation-1');
    const chip = state.childNodes[0];
    assert.equal(view.prop(chip, 'data-state'), 'Not received');
    assert.ok([...chip.childNodes].some((n) => String(n.tagName).toLowerCase() === 'svg'), 'the state has an icon');
    // Who has not reported reads first.
    const text = view.text();
    assert.ok(text.indexOf('Fjord Data') < text.indexOf('Northwind Labs') && text.indexOf('Northwind Labs') < text.indexOf('Pelican Pay'), 'unreported first, then by name');
    // No due date is recorded, so no overdue days are computed.
    assert.doesNotMatch(text, /\d+ days? overdue|overdue · \d|135 days|\b13 days/);
    assert.match(view.text('reports-tiles'), /Received 1 of 3 for Q3 2026.*Not received 2.*Due date Not recorded/);
    assert.ok(view.hrefs().includes('/portfolio/companies/northwind'), 'the company name is a link');
    // The signed-document duties keep their own section and their own due dates.
    assert.match(view.text('portfolio-reports'), /Pelican Pay.*14 Nov 2026/);
    assert.doesNotMatch(text, /D1_SECRET|\bD\d{3,5}\b|#\d{3,5}\b/);
  } finally { await view.close(); }
});

test('2. the report detail opens: what was received, each field with its source and date, the required set, health, the update as written, history', async () => {
  const view = await mount(worker());
  try {
    assert.ok(!view.has('reports-detail'));
    await view.click('button-open-report-2');
    assert.ok(view.has('reports-detail'), 'the detail opens in the Sheet');
    assert.match(view.text('report-detail-received'), /Update Q3 update.*Period Q3 2026.*Submitted 28 Oct 2026.*Version Version 2.*Source Founder update, shown as submitted/);
    assert.match(view.text('row-report-field-mrr'), /MRR \$184,000 Stripe 30 Sep 2026/);
    assert.match(view.text('row-report-field-net_burn'), /Net burn Not recorded Moving banks None stored Not recorded/);
    assert.match(view.text('row-report-field-headcount'), /Headcount 12 Typed in the update/);
    assert.match(view.text('row-report-field-runway_months'), /Runway Months Not recorded Left blank in the update/);
    assert.doesNotMatch(view.text('report-detail-fields'), /\$0\b| 0 /, 'a blank is never 0');
    assert.match(view.text('report-detail-required'), /Carried MRR.*Missing Runway/);
    assert.match(view.text('reports-detail'), /Watch.*Snapshot of 1 Nov 2026/);
    assert.match(view.text('report-detail-body-text'), /Q3 was slower than planned/);
    assert.match(view.text('report-detail-history'), /28 Oct 2026 Submitted by the founder/);
    // Another company: an update for another period is named so, and the chase log reads newest first.
    await view.click('button-open-report-1');
    assert.match(view.text('report-detail-received'), /Period Q2 2026 · not the period measured/);
    assert.match(view.text('report-detail-history'), /28 Jun 2026 Submitted by the founder.*2 Nov 2026 Chase logged by Morgan.*20 Oct 2026 Chase logged/);
  } finally { await view.close(); }
});

test('3. Not recorded: an empty book, no due date, a company with no update, an update for another period, an empty KPI set', async () => {
  const empty = await mount(worker({ '/api/positions/kpi-compliance': json({ ...COMPLIANCE, companies: [], reported_count: 0, total_count: 0 }) }));
  try {
    assert.match(empty.text('reports-inbox-empty'), /No company is held in this book/);
    assert.match(empty.text('reports-tiles'), /Received 0 of 0/);
  } finally { await empty.close(); }
  const other = await mount(worker({
    '/api/positions/kpi-compliance': json({ ...COMPLIANCE, kpi_set: [] }),
    '/api/portfolio-updates/latest': json({ items: [{ ...PELICAN_UPDATE, period: '2026-Q4' }] }),
    '/api/portfolio/chases': json({ items: [] }),
  }));
  try {
    assert.match(other.text('row-investor-update-2'), /Received.*Not measured: the latest update readable here is for Q4 2026/);
    assert.match(other.text('row-investor-update-1'), /Not chased/);
    assert.doesNotMatch(other.text(), /\d+ days? overdue|135 days/);
    await other.click('button-open-report-3');
    assert.match(other.text('report-detail-none'), /No founder update from Fjord Data is readable here\. The reporting read records none\./);
  } finally { await other.close(); }
  const none = await mount(worker({ '/api/positions/kpi-compliance': json({ ...COMPLIANCE, kpi_set: [] }) }));
  try {
    assert.match(none.text('row-investor-update-2'), /No KPI is required at this cadence/);
  } finally { await none.close(); }
});

test('4. Unreadable: each failed source labels its own cells with a Retry for that source alone; never an empty inbox, a zero or "not chased"', async () => {
  let complianceUp = false;
  const view = await mount(worker({ '/api/positions/kpi-compliance': () => (complianceUp ? json(COMPLIANCE) : down()) }));
  try {
    assert.match(view.text('status-reports-inbox-unreadable'), /Reporting could not be read\. This is not a claim that any company is late or that every company has reported\. Retry/);
    assert.ok(!view.has('reports-inbox-empty'), 'a failed read is not an empty book');
    assert.match(view.text('reports-tiles'), /Received Unreadable.*Not received Unreadable/);
    assert.match(view.text('status-investor-updates-partial'), /Reporting could not be read/);
    assert.doesNotMatch(view.text(), /D1_SECRET_INTERNAL_DETAIL/);
    assert.doesNotMatch(view.text('reports-tiles'), /\b0\b/, 'no zero for a failed read');
    const before = { c: view.reads('/api/positions/kpi-compliance'), u: view.reads('/api/portfolio-updates/latest'), ch: view.reads('/api/portfolio/chases') };
    complianceUp = true;
    await view.click('button-retry-reports-compliance');
    assert.equal(view.reads('/api/positions/kpi-compliance'), before.c + 1, 'Retry reads the reporting source again');
    assert.equal(view.reads('/api/portfolio-updates/latest'), before.u, 'and no other source');
    assert.equal(view.reads('/api/portfolio/chases'), before.ch, 'and no other source');
    assert.match(view.text('row-investor-update-1'), /Northwind Labs.*Not received/);
  } finally { await view.close(); }

  let chasesUp = false;
  const chases = await mount(worker({ '/api/portfolio/chases': () => (chasesUp ? json(CHASES) : down()), '/api/portfolio-updates/latest': down, '/api/portfolio/health': down }));
  try {
    assert.match(chases.text('row-investor-update-1'), /Unreadable · Retry/);
    assert.doesNotMatch(chases.text('row-investor-update-1'), /Not chased/, 'an unreadable log is not "nobody was chased"');
    assert.match(chases.text('row-investor-update-2'), /Received.*Unreadable · Retry.*Unreadable · Retry/, 'missing and chase both unreadable for Pelican');
    assert.match(chases.text('status-investor-updates-partial'), /Founder updates, The chase log, Health could not be read/);
    const u = chases.reads('/api/portfolio-updates/latest');
    chasesUp = true;
    await chases.click('status-chase-1-unreadable-retry');
    assert.match(chases.text('row-investor-update-1'), /2 Nov 2026/, 'the chase log alone was read again');
    assert.equal(chases.reads('/api/portfolio-updates/latest'), u, 'the failed updates read was not asked again');
    // The detail: a failed updates read is Unreadable with its own Retry, never "no update".
    await chases.click('button-open-report-2');
    assert.match(chases.text('status-report-detail-unreadable'), /Founder updates could not be read\. That is not a claim that nothing was received\. Retry/);
    assert.ok(!chases.has('report-detail-none'));
    assert.match(chases.text('status-report-health-unreadable'), /Health could not be read\. That is not a claim that the company is healthy\. Retry/);
    await chases.click('button-retry-report-updates');
    assert.equal(chases.reads('/api/portfolio-updates/latest'), u + 1, 'the detail Retry reads the updates source alone');
  } finally { await chases.close(); }
});

test('5. the two addendum-gated actions are unchanged: Ask and Waive stay on the company Reports; the chase is today’s', async () => {
  const view = await mount(worker());
  try {
    assert.doesNotMatch(view.text(), /Ask for this report|Waive this period/, 'PF-04 draws neither action while #4817’s addendum waits');
    assert.ok(view.hrefs().includes('/portfolio/companies/pelican/reports'), 'the signed-duty row still opens the company Reports');
    await view.click('button-open-report-2');
    assert.equal(view.prop(view.node('link-report-detail-company'), 'href'), '/portfolio/companies/pelican/reports', 'the detail opens the company Reports, where Ask and Waive live');
    // The chase, per row and for every company not reported, posts as today.
    await view.click('button-chase-1');
    const posts = () => view.calls.filter((c) => c.method === 'POST' && c.path === '/api/portfolio/chase').map((c) => c.body);
    assert.deepEqual(posts(), [{ project_ids: [1] }]);
    assert.match(view.text('status-chase-note'), /Northwind Labs has been asked\. The founder is notified and the chase is logged\./);
    await view.clickText('Chase all overdue');
    assert.deepEqual(posts()[1], { project_ids: [3, 1] }, 'the page’s own unreported set');
  } finally { await view.close(); }

  const period = { uid: 'pm9', duty_uid: 'd1', label: '2026-09', due_on: '2026-10-30', state: 'late', days_late: 6, asked: false };
  const ACME = { uid: 'p-abc', name: 'Acme Robotics', duties: [{ uid: 'd1', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, holding: { route: 'direct' }, source: {} }], periods: [period] };
  const company = await mount(({ path, method }) => {
    if (method === 'POST') return json({ ok: true });
    if (path === '/api/reporting/companies/p-abc') return json({ ok: true, company: ACME });
    if (path === '/api/positions') return json({ items: [] });
    return json({ items: [] });
  }, {
    element: h(Routes, null, h(Route, { path: '/portfolio/companies/:uid/reports', element: h(PortfolioCompanyPage) })),
    url: '/portfolio/companies/p-abc/reports',
  });
  try {
    await company.click('company-period-ask-pm9');
    assert.match(company.text('company-ask-dialog'), /Ask Acme Robotics for the Sep 2026 · Monthly financial statements\?/);
    await company.click('company-ask-confirm');
    await company.click('company-period-waive-pm9');
    assert.match(company.text('company-waive-dialog'), /Waive Sep 2026 for Acme Robotics\?/);
    await company.click('company-waive-confirm');
    assert.deepEqual(company.calls.filter((c) => c.method === 'POST').map((c) => c.path), ['/api/reporting/periods/pm9/ask', '/api/reporting/periods/pm9/waive']);
  } finally { await company.close(); }
});

/* ---------------------------------------------------------------- model */

test('6. the model: period words, the Worker’s period rule, the required set, what is missing, the last chase, the fields', () => {
  assert.equal(periodName('2026-Q3'), 'Q3 2026');
  assert.equal(periodName('2026-09'), 'Sep 2026');
  assert.equal(periodName(null), null);
  assert.equal(periodCovers('quarterly', '2026-Q3', '2026-Q3'), true);
  assert.equal(periodCovers('quarterly', '2026-Q3', '2026-08'), true, 'a month inside the quarter counts for it');
  assert.equal(periodCovers('quarterly', '2026-Q3', '2026-10'), false);
  assert.equal(periodCovers('monthly', '2026-09', '2026-Q3'), false);

  assert.deepEqual(requiredKpisOf([{ kpi_key: 'a', required: 1 }, { kpi_key: 'b', required: 0 }, { kpi_key: 'c', required: null }]).map((r) => r.kpi_key), ['a'],
    'an unrecorded requirement is neither required nor optional');
  assert.deepEqual(requiredAgainst(KPI_SET, { kpis: { mrr: 0, runway_months: '  ' } }).map((r) => [r.key, r.carried]), [['mrr', true], ['runway_months', false]],
    'a measured 0 is carried; a blank is not');

  const ok = { state: 'ok', value: COMPLIANCE };
  const reads = { compliance: ok, updates: { state: 'ok', value: { items: [PELICAN_UPDATE] } }, positions: { state: 'ok', value: POSITIONS }, chases: { state: 'ok', value: CHASES } };
  const inbox = obligationRowsOf(reads);
  assert.deepEqual(inbox.rows.map((r) => r.name), ['Fjord Data', 'Northwind Labs', 'Pelican Pay']);
  assert.equal(inbox.period, 'Q3 2026');
  const pelican = inbox.rows.find((r) => r.key === '2');
  assert.deepEqual(pelican.missing, { state: 'missing', text: 'Runway' });
  assert.deepEqual(missingFor(pelican.reporting, { ...PELICAN_UPDATE, period: '2026-Q2' }, ok, reads.updates).state, 'not_measured');
  assert.deepEqual(missingFor(pelican.reporting, PELICAN_UPDATE, ok, { state: 'unreadable' }), { state: 'unreadable', text: 'Unreadable' });
  assert.equal(obligationRowsOf({ ...reads, compliance: { state: 'unreadable' } }).state, 'unreadable');

  assert.deepEqual(lastChaseOf(1, reads.chases).date, '2 Nov 2026');
  assert.equal(lastChaseOf(1, reads.chases).count, 2);
  assert.equal(lastChaseOf(2, reads.chases).state, 'none');
  assert.equal(lastChaseOf(1, { state: 'unreadable' }).state, 'unreadable');

  assert.equal(figureValue(184000, 'usd'), '$184,000');
  assert.equal(figureValue(0, 'usd'), '$0', 'a measured zero stays 0');
  assert.equal(figureValue(null, 'usd'), null);
  assert.equal(figureValue(1, 'months'), '1 month');
  const fields = reportFieldsOf(PELICAN_UPDATE);
  assert.deepEqual(fields.map((f) => [f.key, f.value, f.source]), [['mrr', '$184,000', 'Stripe'], ['net_burn', null, null], ['headcount', '12', 'Typed in the update'], ['runway_months', null, null]]);
  assert.equal(fields.find((f) => f.key === 'net_burn').reason, 'Moving banks');
  assert.deepEqual(reportFieldsOf(null), []);
});
