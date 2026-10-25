// D1173 (#2455) — the Use of funds tool inside the Raise module page: its tab
// words (the canvas's seven), Allocation's sections from the module read, the
// five tabs that say what they wait for, the financial model's link with the
// venture kept, and the wiring.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_d1173.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { NOT_YET, TABS, WAITS, forecastHref, isUseOfFundsTab, tabHref, tabSearch } from '../src/pages/raise/useoffunds/useOfFundsModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const cell = (text) => ({ text });
// `services/raiseCycle.ts` fundCells: one row per section, keyed by its section key.
const MODULE = {
  module: { slug: 'use-of-funds', name: 'Use of funds', records_title: 'Categories' },
  card: { state: 'empty', reason: 'No split yet.' },
  records: {
    linkable: true, total: 2, page: 1, page_size: 25,
    cols: [{ key: 'category', label: 'Category' }, { key: 'share', label: 'Share' }],
    rows: [{ id: 'product', cells: { category: cell('Product & engineering'), share: cell('45%') } },
      { id: 'go-to-market', cells: { category: cell('GTM: sales and marketing'), share: cell('30%') } }],
  },
};

function handler(url) {
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  if (/\/records\/[^/?]+\?/.test(url)) return response({ title: 'Product & engineering', sections: [], actions: [] });
  if (url.includes('/cycles/raise/modules/')) return response(MODULE);
  return response({});
}

async function mounted(url, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, flush, text: () => text(container), testIds: ids,
    count: (id) => ids().filter((x) => x === id).length,
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the canvas\'s seven tabs, and only their words are tabs; a section is still a record; the venture is the only query kept', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Home', 'Allocation', 'Milestones and hires', 'Runway', 'Scenarios', 'Plan vs actual', 'History']);
  for (const w of ['allocation', 'milestones', 'runway', 'scenarios', 'actuals', 'history']) assert.ok(isUseOfFundsTab('use-of-funds', w), w);
  for (const id of ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve', 'new', 'home', '']) assert.ok(!isUseOfFundsTab('use-of-funds', id), id);
  assert.ok(!isUseOfFundsTab('data-room', 'runway'), 'only Use of funds has these words');
  assert.equal(tabSearch('?project=7&edit=split#x'), '?project_id=7');
  assert.equal(tabSearch('?project_id=7%3Cb%3E'), '', 'a malformed venture never reaches the address');
  assert.equal(tabSearch('?project_id=0'), '');
  assert.equal(tabHref(TABS[3], '?project_id=3&x=1'), '/raise/use-of-funds/runway?project_id=3');
  assert.equal(forecastHref('?project_id=3'), '/raise/capital/model?project_id=3');
  assert.equal(forecastHref(''), '/raise/capital/model');
});

test('every waiting tab says why, never zero or none', () => {
  for (const t of ['milestones', 'runway', 'scenarios', 'actuals', 'history']) assert.ok(WAITS[t], t);
  for (const w of Object.values(WAITS)) assert.ok(!/\b0\b|\$0|\bnone\b/i.test(w), w);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Allocation draws the module read\'s sections, each opening its record, never a record called "allocation"', async () => {
  const v = await mounted('/raise/use-of-funds/allocation?project_id=3');
  try {
    assert.ok(v.requests.some((u) => u.includes('/cycles/raise/modules/use-of-funds?project=3')));
    assert.ok(!v.requests.some((u) => /\/records\/allocation/.test(u)), 'a tab word is not a record');
    assert.ok(v.testIds().includes('uof-allocation-page') && v.testIds().includes('uof-tabs'));
    assert.match(v.text(), /Product & engineering[\s\S]*GTM: sales and marketing/);
    assert.ok(v.hrefs().includes('/raise/use-of-funds/product?project_id=3'));
  } finally { await v.close(); }
});

test('Milestones, Runway, Scenarios, Plan vs actual and History say what they wait for, and make no read of their own', async () => {
  for (const tab of ['milestones', 'runway', 'scenarios', 'actuals', 'history']) {
    const v = await mounted(`/raise/use-of-funds/${tab}?project_id=3`);
    try {
      assert.ok(v.testIds().includes(`uof-wait-${tab}`), tab);
      assert.ok(v.text().includes(NOT_YET) && v.text().includes(WAITS[tab].slice(0, 30)), tab);
      assert.ok(!v.requests.some((u) => /\/records\/|\/financials\//.test(u)), `${tab} reads nothing it cannot use`);
    } finally { await v.close(); }
  }
  const r = await mounted('/raise/use-of-funds/runway?project_id=3');
  try { assert.ok(r.hrefs().includes('/raise/capital/model?project_id=3'), 'the forecast keeps the venture'); } finally { await r.close(); }
});

test('Home is the module page with the tabs; a section is still its record page; another module is not this tool', async () => {
  const home = await mounted('/raise/use-of-funds?project_id=3');
  try {
    assert.ok(home.testIds().includes('cycle-module') && home.testIds().includes('uof-tabs'));
    assert.ok(home.hrefs().includes('/raise/capital/model?project_id=3'), 'the tool link keeps the venture (broken item 8)');
  } finally { await home.close(); }
  const row = await mounted('/raise/use-of-funds/product?project_id=3');
  try {
    assert.ok(row.requests.some((u) => u.includes('/records/product?project=3')));
    assert.ok(row.testIds().includes('cycle-record-page') && !row.testIds().includes('uof-tabs'));
  } finally { await row.close(); }
  const other = await mounted('/raise/data-room/12?project_id=3');
  try { assert.ok(!other.testIds().includes('uof-tabs')); } finally { await other.close(); }
});

test('a failed module read says so where the sections would be', async () => {
  const fail = await mounted('/raise/use-of-funds/allocation?project_id=3', { handle: (u) => (u.includes('/cycles/raise/modules/') ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    assert.match(fail.text(), /This is not a claim that there are none\./);
    assert.doesNotMatch(fail.text(), /Product & engineering/);
  } finally { await fail.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: no route is added, CycleRoute branches on the tab word, and the canvas sits in incoming', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.ok(route.includes('isUseOfFundsTab(slug, recordId)') && route.includes('!uofTab && !!projectId'));
  assert.ok(route.includes("'use-of-funds': (q) => ({ label: 'Open the financial model', href: forecastHref(q) })"));
  assert.ok(!read('frontend/src/App.jsx').includes('path="/raise/use-of-funds'), 'no route is added');
  for (const f of ['Raise Use Of Funds Page.dc.html', 'Use of funds · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Use of funds · Boards.dc.html').includes('Raise Use Of Funds Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1173.md'));
  assert.ok(existsSync('documentation/audits/USE_OF_FUNDS_MAP_2026-10-25.md'));
});
