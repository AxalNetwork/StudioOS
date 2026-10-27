// D1140 (#3020, CMP19) — one place for companies: the switcher's Manage link,
// the sidebar row, "Your companies" off Profile and identity, the forward from
// /company-settings and the settings at their new address.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_moved_d1140.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  MANAGE_LABEL, MOVED_KEY, MOVED_NOTICES, PROFILE_MOVED_STORE, SETTINGS_PATH, SIDEBAR_LABEL,
  activeUidFrom, companyPathFor, companySettingsPathFor, companyUidFor, forwardTarget, settingsUidFor,
} from '../src/pages/account/companies/companiesModel.js';
import { CompaniesMovedNotice, CompanySettingsRedirect, ProfileMovedNotice } from '../src/pages/account/companies/CompaniesMoved.jsx';
import CompanySettingsAt from '../src/pages/account/companies/CompanySettingsAt.jsx';
import { MANAGE_LABEL as SWITCHER_MANAGE, setReadState } from '../src/ui/CompanySwitcher.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

let seen;
function Where() { const l = useLocation(); seen = `${l.pathname}${l.search}${l.hash}`; return h('span', { 'data-testid': 'where' }, seen); }

async function mount(el, url) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: () => txt(container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    unmount: () => act(async () => root.unmount()),
  };
}

const ROWS = [{ id: 7, uid: 'acme', company_name: 'Acme' }, { id: 9, uid: 'beta-co', company_name: 'Beta' }];

test('the forward keeps the query and hash, adds the moved notice, and opens the active company', () => {
  assert.equal(forwardTarget('acme', '?tab=billing&x=1', '#seats'), '/account/companies/acme?tab=billing&x=1&moved=company-settings#seats');
  assert.equal(forwardTarget('beta-co', ''), '/account/companies/beta-co?moved=company-settings');
  assert.equal(forwardTarget(null, '?moved=old'), '/account/companies?moved=company-settings', 'a stale moved key is replaced, never doubled');
  assert.equal(activeUidFrom(ROWS, 9), 'beta-co');
  assert.equal(activeUidFrom(ROWS, '9'), 'beta-co', 'localStorage hands the id back as text');
  assert.equal(activeUidFrom(ROWS, 404), 'acme', 'a saved id no longer held falls to the first company');
  assert.equal(activeUidFrom([], 7), null);
  assert.equal(activeUidFrom(null, 7), null);
  assert.equal(MOVED_NOTICES[MOVED_KEY], 'Company Settings has a new address. Update your bookmark.');
});

test('mounted, /company-settings forwards with the query, to the active company, to the tab with none, and after a failed read', async () => {
  const restore = installDocument();
  try {
    const app = (list, savedId) => h(Routes, null,
      h(Route, { path: '/company-settings', element: h(CompanySettingsRedirect, { list, savedId }) }),
      h(Route, { path: '*', element: h(Where) }));
    const cases = [
      [async () => ROWS, () => 9, '/account/companies/beta-co?tab=team&moved=company-settings#x'],
      [async () => [], () => null, '/account/companies?tab=team&moved=company-settings#x'],
      [async () => { throw new Error('down'); }, () => 7, '/account/companies?tab=team&moved=company-settings#x'],
    ];
    for (const [list, savedId, want] of cases) {
      seen = null;
      const view = await mount(app(list, savedId), '/company-settings?tab=team#x');
      assert.equal(seen, want);
      await view.unmount();
    }
  } finally { restore(); }
});

test('/company-settings is a counted forward (#2319): a path-only entry and a route that only forwards', () => {
  assert.ok(REDIRECT_ROUTES.some((r) => r.path === '/company-settings'), 'the beacon does not count /company-settings');
  const app = read('frontend/src/App.jsx');
  const line = app.split('\n').find((l) => l.includes('path="/company-settings"'));
  assert.match(line, /<CompanySettingsRedirect \/>/);
  for (const p of ['/account/companies/settings', '/account/companies/:uid/settings']) {
    const at = app.indexOf(`path="${p}"`);
    assert.ok(at > 0 && at < app.indexOf('path="/account/companies/:tab"'), `${p} must precede /account/companies/:tab`);
  }
});

test('the settings segment is never read as a company or a tab', () => {
  assert.equal(companyUidFor('/account/companies/settings'), null);
  assert.equal(companyUidFor('/account/companies/acme/settings'), null);
  assert.equal(companyUidFor('/account/companies/acme'), 'acme');
  assert.equal(settingsUidFor(SETTINGS_PATH), '');
  assert.equal(settingsUidFor('/account/companies/beta-co/settings'), 'beta-co');
  assert.equal(settingsUidFor('/account/companies/acme'), null);
  assert.equal(companySettingsPathFor('beta-co'), '/account/companies/beta-co/settings');
});

test('Manage opens the right company: the switcher, the sidebar row, and Your companies', () => {
  assert.equal(SWITCHER_MANAGE, MANAGE_LABEL);
  const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
  assert.match(switcher, /<Link\s+to="\/account\/companies"[^>]*\n?[^>]*onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,200}data-testid="switcher-manage"/);
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(sidebar, /to="\/account\/companies"/);
  assert.ok(sidebar.includes(SIDEBAR_LABEL), 'the sidebar row is not renamed');
  assert.doesNotMatch(sidebar, />\s*Company Settings\s*</);
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  const card = settings.slice(settings.indexOf('function YourCompaniesSection'));
  assert.match(card, /to=\{c\.uid \? companyPathFor\(c\.uid\) : '\/account\/companies'\}/, 'Manage does not open the row\'s own company');
  assert.equal(companyPathFor('acme'), '/account/companies/acme');
  assert.match(read('frontend/src/pages/account/companies/CompanyLightbox.jsx'), /to=\{companySettingsPathFor\(uid\)\}/);
  assert.doesNotMatch(read('frontend/src/ui/phone/CompanySheet.jsx'), /'\/company-settings'/);
  assert.doesNotMatch(read('frontend/src/workspaces/shellConfig.js'), /'\/company-settings'/);
});

test('the Companies and projects moved notice shows after the forward, and dismissing drops it', async () => {
  const restore = installDocument();
  try {
    const page = h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, h(CompaniesMovedNotice), h(Where)) }));
    let view = await mount(page, '/account/companies/acme?tab=team&moved=company-settings');
    assert.match(view.text(), /Company Settings has a new address\. Update your bookmark\./);
    await view.click('companies-moved-dismiss');
    assert.equal(view.by('companies-moved'), undefined);
    assert.equal(seen, '/account/companies/acme?tab=team', 'dismiss keeps the rest of the query');
    await view.unmount();
    view = await mount(page, '/account/companies/acme?moved=elsewhere');
    assert.equal(view.by('companies-moved'), undefined, 'an unknown moved key draws nothing');
    await view.unmount();
  } finally { restore(); }
});

test('Profile and identity\'s moved notice shows once: dismissed, it does not come back on this device', async () => {
  const restore = installDocument();
  try {
    let view = await mount(h(ProfileMovedNotice), '/account/profile');
    assert.match(view.text(), /Your companies is now Companies and projects, under Account\. Open it/);
    await view.click('profile-companies-moved-dismiss');
    assert.equal(view.by('profile-companies-moved'), undefined);
    assert.equal(localStorage.getItem(PROFILE_MOVED_STORE), '1');
    await view.unmount();
    view = await mount(h(ProfileMovedNotice), '/account/profile');
    assert.equal(view.by('profile-companies-moved'), undefined, 'the notice came back after it was dismissed');
    await view.unmount();
    localStorage.getItem = () => { throw new Error('blocked'); };
    view = await mount(h(ProfileMovedNotice), '/account/profile');
    assert.ok(view.by('profile-companies-moved'), 'storage that throws still draws the notice');
    await view.unmount();
  } finally { restore(); }
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  const pane = settings.slice(settings.indexOf("safeActive === 'account' && ("), settings.indexOf("safeActive === 'security-privacy'"));
  assert.ok(pane.includes('<ProfileMovedNotice />'));
  assert.ok(!pane.includes('<YourCompaniesSection'));
});

test('the settings address: the active company\'s page, another company says so, and the bare address forwards', async () => {
  const restore = installDocument();
  try {
    setReadState({ loading: false, failed: false });
    // `landing` stands in for the page the forward lands on, so the full settings page is not mounted here.
    const at = (company, landing = h(CompanySettingsAt)) => h(ActiveCompanyContext.Provider, { value: { company } }, h(Routes, null,
      h(Route, { path: '/account/companies/settings', element: h(CompanySettingsAt) }),
      h(Route, { path: '/account/companies/:uid/settings', element: landing }),
      h(Route, { path: '*', element: h(Where) })));
    seen = null;
    let view = await mount(at(ROWS[0], h(Where)), '/account/companies/settings?tab=billing');
    assert.equal(seen, '/account/companies/acme/settings?tab=billing');
    await view.unmount();
    view = await mount(at(ROWS[0]), '/account/companies/beta-co/settings');
    assert.ok(view.by('company-settings-not-active'), 'another company\'s settings are drawn as the active one\'s');
    assert.equal(view.pr(view.by('company-settings-not-active')).children?.length > 0, true);
    await view.unmount();
    setReadState({ loading: true, failed: false });
    seen = null;
    view = await mount(at(ROWS[0]), '/account/companies/settings');
    assert.equal(seen, null, 'it forwarded before the companies were read');
    assert.equal(view.text(), '');
    await view.unmount();
  } finally { setReadState({ loading: true, failed: false }); restore(); }
  const page = read('frontend/src/pages/account/companies/CompanySettingsAt.jsx');
  assert.match(page, /if \(company\?\.uid === uid\) return <CompanySettingsPage \/>/);
  assert.match(page, /to=\{companyPathFor\(uid\)\}/);
});
