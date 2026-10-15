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
import { CompanySheet } from '../src/ui/phone/CompanySheet.jsx';
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
  for (const route of ['/profile', '/account/usage', '/account/connectors', '/trust', '/my/events', '/plans-and-pricing', '/wellbeing', '/referrals']) assert.ok(account.includes(`'${route}'`) || account.includes(`"${route}"`), route);
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
  assert.doesNotMatch(accountHtml, /href="\/(?:your-profile|usage|connectors|trust-center|help-center|plans-pricing|events|pricing|logout)"/);
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
