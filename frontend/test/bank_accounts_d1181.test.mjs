// D1181 (#2389) — HQ › Platform › Bank accounts' three tabs from the canvas
// (BNK1, BNK3, BNK5): Accounts is today's registry, Cash draws the entity
// accounts' balances from Mercury's read, History reads the ledger (D1186
// replaced the waits); Cash and History are the Super Admin's.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_accounts_d1181.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { BankAccountsPage } from '../src/pages/admin/ConsolePages.jsx';
import { TABS, tabOf } from '../src/pages/admin/consoles/bankAccountsTabs.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0, name: 'Admin', email: 'a@example.com' };
const ACCOUNTS = { ok: true, items: [{ uid: 'acc-1', entity_key: 'holdings', kind: 'checking', last_four: '4821', nickname: 'Operating', registered: true, current: { cents: 1234567, reason: null }, available: { cents: null, reason: 'unreadable' }, balance_read_at: '2026-10-25T08:00:00Z' }] };

async function mounted(url, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u).replace(/^.*\/api/, '')); return /\/admin\/mercury\/accounts/.test(String(u)) ? response(ACCOUNTS) : response({}); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(BankAccountsPage)))));
  await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const ids = () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean);
  return {
    requests, ids, text: () => txt(container).replace(/\s+/g, ' '),
    current: () => walk(container).filter((n) => pr(n)['aria-current'] === 'page').map((n) => pr(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('three tabs at their own addresses; anything else under the page is Accounts', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [['Accounts', '/admin/platform/bank-accounts'], ['Cash', '/admin/platform/bank-accounts/cash'], ['History', '/admin/platform/bank-accounts/history']]);
  assert.equal(tabOf('/admin/platform/bank-accounts/cash'), 'cash');
  assert.equal(tabOf('/admin/platform/bank-accounts/history/'), 'history');
  assert.equal(tabOf('/admin/platform/bank-accounts'), 'accounts');
  assert.equal(tabOf('/admin/platform/bank-accounts/nope'), 'accounts');
});

test('Cash, for the Super Admin: the entity accounts\' balances from Mercury\'s read; D1186 replaced the series and monthly waits', async () => {
  const v = await mounted('/admin/platform/bank-accounts/cash', SUPER);
  try {
    assert.deepEqual(v.current(), ['bank-tab-cash']);
    assert.ok(v.requests.some((u) => u.startsWith('/admin/mercury/accounts')));
    assert.ok(!v.requests.some((u) => u.startsWith('/admin/bank-accounts')), 'Cash makes no registry read');
    assert.match(v.text(), /\$12,345\.67/);
    assert.match(v.text(), /Unreadable/);
    for (const id of ['series', 'monthly']) assert.ok(v.ids().includes(`bank-cash-${id}`) && !v.ids().includes(`bank-wait-${id}`), id);
  } finally { await v.close(); }
});

test('History reads part 1\'s history (D1186) and nothing else', async () => {
  const v = await mounted('/admin/platform/bank-accounts/history', SUPER);
  try {
    assert.deepEqual(v.current(), ['bank-tab-history']);
    assert.ok(!v.ids().includes('bank-wait-history'));
    assert.deepEqual(v.requests.filter((u) => u.startsWith('/admin/')), ['/admin/bank-accounts/history?page=1&per=25']);
  } finally { await v.close(); }
});

test('an Admin on Cash or History is sent to Fund admin › Banking and reads nothing', async () => {
  for (const tab of ['cash', 'history']) {
    const v = await mounted(`/admin/platform/bank-accounts/${tab}`, ADMIN);
    try {
      assert.ok(v.ids().includes('bank-admin-line'), tab);
      assert.ok(!v.ids().includes('banking-accounts') && !v.ids().includes('bank-history'), tab);
      assert.deepEqual(v.requests.filter((u) => u.startsWith('/admin/')), [], tab);
    } finally { await v.close(); }
  }
});

test('the wiring: the two routes behind hqOnly, the tabs as literal doors, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['', '/cash', '/history']) assert.ok(app.includes(`<Route path="/admin/platform/bank-accounts${p}" element={guard(['admin'], hqOnly(<BankAccountsPage />))} />`), p || 'base');
  const pages = read('frontend/src/pages/admin/ConsolePages.jsx');
  for (const p of ['', '/cash', '/history']) assert.ok(pages.includes(`<HeaderTab to="/admin/platform/bank-accounts${p}"`), p || 'base');
  for (const f of ['Bank Accounts Page.dc.html', 'Bank accounts · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Bank accounts · Boards.dc.html').includes('Bank Accounts Page'));
  assert.ok(existsSync('documentation/architecture/decisions/D1181.md'));
  assert.ok(existsSync('documentation/audits/BANK_ACCOUNTS_MAP_2026-10-25.md'));
});
