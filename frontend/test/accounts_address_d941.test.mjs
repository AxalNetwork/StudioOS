/**
 * D941 (#2746, part 4 of #2375) — the Accounts address, by #2375 question 1's
 * answer A: the Admin's Accounts page at /admin/accounts, HQ › Team at
 * /admin/hq-team, a Super Admin's /admin/accounts forwarded to Team with its
 * one-line notice, and /admin/held/accounts forwarded to Accounts. Mounted on
 * a stubbed fetch where a page reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/accounts_address_d941.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { ACCOUNTS_PATH, TEAM_MOVED_NOTICES, TEAM_PATH, heldAccountsForward, teamForward } from '../src/pages/admin/accountsAddress.js';
import AccountsAddress, { HeldAccountsRedirect } from '../src/pages/admin/AccountsAddress.jsx';
import HqAccountsPage from '../src/pages/hq/AccountsPage.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('the forwards keep the query and hash; Team\'s carries moved=team', () => {
  // Mutations checked: the query dropped; moved missing; the hash dropped; the held forward pointing at Team.
  assert.deepEqual([ACCOUNTS_PATH, TEAM_PATH], ['/admin/accounts', '/admin/hq-team']);
  assert.deepEqual(teamForward('', ''), { pathname: '/admin/hq-team', search: '?moved=team', hash: '' });
  assert.deepEqual(teamForward('?q=ada', '#holders'), { pathname: '/admin/hq-team', search: '?q=ada&moved=team', hash: '#holders' });
  assert.deepEqual(heldAccountsForward('?profile=advisor', '#x'), { pathname: '/admin/accounts', search: '?profile=advisor', hash: '#x' });
  assert.match(TEAM_MOVED_NOTICES.team, /^Team has moved to its own address under HQ\. \/admin\/accounts is the Admin’s Accounts page now\.$/);
});

// ── Mounted ──────────────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stub() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ detail: 'down' }, 503);
  return () => { globalThis.fetch = original; };
}
function Probe() {
  const loc = useLocation();
  return h('p', { 'data-testid': 'probe' }, `${loc.pathname}${loc.search}${loc.hash}`);
}
async function mount(url, routes) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, ...routes.map(([path, element]) => h(Route, { key: path, path, element }))))); });
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    has: (id) => Boolean(byTestId(id)),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    async clickText(text) {
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && textOf(x).trim() === text);
      assert.ok(n, `no "${text}"`); await act(async () => props(n).onClick()); for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('a Super Admin\'s /admin/accounts lands on Team with the query, the hash and moved=team', async () => {
  // Mutation checked: the forward taken for an Admin too; the Super Admin given the Accounts page.
  const restoreFetch = stub();
  const v = await mount('/admin/accounts?q=ada#holders', [['/admin/accounts', h(AccountsAddress, { superAdmin: true })], ['/admin/hq-team', h(Probe)]]);
  try { assert.equal(v.of('probe'), '/admin/hq-team?q=ada&moved=team#holders'); } finally { await v.unmount(); restoreFetch(); }
});

test('an Admin\'s /admin/accounts is the Accounts page, not a forward', async () => {
  const restoreFetch = stub();
  const v = await mount('/admin/accounts', [['/admin/accounts', h(AccountsAddress, { superAdmin: false })], ['/admin/hq-team', h(Probe)]]);
  try {
    assert.ok(!v.has('probe'), 'an Admin was sent to Team');
    assert.ok(v.has('held-accounts-cards'), 'the Accounts page did not draw');
  } finally { await v.unmount(); restoreFetch(); }
});

test('/admin/held/accounts forwards to /admin/accounts with its query', async () => {
  const v = await mount('/admin/held/accounts?profile=advisor', [['/admin/held/accounts', h(HeldAccountsRedirect)], ['/admin/accounts', h(Probe)]]);
  try { assert.equal(v.of('probe'), '/admin/accounts?profile=advisor'); } finally { await v.unmount(); }
});

test('Team shows the one-line notice after the forward, and Dismiss clears it from the address', async () => {
  // Mutations checked: the notice drawn without ?moved; Dismiss leaving moved in the address.
  const restoreFetch = stub();
  let v = await mount('/admin/hq-team?moved=team', [['/admin/hq-team', h(React.Fragment, null, h(HqAccountsPage, { onImpersonate() {} }), h(Probe))]]);
  try {
    assert.equal(v.of('hq-team-moved').replace('Dismiss', '').trim(), TEAM_MOVED_NOTICES.team);
    await v.clickText('Dismiss');
    assert.equal(v.of('probe'), '/admin/hq-team');
    assert.ok(!v.has('hq-team-moved'));
  } finally { await v.unmount(); }
  v = await mount('/admin/hq-team', [['/admin/hq-team', h(HqAccountsPage, { onImpersonate() {} })]]);
  try { assert.ok(!v.has('hq-team-moved'), 'the notice without a forward'); } finally { await v.unmount(); restoreFetch(); }
});

// ── The sources ──────────────────────────────────────────────────────────────

test('the routes, both sidebars, the crumbs and the transfer notice name the new addresses', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/accounts" element={guard(['admin'], <AccountsAddress superAdmin={isSuperAdminUser(user)} />)} />`));
  assert.ok(app.includes(`<Route path="/admin/hq-team" element={guard(['admin'], hqOnly(<HqAccountsPage onImpersonate={handleImpersonate} />))} />`));
  assert.ok(app.includes(`<Route path="/admin/held/accounts" element={guard(['admin'], <HeldAccountsRedirect />)} />`));
  const row = (group, label) => SIDEBAR_GROUPS[group].flatMap((g) => g.items).find((i) => i.label === label);
  assert.equal(row('admin', 'Accounts').to, '/admin/accounts');
  assert.equal(row('super_admin', 'Team').to, '/admin/hq-team');
  assert.ok(!row('super_admin', 'Team').match.includes('/admin/accounts'), 'Team lights on the Admin\'s Accounts page');
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /hqCrumb=\{\{ label: 'Team', to: '\/admin\/hq-team', current: 'All accounts' \}\}/);
  assert.match(read('cloudflare-worker/src/routes/admin_super_admins.ts'), /link: '\/admin\/hq-team', payload,/);
  const all = ['frontend/src/pages/hq/MemberCreditsPage.jsx', 'frontend/src/pages/admin/insights/AdminInsights.jsx', 'frontend/src/pages/admin/segments/segModel.js']
    .map(read).join('\n');
  assert.ok(!/['"`]\/admin\/held\/accounts/.test(all) && !/to="\/admin\/accounts"/.test(read('frontend/src/pages/hq/MemberCreditsPage.jsx')), 'an in-app door to an old address');
});
