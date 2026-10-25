// D1148 (#2421) — the deal page's tabs at their own addresses: each role's
// tabs in the canvas's order, a word the role does not draw opening Overview,
// today's reads on the tabs that have them, and "Not read here yet" with its
// reason on the tabs that do not.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_page_d1148.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { NOT_YET, TAB_DEFS, WAITS, dealTabsFor, tabHref, tabOf } from '../src/pages/dealPageModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DEAL = { id: 4, uid: 'd4', project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, progress_pct: 25, days_in_stage: 3 };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const FOUNDER = { id: 30, role: 'founder', founder_id: 9, name: 'Bram', email: 'bram@example.com' };

function handler(url) {
  if (/\/api\/deals\/4\/activity/.test(url)) return response([{ id: 1, action: 'deal_created', created_at: '2026-10-20 10:00:00' }]);
  if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
  if (/\/api\/deals\/4\/documents/.test(url)) return response([]);
  if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
  if (/\/api\/deals\/invitations\/mine/.test(url)) return response([]);
  if (/\/api\/references/.test(url)) return response([]);
  return response({});
}

async function mounted(url, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handler(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })),
    h(Probe)))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, at, text: () => text(container), ids,
    textOf: (id) => text(nodes().find((n) => props(n)['data-testid'] === id)),
    hrefOf: (id) => props(nodes().find((n) => props(n)['data-testid'] === id)).href,
    current: () => nodes().filter((n) => props(n)['aria-current'] === 'page').map((n) => props(n)['data-testid']),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('each role draws the canvas\'s tabs in its order: eleven for an investor (DL1), five for a founder (DL16), staff with their own (DL17)', () => {
  assert.deepEqual(dealTabsFor('investor'), ['overview', 'scorecard', 'evidence', 'team', 'market', 'traction', 'diligence', 'documents', 'terms', 'commitment', 'notes']);
  assert.deepEqual(dealTabsFor('founder'), ['overview', 'documents', 'terms', 'commitment', 'activity']);
  assert.ok(dealTabsFor('admin').includes('invitations') && !dealTabsFor('admin').includes('notes'), 'an investor\'s notes are their firm\'s, never the studio\'s');
  assert.ok(!dealTabsFor('partner').includes('diligence'), 'reference calls are an admin\'s and an investor\'s (D609)');
  assert.deepEqual(dealTabsFor('advisor'), ['overview']);
  assert.deepEqual(dealTabsFor('investor').map((t) => TAB_DEFS[t].label), ['Overview', 'Scorecard', 'Evidence', 'Team', 'Market', 'Traction', 'Diligence', 'Documents', 'Terms', 'Commitment', 'Notes']);
});

test('the address names the tab; a word the role does not draw, or no word, is Overview', () => {
  assert.equal(tabOf('traction', 'investor'), 'traction');
  assert.equal(tabOf('traction', 'founder'), 'overview', 'a founder has no Traction tab here');
  assert.equal(tabOf('invitations', 'investor'), 'overview');
  assert.equal(tabOf(undefined, 'investor'), 'overview');
  assert.equal(tabOf('', 'admin'), 'overview');
  assert.equal(tabHref(4, 'overview'), '/deals/4');
  assert.equal(tabHref('4', 'commitment'), '/deals/4/commitment');
  assert.equal(tabHref('4x', 'notes'), '/deals//notes', 'a bad id never reaches the address');
});

test('every tab with no read says why, and none says zero or none', () => {
  for (const t of ['scorecard', 'evidence', 'team', 'market', 'traction', 'terms', 'notes', 'diligence']) assert.ok(WAITS[t], t);
  for (const w of Object.values(WAITS)) assert.ok(!/\b0\b|\$0|\bnone\b/i.test(w.replace('not a score of zero', '')), w);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('an investor at /deals/4: Overview from the deal read, the eleven tabs as links, Overview current', async () => {
  const v = await mounted('/deals/4', INVESTOR);
  try {
    assert.ok(v.text().includes('Harbor Ledger'));
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')), dealTabsFor('investor').map((t) => `deal-tab-${t}`));
    assert.deepEqual(v.current(), ['deal-tab-overview']);
    assert.equal(v.hrefOf('deal-tab-traction'), '/deals/4/traction');
    assert.equal(v.ids().filter((id) => id.startsWith('deal-wait-')).length, 0);
  } finally { await v.close(); }
});

test('a tab with no read draws its wait card and makes no read of its own', async () => {
  const v = await mounted('/deals/4/traction', INVESTOR);
  try {
    assert.deepEqual(v.current(), ['deal-tab-traction']);
    assert.ok(v.textOf('deal-wait-traction').includes(NOT_YET));
    assert.ok(v.textOf('deal-wait-traction').includes(WAITS.traction));
    assert.ok(!v.requests.some((u) => /traction|metrics/.test(u)), 'nothing is read for Traction');
  } finally { await v.close(); }
});

test('Notes waits for its store and carries the activity under it; Commitment reads the investor\'s own commitments', async () => {
  let v = await mounted('/deals/4/notes', INVESTOR);
  try {
    assert.ok(v.ids().includes('deal-wait-notes'));
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/activity/.test(u)));
  } finally { await v.close(); }
  v = await mounted('/deals/4/commitment', INVESTOR);
  try {
    assert.deepEqual(v.current(), ['deal-tab-commitment']);
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/commitments/.test(u)));
  } finally { await v.close(); }
});

test('a founder at another role\'s tab sees Overview, with their five tabs', async () => {
  const v = await mounted('/deals/4/traction', FOUNDER);
  try {
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')), dealTabsFor('founder').map((t) => `deal-tab-${t}`));
    assert.deepEqual(v.current(), ['deal-tab-overview']);
    assert.ok(!v.ids().includes('deal-wait-traction'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the tab route beside the deal route, tabs as links, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/deals\/:dealId" element=\{guard\(\['admin', 'partner', 'investor', 'founder'\], investorWorkspace\('deals', <DealRoomPage \/>\)\)\} \/>/);
  assert.match(app, /<Route path="\/deals\/:dealId\/:tab" element=\{guard\(\['admin', 'partner', 'investor', 'founder'\], investorWorkspace\('deals', <DealRoomPage \/>\)\)\} \/>/);
  const page = read('frontend/src/pages/DealRoomPage.jsx');
  assert.ok(!page.includes('setTab('), 'a tab is an address, never local state');
  assert.ok(page.includes("navigate(tabHref(deal.id, 'commitment'))"), 'a recorded commitment opens Commitment at its address');
  for (const f of ['Investor Deal Page.dc.html', 'Deal page · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Deal page · Boards.dc.html').includes('Investor Deal Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1148.md'));
  assert.ok(existsSync('documentation/audits/DEAL_PAGE_MAP_2026-10-25.md'));
});
