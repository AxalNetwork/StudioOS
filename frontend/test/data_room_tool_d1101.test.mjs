// D1101 (#2456) — the Data room tool inside the Raise module page: its tab
// words, the three tabs the founder's room read carries (Files, Access,
// Activity), the three that say what they wait for, and the wiring.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_tool_d1101.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  TABS, WAITS, activityRows, fileRows, grantRows, isDataRoomTab, projectUidOf, tabHref, tabSearch, weekTiles, workspaceHref,
} from '../src/pages/raise/dataroom/dataRoomModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const NOW = Date.parse('2026-10-25T12:00:00Z');
const FAR = '2099-01-01';
// `routes/data_room.ts` GET /:projectUid, founder side.
const ROOM = {
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  folders: [{ id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'nda' }],
  files: [
    { id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'nda', access_tier: 'invited', access_expires_at: null, downloads: 4 },
    { id: 12, uid: 'a2', name: 'Deck.pdf', folder_id: null, visibility: 'open', access_tier: 'nobody', access_expires_at: null, downloads: 0 },
  ],
  grants: [
    { uid: 'g1', status: 'active', created_at: '2026-10-01 09:00:00', expires_at: FAR, investor_email: 'a@bluefern.example', investor_name: 'Bluefern Capital', granted_by_name: 'Founder A', granted_by_role: 'founder', nda_signed: true, committed: 1 },
    { uid: 'g2', status: 'active', created_at: '2026-09-01 09:00:00', expires_at: '2026-10-01', investor_email: 'b@northwind.example', investor_name: null, granted_by_name: null, granted_by_role: null, nda_signed: false, committed: 0 },
  ],
  report_shares: [],
  recent_access: [
    { action: 'blocked', created_at: '2026-10-24 10:00:00', user_email: 'b@northwind.example', user_name: 'Northwind', file_name: 'Model.xlsx', file_visibility: 'nda' },
    { action: 'download', created_at: '2026-10-23 10:00:00', user_email: 'a@bluefern.example', user_name: 'Bluefern Capital', file_name: 'Model.xlsx', file_visibility: 'nda' },
    { action: 'open_room', created_at: '2026-10-22 10:00:00', user_email: 'a@bluefern.example', user_name: 'Bluefern Capital', file_name: null, file_visibility: null },
  ],
  week: { opened: 3, downloaded: 2, blocked: 1 },
};
const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }, { id: 4, uid: 'p4uid', name: 'Other' }];
const MODULE = { module: { slug: 'data-room', name: 'Data room', records_title: 'Files' }, card: { state: 'empty', reason: 'No files yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function handler(url) {
  if (/\/data-room\/p3uid(\?|$)/.test(url)) return response(ROOM);
  if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
  if (/\/records\/[^/?]+\?/.test(url)) return response({ title: 'Model.xlsx', sections: [], actions: [] });
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

test('seven tabs, and only their words are tabs; a file is still a record; the venture is the only query kept', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['home', 'files', 'access', 'requests', 'activity', 'checklist', 'preview']);
  for (const w of ['files', 'access', 'requests', 'activity', 'checklist', 'preview']) assert.ok(isDataRoomTab('data-room', w), w);
  for (const id of ['12', 'new', 'home', 'trash', '']) assert.ok(!isDataRoomTab('data-room', id), id);
  assert.ok(!isDataRoomTab('cap-table', 'files'), 'only the Data room has these words');
  assert.equal(tabSearch('?project=7&mode=workspace#x'), '?project_id=7');
  assert.equal(tabHref(TABS[2], '?project_id=3&version=2'), '/raise/data-room/access?project_id=3');
  assert.equal(workspaceHref('?project_id=3'), '/raise/data-room?mode=workspace&project_id=3');
  assert.equal(workspaceHref(''), '/raise/data-room?mode=workspace');
  assert.equal(projectUidOf(PROJECTS, 3), 'p3uid');
  assert.equal(projectUidOf({ items: PROJECTS }, '4'), 'p4uid');
  assert.equal(projectUidOf(PROJECTS, 9), null);
});

test('who can open a file is the investor read\'s own predicate, and nobody is said with its reason', () => {
  const [model, deck] = fileRows(ROOM, NOW);
  assert.equal(model.folder, 'Financials');
  assert.equal(model.gate, 'NDA');
  assert.equal(model.opens, '1 investor', 'only the grant in force with an NDA');
  assert.equal(model.downloads, '4');
  assert.equal(deck.folder, 'Top level');
  assert.equal(deck.tier, 'Private to you');
  assert.equal(deck.opens, 'No one');
  assert.ok(deck.why.length > 0, 'a file nobody can open says why');
  assert.equal(fileRows({ files: [{ uid: 'x', name: 'x', visibility: 'open', downloads: null }] }, NOW)[0].downloads, 'Not recorded');
});

test('grants: in force, ended or revoked; NDA, committed and who granted; a missing name falls back to the email', () => {
  const [a, b] = grantRows(ROOM, NOW);
  assert.deepEqual([a.who, a.state, a.nda, a.committed, a.since], ['Bluefern Capital', 'In force', 'Signed', 'Committed', '1 Oct 2026']);
  assert.match(a.by, /Founder A/);
  assert.deepEqual([b.who, b.state, b.nda, b.committed], ['b@northwind.example', 'Ended', 'Not signed', 'Not committed']);
  assert.match(b.by, /Not recorded/);
  assert.equal(grantRows({ grants: [{ uid: 'r', status: 'revoked', created_at: null }] }, NOW)[0].state, 'Revoked');
});

test('activity: a refusal is never an open, a link issued is not a read, and a missing week is Not recorded', () => {
  const rows = activityRows(ROOM);
  assert.deepEqual(rows.map((r) => r.tag), ['Blocked', 'Download', 'View']);
  const tiles = weekTiles(ROOM);
  assert.deepEqual(tiles.map((t) => [t.k, t.v]), [['Room opens', '3'], ['Links issued', '2'], ['Refused', '1']]);
  assert.match(tiles[1].sub, /not a read/);
  assert.deepEqual(weekTiles({}).map((t) => t.v), ['Not recorded', 'Not recorded', 'Not recorded']);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Files, Access and Activity read the founder\'s room by the venture\'s uid, never a record called by the tab word', async () => {
  const v = await mounted('/raise/data-room/files?project_id=3');
  try {
    assert.ok(v.requests.some((u) => /\/data-room\/p3uid/.test(u)));
    assert.ok(!v.requests.some((u) => /\/records\/files/.test(u)), 'a tab word is not a record');
    assert.ok(v.testIds().includes('dataroom-files-page') && v.testIds().includes('dataroom-tabs'));
    assert.equal(v.count('dataroom-file-row'), 2);
    assert.ok(v.hrefs().includes('/raise/data-room?mode=workspace&project_id=3'), 'uploads stay in the files tool');
  } finally { await v.close(); }
  const a = await mounted('/raise/data-room/access?project_id=3');
  try { assert.equal(a.count('dataroom-grant-row'), 2); assert.match(a.text(), /Bluefern Capital/); } finally { await a.close(); }
  const l = await mounted('/raise/data-room/activity?project_id=3');
  try {
    assert.equal(l.count('dataroom-week-tile'), 3);
    assert.match(l.text(), /was blocked from/);
    assert.match(l.text(), /A link issued is not a read\./);
  } finally { await l.close(); }
});

test('Requests, Checklist and Preview say what they wait for, and make no room read', async () => {
  for (const tab of ['requests', 'checklist', 'preview']) {
    const v = await mounted(`/raise/data-room/${tab}?project_id=3`);
    try {
      assert.ok(v.testIds().includes(`dataroom-${tab}-wait`), tab);
      assert.ok(v.text().includes(WAITS[tab].slice(0, 30)), tab);
      assert.ok(!v.requests.some((u) => /\/data-room\/p3uid/.test(u)), `${tab} reads nothing it cannot use`);
    } finally { await v.close(); }
  }
});

test('Home is the module page with the tabs; a file is still its record page; another module is not this tool', async () => {
  const home = await mounted('/raise/data-room?project_id=3');
  try {
    assert.ok(home.requests.some((u) => u.includes('/cycles/raise/modules/data-room?project=3')));
    assert.ok(home.testIds().includes('cycle-module') && home.testIds().includes('dataroom-tabs') && home.testIds().includes('dataroom-home-note'));
  } finally { await home.close(); }
  const row = await mounted('/raise/data-room/12?project_id=3');
  try {
    assert.ok(row.requests.some((u) => u.includes('/records/12?project=3')));
    assert.ok(row.testIds().includes('cycle-record-page') && !row.testIds().includes('dataroom-tabs'));
  } finally { await row.close(); }
  const other = await mounted('/raise/use-of-funds?project_id=3');
  try { assert.ok(!other.testIds().includes('dataroom-tabs')); } finally { await other.close(); }
});

test('a failed room read says so where the block would be, and a refusal is not an empty room', async () => {
  const fail = await mounted('/raise/data-room/files?project_id=3', { handle: (u) => (/\/data-room\/p3uid/.test(u) ? response({ detail: 'boom' }, 500) : handler(u)) });
  try {
    assert.ok(fail.testIds().includes('dataroom-files-unreadable'));
    assert.ok(!fail.testIds().includes('dataroom-files-none'));
    assert.match(fail.text(), /This is not a claim that the room is empty\./);
  } finally { await fail.close(); }
  const refused = await mounted('/raise/data-room/access?project_id=9');
  try {
    assert.ok(refused.testIds().includes('dataroom-access-refused'), 'a venture not in the list is refused, never an empty room');
    assert.ok(!refused.testIds().includes('dataroom-access-none'));
  } finally { await refused.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: no route is added, CycleRoute branches on the tab word, and the canvas sits in incoming', () => {
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /path="\/raise\/data-room\/(files|access|requests|activity|checklist|preview)/, 'the module routes carry the tool');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.ok(route.includes("const dataRoomTab = record && cycle === 'raise' && isDataRoomTab(slug, recordId) ? recordId : null;"));
  assert.ok(route.includes('!narrativeTab && !capTableTab && !dataRoomTab && !!projectId'));
  assert.ok(route.includes("slug === DATA_ROOM ? <DataRoomHomeNav search={q} />"));
  const tool = read('frontend/src/pages/raise/dataroom/DataRoomTool.jsx');
  assert.doesNotMatch(tool, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(tool, /dataRoom(Upload|Delete|Grant|Revoke|Update)/, 'the integration writes nothing');
  for (const f of ['Raise Data Room Page.dc.html', 'Data Room · Boards.dc.html']) {
    const src = read(`design/incoming/${f}`);
    assert.ok(src.includes('<script src="./support.js"></script>'), f);
    assert.ok(!src.includes('@font-face') && !src.includes('__claude_design_branding'), f);
  }
  assert.ok(read('design/incoming/Data Room · Boards.dc.html').includes('dc-import name="Raise Data Room Page"'));
  assert.ok(read('design/incoming/Data Room · Boards.dc.html').includes('DR24'));
  assert.ok(existsSync('documentation/architecture/decisions/D1101.md'), 'D1101 records the integration');
});
