// D1443 part 5 (#3992) — Ask on every rail page header: one helper
// (`ui/HeaderAsk.jsx`), mounted by the shared header pieces, one button a page.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/header_ask_d1443p5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { __resetEadwynPanelForTest, useAskRail } from '../src/ui/eadwynPanel.js';
import { askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import HeaderAsk, { headerAskClaims, headerAskWinner, useHeaderAskClaim } from '../src/ui/HeaderAsk.jsx';
import AdminPageHeader from '../src/ui/AdminPageHeader.jsx';
import ZoneActions from '../src/workspaces/ZoneActions.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** A rail that serves Ask on its page, as `WorkerRail` does. */
function Rail({ serves = true }) {
  useAskRail(serves, 'Founder · Build · Board', 'Build · Board');
  return null;
}

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const realWaiting = askPanelAdapter.waiting;
  askPanelAdapter.waiting = async () => ({ available: true, data: { count: 2 } });
  await act(async () => { root.render(element); });
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const asks = () => walk(container).filter((n) => n.tagName === 'BUTTON' && /^Ask Eadwyn/.test(props(n)['aria-label'] || ''));
  return {
    asks, props, walk, container,
    render: async (el) => { await act(async () => { root.render(el); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    async unmount() { await act(async () => root.unmount()); askPanelAdapter.waiting = realWaiting; restore(); },
  };
}

test('one Ask a page: two header mounts draw one button, and the next takes over when the first goes', async () => {
  // Mutation checked: HeaderAsk drawing on every mount (no claim) → two buttons.
  __resetEadwynPanelForTest();
  const page = (both) => h(MemoryRouter, null, h(Rail), both ? h(HeaderAsk, { testId: 'first' }) : null, h(HeaderAsk, { testId: 'second' }));
  const m = await mount(page(true));
  try {
    assert.equal(m.asks().length, 1, 'one Ask on the page');
    assert.equal(m.props(m.asks()[0])['data-testid'], 'first', 'the first mounted is the one drawn');
    assert.equal(m.props(m.asks()[0])['aria-label'], 'Ask Eadwyn, 2 waiting', 'with D1442\'s count');
    await m.render(page(false));
    assert.equal(m.asks().length, 1);
    assert.equal(m.props(m.asks()[0])['data-testid'], 'second', 'the remaining mount draws it');
    await m.render(h(MemoryRouter, null));
    assert.deepEqual(headerAskClaims(), [], 'unmounted mounts give their place back');
  } finally { await m.unmount(); }
});

test('no rail serving Ask (no rail, a support session, an Explorer): no header Ask anywhere', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(MemoryRouter, null, h(Rail, { serves: false }), h(HeaderAsk), h(ZoneActions, { items: [{ label: 'Export', onClick: () => {} }] })));
  try {
    assert.equal(m.asks().length, 0);
  } finally { await m.unmount(); }
});

test('ZoneActions (the action row ~70 pages draw) carries the Ask beside the primary', async () => {
  // Mutation checked: HeaderAsk dropped from ZoneActions → no Ask.
  __resetEadwynPanelForTest();
  const items = [{ label: 'New lane', onClick: () => {}, primary: true, accent: 'founder' }, { label: 'Export', onClick: () => {} }];
  const m = await mount(h(MemoryRouter, null, h(Rail), h(ZoneActions, { items })));
  try {
    assert.equal(m.asks().length, 1);
    assert.equal(m.props(m.asks()[0])['data-testid'], 'zone-actions-ask');
  } finally { await m.unmount(); }
});

test('the rail\'s fallback draws only while no header claims Ask, whichever mounted first', async () => {
  // Mutation checked: headerAskWinner taking the first claim regardless of rank → the rail's Ask beside the header's.
  assert.equal(headerAskWinner([{ id: 'r', fallback: true }, { id: 'h', fallback: false }]), 'h');
  assert.equal(headerAskWinner([{ id: 'r', fallback: true }]), 'r');
  assert.equal(headerAskWinner([]), null);
  __resetEadwynPanelForTest();
  const page = (header) => h(MemoryRouter, null, h(Rail), h(HeaderAsk, { fallback: true, testId: 'rail-ask' }), header ? h(HeaderAsk, { testId: 'page-ask' }) : null);
  const m = await mount(page(true));
  try {
    assert.equal(m.asks().length, 1);
    assert.equal(m.props(m.asks()[0])['data-testid'], 'page-ask', 'the header wins over the rail that claimed first');
    await m.render(page(false));
    assert.equal(m.asks().length, 1);
    assert.equal(m.props(m.asks()[0])['data-testid'], 'rail-ask', 'no header: the rail carries it');
  } finally { await m.unmount(); }
});

test('a page that draws its own Ask (the deck\'s DeckAsk) claims the place: no header or rail Ask beside it', async () => {
  // Mutation checked: headerAskWinner ignoring `own` → the header's Ask beside the deck's.
  assert.equal(headerAskWinner([{ id: 'h', fallback: false }, { id: 'd', own: true }]), 'd');
  __resetEadwynPanelForTest();
  function OwnAsk() { useHeaderAskClaim(); return null; }
  const m = await mount(h(MemoryRouter, null, h(Rail), h(HeaderAsk, { testId: 'page-ask' }), h(HeaderAsk, { fallback: true, testId: 'rail-ask' }), h(OwnAsk)));
  try {
    assert.equal(m.asks().length, 0, 'the deck draws its own; nothing else does');
  } finally { await m.unmount(); }
  assert.match(codeOnly(read('pages/raise/pitch/DeckAsk.jsx')), /useHeaderAskClaim\(\);/);
  assert.match(codeOnly(read('ui/WorkerRail.jsx')), /\{!collapsed && !groups && <div className="fwr-ask-entry">/, 'never on a deck rail (D1604)');
});

test('AK11: an admin console with no primary draws Ask alone; where Ask does not serve, no actions row at all', async () => {
  // Mutation checked: the row gated on `actions || more` only → no Ask on a page with no primary.
  __resetEadwynPanelForTest();
  const header = (serves) => h(MemoryRouter, null, h(Rail, { serves }), h(AdminPageHeader, { title: 'Approvals', line: 'Eadwyn proposes; the admin decides.' }));
  let m = await mount(header(true));
  try {
    assert.equal(m.asks().length, 1);
    assert.equal(m.props(m.asks()[0])['data-testid'], 'admin-page-ask');
  } finally { await m.unmount(); }
  __resetEadwynPanelForTest();
  m = await mount(header(false));
  try {
    assert.equal(m.asks().length, 0);
    assert.equal(m.walk(m.container).filter((n) => m.props(n)['data-testid'] === 'admin-page-actions').length, 0, 'no empty row');
  } finally { await m.unmount(); }
});

test('AK12: every host\'s rail track reads the panel\'s width, which is 420px only while docked open at 1440px and up', () => {
  // Mutation checked: one host left on the bare var(--fwr-track, Npx) → named here.
  const root = new URL('../src/', import.meta.url).pathname;
  const css = [];
  const walkDir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkDir(p); else if (p.endsWith('.css')) css.push(p); } };
  walkDir(root);
  let reads = 0;
  for (const f of css) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/var\(--fwr-track[^)]*\)/g)) {
      reads += 1;
      const after = src.slice(m.index - 5, m.index + m[0].length + 26);
      assert.match(after, /calc\(var\(--fwr-track, \d+px\) \+ var\(--fwr-ask, 0px\)\)/, `${f.slice(root.length)} reads the rail track without the Ask width`);
    }
  }
  assert.ok(reads >= 17, `every host: ${reads}`);
  const ask = codeOnly(read('ui/askPanel.css'));
  assert.match(ask, /@media \(min-width: 1440px\) \{\s*:root\[data-eadwyn-ask-at="dock"\] \{ --fwr-ask: 420px; \}/);
  assert.match(ask, /@container fwr-col \(min-width: 400px\)/, 'the rail moves clear only where its track widened');
  const rail = codeOnly(read('ui/WorkerRail.jsx'));
  assert.match(rail, /if \(askState\.open && askAt === 'dock'\) root\.setAttribute\('data-eadwyn-ask-at', 'dock'\);/);
});

test('the source: every shared header mounts HeaderAsk, and the pages that drew PageAsk directly go through it', () => {
  assert.match(codeOnly(read('ui/HeaderAsk.jsx')), /return <PageAsk label=\{label\} testId=\{testId\} \/>;/);
  assert.match(codeOnly(read('workspaces/ZoneActions.jsx')), /<HeaderAsk testId="zone-actions-ask" \/>/);
  assert.match(codeOnly(read('workspaces/ProfileHeaderAsk.jsx')), /return <HeaderAsk testId="zone-header-ask" \/>;/);
  assert.match(codeOnly(read('pages/cycles/CycleOverview.jsx')), /const askNode = ask \?\? <HeaderAsk label=/);
  // Part 5b: the admin header (AK11), the investor portfolio header, the bespoke HQ and desk headers, and the rail's fallback.
  assert.match(codeOnly(read('ui/AdminPageHeader.jsx')), /\{actions\}<HeaderAsk testId="admin-page-ask" \/>/);
  assert.match(codeOnly(read('ui/WorkerRail.jsx')), /<HeaderAsk fallback testId="rail-ask" \/>/);
  for (const f of ['components/WorkspaceTabs.jsx', 'pages/admin/AdminTeam.jsx', 'pages/admin/AdminTelegram.jsx', 'pages/admin/contracts/ContractsDesk.jsx', 'pages/branch/BranchSettings.jsx',
    'pages/hq/AccountsPage.jsx', 'pages/hq/ContentPage.jsx', 'pages/hq/CreditRulesRegistryPage.jsx', 'pages/hq/HqBranchOverlay.jsx', 'pages/hq/HqFundsPage.jsx', 'pages/hq/HqHomePage.jsx',
    'pages/hq/HqSupportPage.jsx', 'pages/hq/MeetingBotsPage.jsx', 'pages/hq/MemberCreditsPage.jsx', 'pages/hq/PlatformPage.jsx', 'pages/hq/RevenuePage.jsx', 'pages/hq/ReviewQueuePage.jsx',
    'pages/hq/SecurityPage.jsx', 'pages/hq/TrustObligationsPage.jsx', 'pages/founder/FounderNetworkDesk.jsx', 'pages/founder/FounderResearchDesk.jsx',
    'pages/investor/InvestorResearchWorkspace.jsx', 'pages/raise/pitch/NewDeck.jsx', 'pages/raise/pitch/TemplatesGallery.jsx']) {
    assert.match(codeOnly(read(f)), /<HeaderAsk \/>/, f);
  }
  for (const f of ['pages/cycles/CycleRoute.jsx', 'pages/cycles/RaiseOverviewLead.jsx', 'pages/work/CompliancePage.jsx', 'pages/work/WorkPage.jsx', 'pages/team/AskButton.jsx']) {
    const src = codeOnly(read(f));
    assert.match(src, /<HeaderAsk\b/, f);
    assert.doesNotMatch(src, /<PageAsk\b/, `${f} draws a second Ask beside the shared one`);
  }
});
