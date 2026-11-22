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
import * as dealPageModel from '../src/pages/dealPageModel.js';
import { TAB_DEFS, dealGroupsFor, dealTabsFor, scopeHref, tabHref, tabOf } from '../src/pages/dealPageModel.js';

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
  // D6164 part 3 (answer A): the investor's last view is Activity, whose Firm notes filter holds the notes.
  assert.deepEqual(dealTabsFor('investor'), ['overview', 'scorecard', 'evidence', 'team', 'market', 'traction', 'diligence', 'documents', 'terms', 'commitment', 'activity']);
  assert.deepEqual(dealTabsFor('founder'), ['overview', 'documents', 'terms', 'commitment', 'activity']);
  assert.ok(dealTabsFor('admin').includes('invitations') && !dealTabsFor('admin').includes('notes'), 'an investor\'s notes are their firm\'s, never the studio\'s');
  assert.ok(!dealTabsFor('partner').includes('diligence'), 'reference calls are an admin\'s and an investor\'s (D609)');
  assert.deepEqual(dealTabsFor('advisor'), ['overview']);
  assert.deepEqual(dealTabsFor('investor').map((t) => TAB_DEFS[t].label), ['Overview', 'Scorecard', 'Evidence', 'Team', 'Market', 'Traction', 'Diligence', 'Documents', 'Terms', 'Commitment', 'Activity']);
});

test('the address names the tab; a word the role does not draw, or no word, is Overview', () => {
  assert.equal(tabOf('traction', 'investor'), 'traction');
  assert.equal(tabOf('traction', 'founder'), 'overview', 'a founder has no Traction tab here');
  assert.equal(tabOf('invitations', 'investor'), 'overview');
  assert.equal(tabOf(undefined, 'investor'), 'overview');
  assert.equal(tabOf('', 'admin'), 'overview');
  assert.equal(tabHref(4, 'overview'), '/deals/4');
  assert.equal(tabHref('4', 'commitment'), '/deals/4/commitment');
  assert.equal(tabHref('4x', 'activity'), '/deals//activity', 'a bad id never reaches the address');
});

test('D6168: no tab waits any more; a scope’s drawer has its own address on the Scorecard tab', () => {
  assert.equal('WAITS' in dealPageModel, false, 'Scorecard and Evidence draw their reads (D1257, D1268); no tab draws a wait card');
  assert.equal(scopeHref(4, 'team'), '/deals/4/scorecard?scope=team');
  assert.equal(scopeHref('4', 'legal_ip'), '/deals/4/scorecard?scope=legal_ip');
  assert.equal(scopeHref(4, 'x&y=1'), '/deals/4/scorecard', 'a word that is not a scope key never reaches the address');
  assert.equal(scopeHref('4x', 'team'), '/deals//scorecard?scope=team', 'a bad id never reaches the address');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

// D4815 part 4 (#5903, DE04): the tab row is the eight tabs, each holding the views above; a
// view keeps its address, and the tab holding it is the one lit.
test('an investor at /deals/4: Overview from the deal read, the eight tabs as links, Overview current', async () => {
  const v = await mounted('/deals/4', INVESTOR);
  try {
    assert.ok(v.text().includes('Harbor Ledger'));
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')), dealGroupsFor('investor').map((g) => `deal-tab-${g.id}`));
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')).length, 8);
    assert.deepEqual(v.current(), ['deal-tab-overview']);
    assert.equal(v.hrefOf('deal-tab-evidence'), '/deals/4/evidence');
    assert.equal(v.ids().filter((id) => id.startsWith('deal-wait-')).length, 0);
  } finally { await v.close(); }
});

test('D1154: Traction reads its own section and draws no wait card', async () => {
  const v = await mounted('/deals/4/traction', INVESTOR);
  try {
    assert.deepEqual(v.current(), ['deal-tab-scorecard', 'deal-subtab-traction'], 'D6164 part 3: Traction is a view under Scorecard, at its old address');
    assert.ok(!v.ids().includes('deal-wait-traction'));
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/traction$/.test(u)), 'Traction reads D1151\'s section');
  } finally { await v.close(); }
});

test('/notes opens Activity with Firm notes on and reads your firm\'s notes (D1152, D6164 part 3); Commitment reads the investor\'s own commitments', async () => {
  let v = await mounted('/deals/4/notes', INVESTOR);
  try {
    assert.ok(!v.ids().includes('deal-wait-notes'), 'D1152: part 2\'s store is read, so Notes no longer waits');
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/notes/.test(u)));
    assert.deepEqual(v.current(), ['deal-tab-activity'], 'the notes are Activity\'s Firm notes');
  } finally { await v.close(); }
  v = await mounted('/deals/4/commitment', INVESTOR);
  try {
    assert.deepEqual(v.current(), ['deal-tab-investment'], 'Commitment opens Investment at its old address');
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/commitments/.test(u)));
  } finally { await v.close(); }
});

test('a founder at another role\'s tab sees Overview, with the tabs that hold their five views', async () => {
  const v = await mounted('/deals/4/traction', FOUNDER);
  try {
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')), ['deal-tab-overview', 'deal-tab-dataroom', 'deal-tab-terms', 'deal-tab-investment', 'deal-tab-activity']);
    assert.deepEqual(v.current(), ['deal-tab-overview']);
    assert.ok(!v.ids().includes('deal-wait-traction'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the tab route beside the deal route, tabs as links, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  // D1152: an Advisor and an Explorer reach the page for DL22's words.
  assert.match(app, /<Route path="\/deals\/:dealId" element=\{guard\(\['admin', 'partner', 'investor', 'founder', 'advisor', 'exploring'\], investorWorkspace\('deals', <DealRoomPage \/>\)\)\} \/>/);
  assert.match(app, /<Route path="\/deals\/:dealId\/:tab" element=\{guard\(\['admin', 'partner', 'investor', 'founder', 'advisor', 'exploring'\], investorWorkspace\('deals', <DealRoomPage \/>\)\)\} \/>/);
  const page = read('frontend/src/pages/DealRoomPage.jsx');
  assert.ok(!page.includes('setTab('), 'a tab is an address, never local state');
  assert.ok(page.includes("navigate(tabHref(deal.id, 'commitment'))"), 'a recorded commitment opens Commitment at its address');
  for (const f of ['Investor Deal Page.dc.html', 'Deal page · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Deal page · Boards.dc.html').includes('Investor Deal Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1148.md'));
  assert.ok(existsSync('documentation/audits/DEAL_PAGE_MAP_2026-10-25.md'));
});

// D4631 (#4631): the documents list is behind the venture's NDA for an investor; the tab says so, it is not "unreadable".
// D6186 (#6186): the non-investor tab is `deal/DealDocumentsStaff.jsx`; an Operating Partner meets the same NDA rule there.
test('D4631: the Documents tab tells a reader without the NDA why, and keeps a failed read unreadable', () => {
  const page = readFileSync(new URL('../src/pages/DealRoomPage.jsx', import.meta.url), 'utf8');
  assert.ok(!page.includes('function DocumentsTab'), 'the legacy list is gone (D6186)');
  assert.match(page, /<DealDocumentsStaff deal=\{deal\} viewer=\{viewerOf\(role, user, deal\)\} \/>/);
  const src = readFileSync(new URL('../src/pages/deal/DealDocumentsStaff.jsx', import.meta.url), 'utf8');
  assert.match(src, /status: e\?\.code === 'nda_required' \? 'nda' : 'unreadable'/);
  assert.match(src, /data-testid="deal-documents-nda"/);
  assert.match(src, /claim="That is not a claim that no documents exist\."/);
});
