// D1140 (#3020, CMP19) — one place for companies: the switcher's Manage link,
// the Account menu, "Your companies" off Profile and identity, the forward from
// /company-settings and the settings at their new address.
// D1415 part 4 (#3856): the section's address is /account/portfolio; every old
// /account/companies… address forwards there in one hop (tests at the end).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_moved_d1140.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  MANAGE_LABEL, MOVED_NOTICES, PROFILE_MOVED_STORE, SETTINGS_PATH, SIDEBAR_LABEL,
  companyPathFor, companySettingsPathFor, companyUidFor, settingsUidFor,
  BASE_PATH, COMPANIES_MOVED_KEY, TAB_PATHS,
} from '../src/pages/account/companies/companiesModel.js';
import { CompaniesMovedNotice, ProfileMovedNotice } from '../src/pages/account/companies/CompaniesMoved.jsx';
import CompanySettingsAt from '../src/pages/account/companies/CompanySettingsAt.jsx';
import { MANAGE_LABEL as SWITCHER_MANAGE, setReadState } from '../src/ui/CompanySwitcher.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';
import { isRetiredRedirect } from './_retiredRedirects_2319.mjs';

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

test('D2319 removes /company-settings from routes and beacon keys', () => {
  assert.equal(REDIRECT_ROUTES.some((r) => r.path === '/company-settings'), false, 'retired by D2319');
  const app = read('frontend/src/App.jsx');
  const line = app.split('\n').find((l) => l.includes('path="/company-settings"'));
  assert.equal(line, undefined);
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

test('Manage opens the right company: the switcher, Account menu, and Your companies', () => {
  assert.equal(SWITCHER_MANAGE, MANAGE_LABEL);
  const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
  assert.match(switcher, /<Link\s+to="\/account\/portfolio"[^>]*\n?[^>]*onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,200}data-testid="switcher-manage"/);
  const sidebar = read('frontend/src/ui/SidebarNav.jsx');
  assert.doesNotMatch(sidebar, /to="\/account\/portfolio"/);
  const app = read('frontend/src/App.jsx');
  const account = app.slice(app.indexOf('function UserDropdown('), app.indexOf('function PortalSwitcher'));
  assert.match(account, /<Link to="\/account\/portfolio"[\s\S]*?>\s*Portfolio\s*<\/Link>/);
  assert.equal(SIDEBAR_LABEL, 'Portfolio', 'D1413 name retained in Account (D4416)');
  assert.doesNotMatch(sidebar, />\s*Company Settings\s*</);
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  const card = settings.slice(settings.indexOf('function YourCompaniesSection'));
  assert.match(card, /to=\{c\.uid \? companyPathFor\(c\.uid\) : '\/account\/portfolio'\}/, 'Manage does not open the row\'s own company');
  assert.equal(companyPathFor('acme'), '/account/portfolio/acme');
  // D1413 (#3696 Q3): the company page replaced the lightbox, and opens the company's settings.
  assert.match(read('frontend/src/pages/account/companies/CompanyPage.jsx'), /to=\{companySettingsPathFor\(uid\)\}/);
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
    assert.match(view.text(), /Your companies is now Portfolio, under Account\. Open it/);
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

test('the settings address: any company\'s own page (D4152), and the bare address forwards', async () => {
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
    // D4152 (#4152): any company's settings open at its own address, one header and one form, active here or not.
    view = await mount(at(ROWS[0]), '/account/portfolio/beta-co/settings');
    assert.ok(view.by('company-settings-general'), 'another company\'s settings are its own page');
    assert.equal(view.by('company-settings-not-active'), undefined, 'no "make it active first" detour');
    await view.unmount();
    setReadState({ loading: true, failed: false });
    seen = null;
    view = await mount(at(ROWS[0]), '/account/portfolio/settings');
    assert.equal(seen, null, 'it forwarded before the companies were read');
    assert.equal(view.text(), '');
    await view.unmount();
  } finally { setReadState({ loading: true, failed: false }); restore(); }
  const page = read('frontend/src/pages/account/companies/CompanySettingsAt.jsx');
  // D4152 (#4152 §4–§5): one header and one General form; the old page is never drawn under the tabs.
  assert.match(page, /<SettingsHead uid=\{uid\} name=\{name\} tab="general" \/>\s*<CompanyGeneralForm uid=\{uid\} \/>/);
  assert.doesNotMatch(page.slice(page.indexOf('data-testid="company-settings-general"')), /<CompanySettingsPage/);
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

test('D1415 part 4: the constants are /account/portfolio; D1413 (#3696 Q1) names the section Portfolio', () => {
  assert.equal(BASE_PATH, '/account/portfolio');
  assert.deepEqual(Object.values(TAB_PATHS), ['/account/portfolio', '/account/portfolio/projects', '/account/portfolio/funds', '/account/portfolio/engagements', '/account/portfolio/invitations']);
  assert.equal(companyPathFor('acme'), '/account/portfolio/acme');
  assert.equal(SETTINGS_PATH, '/account/portfolio/settings');
  assert.equal(companySettingsPathFor('acme'), '/account/portfolio/acme/settings');
  assert.equal(SIDEBAR_LABEL, 'Portfolio', 'the owner\'s answer to #3696 Q1');
  assert.equal(MANAGE_LABEL, 'Open Portfolio');
  assert.equal(MOVED_NOTICES[COMPANIES_MOVED_KEY], 'Companies and projects is now Portfolio, at a new address. Update your bookmark.');
});

test('D2319: old company aliases no longer count; portfolio destinations remain canonical', () => {
  const paths = REDIRECT_ROUTES.map((r) => r.path);
  const tab = paths.indexOf('/account/companies/:tab');
  for (const p of ['/account/companies', '/account/companies/settings', '/account/companies/:uid/settings']) {
    assert.equal(paths.includes(p), false, `${p} retired by D2319`);
    assert.equal(tab, -1, 'the retired parameter alias is absent too');
  }
  for (const [from, , pattern] of OLD) assert.equal(redirectPatternFor(split(from)[0]), isRetiredRedirect(split(from)[0]) ? null : pattern, from);
  for (const now of ['/account/portfolio', '/account/portfolio/acme', '/account/portfolio/settings']) assert.equal(redirectPatternFor(now), null, now);
});


test('#4736: no file in frontend/src exports a redirect for a retired address, and the rail has no /company-settings key', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = walk('frontend/src').filter((f) => /\.(jsx?|mjs)$/.test(f));
  for (const f of files) assert.doesNotMatch(read(f).split('\n').filter((l) => /^\s*(export|function|const)\b/.test(l)).join('\n'), /\b(CompaniesMovedRedirect|CompanySettingsRedirect)\b/, f);
  assert.equal(existsSync('frontend/src/pages/account/companies/CompaniesMoved.jsx'), true, 'the arrival notices stay');
  assert.doesNotMatch(read('frontend/src/lib/railPages.js'), /['"]\/company-settings['"]/);
  const model = read('frontend/src/pages/account/companies/companiesModel.js');
  assert.doesNotMatch(model, /export (function|const) (forwardTarget|movedCompaniesTarget|activeUidFrom|OLD_BASE_PATH)\b/, 'the forwards are gone, so are their helpers');
});

test('D1415 part 4: the new addresses are routed, the settings ones before :tab', () => {
  const app = read('frontend/src/App.jsx');
  const at = (p) => app.indexOf(`path="${p}"`);
  assert.ok(at('/account/portfolio/settings') > 0 && at('/account/portfolio/settings') < at('/account/portfolio/:tab'));
  assert.ok(at('/account/portfolio/:uid/settings') > 0 && at('/account/portfolio/:uid/settings') < at('/account/portfolio/:tab'));
});
