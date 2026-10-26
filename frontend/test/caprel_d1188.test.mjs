// D1188 (#2457) — the Capital relationships tool inside the Raise module page:
// its tab words (the canvas's seven), Pipeline's investors and Calls' history
// from the module read, Commitments from today's closes and pro-rata, and the
// wiring. D1193 (#3127): Match, Outreach and Activity no longer wait; each
// draws its own read (`caprel_tabs_d1193.test.mjs` holds their rules).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_d1188.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { TABS, isCapRelTab, tabHref, tabSearch } from '../src/pages/raise/caprel/capRelModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const cell = (text) => ({ text });
// `services/raiseCycle.ts` fundCells: one row per section, keyed by its section key.
const MODULE = {
  module: { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
  card: { state: 'empty', reason: 'No investors yet.' },
  records: {
    linkable: true, total: 2, page: 1, page_size: 25,
    cols: [{ key: 'investor', label: 'Investor' }, { key: 'stage', label: 'Stage' }],
    rows: [{ id: 41, cells: { investor: cell('Bluefern Capital'), stage: cell('Meeting') } },
      { id: 42, cells: { investor: cell('Northwind Ventures'), stage: cell('Intro') } }],
  },
  parts: { calls: { state: 'ok', items: [] } },
};

// D1192: Pipeline is the board, from the pipeline's own prospects read.
const PROSPECTS = { items: [
  { id: 41, name: 'Bluefern Capital', stage: 'meeting', updated_at: '2026-10-20' },
  { id: 42, name: 'Northwind Ventures', stage: 'to_contact', updated_at: '2026-10-19' },
] };

function handler(url) {
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  if (/\/contacts\/raise-prospects\?/.test(url)) return response(PROSPECTS);
  if (/\/records\/[^/?]+\?/.test(url)) return response({ title: 'Bluefern Capital', sections: [], actions: [] });
  if (/\/contacts\/raise-closes/.test(url)) return response({ closes: [], round: null });
  if (/\/contacts\/raise-pro-rata/.test(url)) return response({ items: [] });
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

test('the canvas\'s seven tabs, and only their words are tabs; an investor is still a record; the venture is the only query kept', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Pipeline', 'Match', 'Outreach', 'Commitments', 'Calls', 'Activity']);
  for (const w of ['pipeline', 'match', 'outreach', 'commitments', 'calls', 'activity']) assert.ok(isCapRelTab('capital-relationships', w), w);
  for (const id of ['41', 'new', 'overview', '']) assert.ok(!isCapRelTab('capital-relationships', id), id);
  assert.ok(!isCapRelTab('use-of-funds', 'pipeline'), 'only Capital relationships has these words');
  assert.equal(tabSearch('?project=7&x=1#y'), '?project_id=7');
  assert.equal(tabSearch('?project_id=7%3Cb%3E'), '');
  assert.equal(tabHref(TABS[4], '?project_id=3'), '/raise/capital-relationships/commitments?project_id=3');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Pipeline draws the venture\'s investors on the board (D1192), each opening its lightbox, never a record called "pipeline"', async () => {
  const v = await mounted('/raise/capital-relationships/pipeline?project_id=3');
  try {
    assert.ok(v.requests.some((u) => u.includes('/contacts/raise-prospects?project_id=3')));
    assert.ok(!v.requests.some((u) => /\/records\/pipeline/.test(u)), 'a tab word is not a record');
    assert.ok(v.testIds().includes('caprel-pipeline-page') && v.testIds().includes('caprel-tabs') && v.testIds().includes('caprel-board'));
    assert.match(v.text(), /Northwind Ventures[\s\S]*Bluefern Capital/, 'Identified before Meeting');
  } finally { await v.close(); }
});

test('Calls draws the module read\'s calls; Commitments reads D1190\'s commitments, the closes and pro-rata (D1193)', async () => {
  let v = await mounted('/raise/capital-relationships/calls?project_id=3');
  try { assert.ok(v.testIds().includes('caprel-calls')); } finally { await v.close(); }
  v = await mounted('/raise/capital-relationships/commitments?project_id=3');
  try {
    assert.ok(v.testIds().includes('caprel-commitments'));
    assert.ok(v.requests.some((u) => /\/capital-relationships\/commitments\?project=3/.test(u)));
    assert.ok(v.requests.some((u) => /\/contacts\/raise-closes/.test(u)));
    assert.ok(v.requests.some((u) => /\/contacts\/raise-pro-rata/.test(u)));
  } finally { await v.close(); }
});

test('D1193: Match, Outreach and Activity each draw their own read, and no tab waits', async () => {
  const reads = { match: /\/capital-relationships\/match\?project=3/, outreach: /\/capital-relationships\/materials\?project=3/, activity: /\/capital-relationships\/activity\?project=3/ };
  for (const [tab, url] of Object.entries(reads)) {
    const v = await mounted(`/raise/capital-relationships/${tab}?project_id=3`);
    try {
      assert.ok(v.testIds().includes(`caprel-${tab}`), tab);
      assert.ok(!v.testIds().some((id) => id.startsWith('caprel-wait-')), `${tab} does not wait`);
      assert.ok(v.requests.some((u) => url.test(u)), `${tab} reads its own read`);
    } finally { await v.close(); }
  }
});

test('Overview is the module page with the tabs; an investor is still its record page; another module is not this tool', async () => {
  const home = await mounted('/raise/capital-relationships?project_id=3');
  try { assert.ok(home.testIds().includes('cycle-module') && home.testIds().includes('caprel-tabs')); } finally { await home.close(); }
  const row = await mounted('/raise/capital-relationships/41?project_id=3');
  try {
    assert.ok(row.requests.some((u) => u.includes('/records/41?project=3')));
    assert.ok(row.testIds().includes('cycle-record-page') && !row.testIds().includes('caprel-tabs'));
  } finally { await row.close(); }
  const other = await mounted('/raise/use-of-funds/runway?project_id=3');
  try { assert.ok(!other.testIds().includes('caprel-tabs')); } finally { await other.close(); }
});

test('a failed investors read says so where the board would be (D1192)', async () => {
  const fail = await mounted('/raise/capital-relationships/pipeline?project_id=3', { handle: (u) => (u.includes('/contacts/raise-prospects') ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    assert.match(fail.text(), /This is not a claim that you have none\./);
    assert.doesNotMatch(fail.text(), /Bluefern Capital/);
  } finally { await fail.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: no route is added, CycleRoute branches on the tab word, and the canvas sits in incoming', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.ok(route.includes('isCapRelTab(slug, recordId)') && route.includes('!capRelTab && !!projectId'));
  // D1221 (#2458) adds the one route a tab word cannot carry: one call, below the Calls tab.
  const app = read('frontend/src/App.jsx').replace(`<Route path="/raise/capital-relationships/calls/:uid" element={guard(labRoles(['admin', 'founder']), <RaiseCallPage />)} />`, '');
  assert.ok(!app.includes('path="/raise/capital-relationships'), 'no other route is added');
  for (const f of ['Capital Relationships Page.dc.html', 'Capital relationships · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Capital relationships · Boards.dc.html').includes('Capital Relationships Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1188.md'));
  assert.ok(existsSync('documentation/audits/CAPITAL_RELATIONSHIPS_MAP_2026-10-25.md'));
});
