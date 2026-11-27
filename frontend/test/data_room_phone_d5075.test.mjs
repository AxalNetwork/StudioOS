// D5075 part 2 (#5075) — the Data room on a phone (DR33 RAD33B, DR22b): Access
// is investor cards, not the 880px table or the file × investor matrix; each
// card carries since, until, folders, the NDA, what the investor can open and
// what stays shut, and opens a sheet that lists every file with `grantOn`'s
// rule. Files is cards with a 44px link and Select. Each detailed table sits
// behind View table. Desktop is unchanged. Every name is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_phone_d5075.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DataRoomAccess from '../src/pages/raise/dataroom/DataRoomAccess.jsx';
import DataRoomFiles from '../src/pages/raise/dataroom/DataRoomFiles.jsx';
import { accessRows, grantFiles, matrix } from '../src/pages/raise/dataroom/accessModel.js';
import { ROOM_CAPS } from './_data_room_capabilities.mjs';

const h = React.createElement;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const FAR = '2099-12-31 23:59:59';
const LONG = 'Kingfisher Long Horizon Opportunities Growth Equity Partners Fund IV International';
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROOM = (o = {}) => ({
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  role: 'owner', capabilities: ROOM_CAPS.owner,
  folders: [
    { id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'nda' },
    { id: 3, uid: 'f3', name: 'Legal', parent_id: null, visibility: 'open' },
  ],
  files: [
    { id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'nda', access_tier: 'invited', access_expires_at: null, downloads: 3 },
    { id: 12, uid: 'a2', name: 'Deck.pdf', folder_id: null, visibility: 'open', access_tier: 'nobody', access_expires_at: null, downloads: 0 },
    { id: 14, uid: 'a4', name: 'Contract.pdf', folder_id: 3, visibility: 'open', access_tier: 'invited', access_expires_at: null, downloads: null },
  ],
  grants: [
    { uid: 'g1', status: 'active', created_at: '2026-10-01 09:00:00', expires_at: FAR, investor_name: LONG, investor_email: 'a@kingfisher.example', granted_by_name: 'Founder A', nda_signed: true, nda_pending: false, committed: 1, folders: null },
    { uid: 'g2', status: 'active', created_at: '2026-10-02 09:00:00', expires_at: null, investor_name: 'Juniper Angels', investor_email: 'j@juniper.example', granted_by_name: 'Founder A', nda_signed: false, nda_pending: true, committed: 0, folders: ['f3'] },
    { uid: 'g4', status: 'revoked', created_at: '2026-08-01 09:00:00', expires_at: null, investor_name: 'Harbor Seed Fund', investor_email: 'h@harbor.example', nda_signed: false, nda_pending: false, committed: 0, folders: null },
  ],
  report_shares: [],
  recent_access: [{ action: 'open_room', created_at: '2026-10-22 10:00:00', user_email: 'a@kingfisher.example', file_name: null }],
  ...o,
});

async function mounted(el) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET' }); return response({ ok: true }); };
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (v) => v.requests.filter((q) => q.method !== 'GET');

test('the model: a card’s open and shut counts and the file-by-file list say what the matrix says', () => {
  const room = ROOM();
  const rows = accessRows(room, NOW);
  const g1 = rows.find((r) => r.uid === 'g1');
  assert.deepEqual([g1.open, g1.shut, g1.total, g1.canOpen], [2, 1, 3, '2 of 3']);
  const g4 = rows.find((r) => r.uid === 'g4');
  assert.deepEqual([g4.open, g4.shut, g4.canOpen], [0, 3, '0 of 3'], 'a revoked grant opens nothing');
  const m = matrix(room, {}, NOW);
  for (const g of room.grants.filter((x) => x.status === 'active')) {
    const col = m.investors.findIndex((i) => i.uid === g.uid);
    const files = grantFiles(room, g, NOW);
    assert.deepEqual(files.map((f) => f.why), m.rows.map((r) => r.cells[col].why), `${g.uid}: the sheet and the matrix disagree`);
  }
  const j = grantFiles(room, room.grants[1], NOW);
  assert.deepEqual(j.map((f) => [f.name, f.folder, f.open]), [['Model.xlsx', 'Financials', false], ['Deck.pdf', 'Top level', false], ['Contract.pdf', 'Legal', true]]);
  assert.match(j[0].why, /does not include this folder/);
});

test('Access on a phone: investor cards, no wide table, the matrix behind View table, and a sheet file by file', async () => {
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => {}, phone: true }));
  try {
    assert.ok(v.has('dataroom-access-cards'), 'no cards on a phone');
    assert.ok(!v.has('dataroom-access-table'), 'the 880px table is drawn on a phone');
    assert.ok(!v.has('access-view-matrix'), 'the List/Matrix switch is drawn on a phone');
    assert.ok(!v.has('access-matrix'), 'the matrix is open before View table');
    assert.ok(!v.has('grant-card-g4'), 'Active grants by default, as the list');
    const card = v.textOf('grant-card-g1');
    assert.ok(card.includes(LONG), 'the long name is cut');
    assert.match(card, /Since 1 Oct 2026 · until 31 Dec 2099 · All folders/);
    assert.equal(v.textOf('grant-card-open-count-g1'), '2 of 3 files');
    assert.equal(v.textOf('grant-card-shut-g1'), '1 file');
    assert.match(card, /NDASigned.*CommittedYes.*Last eventOpened the room · 22 Oct 2026/s);
    assert.match(v.textOf('grant-card-g2'), /No end date · Legal.*Waiting for signatures/s);
    assert.equal(v.textOf('grant-card-shut-g2'), '2 files');
    for (const id of ['grant-card-open-g1', 'grant-card-files-g1', 'grant-card-revoke-g1', 'access-share', 'access-view-table']) {
      assert.match(v.props(id).className, /min-h-\[44px\]/, `${id} is under 44px`);
    }
    assert.equal(v.props('access-view-table')['aria-expanded'], false);
    await v.click('access-view-table');
    assert.equal(v.props('access-view-table')['aria-expanded'], true);
    assert.equal(v.props('access-view-table')['aria-controls'], 'dataroom-access-phone-matrix');
    assert.ok(v.has('access-matrix'), 'View table opens the matrix');
    await v.click('grant-card-files-g2');
    assert.ok(v.has('investor-lightbox'));
    assert.match(v.textOf('investor-file-a1'), /Model\.xlsx.*Financials.*does not include this folder/s);
    assert.match(v.textOf('investor-file-a4'), /Contract\.pdf.*Legal.*✓ Can open/s);
    assert.match(v.props('investor-revoke').className, /min-h-\[44px\]/);
    await v.click('investor-revoke');
    assert.ok(v.has('revoke-dialog'), 'Revoke is asked first');
    assert.equal(writes(v).length, 0, 'reading and opening wrote nothing');
  } finally { await v.close(); }
});

test('Access on a phone: Revoke on a card opens the same dialog; a co-founder has no Revoke', async () => {
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => {}, phone: true }));
  try {
    await v.click('grant-card-revoke-g2');
    assert.match(v.textOf('revoke-dialog'), /Revoke Juniper Angels’s access\?/);
    assert.equal(writes(v).length, 0);
  } finally { await v.close(); }
  const c = await mounted(h(DataRoomAccess, { room: ROOM({ role: 'cofounder', capabilities: ROOM_CAPS.cofounder }), projectUid: 'p3uid', reload: () => {}, phone: true }));
  try {
    assert.ok(c.has('grant-card-g1'));
    assert.ok(!c.has('grant-card-revoke-g1'), 'a co-founder cannot revoke');
  } finally { await c.close(); }
});

test('Access on a desktop is unchanged: the table, the List/Matrix switch, no cards', async () => {
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }));
  try {
    assert.ok(v.has('dataroom-access-table'));
    assert.ok(v.has('access-view-matrix'));
    assert.ok(!v.has('dataroom-access-cards'));
    assert.ok(!v.has('access-view-table'));
    assert.doesNotMatch(v.props('access-share').className, /min-h-\[44px\]/);
    await v.click('grant-open-g2');
    assert.ok(!v.has('investor-files'), 'the file-by-file list is the phone’s');
  } finally { await v.close(); }
});

test('Files on a phone: cards with a 44px link and Select, the table behind View table; desktop keeps the table', async () => {
  const v = await mounted(h(DataRoomFiles, { room: ROOM(), projectUid: 'p3uid', projectId: 7, reload: () => {}, phone: true }));
  try {
    assert.ok(v.has('dataroom-files-cards'));
    assert.ok(!v.has('dataroom-files-table'), 'the 760px table is drawn on a phone');
    assert.match(v.textOf('dataroom-file-card-a1'), /Model\.xlsx.*FolderFinancials.*Gate.*NDA.*UntilNo end date.*Links issued3.*Who can open it now/s);
    assert.match(v.textOf('dataroom-file-card-a4'), /Links issuedNot recorded/, 'a missing count is never 0');
    assert.match(v.props('dataroom-file-card-open-a1').className, /min-h-\[44px\]/);
    assert.match(v.props('dataroom-upload').className, /min-h-\[44px\]/);
    await v.click('dataroom-files-view-table');
    assert.equal(v.props('dataroom-files-view-table')['aria-expanded'], true);
    assert.ok(v.has('dataroom-files-table'), 'View table opens the table');
  } finally { await v.close(); }
  const d = await mounted(h(DataRoomFiles, { room: ROOM(), projectUid: 'p3uid', projectId: 7, reload: () => {} }));
  try {
    assert.ok(d.has('dataroom-files-table'));
    assert.ok(!d.has('dataroom-files-cards'));
    assert.doesNotMatch(d.props('dataroom-upload').className, /min-h-\[44px\]/);
  } finally { await d.close(); }
});

test('DataRoomTool hands Files the phone flag', () => {
  const tool = readFileSync(new URL('../src/pages/raise/dataroom/DataRoomTool.jsx', import.meta.url), 'utf8');
  assert.match(tool, /<FilesTab [^>]*phone=\{phone\}/);
  assert.match(tool, /<DataRoomFiles [^>]*phone=\{phone\}/);
});
