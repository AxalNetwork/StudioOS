/** D1122 / #3002 — the remaining D936 header gaps, on real components. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument, mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { BillingPage, DirectoryPage } from '../src/pages/admin/ConsolePages.jsx';
import AdminPageHeader, { HeaderMenuItem, HeaderTab } from '../src/ui/AdminPageHeader.jsx';
const h = React.createElement;
const read = p => readFileSync(p, 'utf8');
const byId = (v, id) => v.nodes().find(n => v.props(n)?.['data-testid'] === id);

// Real header composition, without waiting for Billing's on-demand Stripe reads.
test('Billing identifies HQ only before any read; an ordinary console does not', async () => {
  for (const [Page, path, expected] of [[BillingPage, '/admin/revenue/billing', true], [DirectoryPage, '/admin/directory', false]]) {
    const v = await mountContracts(h(AuthProvider, null, h(Page)), path, { id: 1, role: 'admin', is_super_admin: 1 });
    try {
      assert.equal(v.text().includes('HQ only'), expected);
      assert.ok(byId(v, 'admin-page-header'));
      assert.ok(!byId(v, 'admin-page-scope'), 'HQ pages have no Admin scope');
    } finally { await v.unmount(); }
  }
});

test('Legal console and only its dedicated test references are retired; Contracts remains routed', () => {
  assert.equal(existsSync('frontend/src/pages/admin/consoles/LegalConsole.jsx'), false);
  for (const file of ['frontend/test/_adminConsoles.mjs', 'frontend/test/admin_consoles_d648.test.mjs', 'frontend/test/_toast_render_child.mjs', 'frontend/test/admin_console_copy_d942.test.mjs', 'frontend/test/admin_route_reachability.test.mjs']) {
    assert.doesNotMatch(read(file), /LegalConsole|LegalPanel|SignedDocLightbox|TemplateUsageModal/, file);
  }
  assert.match(read('frontend/src/pages/hq/ContractsPage.jsx'), /export \{ default \} from '\.\.\/admin\/contracts\/ContractsDesk\.jsx'/);
});

test('phone primary action has its own full-width row under the line; tabs retain their fade and notice has a touch target', async () => {
  const v = await mountContracts(h(AdminPageHeader, {
    title: 'Invitations', line: 'Bring partners in.', actions: h('button', null, 'New invitation'),
    notice: { text: 'A new address.', onDismiss() {} },
    tabs: h(HeaderTab, { to: '/admin/invitations' }, 'Overview'),
  }));
  try {
    const actions = byId(v, 'admin-page-actions');
    const primary = actions.childNodes[0];
    const cls = v.props(primary).className;
    assert.match(cls, /col-span-2 row-start-4/);
    assert.ok(cls.includes('[&>*]:w-full'));
    assert.ok(cls.includes('sm:[&>*]:w-auto'));
    const line = v.nodes().find(n => n.tagName === 'P');
    assert.match(v.props(line).className, /row-start-3/);
    const tabs = byId(v, 'admin-page-tabs');
    assert.match(v.props(tabs).style.maskImage, /linear-gradient/);
    assert.ok(v.props(tabs).style.paddingRight >= 16, 'the final tab must scroll clear of the fade');
    assert.match(v.props(tabs).className, /overflow-x-auto/);
    const dismiss = v.nodes().find(n => n.tagName === 'BUTTON' && v.props(n)?.children === 'Dismiss');
    assert.match(v.props(dismiss).className, /min-h-\[44px\]/);
  } finally { await v.unmount(); }
});

// Focus-aware small DOM. Only its menu query is needed: it reads actual mounted
// menuitem nodes rather than substituting a hand-written model of the menu.
for (const phone of [false, true]) test(`More traps focus, closes and returns focus (${phone ? 'phone sheet' : 'desktop menu'})`, async () => {
  const restore = installDocument('', { focus: true });
  const previousMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const nodes = () => { const walk = n => [n, ...n.childNodes.flatMap(walk)]; return walk(container); };
  const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const id = value => nodes().find(n => props(n)?.['data-testid'] === value);
  let picks = 0;
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(AdminPageHeader, { title: 'Accounts', more: h(React.Fragment, null,
      h(HeaderMenuItem, { onSelect: () => { picks++; } }, 'Copy link'), h(HeaderMenuItem, { to: '/admin/trash' }, 'Trash'), h(HeaderMenuItem, { onSelect() {} }, 'Third action')) }))));
    const opener = id('admin-page-more');
    assert.equal(props(opener)['aria-haspopup'], phone ? 'dialog' : 'menu');
    opener.parentNode.querySelectorAll = () => nodes().filter(n => props(n)?.role === 'menuitem');
    opener.focus();
    await act(async () => props(opener).onClick());
    const items = () => nodes().filter(n => props(n)?.role === 'menuitem');
    assert.ok(document.activeElement === items()[0], 'opening focuses the first item');
    const sheet = id('admin-page-more-sheet');
    assert.equal(Boolean(sheet), phone);
    if (phone) {
      assert.equal(props(sheet).role, 'dialog');
      assert.equal(props(sheet)['aria-modal'], 'true');
      assert.equal(props(id('admin-page-more-sheet-layer'))['data-phone'], 'sheet');
    }
    const key = async (key, shiftKey = false) => {
      let prevented = false;
      await act(async () => props(opener.parentNode).onKeyDown({ key, shiftKey, preventDefault() { prevented = true; } }));
      assert.equal(prevented, true, key);
    };
    items()[2].focus(); await key('Tab'); assert.ok(document.activeElement === items()[0]);
    await key('Tab', true); assert.ok(document.activeElement === items()[2]);
    await key('Home'); assert.ok(document.activeElement === items()[0]);
    await key('End'); assert.ok(document.activeElement === items()[2]);
    await key('ArrowDown'); assert.ok(document.activeElement === items()[0]);
    await key('Escape'); assert.equal(id('admin-page-more-menu'), undefined);
    assert.ok(document.activeElement === opener);
    await act(async () => props(opener).onClick());
    await act(async () => props(items()[0]).onClick());
    assert.equal(picks, 1); assert.equal(id('admin-page-more-menu'), undefined);
    assert.ok(document.activeElement === opener);
  } finally {
    await act(async () => root.unmount());
    globalThis.matchMedia = previousMedia; restore();
  }
});
