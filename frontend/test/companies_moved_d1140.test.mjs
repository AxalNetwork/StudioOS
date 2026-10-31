// D1140 (#3020, CMP19) — one place for companies: the switcher's Manage link,
// the sidebar row, "Your companies" off Profile and identity, the forward from
// /company-settings and the settings at their new address.
// D1415 part 4 (#3856): the section's address is /account/portfolio; every old
// /account/companies… address forwards there in one hop (tests at the end).
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
  BASE_PATH, COMPANIES_MOVED_KEY, TAB_PATHS, movedCompaniesTarget,
} from '../src/pages/account/companies/companiesModel.js';
import { CompaniesMovedNotice, CompaniesMovedRedirect, CompanySettingsRedirect, ProfileMovedNotice } from '../src/pages/account/companies/CompaniesMoved.jsx';
import CompanySettingsAt from '../src/pages/account/companies/CompanySettingsAt.jsx';
import { MANAGE_LABEL as SWITCHER_MANAGE, setReadState } from '../src/ui/CompanySwitcher.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';

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
  assert.equal(forwardTarget('acme', '?tab=billing&x=1', '#seats'), '/account/portfolio/acme?tab=billing&x=1&moved=company-settings#seats');
  assert.equal(forwardTarget('beta-co', ''), '/account/portfolio/beta-co?moved=company-settings');
  assert.equal(forwardTarget(null, '?moved=old'), '/account/portfolio?moved=company-settings', 'a stale moved key is replaced, never doubled');
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
      [async () => ROWS, () => 9, '/account/portfolio/beta-co?tab=team&moved=company-settings#x'],
      [async () => [], () => null, '/account/portfolio?tab=team&moved=company-settings#x'],
      [async () => { throw new Error('down'); }, () => 7, '/account/portfolio?tab=team&moved=company-settings#x'],
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
  for (const p of ['/account/portfolio/settings', '/account/portfolio/:uid/settings']) {
    const at = app.indexOf(`path="${p}"`);
    assert.ok(at > 0 && at < app.indexOf('path="/account/portfolio/:tab"'), `${p} must precede /account/portfolio/:tab`);
  }
});

test('the settings segment is never read as a company or a tab', () => {
  assert.equal(companyUidFor('/account/portfolio/settings'), null);
  assert.equal(companyUidFor('/account/portfolio/acme/settings'), null);
  assert.equal(companyUidFor('/account/portfolio/acme'), 'acme');
  assert.equal(settingsUidFor(SETTINGS_PATH), '');
  assert.equal(settingsUidFor('/account/portfolio/beta-co/settings'), 'beta-co');
  assert.equal(settingsUidFor('/account/portfolio/acme'), null);
  assert.equal(companySettingsPathFor('beta-co'), '/account/portfolio/beta-co/settings');
});

test('Manage opens the right company: the switcher, the sidebar row, and Your companies', () => {
  assert.equal(SWITCHER_MANAGE, MANAGE_LABEL);
  const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
  assert.match(switcher, /<Link\s+to="\/account\/portfolio"[^>]*\n?[^>]*onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,200}data-testid="switcher-manage"/);
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(sidebar, /to="\/account\/portfolio"/);
  assert.ok(sidebar.includes(SIDEBAR_LABEL), 'the sidebar row is not renamed');
  assert.doesNotMatch(sidebar, />\s*Company Settings\s*</);
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  const card = settings.slice(settings.indexOf('function YourCompaniesSection'));
  assert.match(card, /to=\{c\.uid \? companyPathFor\(c\.uid\) : '\/account\/portfolio'\}/, 'Manage does not open the row\'s own company');
  assert.equal(companyPathFor('acme'), '/account/portfolio/acme');
  assert.match(read('frontend/src/pages/account/companies/CompanyLightbox.jsx'), /to=\{companySettingsPathFor\(uid\)\}/);
  assert.doesNotMatch(read('frontend/src/ui/phone/CompanySheet.jsx'), /'\/company-settings'/);
  assert.doesNotMatch(read('frontend/src/workspaces/shellConfig.js'), /'\/company-settings'/);
});

test('the Companies and projects moved notice shows after the forward, and dismissing drops it', async () => {
  const restore = installDocument();
  try {
    const page = h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, h(CompaniesMovedNotice), h(Where)) }));
    let view = await mount(page, '/account/portfolio/acme?tab=team&moved=company-settings');
    assert.match(view.text(), /Company Settings has a new address\. Update your bookmark\./);
    await view.click('companies-moved-dismiss');
    assert.equal(view.by('companies-moved'), undefined);
    assert.equal(seen, '/account/portfolio/acme?tab=team', 'dismiss keeps the rest of the query');
    await view.unmount();
    view = await mount(page, '/account/portfolio/acme?moved=elsewhere');
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
      h(Route, { path: '/account/portfolio/settings', element: h(CompanySettingsAt) }),
      h(Route, { path: '/account/portfolio/:uid/settings', element: landing }),
      h(Route, { path: '*', element: h(Where) })));
    seen = null;
    let view = await mount(at(ROWS[0], h(Where)), '/account/portfolio/settings?tab=billing');
    assert.equal(seen, '/account/portfolio/acme/settings?tab=billing');
    await view.unmount();
    view = await mount(at(ROWS[0]), '/account/portfolio/beta-co/settings');
    assert.ok(view.by('company-settings-not-active'), 'another company\'s settings are drawn as the active one\'s');
    assert.equal(view.pr(view.by('company-settings-not-active')).children?.length > 0, true);
    await view.unmount();
    setReadState({ loading: true, failed: false });
    seen = null;
    view = await mount(at(ROWS[0]), '/account/portfolio/settings');
    assert.equal(seen, null, 'it forwarded before the companies were read');
    assert.equal(view.text(), '');
    await view.unmount();
  } finally { setReadState({ loading: true, failed: false }); restore(); }
  const page = read('frontend/src/pages/account/companies/CompanySettingsAt.jsx');
  assert.match(page, /if \(company\?\.uid === uid\) return <CompanySettingsPage \/>/);
  assert.match(page, /to=\{companyPathFor\(uid\)\}/);
});

// ── D1415 part 4 (#3856): /account/portfolio ─────────────────────────────

/** Each old address, where it lands, and the pattern the beacon counts it under. */
const OLD = [
  ['/account/companies', '/account/portfolio?moved=companies', '/account/companies'],
  ['/account/companies/projects?x=1#t', '/account/portfolio/projects?x=1&moved=companies#t', '/account/companies/:tab'],
  ['/account/companies/acme?tab=team&moved=old#seats', '/account/portfolio/acme?tab=team&moved=companies#seats', '/account/companies/:tab'],
  ['/account/companies/settings?tab=billing#b', '/account/portfolio/settings?tab=billing&moved=companies#b', '/account/companies/settings'],
  ['/account/companies/beta-co/settings?q=2', '/account/portfolio/beta-co/settings?q=2&moved=companies', '/account/companies/:uid/settings'],
];
const split = (u) => { const m = u.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/); return [m[1], m[2] || '', m[3] || '']; };

test('D1415 part 4: the constants are /account/portfolio; the labels are unchanged', () => {
  assert.equal(BASE_PATH, '/account/portfolio');
  assert.deepEqual(Object.values(TAB_PATHS), ['/account/portfolio', '/account/portfolio/projects', '/account/portfolio/funds', '/account/portfolio/engagements', '/account/portfolio/invitations']);
  assert.equal(companyPathFor('acme'), '/account/portfolio/acme');
  assert.equal(SETTINGS_PATH, '/account/portfolio/settings');
  assert.equal(companySettingsPathFor('acme'), '/account/portfolio/acme/settings');
  assert.equal(SIDEBAR_LABEL, 'Companies and projects', 'a label renamed before #3696\'s naming question is answered');
  assert.equal(MANAGE_LABEL, 'Manage companies and projects');
  assert.equal(MOVED_NOTICES[COMPANIES_MOVED_KEY], 'Companies and projects has a new address. Update your bookmark.');
});

test('D1415 part 4: every old address forwards to the same place, its query and hash kept, moved=companies added', () => {
  for (const [from, want] of OLD) assert.equal(movedCompaniesTarget(...split(from)), want, from);
  assert.equal(movedCompaniesTarget('/account/companies/', ''), '/account/portfolio?moved=companies', 'a trailing slash is the section');
  for (const other of ['/account/companiesx', '/account/portfolio', '/company-settings', '']) assert.equal(movedCompaniesTarget(other), null, other);
});

test('D1415 part 4: mounted, each old address lands on the new one in one hop', async () => {
  const restore = installDocument();
  try {
    const app = h(Routes, null,
      ...['/account/companies', '/account/companies/settings', '/account/companies/:uid/settings', '/account/companies/:tab']
        .map((path) => h(Route, { key: path, path, element: h(CompaniesMovedRedirect) })),
      h(Route, { path: '*', element: h(Where) }));
    for (const [from, want] of OLD) {
      seen = null;
      const view = await mount(app, from);
      assert.equal(seen, want, from);
      await view.unmount();
    }
  } finally { restore(); }
});

test('D1415 part 4: App.jsx routes the new addresses (settings before :tab) and forwards every old one', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/account/companies', '/account/companies/settings', '/account/companies/:uid/settings', '/account/companies/:tab']) {
    const line = app.split('\n').find((l) => l.includes(`path="${p}"`));
    assert.ok(line, `${p} is not routed`);
    assert.match(line, /element=\{<CompaniesMovedRedirect \/>\}/, `${p} must only forward`);
  }
  const at = (p) => app.indexOf(`path="${p}"`);
  assert.ok(at('/account/portfolio/settings') > 0 && at('/account/portfolio/settings') < at('/account/portfolio/:tab'));
  assert.ok(at('/account/portfolio/:uid/settings') > 0 && at('/account/portfolio/:uid/settings') < at('/account/portfolio/:tab'));
  // /partner/operations[/overview] go straight to the new settings address.
  for (const p of ['/partner/operations', '/partner/operations/overview']) {
    const line = app.split('\n').find((l) => l.includes(`path="${p}"`));
    assert.match(line, /<Navigate to="\/account\/portfolio\/settings" replace \/>/, p);
  }
});

test('D1415 part 4: /company-settings lands under /account/portfolio in one hop, never on an old address', () => {
  for (const t of [forwardTarget('acme', '?a=1', '#h'), forwardTarget(null, '')]) {
    assert.ok(t.startsWith('/account/portfolio'), t);
    assert.equal(redirectPatternFor(split(t)[0]), null, `${t} forwards again`);
  }
});

test('D1415 part 4: the beacon counts each old address under its own pattern, exact before :tab', () => {
  const paths = REDIRECT_ROUTES.map((r) => r.path);
  const tab = paths.indexOf('/account/companies/:tab');
  for (const p of ['/account/companies', '/account/companies/settings', '/account/companies/:uid/settings']) {
    assert.ok(paths.includes(p), `${p} is not counted`);
    assert.ok(paths.indexOf(p) < tab, `${p} must precede /account/companies/:tab`);
  }
  for (const [from, , pattern] of OLD) assert.equal(redirectPatternFor(split(from)[0]), pattern, from);
  for (const now of ['/account/portfolio', '/account/portfolio/acme', '/account/portfolio/settings']) assert.equal(redirectPatternFor(now), null, now);
});

