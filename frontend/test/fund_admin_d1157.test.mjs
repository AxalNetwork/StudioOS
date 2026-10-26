// D1157 (#2388) — the fund admin console's tabs at their own addresses under
// /admin/fund-admin: the canvas's nine tabs, Banking's three parts, D714's
// `?tab=` links forwarding to the new addresses with the fund filter kept,
// NAV & performance drawing today's performance read, and "Not read here yet"
// with its reason on Funds and Books (D1162 gave LPs its roster).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_d1157.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  BANKING_PARTS, LEGACY_TABS, NOT_YET, TABS, WAITS, keepFund, legacyHref, tabOfView, viewFrom, viewHref,
} from '../src/pages/admin/fundAdmin/fundAdminModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };

const OVERVIEW = () => ({
  as_of: '2026-10-25',
  entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund I', overdue_lines: 0 }] },
  fees: { state: 'ok', items: [] },
  drafts: { state: 'ok', items: [] },
  matches: { state: 'ok', items: [{ fund_id: 7, proposed: 2, needs_review: 1 }] },
});

function stubs() {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push(name); return f(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', async () => ({ super_admin: false, acts: [] })), overview: rec('overview', async () => OVERVIEW()),
        lps: rec('lps', async () => ({ funds: [], page: 1, per_page: 25, pages: 1, total_rows: 0, totals: { rows: 0, not_recorded: {} }, tally: { by_type: [] }, items: [] })),
      },
      performance: { list: rec('performance', async () => ({ items: [] })) },
      mercury: {
        connections: rec('connections', async () => ({ ok: true, entities: [] })),
        accounts: rec('accounts', async () => ({ ok: true, items: [] })),
        transactions: rec('transactions', async () => ({ ok: true, page: 1, page_size: 50, total: 0, items: [] })),
        matches: rec('matches', async () => ({ ok: true, items: [] })),
      },
    },
  };
}

async function mount(url, s = stubs()) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: '', search: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: ADMIN, apis: s.apis }), h(Probe))));
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    at, calls: s.calls, by,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    href: (id) => pr(by(id)).href,
    current: () => walk(container).filter((n) => pr(n)['aria-current'] === 'page').map((n) => pr(n)['data-testid']),
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the canvas\'s nine tabs in its order, each at its own address, and Banking\'s three parts', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['overview', 'funds', 'lps', 'calls', 'distributions', 'performance', 'fees', 'reports', 'banking']);
  assert.deepEqual(TABS.map((t) => viewHref(t.path)), ['/admin/fund-admin', '/admin/fund-admin/funds', '/admin/fund-admin/lps', '/admin/fund-admin/calls',
    '/admin/fund-admin/distributions', '/admin/fund-admin/performance', '/admin/fund-admin/fees', '/admin/fund-admin/reports', '/admin/fund-admin/banking']);
  assert.deepEqual(BANKING_PARTS.map((b) => viewHref(b.path)), ['/admin/fund-admin/banking', '/admin/fund-admin/banking/reconciliation', '/admin/fund-admin/banking/books']);
});

test('the address names the view; anything under a tab is that tab, and an unknown word is Overview', () => {
  assert.equal(viewFrom('/admin/fund-admin'), 'overview');
  assert.equal(viewFrom('/admin/fund-admin/'), 'overview');
  assert.equal(viewFrom('/admin/fund-admin/lps'), 'lps');
  assert.equal(viewFrom('/admin/fund-admin/reports/notices'), 'reports');
  assert.equal(viewFrom('/admin/fund-admin/banking/reconciliation'), 'reconciliation');
  assert.equal(viewFrom('/admin/fund-admin/banking/books'), 'books');
  assert.equal(viewFrom('/admin/fund-admin/banking/nonsense'), 'banking');
  assert.equal(viewFrom('/admin/fund-admin/nonsense'), 'overview');
  assert.equal(viewFrom('/admin/fund-adminx/lps'), 'overview', 'only the console\'s own addresses');
  assert.equal(tabOfView('reconciliation'), 'banking');
  assert.equal(tabOfView('books'), 'banking');
  assert.equal(tabOfView('fees'), 'fees');
});

test('a D714 ?tab= link forwards to its new address, keeping only a well-formed fund filter', () => {
  for (const [key, path] of Object.entries(LEGACY_TABS)) assert.equal(legacyHref(`?tab=${key}`), viewHref(path));
  assert.equal(legacyHref('?tab=reconciliation&fund=7'), '/admin/fund-admin/banking/reconciliation?fund=7');
  assert.equal(legacyHref('?tab=nonsense'), '/admin/fund-admin');
  assert.equal(legacyHref('?fund=7'), null, 'no ?tab=, no forward');
  assert.equal(keepFund('?fund=7&x=1'), '?fund=7');
  assert.equal(keepFund('?fund=0'), '');
  assert.equal(keepFund('?fund=7%3Cb%3E'), '', 'a malformed id never reaches the address');
});

test('every view with no read says why, and none says zero or none', () => {
  for (const v of ['funds', 'books']) assert.ok(WAITS[v], v);
  assert.equal(WAITS.lps, undefined, 'D1162: LPs reads its roster');
  for (const w of Object.values(WAITS)) assert.ok(!/\b0\b|\$0|\bnone\b/i.test(w), w);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('the tabs are links to their addresses; the open one is current, and Banking carries Reconciliation\'s flag', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=7');
  try {
    assert.deepEqual(v.ids().filter((id) => id.startsWith('fund-admin-tab-')), TABS.map((t) => `fund-admin-tab-${t.key}`));
    assert.deepEqual(v.current(), ['fund-admin-tab-lps']);
    assert.equal(v.href('fund-admin-tab-fees'), '/admin/fund-admin/fees?fund=7');
    assert.equal(v.text('fund-admin-flag-banking'), '3');
    assert.ok(!v.by('fund-admin-banking-parts'), 'the parts are Banking\'s alone');
  } finally { await v.close(); }
});

test('Funds draws its wait card and makes no read of its own', async () => {
  for (const [url, view] of [['/admin/fund-admin/funds', 'funds']]) {
    const v = await mount(url);
    try {
      assert.ok(v.by(`fund-admin-panel-${view}`), view);
      assert.ok(v.text(`fund-admin-wait-${view}`).includes(NOT_YET), view);
      assert.ok(v.text(`fund-admin-wait-${view}`).includes(WAITS[view].slice(0, 40)), view);
      assert.deepEqual([...new Set(v.calls)].sort(), ['access', 'overview'], `${view} reads nothing but the console's own two`);
    } finally { await v.close(); }
  }
});

test('Banking draws its three parts with the open one current; Reconciliation is a part, not a tab', async () => {
  const v = await mount('/admin/fund-admin/banking/reconciliation');
  try {
    assert.deepEqual(v.current(), ['fund-admin-tab-banking', 'fund-admin-part-reconciliation']);
    assert.deepEqual(v.ids().filter((id) => id.startsWith('fund-admin-part-')), BANKING_PARTS.map((b) => `fund-admin-part-${b.key}`));
    assert.ok(v.by('fund-admin-panel-reconciliation'));
    assert.ok(v.calls.includes('matches'));
    assert.deepEqual(BANKING_PARTS.map((b) => v.href(`fund-admin-part-${b.key}`)), BANKING_PARTS.map((b) => viewHref(b.path)));
  } finally { await v.close(); }
});

test('NAV & performance reads the performance list there, and only there', async () => {
  let v = await mount('/admin/fund-admin/performance');
  try {
    assert.ok(v.by('fund-admin-panel-performance'));
    assert.ok(v.calls.includes('performance'));
  } finally { await v.close(); }
  v = await mount('/admin/fund-admin');
  try { assert.ok(!v.calls.includes('performance')); } finally { await v.close(); }
});

test('a D714 ?tab= address forwards in place, with the fund filter', async () => {
  const v = await mount('/admin/fund-admin?tab=reconciliation&fund=7');
  try {
    assert.equal(v.at.path, '/admin/fund-admin/banking/reconciliation');
    assert.equal(v.at.search, '?fund=7');
    assert.ok(v.by('fund-admin-panel-reconciliation'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the sub-path routes with the console\'s guard, the links that moved, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/fund-admin', '/admin/fund-admin/:tab', '/admin/fund-admin/:tab/:sub']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <FundAdminConsole />)} />`), p);
  }
  assert.ok(read('frontend/src/pages/admin/fundAdmin/mercuryEntityModel.js').includes("href: '/admin/fund-admin/banking'"));
  assert.ok(read('frontend/src/pages/admin/consoles/BankAccountsConsole.jsx').includes("RECONCILIATION_HREF = '/admin/fund-admin/banking/reconciliation'"));
  for (const f of ['Fund Admin Console Page.dc.html', 'Fund admin · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Fund admin · Boards.dc.html').includes('Fund Admin Console Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1157.md'));
  assert.ok(existsSync('documentation/audits/FUND_ADMIN_MAP_2026-10-25.md'));
});
