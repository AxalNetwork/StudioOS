// D1160 (#3067, part 3 of #2388) — Fund admin's header (FND1, FND2): the
// title, the profile pill, the one primary button per tab named by the act
// table, More, the muted line, the as-of chip, the fund filter kept across
// tabs, the tab counts with their amber flags; /funds and /funds/performance
// forwarding an admin with the moved notice (FND16); HQ › Funds' link and row
// label; Fund Ops retired; and the refusals (FND20).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_header_d1160.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import FundOpsRedirect from '../src/pages/admin/fundAdmin/FundOpsRedirect.jsx';
import FundAdminBoundary from '../src/pages/admin/fundAdmin/Refusal.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  FILTER_KEPT, LINE, MOVED_NOTICE, REFUSALS, TITLE, fundFilter, fundOpsTarget, fundsCsv, headerPrimary, moreItems,
  profilePill, tabCounts, withFund,
} from '../src/pages/admin/fundAdmin/fundAdminModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };

const OVERVIEW = () => ({
  as_of: '2026-10-25',
  entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [
    { fund_id: 7, name: 'Example Fund I', committed_cents: 800000000, called_cents: 400000000, received_cents: 372000000, outstanding_cents: 28000000, overdue_lines: 3, next_due_date: null },
    { fund_id: 9, name: 'Example Fund II', committed_cents: 300000000, called_cents: 75000000, received_cents: 67000000, outstanding_cents: 8000000, overdue_lines: 0, next_due_date: '2026-11-04' },
  ] },
  fees: { state: 'ok', items: [] },
  drafts: { state: 'ok', items: [{ fund_id: 7, prepared: 2 }] },
  matches: { state: 'ok', items: [{ fund_id: 7, proposed: 4, needs_review: 1 }] },
});
const ACCESS = (sa) => ({
  super_admin: sa,
  acts: [
    { act: 'capital_call.issue', allowed: sa, sentence: 'A Super Admin issues capital calls.' },
    { act: 'distribution.execute', allowed: sa, sentence: 'A Super Admin executes distributions.' },
  ],
});

function stubs({ sa = false, access = null, overview = null } = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push(name); return f(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', access || (async () => ACCESS(sa))), overview: rec('overview', overview || (async () => OVERVIEW())),
        lps: rec('lps', async () => ({ funds: [], page: 1, per_page: 25, pages: 1, total_rows: 0, totals: { rows: 0, not_recorded: {} }, tally: { by_type: [] }, items: [] })),
      },
      performance: { list: rec('performance', async () => ({ items: [] })) },
      mercury: {
        connections: rec('connections', async () => ({ ok: true, entities: [] })),
        accounts: rec('accounts', async () => ({ ok: true, items: [] })),
        transactions: rec('transactions', async () => ({ ok: true, page: 1, page_size: 50, total: 0, items: [] })),
        matches: rec('matches', async () => ({ ok: true, items: [] })),
      },
      fees: { periods: async () => ({ items: [] }), terms: async () => ({ items: [] }) },
      reporting: { list: async () => ({ items: [] }) },
      funds: { distributions: async () => ({ items: [] }) },
      capitalAttestations: { forFund: async () => ({ items: [] }) },
    },
  };
}

async function mount(url, { user = ADMIN, s = stubs({ sa: user === SUPER }), routes = null } = {}) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: '', search: '', hash: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; at.hash = l.hash; return null; }
  const consoleEl = h(FundAdminConsoleView, { user, apis: s.apis });
  const tree = routes ? h(Routes, null, ...routes(consoleEl)) : consoleEl;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, tree, h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    at, calls: s.calls, by, flush,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    href: (id) => pr(by(id)).href || pr(by(id)).to,
    props: (id) => pr(by(id)),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

/* ------------------------------------------------------------------ the model */

test('the primary button is the act table\'s: the Super Admin\'s "New capital call", an Admin\'s "Preview a capital call"', () => {
  const fund = { id: 7, name: 'Example Fund I' };
  assert.deepEqual(headerPrimary('overview', ACCESS(true), null), { label: 'New capital call', to: '/admin/fund-admin/calls' });
  assert.deepEqual(headerPrimary('calls', ACCESS(false), fund), { label: 'Preview a capital call', to: '/funds/calls?fund=7' });
  assert.equal(headerPrimary('calls', null, fund).label, 'Preview a capital call', 'an unread table names no Super Admin act');
  assert.deepEqual(headerPrimary('distributions', ACCESS(true), fund), { label: 'New distribution', to: '/admin/fund-admin/distributions?fund=7#distribution-form' });
  assert.equal(headerPrimary('distributions', ACCESS(false), fund).label, 'Preview a distribution');
  assert.deepEqual(headerPrimary('fees', ACCESS(false), fund), { label: 'Preview period', to: '/admin/fund-admin/fees?fund=7#fee-prepare' });
  assert.deepEqual(headerPrimary('lps', ACCESS(false), null), { label: 'Add LP', to: '/admin/fund-admin/lps?add=1' }, 'D1162: Add LP is an Admin\'s act');
  for (const v of ['performance', 'reports', 'banking', 'reconciliation', 'books']) assert.equal(headerPrimary(v, ACCESS(true), fund), null, `${v} has no act page yet`);
  // D1161: New fund on the tab, Edit fund facts on one fund's page.
  assert.deepEqual(headerPrimary('funds', ACCESS(false), null), { label: 'New fund', to: '/admin/fund-admin/funds?new=1' });
  assert.deepEqual(headerPrimary('funds', ACCESS(true), null, 7), { label: 'Edit fund facts', to: '/admin/fund-admin/funds/7?edit=facts' });
});

test('the tab counts: a number read, a dash with its reason, the amber flag with what waits — never a zero', () => {
  const c = tabCounts(OVERVIEW());
  assert.deepEqual(c.funds, { kind: 'num', value: 2 });
  assert.equal(c.lps.kind, 'dash');
  assert.match(c.lps.tip, /the LPs tab reads its own roster/);
  assert.deepEqual(c.calls, { kind: 'flag', value: 3, testId: 'fund-admin-flag-calls' });
  assert.deepEqual(c.banking, { kind: 'flag', value: 5, testId: 'fund-admin-flag-banking' });
  assert.deepEqual(c.reports, { kind: 'flag', value: 2, testId: 'fund-admin-flag-reports' });
  const quiet = tabCounts({ ...OVERVIEW(), drafts: { state: 'ok', items: [] } });
  assert.equal(quiet.reports, null, 'nothing waits: no flag, never a 0');
  assert.deepEqual(tabCounts({}).funds, { kind: 'dash', tip: 'The administered funds could not be read.' });
  assert.deepEqual(tabCounts(null).funds, { kind: 'load' });
});

test('the fund filter: All funds and each fund, a per-fund tab picks one, and the filter rides every tab', () => {
  const funds = [{ id: 7, name: 'Fund I' }, { id: 9, name: 'Fund II' }];
  const all = fundFilter(funds, '', 'overview');
  assert.deepEqual(all.pills.map((p) => [p.label, p.on]), [['All funds', true], ['Fund I', false], ['Fund II', false]]);
  assert.equal(all.note, null);
  const kept = fundFilter(funds, '?fund=9', 'lps');
  assert.deepEqual(kept.pills.map((p) => p.on), [false, false, true]);
  assert.equal(kept.note, FILTER_KEPT, 'a tab that shows every fund says so');
  const per = fundFilter(funds, '', 'calls');
  assert.deepEqual(per.pills.map((p) => [p.label, p.on]), [['Fund I', true], ['Fund II', false]], 'a per-fund tab offers no All funds');
  assert.equal(withFund('/admin/fund-admin/calls', '?fund=7&moved=fund-ops', 9), '/admin/fund-admin/calls?fund=9');
  assert.equal(withFund('/admin/fund-admin', '?fund=7', null), '/admin/fund-admin');
});

test('More, the pill, Export and the forward\'s address', () => {
  assert.deepEqual(moreItems(ACCESS(true)).map((m) => m.key), ['hq-funds', 'lp-applications', 'export']);
  assert.deepEqual(moreItems(ACCESS(false)).map((m) => m.key), ['lp-applications', 'export'], 'HQ › Funds is the Super Admin\'s');
  assert.equal(moreItems(ACCESS(true))[0].to, '/admin/funds');
  assert.deepEqual(profilePill(ACCESS(true)), { label: 'Super Admin', tone: 'held' });
  assert.deepEqual(profilePill(ACCESS(false)), { label: 'Admin', tone: 'hq' });
  assert.equal(profilePill(null), null, 'no profile is claimed before the table reads');
  const csv = fundsCsv(OVERVIEW()).trim().split('\n');
  assert.equal(csv[0], 'Fund,Committed (cents),Called (cents),Received (cents),Outstanding (cents),Overdue lines,Next due');
  assert.equal(csv[1], 'Example Fund I,800000000,400000000,372000000,28000000,3,Not recorded', 'a value no store holds is Not recorded, never 0');
  assert.match(fundsCsv({ funds: { state: 'unreadable' } }), /could not be read \(unreadable\)/);
  assert.equal(fundOpsTarget('/funds', '?fund=7', '#x'), '/admin/fund-admin?fund=7&moved=fund-ops#x');
  assert.equal(fundOpsTarget('/funds/performance/', ''), '/admin/fund-admin/performance?moved=fund-ops');
});

/* ------------------------------------------------------------------ mounted */

test('the header: title, profile pill, the one primary, More, the line, the as-of chip and the counts', async () => {
  const v = await mount('/admin/fund-admin', { user: SUPER });
  try {
    assert.ok(v.by('fund-admin-header'));
    assert.match(v.text('fund-admin-header'), new RegExp(`^${TITLE}`));
    assert.equal(v.text('fund-admin-role'), 'Super Admin');
    assert.equal(v.text('fund-admin-primary'), 'New capital call');
    assert.ok(v.text('fund-admin-header').includes(LINE));
    assert.equal(v.text('fund-admin-as-of'), 'As of 2026-10-25');
    assert.match(v.text('fund-admin-tab-funds'), /Funds 2/);
    assert.equal(v.text('fund-admin-flag-calls'), '3');
    assert.equal(v.text('fund-admin-flag-banking'), '5');
    assert.ok(!v.by('fund-admin-flag-fees'));
    await v.click('admin-page-more');
    assert.ok(v.by('fund-admin-more-hq-funds') && v.by('fund-admin-more-lp-applications') && v.by('fund-admin-more-export'));
  } finally { await v.close(); }
  const a = await mount('/admin/fund-admin/calls?fund=7', { user: ADMIN });
  try {
    assert.equal(a.text('fund-admin-role'), 'Admin');
    assert.equal(a.text('fund-admin-primary'), 'Preview a capital call', 'the Admin\'s primary');
    assert.equal(a.href('fund-admin-primary'), '/funds/calls?fund=7');
    await a.click('admin-page-more');
    assert.ok(!a.by('fund-admin-more-hq-funds'), 'HQ › Funds is the Super Admin\'s');
  } finally { await a.close(); }
});

test('the fund filter survives a tab change, and a per-fund tab reads the fund it names', async () => {
  const v = await mount('/admin/fund-admin/distributions?fund=9');
  try {
    assert.equal(v.props('fund-admin-filter-f-9')['aria-current'], 'true');
    assert.ok(!v.by('fund-admin-filter-all'), 'a per-fund tab offers no All funds');
    assert.match(v.text('distributions-section'), /Distributions · Example Fund II/);
    assert.equal(v.href('fund-admin-tab-reports'), '/admin/fund-admin/reports?fund=9');
    assert.equal(v.href('fund-admin-tab-lps'), '/admin/fund-admin/lps?fund=9');
    assert.equal(v.href('fund-admin-filter-f-7'), '/admin/fund-admin/distributions?fund=7');
    assert.ok(!v.by('fund-select'), 'the tab\'s own chooser is gone: the header carries it');
  } finally { await v.close(); }
  const lps = await mount('/admin/fund-admin/lps?fund=9');
  try {
    assert.equal(lps.text('fund-admin-filter-note'), FILTER_KEPT);
    assert.equal(lps.href('fund-admin-filter-all'), '/admin/fund-admin/lps');
    assert.ok(lps.by('fund-admin-panel-lps'), 'the tab and its panel are kept');
    assert.ok(lps.by('lps-section') && !lps.by('fund-admin-wait-lps'), 'D1162: the roster replaces the wait card');
  } finally { await lps.close(); }
});

test('an admin at /funds lands on Fund administration with the notice; /funds/performance on its tab', async () => {
  const routes = (consoleEl) => [
    h(Route, { key: 'f', path: '/funds', element: h(FundOpsRedirect, { send: () => {} }) }),
    h(Route, { key: 'p', path: '/funds/performance', element: h(FundOpsRedirect, { send: () => {} }) }),
    h(Route, { key: 'c', path: '/admin/fund-admin/*', element: consoleEl }),
  ];
  const v = await mount('/funds?fund=7#calls', { routes });
  try {
    assert.equal(v.at.path, '/admin/fund-admin');
    assert.equal(v.at.search, '?fund=7&moved=fund-ops');
    assert.equal(v.at.hash, '#calls', 'the hash is kept');
    assert.equal(v.text('admin-page-moved').replace(/ Dismiss$/, ''), MOVED_NOTICE);
  } finally { await v.close(); }
  const p = await mount('/funds/performance', { routes });
  try {
    assert.equal(p.at.path, '/admin/fund-admin/performance');
    assert.ok(p.by('fund-admin-panel-performance'));
    assert.ok(p.by('admin-page-moved'));
  } finally { await p.close(); }
  // An investor's /funds is unchanged: the landing for an investor, the forward for anyone else the guard admits.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/funds" element=\{guard\(\['admin', 'investor'\], effectiveRole === 'investor' \? <InvestorFundLanding fundUnlocked=\{hasInvestorTier\(user, 'institutional'\)\} \/> : <FundOpsRedirect \/>\)\} \/>/);
  assert.match(app, /<Route path="\/funds\/performance" element=\{guard\(\['admin', 'investor'\], effectiveRole === 'investor' \? investorFundWorkspace\(<FundPerformancePage embedded \/>\) : <FundOpsRedirect \/>\)\} \/>/);
});

test('the refusals (FND20): a branch admin, a support session and a member, each in the canvas\'s words, with no read', async () => {
  const s = stubs();
  const b = await mount('/admin/fund-admin', { user: { ...ADMIN, branch: { code: 'lis' } }, s });
  try {
    assert.match(b.text('fund-admin-branch'), new RegExp(`${REFUSALS.branch.title}`));
    assert.ok(b.text('fund-admin-branch').includes(REFUSALS.branch.line));
    assert.equal(b.text('fund-admin-branch-action'), 'Go to Studio');
    assert.ok(!b.by('fund-admin-header'));
    assert.deepEqual(s.calls, [], 'no read at all');
  } finally { await b.close(); }
  const routes = (impersonating) => () => [h(Route, { key: 'b', path: '*', element: h(FundAdminBoundary, { home: '/studio', impersonating }) })];
  const sup = await mount('/admin/fund-admin', { routes: routes(true) });
  try {
    assert.match(sup.text('fund-admin-support'), /A support session cannot read fund administration\./);
    assert.ok(!sup.by('fund-admin-member'));
  } finally { await sup.close(); }
  const mem = await mount('/admin/fund-admin', { routes: routes(false) });
  try {
    assert.match(mem.text('fund-admin-member'), /This page is for studio admins\. Fund administration is run by HQ’s admins\./);
    assert.equal(mem.href('fund-admin-member-action'), '/studio');
  } finally { await mem.close(); }
  const app = read('frontend/src/App.jsx');
  assert.match(app, /\{ under: \/\^\\\/admin\\\/fund-admin\(\\\/\|\$\)\/, roles: FUND_ADMIN_BOUNDARY_ROLES, Panel: FundAdminBoundary, notPreview: true \}/);
  assert.match(app, /const FUND_ADMIN_BOUNDARY_ROLES = new Set\(\['founder', 'partner', 'investor', 'advisor', 'exploring'\]\);/);
  assert.match(app, /!\(b\.notPreview && previewing\)/, 'an admin previewing another role is sent home as before');
});

/* ------------------------------------------------------------------ the source */

test('HQ › Funds links Fund admin and its row is Funds oversight; Fund Ops is retired and the LPA drawer stays', () => {
  const hq = read('frontend/src/pages/hq/HqFundsPage.jsx');
  assert.match(hq, /to="\/admin\/fund-admin"[\s\S]{0,400}Manage HQ&rsquo;s funds in Fund admin/);
  assert.doesNotMatch(hq, /to="\/funds"/);
  const rows = SIDEBAR_GROUPS.super_admin.flatMap((g) => g.items || []);
  assert.equal(rows.find((r) => r.to === '/admin/funds')?.label, 'Funds oversight');
  assert.ok(!existsSync('frontend/src/pages/FundOpsWorkspace.jsx'));
  const page = read('frontend/src/pages/FundsPage.jsx');
  assert.match(page, /export function LPADrawer\(/);
  assert.doesNotMatch(page, /export function AdminFundsView|CreateFundModal|CapitalCallModal|DistributionModal/);
  assert.match(read('frontend/src/pages/SpinoutLabLpCommitment.jsx'), /import \{ LPADrawer \} from '\.\/FundsPage';/);
  assert.doesNotMatch(read('frontend/src/App.jsx'), /FundOpsWorkspace/, 'nothing in the routes names the retired page');
  assert.doesNotMatch(read('frontend/src/pages/admin/fundAdmin/FundAdminConsole.jsx'), /function Chrome|\b(alert|confirm)\(/);
});
