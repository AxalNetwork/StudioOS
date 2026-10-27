/**
 * D1299 (#2377) — Admin › Accounts, S21's integration of the owner's canvas
 * (ACC1–ACC14): Overview and All accounts as two tabs at their own addresses,
 * a widget per profile from the glance, the two sub-accounts saying why they
 * have no figure, and one account's record at `/admin/accounts/all/<id>`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/accounts_d1299.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { drawsAccountControls } from '../src/lib/accountControls.js';
import HeldAccounts from '../src/pages/admin/HeldAccounts.jsx';
import {
  ACCOUNTS_TABS, PROFILE_WIDGETS, accountRecordHref, recordIdOf, widgetCount,
} from '../src/pages/admin/accountsAddress.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

test('the addresses: two tabs, and one record per account', () => {
  assert.deepEqual(ACCOUNTS_TABS.map((t) => t.to), ['/admin/accounts', '/admin/accounts/all']);
  assert.equal(accountRecordHref(7), '/admin/accounts/all/7');
  // Mutation checked: accept any segment → 'all/abc' reads NaN, not null.
  assert.equal(recordIdOf('/admin/accounts/all/7'), 7);
  assert.equal(recordIdOf('/admin/accounts/all/7/'), 7);
  for (const p of ['/admin/accounts/all', '/admin/accounts/all/0', '/admin/accounts/all/abc', '/admin/accounts/7', '/admin/hq-team/7']) {
    assert.equal(recordIdOf(p), null, p);
  }
});

test('a widget counts its role; a role the glance groups out is a measured 0; no role is not read', () => {
  const byRole = [{ role: 'founder', count: 12 }, { role: 'partner', count: 3 }];
  assert.equal(widgetCount(byRole, 'founder'), 12);
  assert.equal(widgetCount(byRole, 'partner'), 3);
  assert.equal(widgetCount(byRole, 'advisor'), 0);
  // Mutation checked: return 0 for a widget with no role → LPs and testers read 0.
  assert.equal(widgetCount(byRole, null), null);
  assert.equal(widgetCount(undefined, 'founder'), null);
  assert.deepEqual(PROFILE_WIDGETS.map((w) => w.label), ['Founders', 'Investors', 'Advisors', 'Operating Partners', 'Explorers', 'LPs', 'Product testers']);
});

test('App.jsx serves the record address, and the record waits for its row before drawing controls', () => {
  // Mutation checked: drop the route → /admin/accounts/all/7 has no page.
  assert.match(read('frontend/src/App.jsx'), /path="\/admin\/accounts\/all\/:id" element=\{guard\(\['admin'\], <AllAccountsPage onImpersonate=\{handleImpersonate\} \/>\)\}/);
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /openId=\{recordIdOf\(pathname\)\} onOpenChange=\{onOpenChange\}/);
  // A record opened by id alone has no role yet: no View As, no Disable, until its row is read.
  // Mutation checked: drop the role rule → a stub row draws the controls.
  assert.equal(drawsAccountControls({ id: 9 }, { id: 1, is_super_admin: 0 }), false);
  assert.equal(drawsAccountControls({ id: 9, role: 'founder' }, { id: 1, is_super_admin: 0 }), true);
  assert.equal(drawsAccountControls({ id: 9, role: 'admin' }, { id: 1, is_super_admin: 0 }), false);
});

async function mount(glance) {
  const restore = installDocument();
  const original = api.adminStudioGlance;
  api.adminStudioGlance = glance;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/accounts'] }, React.createElement(HeldAccounts))));
  return {
    container,
    async done() { await act(async () => root.unmount()); api.adminStudioGlance = original; restore(); },
  };
}

const ACCOUNTS = { available: true, label: 'Accounts', total: 15, by_role: [{ role: 'founder', count: 12 }, { role: 'partner', count: 3 }], new_7d: 2, new_30d: 5, deactivated: 1, exploring: 4, trash_projects: 0 };

test('Overview: the header and tabs, the totals and a widget per profile, from the glance', async () => {
  const w = await mount(async () => ({ tier: 'hq', accounts: ACCOUNTS }));
  try {
    assert.ok(byId(w.container, 'accounts-header'));
    for (const t of ACCOUNTS_TABS) assert.ok(byId(w.container, `accounts-tab-${t.key}`), t.key);
    assert.match(text(byId(w.container, 'accounts-total-total-count')), /15/);
    assert.match(text(byId(w.container, 'accounts-total-new30d-count')), /5/);
    assert.match(text(byId(w.container, 'accounts-widget-founder-count')), /12/);
    // Mutation checked: map Operating Partners to 'operating_partner' → reads 0, not 3.
    assert.match(text(byId(w.container, 'accounts-widget-partner-count')), /3/);
    assert.match(text(byId(w.container, 'accounts-widget-advisor-count')), /\b0\b/, 'a measured zero');
    // The sub-accounts say why, never a number.
    for (const k of ['lp', 'tester']) {
      const t = text(byId(w.container, `accounts-widget-${k}-count`));
      assert.doesNotMatch(t, /\d/, `${k}: ${t}`);
    }
    assert.match(text(byId(w.container, 'accounts-widget-tester-count')), /Not recorded/);
    // The other doors stay.
    assert.ok(byId(w.container, 'held-accounts-cards'));
  } finally { await w.done(); }
});

test('a glance that cannot be read draws no zero anywhere', async () => {
  const w = await mount(async () => { throw new Error('503'); });
  try {
    for (const id of ['accounts-total-total-count', 'accounts-widget-founder-count', 'accounts-widget-advisor-count']) {
      // `Figure` says Unreadable for a failed glance before it reads any value.
      assert.doesNotMatch(text(byId(w.container, id)), /\b0\b/, id);
    }
  } finally { await w.done(); }
});
