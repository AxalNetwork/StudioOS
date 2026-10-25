/**
 * D1056 (#2427) — Reporting to investors: Grow's Reporting desk at
 * /grow/reporting (and /duties) in place of the Updates tab, Portfolio's
 * Updates named Reports, and the investor's company page at
 * /portfolio/companies/:uid. Every block a duty, period or frozen figure
 * would fill says "Not read here yet"; the History and Reports come from
 * today's reads, each answering alone.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reporting_d1056.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  COMPANY_TABS, DESK_TABS, DESK_WAITS, NOT_YET, companyHref, companyOf, companyTabOf, deskHref, deskSearch, holdingLine, reportRows,
} from '../src/pages/cycles/reportingModel.js';
import { CYCLES, cycleTabs } from '../src/pages/cycles/cycleModel.js';
import ReportingDesk from '../src/pages/cycles/ReportingDesk.jsx';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { api } from '../src/lib/api.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;

// ---------------------------------------------------------------- the model

test('the desk\'s addresses keep only the venture; Grow\'s history tab is Reporting, lit on the desk', () => {
  assert.deepEqual(DESK_TABS.map((t) => t.path), ['/grow/reporting', '/grow/reporting/duties']);
  assert.equal(deskSearch('?project_id=7&tab=x'), '?project_id=7');
  assert.equal(deskSearch('?project_id=7x'), '');
  assert.equal(deskHref('duties', '?project_id=7'), '/grow/reporting/duties?project_id=7');
  assert.deepEqual([CYCLES.grow.history.key, CYCLES.grow.history.name, CYCLES.grow.history.path], ['reporting', 'Reporting', '/grow/reporting']);
  const tabs = cycleTabs('grow', [{ slug: 'distribution', name: 'Distribution' }], 'reporting', '?project_id=7');
  assert.deepEqual(tabs.map((t) => [t.name, t.href, t.active]), [
    ['Overview', '/grow?project_id=7', false], ['Reporting', '/grow/reporting?project_id=7', true], ['Distribution', '/grow/distribution?project_id=7', false],
  ]);
  assert.equal(cycleTabs('grow', [{ slug: 'distribution' }], null)[1].active, false, 'not lit elsewhere');
  assert.deepEqual(DESK_WAITS.map((w) => w.title), ['Due next', 'Needs you', 'Calendar']);
});

test('the company page: a safe uid only, its tabs, the holding from the position, reports newest first for this company only', () => {
  assert.equal(companyHref('p-abc'), '/portfolio/companies/p-abc');
  assert.equal(companyHref('p-abc', 'reports'), '/portfolio/companies/p-abc/reports');
  assert.equal(companyHref('../x'), null);
  assert.equal(companyHref(''), null);
  assert.deepEqual(COMPANY_TABS.map((t) => t.label), ['Figures', 'Reports', 'Terms']);
  assert.equal(companyTabOf('/portfolio/companies/p-abc/terms'), 'terms');
  assert.equal(companyTabOf('/portfolio/companies/p-abc'), 'figures');
  const positions = [{ project_id: 4, project: { uid: 'p-abc', name: 'Acme' }, total_invested: 250000, latest_round: 'Seed', first_date: '2026-03-12' }];
  assert.equal(companyOf(positions, 'p-abc').project_id, 4);
  assert.equal(companyOf(positions, 'p-zzz'), null);
  assert.equal(holdingLine(positions[0]), 'Your holding: Seed · $250,000 invested · since 12 Mar 2026');
  assert.equal(holdingLine({ total_invested: 0 }), 'Your holding: not recorded', 'a zero or missing amount is never written as $0 invested');
  const rows = reportRows([
    { uid: 'u1', project_id: 4, title: 'Q2', submitted_at: '2026-07-02 10:00:00' },
    { uid: 'u2', project_id: 4, title: 'Q3', submitted_at: '2026-10-02 10:00:00' },
    { uid: 'u3', project_id: 9, title: 'Other company', submitted_at: '2026-10-03 10:00:00' },
  ], 4);
  assert.deepEqual(rows.map((r) => [r.title, r.sent, r.href]), [['Q3', '2 Oct 2026', '/updates/u2'], ['Q2', '2 Jul 2026', '/updates/u1']]);
});

// ---------------------------------------------------------------- mounted

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { root, byId, all, text, props, walk, settle, close, container };
}

test('mounted desk: History from the Durable company-building read, each duty block "Not read here yet", Duties says where terms change', async () => {
  const t = harness();
  const was = cyclesApi.module;
  const calls = [];
  cyclesApi.module = async (...a) => { calls.push(a); return { parts: { updates: [{ uid: 'u1', period: 'Sep 2026', sent_at: '2026-10-02 10:00:00', sent_to: { investors: 3 }, href: '/updates/u1' }] } }; };
  try {
    await act(async () => t.root.render(h(MemoryRouter, { initialEntries: ['/grow/reporting?project_id=7'] },
      h(ReportingDesk, { tab: 'desk', projectId: 7, search: '?project_id=7', cards: [{ slug: 'distribution', name: 'Distribution' }], action: { label: 'Share an update', href: '/grow/update?project_id=7' } }))));
    await t.settle();
    assert.deepEqual(calls, [['grow', 7, 'durable-company-building', {}]]);
    assert.match(t.text(t.byId('reporting-history')), /Update · Sep 2026.*Sent 2 Oct · 3 investors/s);
    for (const w of DESK_WAITS) assert.match(t.text(t.byId(`reporting-wait-${w.key}`)), new RegExp(`${w.title}${NOT_YET}`));
    assert.ok(!/\b0 (due|late|duties)\b/.test(t.text(t.container)), 'no zero is claimed');
    const tabs = t.walk(t.byId('cycle-tabs')).filter((n) => n.tagName === 'A');
    assert.equal(t.props(tabs.find((n) => t.text(n) === 'Reporting'))['aria-current'], 'page');
    assert.equal(t.props(t.byId('reporting-tab-duties')).href, '/grow/reporting/duties?project_id=7');
    await act(async () => t.root.render(h(MemoryRouter, { key: 'duties', initialEntries: ['/grow/reporting/duties'] },
      h(ReportingDesk, { tab: 'duties', projectId: 7, search: '?project_id=7', cards: [] }))));
    await t.settle();
    assert.match(t.text(t.byId('reporting-duties')), /amend the document in Raise.*Not read here yet.*not the same as owing none/s);
    // A failed History read says so, and the waiting blocks still draw.
    cyclesApi.module = async () => { throw new Error('down'); };
    await act(async () => t.root.render(h(MemoryRouter, { key: 'down', initialEntries: ['/grow/reporting'] },
      h(ReportingDesk, { tab: 'desk', projectId: 8, search: '', cards: [] }))));
    await t.settle();
    assert.match(t.text(t.container), /not a claim that nothing was sent/);
    assert.ok(t.byId('reporting-wait-calendar'));
  } finally { cyclesApi.module = was; await t.close(); }
});

test('mounted company page: the header from the position, Reports from the company\'s updates, Figures and Terms waiting, a stranger\'s uid refused', async () => {
  const t = harness();
  const was = { positionsList: api.positionsList, portfolioUpdatesList: api.portfolioUpdatesList };
  const asked = [];
  api.positionsList = async () => ({ items: [{ project_id: 4, project: { uid: 'p-abc', name: 'Acme Robotics', stage: 'Seed' }, total_invested: 250000, latest_round: 'Seed', first_date: '2026-03-12' }] });
  api.portfolioUpdatesList = async (o) => { asked.push(o); return { items: [{ uid: 'u2', project_id: 4, title: 'Q3 2026', submitted_at: '2026-10-02 10:00:00' }] }; };
  const at = async (url) => {
    await act(async () => t.root.render(h(MemoryRouter, { key: url, initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/portfolio/companies/:uid', element: h(PortfolioCompanyPage) }),
        h(Route, { path: '/portfolio/companies/:uid/reports', element: h(PortfolioCompanyPage) }),
        h(Route, { path: '/portfolio/companies/:uid/terms', element: h(PortfolioCompanyPage) })))));
    await t.settle();
  };
  try {
    await at('/portfolio/companies/p-abc');
    assert.match(t.text(t.byId('company-holding')), /Seed · Your holding: Seed · \$250,000 invested · since 12 Mar 2026/);
    assert.match(t.text(t.byId('company-wait-figures')), /Figures.*Not read here yet.*nothing here is a guessed or zero value/s);
    assert.equal(asked.length, 0, 'Figures reads no update');
    await at('/portfolio/companies/p-abc/reports');
    assert.deepEqual(asked, [{ project_id: 4 }]);
    assert.match(t.text(t.byId('company-reports')), /Q3 2026.*Received 2 Oct 2026/s);
    await at('/portfolio/companies/p-abc/terms');
    assert.match(t.text(t.byId('company-wait-terms')), /Terms.*Not read here yet/s);
    await at('/portfolio/companies/p-zzz');
    assert.ok(t.byId('company-not-held'), 'a company you hold no position in shows nothing of it');
    api.positionsList = async () => { throw new Error('down'); };
    await at('/portfolio/companies/p-abc');
    assert.match(t.text(t.container), /not a claim that you hold nothing here/);
  } finally { Object.assign(api, was); await t.close(); }
});

// ---------------------------------------------------------------- the wiring

test('wiring: the routes sit ahead of /grow/:slug, /grow/updates forwards to the desk, the shell says Reports, and the canvas is in', () => {
  const app = read('frontend/src/App.jsx');
  for (const [path, el] of [['/grow/reporting', 'reporting="desk"'], ['/grow/reporting/duties', 'reporting="duties"']]) {
    const at = app.indexOf(`<Route path="${path}" element={`);
    assert.ok(at > 0 && at < app.indexOf('<Route path="/grow/:slug"'), path);
    assert.ok(app.slice(at, app.indexOf('\n', at)).includes(`<CycleRoute cycle="grow" ${el} />`), path);
  }
  assert.match(app, /<Route path="\/grow\/updates" element=\{guard\(\['admin', 'founder'\], <HistoryRedirect to="\/grow\/reporting" hash="" \/>\)\} \/>/);
  for (const p of ['/portfolio/companies/:uid', '/portfolio/companies/:uid/reports', '/portfolio/companies/:uid/terms']) {
    assert.match(app, new RegExp(`<Route path="${p.replace(/\//g, '\\/')}" element=\\{guard\\(\\['admin', 'investor'\\], investorWorkspace\\('portfolio', <PortfolioCompanyPage \\/>\\)\\)\\} \\/>`), p);
  }
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /\} else if \(reporting && cycle === 'grow'\) \{/);
  assert.match(route, /if \(record \|\| slug \|\| reporting \|\| !projectId \|\| !def\) return undefined;/, 'the desk never reads the overview');
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/grow\/updates' \}/);
  assert.match(read('frontend/src/pages/PortfolioWorkspace.jsx'), /\{ to: '\/portfolio\/updates', label: 'Reports',/);
  assert.match(read('frontend/src/workspaces/shellConfig.js'), /\{ slug: 'updates', label: 'Reports', archetype: A\.FEED \}/);
  assert.match(read('frontend/src/pages/investor/InvestorPortfolioUpdates.jsx'), /<Link to=\{companyHref\(row\.project\.uid\)\}/);
  for (const f of ['frontend/src/pages/cycles/ReportingDesk.jsx', 'frontend/src/pages/investor/PortfolioCompanyPage.jsx', 'frontend/src/pages/cycles/reportingModel.js']) {
    assert.doesNotMatch(read(f), /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
  }
  assert.ok(read('design/incoming/Reporting · Boards.dc.html').includes('RPT21'));
});
