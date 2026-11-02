// D1443 part 5 (#3992) — Ask on every rail page header: one helper
// (`ui/HeaderAsk.jsx`), mounted by the shared header pieces, one button a page.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/header_ask_d1443p5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { __resetEadwynPanelForTest, useAskRail } from '../src/ui/eadwynPanel.js';
import { askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import HeaderAsk, { headerAskClaims } from '../src/ui/HeaderAsk.jsx';
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

test('the source: every shared header mounts HeaderAsk, and the pages that drew PageAsk directly go through it', () => {
  assert.match(codeOnly(read('ui/HeaderAsk.jsx')), /return <PageAsk label=\{label\} testId=\{testId\} \/>;/);
  assert.match(codeOnly(read('workspaces/ZoneActions.jsx')), /<HeaderAsk testId="zone-actions-ask" \/>/);
  assert.match(codeOnly(read('workspaces/ProfileHeaderAsk.jsx')), /return <HeaderAsk testId="zone-header-ask" \/>;/);
  assert.match(codeOnly(read('pages/cycles/CycleOverview.jsx')), /const askNode = ask \?\? <HeaderAsk label=/);
  for (const f of ['pages/cycles/CycleRoute.jsx', 'pages/cycles/RaiseOverviewLead.jsx', 'pages/work/CompliancePage.jsx', 'pages/team/AskButton.jsx']) {
    const src = codeOnly(read(f));
    assert.match(src, /<HeaderAsk\b/, f);
    assert.doesNotMatch(src, /<PageAsk\b/, `${f} draws a second Ask beside the shared one`);
  }
});
