import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { PhoneSheet, SheetRow } from '../src/ui/phone/PhoneSheet.jsx';
import { PhoneRows } from '../src/ui/phone/PhoneRows.jsx';
import { PhoneBar, backFallback } from '../src/ui/phone/PhoneBar.jsx';
import { usePhoneWidth } from '../src/ui/phone/usePhoneWidth.js';
import { companyRowDescription } from '../src/ui/phone/CompanySheet.jsx';
import { CompanySheet, CompanyVisits, visitToRecord } from '../src/ui/phone/CompanySheet.jsx';
import { PhoneHeader, HeaderForWidth, BAND_BACKGROUND } from '../src/ui/phone/PhoneHeader.jsx';
import { setReadState } from '../src/ui/CompanySwitcher.jsx';
import NotificationBell from '../src/components/NotificationBell.jsx';
import MobileTabBar from '../src/components/MobileTabBar.jsx';
import { FOUNDER_BAND_PATHS, mobilePlan } from '../src/lib/mobileTabs.js';
import { PERSONAS } from '../src/lib/personas.js';
import { companySheetApi } from '../src/lib/api/companySheet.js';
import { KEY as SUPPORT_KEY } from '../src/lib/supportSession.js';
import { existsSync } from 'node:fs';
import { __resetEadwynPanelForTest, useEadwynPanel, useEadwynRailServes } from '../src/ui/eadwynPanel.js';
import { AccountSheet } from '../src/ui/phone/AccountSheet.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { moreGroups } from '../src/pages/MorePage.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const h = React.createElement;
const render = (element, path = '/more') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, element));
const read = file => readFileSync(resolve(file), 'utf8');

test('D699 sheet keeps the canvas frame and modal semantics', () => {
  const html = render(h(PhoneSheet, { title: 'Switch company', onClose() {} },
    h(SheetRow, { title: 'Juniper Labs', description: 'Not started', onClick() {} })));
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(html, /max-h-\[78%\]/);
  assert.match(html, /rounded-t-\[20px\]/);
  assert.match(html, /z-50/);
  assert.match(html, /min-h-\[52px\]/);
  assert.doesNotMatch(html, /z-\[80\]/);
  const source = read('frontend/src/ui/phone/PhoneSheet.jsx');
  for (const behavior of ['useEscapeClose(onClose)', 'inertOutside(layer.current)', 'lockScroll(document.body)', 'tabTarget(', 'opener?.current?.focus?', '> 60', 'routeAtOpen']) assert.ok(source.includes(behavior), behavior);
});

test('D699 bar and page rows use the pushed-page sizes and render links and actions', () => {
  const bar = render(h(PhoneBar, { back: { label: 'Studio', to: '/studio' }, title: 'More', sub: 'Everything outside the four cycles.' }));
  assert.match(bar, /min-h-11/);
  assert.match(bar, /text-\[19px\]/);
  assert.match(bar, /Everything outside the four cycles/);
  assert.doesNotMatch(bar, /Open Eadwyn for this page/);
  const rows = render(h(PhoneRows, { groups: [{ label: 'Around the cycles', rows: [
    { title: 'Network', description: 'Relationships', to: '/network', value: '3' },
    { title: 'Research', onClick() {}, notRecorded: true },
  ] }] }));
  assert.match(rows, /href="\/network"/);
  assert.match(rows, /<button/);
  assert.equal((rows.match(/min-h-\[56px\]/g) || []).length, 2);
  assert.match(rows, /max-w-\[40%\]/);
  assert.match(rows, /Not recorded/);
});

test('D699 first-entry Back is safe for each viewer', () => {
  assert.equal(backFallback({ shellRole: 'founder', pathname: '/raise/data-room/12' }), '/raise');
  assert.equal(backFallback({ shellRole: 'founder', pathname: '/account/usage', lastCycle: 'grow' }), '/grow');
  assert.equal(backFallback({ shellRole: 'founder', pathname: '/account/usage' }), '/validate');
  assert.equal(backFallback({ role: 'investor' }), '/studio');
  assert.equal(backFallback({ role: 'exploring', labActive: true }), '/studio');
  assert.equal(backFallback({ role: 'exploring', pathname: '/trust' }), '/account');
  assert.equal(backFallback({ role: 'exploring', pathname: '/account' }), '/exploring');
  assert.equal(backFallback({}), '/account');
  assert.match(render(h(PhoneBar, { back: { label: 'Account' }, title: 'Trust' }), '/trust'), /href="\/account"/);
});

test('D699 one phone-width hook answers the first render and server render', () => {
  const Probe = () => h('span', null, usePhoneWidth() ? 'phone' : 'wide');
  const original = globalThis.window;
  try {
    delete globalThis.window;
    assert.match(render(h(Probe)), />wide<\/span>/);
    globalThis.window = { matchMedia: query => ({ matches: query === '(max-width: 1023px)' }) };
    assert.match(render(h(Probe)), />phone<\/span>/);
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('D699 company row descriptions are honest and dated in en-GB', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  assert.equal(companyRowDescription({ cycles_active: ['validate', 'build'] }, true, now), 'Active · Validate, Build');
  assert.equal(companyRowDescription({ cycles_active: [] }, true, now), 'Not started');
  assert.equal(companyRowDescription({ cycles_active: [], last_opened: { cycle: 'raise', at: '2026-10-12T00:00:00Z' } }, false, now), 'Raise · last opened 12 Oct');
  assert.equal(companyRowDescription({ cycles_active: ['validate', 'build'] }, false, now), 'Validate, Build');
  assert.equal(companyRowDescription({ cycles_active: null }, false, now), '');
  assert.equal(companyRowDescription({ cycles_active: [], last_opened: { cycle: 'grow', at: '2025-10-12T00:00:00Z' } }, false, now), 'Grow · last opened 12 Oct 2025');
});

test('D699 More carries both canvas rows and sidebar/persona extras', () => {
  const groups = moreGroups();
  assert.equal(groups[0].label, 'Around the cycles');
  assert.deepEqual(groups[0].rows.map(row => row.to), ['/network', '/research']);
  assert.deepEqual(groups[1].rows.map(row => row.to), ['/spinout-lab', '/messages']);
  assert.deepEqual(moreGroups(undefined, 'founder_existing')[1].rows.map(row => row.to), ['/spinout-lab', '/messages', '/legal-capital']);
  const clone = { founder: SIDEBAR_GROUPS.founder.map(group => ({ ...group, items: [...group.items] })) };
  clone.founder[0].items.push({ to: '/new-place', label: 'New place' });
  assert.ok(moreGroups(clone)[1].rows.some(row => row.to === '/new-place'));
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/more" element=\{guard\(\['admin', 'founder'\]/);
  assert.match(read('frontend/src/pages/MorePage.jsx'), /Unreadable — persona links could not be loaded/);
});

test('D699 one switch writer and account sheet member routes', () => {
  const sheet = read('frontend/src/ui/phone/CompanySheet.jsx');
  assert.match(sheet, /useCompanySwitch\(/);
  assert.doesNotMatch(sheet, /setActiveCompanyId\(/);
  assert.doesNotMatch(sheet, /\/companies\/new|\/switch\//);
  assert.match(sheet, /Unreadable —/);
  const account = read('frontend/src/ui/phone/AccountSheet.jsx');
  for (const route of ['/profile', '/account/usage', '/account/connectors', '/trust', '/my/events', '/pricing', '/wellbeing', '/referrals']) assert.ok(account.includes(`'${route}'`) || account.includes(`"${route}"`), route);
  assert.match(account, /onLogout\?\.\(\)/);
  const companyHtml = render(h(ActiveCompanyContext.Provider, { value: { company: { id: 1, company_name: 'Juniper Labs' }, companies: [], setCompany() {}, setCompanies() {} } },
    h(CompanySheet, { onClose() {} })));
  assert.match(companyHtml, /Switch company/);
  assert.match(companyHtml, /Create a company/);
  assert.match(companyHtml, /A new sidebar, scoped to it/);
  assert.match(companyHtml, /Company Settings/);
  const accountHtml = render(h(ActiveCompanyContext.Provider, { value: { company: { company_name: 'Juniper Labs' } } },
    h(AccountSheet, { user: { name: 'Ada Quill' }, onClose() {}, onLogout() {} })));
  assert.match(accountHtml, />AQ<\/span>/);
  assert.match(accountHtml, /Founder · Juniper Labs/);
  assert.match(accountHtml, /Founder Wellbeing/);
  assert.match(accountHtml, /Refer &amp; Earn/);
  assert.match(accountHtml, /Log Out/);
  assert.match(accountHtml, /href="\/my\/events"/);
  // D786 (#2211): /pricing is the real Plans & Pricing page now, not a canvas slug.
  assert.doesNotMatch(accountHtml, /href="\/(?:your-profile|usage|connectors|trust-center|help-center|plans-pricing|events|logout)"/);
});

test('D699 company sheet switches a member to their last opened cycle', async () => {
  const original = api.listMyCompanies;
  const selected = [];
  const rows = [
    { id: 1, uid: 'one', company_name: 'Juniper Labs', cycles_active: ['validate', 'build'] },
    { id: 2, uid: 'two', company_name: 'Orchard Ops', cycles_active: [] },
    { id: 3, uid: 'three', company_name: 'Tidewater', cycles_active: [], last_opened: { cycle: 'raise', at: '2026-10-12T12:00:00Z' } },
  ];
  api.listMyCompanies = async () => rows;
  const Route = () => h('span', { 'data-testid': 'location' }, useLocation().pathname);
  let mounted;
  try {
    mounted = await mountContracts(h(ActiveCompanyContext.Provider, { value: {
      company: rows[0], companies: rows, setCompany: co => selected.push(co.id), setCompanies() {},
    } }, h(React.Fragment, null, h(CompanySheet, { onClose() {} }), h(Route))), '/more');
    await mounted.flush();
    assert.match(mounted.text(), /Active · Validate, Build/);
    assert.match(mounted.text(), /Orchard OpsNot started/);
    assert.match(mounted.text(), /Raise · last opened 12 Oct/);
    const content = node => node.nodeType === 3 ? node.textContent || '' : (node.childNodes || []).map(content).join('');
    const tide = mounted.nodes().find(node => node.tagName === 'BUTTON' && content(node).includes('Tidewater'));
    assert.ok(tide, 'Tidewater is a switchable row');
    await act(async () => mounted.props(tide).onClick());
    assert.deepEqual(selected, [3]);
    assert.match(mounted.text(), /\/raise/);
  } finally {
    if (mounted) await mounted.unmount();
    api.listMyCompanies = original;
  }
});

test('D699 refused company creation keeps the editor open with the server reason', async () => {
  const oldList = api.listMyCompanies, oldCreate = api.createCompany;
  const oldFocus = Object.getOwnPropertyDescriptor(Object.prototype, 'focus');
  // The tiny repository DOM fixture lacks focus(); React calls it for autoFocus.
  Object.defineProperty(Object.prototype, 'focus', { value() {}, configurable: true, enumerable: false });
  api.listMyCompanies = async () => [];
  api.createCompany = async () => { throw new Error('You already have a company called "Orchard Ops".'); };
  const content = node => node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(content).join('') : node.textContent || '';
  let mounted;
  try {
    mounted = await mountContracts(h(CompanySheet, { onClose() {} }), '/more');
    await mounted.flush();
    const add = mounted.nodes().find(node => node.tagName === 'BUTTON' && content(node).includes('Create a company'));
    assert.ok(add, mounted.text());
    await act(async () => mounted.props(add).onClick());
    const input = mounted.nodes().find(node => node.tagName === 'INPUT');
    await act(async () => mounted.props(input).onChange({ target: { value: 'Orchard Ops' } }));
    const form = mounted.nodes().find(node => node.tagName === 'FORM');
    await act(async () => mounted.props(form).onSubmit({ preventDefault() {} }));
    assert.match(mounted.text(), /already have a company called/);
    assert.ok(mounted.nodes().some(node => node.tagName === 'INPUT'), 'a 409 keeps the name field open');
  } finally {
    if (mounted) await mounted.unmount();
    api.listMyCompanies = oldList; api.createCompany = oldCreate;
    if (oldFocus === undefined) delete Object.prototype.focus; else Object.defineProperty(Object.prototype, 'focus', oldFocus);
  }
});

test('D699 phone primitives pair light backgrounds and text with dark colours', () => {
  for (const file of ['PhoneBar.jsx', 'PhoneRows.jsx', 'PhoneSheet.jsx', 'CompanySheet.jsx', 'AccountSheet.jsx']) {
    const source = read(`frontend/src/ui/phone/${file}`);
    for (const match of source.matchAll(/(?:bg-white|text-gray-(?:700|800|900)|border-gray-(?:200|300))/g)) {
      const line = source.slice(source.lastIndexOf('\n', match.index) + 1, source.indexOf('\n', match.index));
      assert.match(line, /dark:/, `${file}: ${line.trim()}`);
    }
  }
});

// ── PR 2: the visit recorder, the band, the tabs and the census ─────────────

test('D699 a cycle page is a visit, sent once an hour per company and cycle (test 15)', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.deepEqual(visitToRecord('/raise/data-room', 3, null, now), { companyId: 3, cycle: 'raise' });
  const last = { companyId: 3, cycle: 'raise', at: now };
  assert.equal(visitToRecord('/raise/data-room', 3, last, now + 59 * 60_000), null, 'the same pair inside the hour');
  assert.deepEqual(visitToRecord('/raise/data-room', 3, last, now + 60 * 60_000), { companyId: 3, cycle: 'raise' });
  assert.deepEqual(visitToRecord('/raise', 4, last, now), { companyId: 4, cycle: 'raise' }, 'another company is a new pair');
  assert.deepEqual(visitToRecord('/grow', 3, last, now), { companyId: 3, cycle: 'grow' });
  assert.deepEqual(visitToRecord('/validate/problem-discovery/12', 3, null, now), { companyId: 3, cycle: 'validate' });
  for (const path of ['/network', '/studio', '/more', '/validate/interviews', '/raise/cap-table/variants']) {
    assert.equal(visitToRecord(path, 3, null, now), null, path);
  }
  for (const id of [null, undefined, 0, -1, '3']) assert.equal(visitToRecord('/grow', id, null, now), null, String(id));
});

async function visitsSent(props, { path = '/raise/data-room', support = false } = {}) {
  const original = companySheetApi.recordVisit;
  const sent = [];
  companySheetApi.recordVisit = async (companyId, cycle) => { sent.push([companyId, cycle]); return {}; };
  // Written during render, so it is in place before the recorder's effect runs.
  const Support = () => {
    if (support) localStorage.setItem(SUPPORT_KEY, JSON.stringify({ expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
    return null;
  };
  let mounted;
  try {
    mounted = await mountContracts(h(ActiveCompanyContext.Provider, { value: { company: { id: 3, company_name: 'Tidewater' } } },
      h(Support), h(CompanyVisits, props)), path);
    await mounted.flush();
  } finally {
    if (mounted) await mounted.unmount();
    companySheetApi.recordVisit = original;
  }
  return sent;
}

test('D699 the recorder sends a founder\'s visit, and never an operator\'s (test 15)', async () => {
  assert.deepEqual(await visitsSent({ role: 'founder', record: true }), [[3, 'raise']]);
  assert.deepEqual(await visitsSent({ role: 'founder', record: true }, { path: '/network' }), []);
  assert.deepEqual(await visitsSent({ role: 'founder', record: false }), [], 'impersonating or viewing as a founder');
  assert.deepEqual(await visitsSent({ role: 'founder', record: true }, { support: true }), [], 'an HQ support session');
  assert.deepEqual(await visitsSent({ role: 'investor', record: true }), [], 'not a founder');
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<MobileTabBar role=\{shellRole\} \/>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<CompanyVisits role=\{shellRole\} record=\{!isImpersonating && !\(isAdmin && activeRole !== 'admin'\)\} \/>/);
});

const ada = { id: 7, name: 'Ada Quill', email: 'ada@example.test' };
const band = (company, readState = { loading: false, failed: false }) => {
  setReadState(readState);
  try {
    return render(h(ActiveCompanyContext.Provider, { value: { company } }, h(PhoneHeader, { user: ada, onLogout() {} })), '/validate');
  } finally { setReadState({ loading: true, failed: false }); }
};

test('D699 the band: image, pill, Studio, bell and initials, all 44px targets (test 17)', () => {
  const html = band({ id: 1, company_name: 'Juniper Labs' });
  // The 52px row sits inside the band, below the top inset the band takes as the shell's first element (2026-10-21).
  assert.match(html, /<header data-testid="phone-header" data-phone-band="" class="[^"]*\blg:hidden\b[^"]*"[^>]*><div class="relative h-\[52px\]">/);
  for (const part of ['rgba(20,12,38,.22) 0%', 'rgba(20,12,38,.55) 100%', 'url(/site/lab-band.webp) center 18% / cover', 'rgb(20,12,38)']) {
    assert.ok(BAND_BACKGROUND.includes(part), part);
  }
  assert.match(html, /style="background:linear-gradient\(180deg/);
  assert.ok(existsSync(resolve('frontend/public/site/lab-band.webp')), 'the band image is not committed');
  assert.match(html, />Axal VC</);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false" data-company-switcher="" data-testid="phone-company-pill"/);
  assert.match(html, /max-w-\[118px\][^>]*><span class="truncate">Juniper Labs<\/span>/);
  assert.match(html, /<a aria-label="Studio"[^>]*href="\/studio"/);
  assert.match(html, /<a aria-label="Studio" class="[^"]*\bh-11\b/);
  assert.match(html, /aria-label="Account"[^>]*>.*?>AQ<\/span>/);
  for (const [, cls] of html.matchAll(/<(?:a|button)\b[^>]*class="([^"]*)"/g)) assert.match(cls, /\bh-11\b/, `a band control is under 44px: ${cls}`);
  assert.doesNotMatch(html, /Open menu/);
  assert.match(read('frontend/src/ui/phone/PhoneHeader.jsx'), /<NotificationBell userId=\{user\?\.id\} tone="band" \/>/);
  const bell = render(h(NotificationBell, { userId: 7, tone: 'band' }));
  assert.match(bell, /aria-label="Notifications" class="relative inline-flex h-11 w-11 [^"]*text-white/);
  assert.match(render(h(NotificationBell, { userId: 7 })), /aria-label="Notifications" class="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600"/, 'the desktop bell changed');
});

test('D699 the pill keeps the switcher\'s honesty rules (test 17)', () => {
  assert.match(band(null), /<span class="truncate">No company<\/span>/);
  assert.match(band(null, { loading: true, failed: false }), /<span class="truncate">…<\/span>/);
  assert.match(band(null, { loading: false, failed: true }), /<span class="truncate">Unavailable<\/span>/);
});

test('D699 one header is mounted: the band for a founder on a phone, today\'s otherwise (test 17)', () => {
  const today = h('header', { 'data-testid': 'today' });
  const at = (founder, phone) => render(h(ActiveCompanyContext.Provider, { value: { company: null } },
    h(HeaderForWidth, { founder, phone, user: ada }, today)));
  assert.match(at(true, true), /phone-header/);
  assert.doesNotMatch(at(true, true), /data-testid="today"/);
  for (const [founder, phone] of [[true, false], [false, true], [false, false]]) {
    const html = at(founder, phone);
    assert.match(html, /data-testid="today"/);
    assert.doesNotMatch(html, /phone-header/);
  }
  const app = read('frontend/src/App.jsx');
  const wrap = app.indexOf("<HeaderForWidth founder={shellRole === 'founder'} user={user} onLogout={onLogout} branchFact={branchFact}>");
  const header = app.indexOf('<header className="z-40 h-14 ');
  const close = app.indexOf('</HeaderForWidth>');
  assert.ok(wrap > 0 && wrap < header && header < close, 'today\'s header is not inside HeaderForWidth');
  assert.match(app.slice(header, close), /<\/header>\s*$/, 'HeaderForWidth wraps more than the header');
  assert.equal(app.split('aria-label="Open menu"').length - 1, 1, 'the hamburger lives in today\'s header only');
});

test('D699 the founder tabs are the four cycles, and More is the /more page (test 18)', () => {
  const plan = mobilePlan('founder');
  assert.deepEqual(plan.tabs.map(row => row.to), ['/validate', '/build', '/raise', '/grow']);
  assert.ok(!plan.more.some(row => FOUNDER_BAND_PATHS.includes(row.to)), '/studio is in More');
  const bar = path => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(MobileTabBar, { role: 'founder' })));
  assert.match(bar('/more'), /aria-current="page"[^>]*data-testid="link-mobile-tab-more" href="\/more"/);
  assert.match(bar('/network/relationships'), /data-active="true" data-testid="link-mobile-tab-more"/);
  assert.doesNotMatch(bar('/studio'), /aria-current="page"|data-active="true"/, 'something is lit on /studio');
  assert.doesNotMatch(bar('/validate'), /aria-haspopup/);
  for (const role of ['investor', 'advisor', 'partner', 'admin', 'exploring']) assert.equal(mobilePlan(role), null, role);
});

test('D699 census: every destination a founder\'s phone had keeps a phone home (test 19)', () => {
  const app = read('frontend/src/App.jsx');
  const dropdown = app.slice(app.indexOf('function UserDropdown('), app.indexOf('function PortalSwitcher'));
  const header = app.slice(app.indexOf('<header className="z-40 h-14 '), app.indexOf('</header>'));
  const wanted = new Map();
  const want = (to, from) => wanted.set(to, from);
  for (const row of SIDEBAR_GROUPS.founder.flatMap(group => group.items)) want(row.to, 'sidebar');
  assert.match(read('frontend/src/ui/SidebarNav.jsx'), /to="\/company-settings"/);
  want('/company-settings', 'drawer');
  const dropdownLinks = [...dropdown.matchAll(/to="([^"]+)"/g)].map(match => match[1]);
  assert.ok(dropdownLinks.length >= 10, 'the census no longer reads UserDropdown');
  for (const to of dropdownLinks) want(to, 'UserDropdown');
  for (const to of ['/messages', '/referrals']) { assert.match(header, new RegExp(`to="${to}"`)); want(to, 'header'); }
  assert.match(read('frontend/src/components/FounderWellbeingMenu.jsx'), /to="\/wellbeing"/);
  want('/wellbeing', 'FounderWellbeingMenu');

  const offered = new Set(['/studio', ...mobilePlan('founder').tabs.map(row => row.to)]);
  for (const group of moreGroups()) for (const row of group.rows) offered.add(row.to);
  const sheets = read('frontend/src/ui/phone/CompanySheet.jsx') + read('frontend/src/ui/phone/AccountSheet.jsx');
  for (const [, to] of sheets.matchAll(/'(\/[a-z][a-z/-]*)'/g)) offered.add(to);
  for (const [, to] of sheets.matchAll(/to="(\/[a-z][a-z/-]*)"/g)) offered.add(to);
  for (const [to, from] of wanted) assert.ok(offered.has(to), `${to} (${from}) has no phone home`);

  // Each founder persona's extras reach /more; a persona of another alignment adds none, as in the sidebar.
  for (const persona of PERSONAS.filter(p => p.role_alignment === 'founder')) {
    const rows = new Set(moreGroups(undefined, persona.id).flatMap(group => group.rows.map(row => row.to)));
    for (const extra of persona.nav_extras) assert.ok(rows.has(extra.to) || offered.has(extra.to), `${persona.id}: ${extra.to}`);
  }
  const partner = PERSONAS.find(p => p.role_alignment === 'partner' && p.nav_extras.length);
  const base = moreGroups().flatMap(group => group.rows.map(row => row.to));
  assert.deepEqual(moreGroups(undefined, partner.id).flatMap(group => group.rows.map(row => row.to)), base, `${partner.id} adds partner rows to a founder's More`);

  // The switch and the create go through the one switch path.
  const companySheet = read('frontend/src/ui/phone/CompanySheet.jsx');
  assert.match(companySheet, /switchTo\(co\)/);
  assert.match(companySheet, /await create\(name\.trim\(\)\)/);
  // The one control with no phone home: the sidebar search filters drawer
  // rows, and the drawer is not reachable on a founder's phone (D699.md).
  assert.match(read('frontend/src/ui/SidebarNav.jsx'), /search/i);
});

// ── The bar's Eadwyn button (test 10, D698) ─────────────────────────────────

async function barButtons(barProps, { served }) {
  __resetEadwynPanelForTest();
  const out = {};
  // Stands in for a founder `WorkerRail`: the rail is what makes the panel available.
  const Rail = () => { useEadwynRailServes(served); return null; };
  const Probe = () => { out.panel = useEadwynPanel(); return null; };
  const mounted = await mountContracts(h(React.Fragment, null, h(Rail), h(Probe),
    h(PhoneBar, { back: { label: 'Back', to: '/account' }, title: 'Usage', ...barProps })), '/account/usage');
  try {
    await mounted.flush();
    const buttons = mounted.nodes().filter(node => node.tagName === 'BUTTON');
    const open = buttons.find(node => mounted.props(node)['aria-label'] === 'Open Eadwyn for this page');
    if (open) await act(async () => mounted.props(open).onClick());
    return { buttons: buttons.length, open: !!open, panel: { ...out.panel }, text: mounted.text() };
  } finally {
    await mounted.unmount();
    __resetEadwynPanelForTest();
  }
}

test('D699 the bar draws D698\'s Eadwyn button from eadwynLabel, only for a viewer the panel serves (test 10)', async () => {
  const served = await barButtons({ eadwynLabel: 'Account · Usage' }, { served: true });
  assert.equal(served.open, true, 'no "Open Eadwyn for this page" button');
  assert.equal(served.buttons, 1, 'the bar draws a second button beside EadwynButton');
  assert.equal(served.panel.triggered, true, 'the button did not register its trigger, so the floating button stays');
  assert.equal(served.panel.open, true, 'the button did not open the panel');
  assert.equal(served.panel.label, 'Account · Usage', 'the panel opened without the bar\'s eadwynLabel');

  const unserved = await barButtons({ eadwynLabel: 'Usage' }, { served: false });
  assert.equal(unserved.buttons, 0, 'a viewer the panel does not serve got a button or a stand-in');

  const none = await barButtons({}, { served: true });
  assert.equal(none.buttons, 0, 'a bar with no eadwynLabel drew a button');

  const action = await barButtons({ eadwynLabel: 'Usage', action: h('a', { href: '/menu' }, 'Menu') }, { served: true });
  assert.equal(action.open, false, 'action did not replace the Eadwyn button');
  assert.match(action.text, /Menu/);

  assert.match(read('frontend/src/ui/phone/PhoneBar.jsx'), /import \{ EadwynButton \} from '\.\.\/EadwynPanel\.jsx';/);
  assert.doesNotMatch(read('frontend/src/ui/phone/PhoneBar.jsx'), /aria-label="Open Eadwyn for this page"/, 'the bar draws its own copy of the button');
});
